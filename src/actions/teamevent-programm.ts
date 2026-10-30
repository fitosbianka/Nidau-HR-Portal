'use server'

// Teamevent Programm: Infotexte anpassen, Teilnehmende verwalten,
// persönliche Checkliste speichern, Admin Checkliste, sensible Daten nach
// der Reise löschen. Zugriffsregel überall: eigene Checkliste nur die
// Person selbst, alles andere nur die Organisatorin (geprüft an der
// angemeldeten Person, nicht an der Admin Rolle).

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { TE_BUCKET, hatTeameventZugang, istOrganisatorin } from '@/lib/teamevents'
import { AUSWEIS_ANCHOR, ausweisKey } from '@/lib/ausweise'
import { parseAusweisGeheim, parseCheckGeheim, checkZuObjekt, bildPfad } from '@/lib/teamevent-geheim'
import { programmFuer } from '@/lib/teamevent-europapark'
import {
  TE_PROGRAMM_ANCHOR, texteKey, teilnehmerKey, checkKey, adminCheckKey, detailsKey,
  parseTexte, parseTeilnehmer, parseAdminCheck, parseDetailsRoh, parseDetail, leeresDetail, istGastId, GAST_ID_RE, fristAbgelaufen, EIGENE_PHASE, EIGEN_ID_RE, manuellAbhakbar,
  type TeCheck, type TeTexte, type Einstieg, type TeDetails, type TeAdminCheck, type EigenerPunkt,
} from '@/lib/teamevent-programm'

const SLUG_RE = /^[a-z0-9-]{2,60}$/
const UUID_RE = /^[0-9a-f-]{8,64}$/i
type Admin = Awaited<ReturnType<typeof createAdminClient>>
type Ctx = { admin: Admin; userId: string; name: string; organisatorin: boolean }

async function requireProgramm(): Promise<Ctx> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (!hatTeameventZugang(p?.role, p?.full_name)) throw new Error('Keine Berechtigung')
  return { admin: await createAdminClient(), userId: user.id, name: p?.full_name ?? 'Unbekannt', organisatorin: istOrganisatorin(p?.full_name) }
}

const NUR_ORGA = { error: 'Das kann nur die Organisatorin ändern.' }
// Hinweis: kein revalidatePath in diesen Actions. Die Teamevent Seiten sind
// force-dynamic; ein revalidatePath würde nur bei jedem Haken die ganze
// Seite serverseitig neu rendern und die Antwort verzögern. Komponenten,
// die frische Serverdaten brauchen, rufen router.refresh() selbst auf.

async function ladeZeile(admin: Admin, key: string): Promise<string | null> {
  const { data, error } = await admin.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', key).eq('schedule_date', TE_PROGRAMM_ANCHOR).maybeSingle()
  if (error) throw new Error(`Laden fehlgeschlagen: ${error.message}`)
  return (data as { comment: string } | null)?.comment ?? null
}
async function schreibeZeile(admin: Admin, key: string, wert: unknown) {
  const am = new Date().toISOString()
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: key, schedule_date: TE_PROGRAMM_ANCHOR, comment: JSON.stringify(wert), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error ? { error: error.message } : null
}

// ── Infotexte ───────────────────────────────────────────────────────────

/** Einen Textblock anpassen (eine Zeile pro Aufzählungspunkt). */
export async function texteSpeichern(slug: string, blockId: string, zeilen: string[]) {
  const ctx = await requireProgramm()
  if (!ctx.organisatorin) return NUR_ORGA
  const p = SLUG_RE.test(slug) ? programmFuer(slug) : null
  if (!p || !p.bloecke.some(b => b.id === blockId)) return { error: 'Textblock nicht gefunden.' }
  const sauber = (Array.isArray(zeilen) ? zeilen : []).map(z => String(z).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 60).map(z => z.slice(0, 300))
  if (sauber.length === 0) return { error: 'Bitte mindestens eine Zeile eingeben oder den Standardtext wiederherstellen.' }
  let texte: TeTexte
  try { texte = parseTexte(await ladeZeile(ctx.admin, texteKey(slug))) } catch (e) { return { error: e instanceof Error ? e.message : 'Fehler.' } }
  const err = await schreibeZeile(ctx.admin, texteKey(slug), { bloecke: { ...texte, [blockId]: sauber }, aktualisiertAm: new Date().toISOString(), von: ctx.name })
  if (err) return err
  return { success: true as const }
}

/** Standardtext eines Blocks wiederherstellen. */
export async function texteZuruecksetzen(slug: string, blockId: string) {
  const ctx = await requireProgramm()
  if (!ctx.organisatorin) return NUR_ORGA
  if (!SLUG_RE.test(slug)) return { error: 'Ungültig.' }
  let texte: TeTexte
  try { texte = parseTexte(await ladeZeile(ctx.admin, texteKey(slug))) } catch (e) { return { error: e instanceof Error ? e.message : 'Fehler.' } }
  const rest = { ...texte }
  delete rest[blockId]
  const err = await schreibeZeile(ctx.admin, texteKey(slug), { bloecke: rest, aktualisiertAm: new Date().toISOString(), von: ctx.name })
  if (err) return err
  return { success: true as const }
}

// ── Teilnehmende ────────────────────────────────────────────────────────

/** Teilnehmerliste setzen (Profil IDs); Namen ohne Zuordnung werden gelöscht. */
export async function teilnehmerSetzen(slug: string, ids: string[]) {
  const ctx = await requireProgramm()
  if (!ctx.organisatorin) return NUR_ORGA
  if (!SLUG_RE.test(slug) || !programmFuer(slug)) return { error: 'Teamevent nicht gefunden.' }
  const sauber = Array.from(new Set((Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string' && UUID_RE.test(id)))).slice(0, 200)
  const { data } = await ctx.admin.from('profiles').select('id').in('id', sauber.length ? sauber : ['00000000-0000-0000-0000-000000000000'])
  const bekannt = new Set(((data ?? []) as Array<{ id: string }>).map(p => p.id))
  const gueltig = sauber.filter(id => bekannt.has(id))
  const err = await schreibeZeile(ctx.admin, teilnehmerKey(slug), { ids: gueltig, nichtZugeordnet: [] })
  if (err) return err
  return { success: true as const, anzahl: gueltig.length }
}

// ── Persönliche Checkliste ──────────────────────────────────────────────

export type CheckPatch = {
  tick?: { id: string; wert: boolean }
  ticks?: Record<string, boolean>     // kompletter Stand der von Hand gesetzten Haken
  einstieg?: Einstieg | null
  allergien?: string
  keineAllergien?: boolean
}

/** Eigene Checkliste speichern (Organisatorin auch für andere Teilnehmende). */
export async function checkSpeichern(slug: string, profileId: string, patch: CheckPatch) {
  const ctx = await requireProgramm()
  if (!SLUG_RE.test(slug) || !UUID_RE.test(profileId)) return { error: 'Ungültige Angaben.' }
  if (!ctx.organisatorin && ctx.userId !== profileId) return { error: 'Du kannst nur deine eigene Checkliste ändern.' }
  const p = programmFuer(slug)
  if (!p) return { error: 'Teamevent nicht gefunden.' }
  let check: TeCheck
  try {
    const teilnehmer = parseTeilnehmer(await ladeZeile(ctx.admin, teilnehmerKey(slug)))
    if (!teilnehmer?.ids.includes(profileId)) return { error: 'Diese Person ist nicht als Teilnehmerin oder Teilnehmer eingetragen.' }
    check = parseCheckGeheim(await ladeZeile(ctx.admin, checkKey(slug, profileId)))
  } catch (e) { return { error: e instanceof Error ? e.message : 'Fehler.' } }

  // Eingabeschluss: Allergien nach der Frist nur noch durch die Organisatorin
  if (!ctx.organisatorin && (typeof patch.allergien === 'string' || typeof patch.keineAllergien === 'boolean')) {
    const item = p.checkliste.find(i => i.art === 'allergien')
    if (item && fristAbgelaufen(item.fristBis, new Date().toISOString())) return { error: item.geschlossenText ?? 'Die Eingabe ist geschlossen.' }
  }
  if (patch.tick) {
    const item = p.checkliste.find(i => i.id === patch.tick!.id)
    if (!item) return { error: 'Punkt nicht gefunden.' }
    check.ticks = { ...check.ticks, [item.id]: patch.tick.wert === true }
  }
  if (patch.ticks && typeof patch.ticks === 'object') {
    const manuell = new Set(p.checkliste.filter(manuellAbhakbar).map(i => i.id))
    const neu: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(patch.ticks)) if (manuell.has(k) && typeof v === 'boolean') neu[k] = v
    check.ticks = neu
  }
  if ('einstieg' in patch) check.einstieg = patch.einstieg === 'kehrsatz' || patch.einstieg === 'bern' ? patch.einstieg : null
  if (typeof patch.allergien === 'string') {
    const t = patch.allergien.replace(/\s+/g, ' ').trim().slice(0, 500)
    check.allergien = t || null
    if (t) check.keineAllergien = false
  }
  if (typeof patch.keineAllergien === 'boolean') {
    check.keineAllergien = patch.keineAllergien
    if (patch.keineAllergien) check.allergien = null
  }
  check.aktualisiertAm = new Date().toISOString()
  const err = await schreibeZeile(ctx.admin, checkKey(slug, profileId), checkZuObjekt(check))
  if (err) return err
  return { success: true as const, check }
}

// ── Admin Checkliste ────────────────────────────────────────────────────

/** Haken der Admin Checkliste als Ganzes speichern (der Browser schickt
 *  den aktuellen Stand, Aufrufe laufen dort nacheinander). */
export async function adminCheckSpeichern(slug: string, ticks: Record<string, boolean>) {
  const ctx = await requireProgramm()
  if (!ctx.organisatorin) return NUR_ORGA
  const p = SLUG_RE.test(slug) ? programmFuer(slug) : null
  if (!p) return { error: 'Teamevent nicht gefunden.' }
  let a: TeAdminCheck
  try { a = parseAdminCheck(await ladeZeile(ctx.admin, adminCheckKey(slug, ctx.userId))) } catch (e) { return { error: e instanceof Error ? e.message : 'Fehler.' } }
  const bekannt = new Set([...p.adminPhasen.flatMap(ph => ph.items.map(i => i.id)), ...a.eigene.map(e => e.id)])
  const sauber: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(ticks ?? {})) if (bekannt.has(k) && typeof v === 'boolean') sauber[k] = v
  const err = await schreibeZeile(ctx.admin, adminCheckKey(slug, ctx.userId), { ticks: sauber, eigene: a.eigene })
  if (err) return err
  return { success: true as const, ticks: sauber }
}

/** Eigenen Punkt zur Admin Checkliste hinzufügen (Phase wählbar). */
export async function adminItemHinzufuegen(slug: string, phaseId: string, titel: string, text: string) {
  const ctx = await requireProgramm()
  if (!ctx.organisatorin) return NUR_ORGA
  const p = SLUG_RE.test(slug) ? programmFuer(slug) : null
  if (!p) return { error: 'Teamevent nicht gefunden.' }
  const phase = p.adminPhasen.some(ph => ph.id === phaseId) ? phaseId : EIGENE_PHASE.id
  const t = (titel ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
  if (t.length < 2) return { error: 'Bitte einen Titel eingeben.' }
  let a: TeAdminCheck
  try { a = parseAdminCheck(await ladeZeile(ctx.admin, adminCheckKey(slug, ctx.userId))) } catch (e) { return { error: e instanceof Error ? e.message : 'Fehler.' } }
  if (a.eigene.length >= 100) return { error: 'Höchstens 100 eigene Punkte.' }
  const neu: EigenerPunkt = { id: `eigen-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, phase, titel: t, text: (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 600), erstelltAm: new Date().toISOString() }
  const eigene = [...a.eigene, neu]
  const err = await schreibeZeile(ctx.admin, adminCheckKey(slug, ctx.userId), { ticks: a.ticks, eigene })
  if (err) return err
  return { success: true as const, eigene }
}

/** Eigenen Punkt entfernen (vorgegebene Punkte bleiben). */
export async function adminItemLoeschen(slug: string, itemId: string) {
  const ctx = await requireProgramm()
  if (!ctx.organisatorin) return NUR_ORGA
  if (!SLUG_RE.test(slug) || !EIGEN_ID_RE.test(itemId) || !programmFuer(slug)) return { error: 'Ungültige Angaben.' }
  let a: TeAdminCheck
  try { a = parseAdminCheck(await ladeZeile(ctx.admin, adminCheckKey(slug, ctx.userId))) } catch (e) { return { error: e instanceof Error ? e.message : 'Fehler.' } }
  const eigene = a.eigene.filter(e => e.id !== itemId)
  const ticks = { ...a.ticks }; delete ticks[itemId]
  const err = await schreibeZeile(ctx.admin, adminCheckKey(slug, ctx.userId), { ticks, eigene })
  if (err) return err
  return { success: true as const, eigene }
}

// ── Zimmer, Reservation, Abendessen (nur Organisatorin) ─────────────────

export type DetailPatch = {
  name?: string              // nur bei Gästen ohne Konto
  zimmer: 'doppel' | 'einzel' | null
  zimmerMit: string | null
  resName: string
  resNr: string
  vorspeise: string
  hauptgang: string
  dessert: string
  auchPartner: boolean       // Reservation auch bei der Zimmerpartnerin eintragen
}

async function ladeDetails(admin: Admin, slug: string): Promise<TeDetails> {
  return parseDetailsRoh(await ladeZeile(admin, detailsKey(slug)))?.details ?? {}
}
const schreibeDetails = (admin: Admin, slug: string, details: TeDetails) => schreibeZeile(admin, detailsKey(slug), { details, gaesteOk: true })

/** Details einer Person speichern; Zimmerpartnerschaft wird beidseitig
 *  gepflegt (die Partnerin bekommt dieselbe Zuordnung, bei Bedarf auch
 *  Reservationsname und Nummer). */
export async function detailsSpeichern(slug: string, profileId: string, e: DetailPatch) {
  const ctx = await requireProgramm()
  if (!ctx.organisatorin) return NUR_ORGA
  const gast = istGastId(profileId)
  if (!SLUG_RE.test(slug) || !(gast ? GAST_ID_RE.test(profileId) : UUID_RE.test(profileId)) || !programmFuer(slug)) return { error: 'Ungültige Angaben.' }
  const gastName = (e.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (gast && !gastName) return { error: 'Bitte einen Namen für den Gast eingeben.' }
  let details: TeDetails, ids: string[]
  try {
    ids = parseTeilnehmer(await ladeZeile(ctx.admin, teilnehmerKey(slug)))?.ids ?? []
    details = await ladeDetails(ctx.admin, slug)
  } catch (err) { return { error: err instanceof Error ? err.message : 'Fehler.' } }
  if (!gast && !ids.includes(profileId)) return { error: 'Diese Person ist nicht als Teilnehmerin oder Teilnehmer eingetragen.' }
  const gueltigePartnerin = (k: string) => k !== profileId && (ids.includes(k) || (istGastId(k) && !!details[k]))

  const alt = details[profileId] ?? leeresDetail()
  const neu = parseDetail({ ...e, name: gast ? gastName : null, preReg: alt.preReg })
  const partnerId = neu.zimmer === 'doppel' && neu.zimmerMit && gueltigePartnerin(neu.zimmerMit) ? neu.zimmerMit : null
  neu.zimmerMit = partnerId
  // bisherige Partnerin lösen, falls gewechselt
  for (const [id, d] of Object.entries(details)) {
    if (id !== profileId && id !== partnerId && d.zimmerMit === profileId) details[id] = { ...d, zimmer: null, zimmerMit: null }
  }
  if (partnerId) {
    const p = details[partnerId] ?? leeresDetail()
    // war die Partnerin vorher mit jemand anderem zusammen, diese Person lösen
    if (p.zimmerMit && p.zimmerMit !== profileId && details[p.zimmerMit]?.zimmerMit === partnerId) {
      details[p.zimmerMit] = { ...details[p.zimmerMit], zimmer: null, zimmerMit: null }
    }
    details[partnerId] = { ...p, zimmer: 'doppel', zimmerMit: profileId, ...(e.auchPartner ? { resName: neu.resName, resNr: neu.resNr } : {}) }
  }
  details[profileId] = neu
  const err = await schreibeDetails(ctx.admin, slug, details)
  if (err) return err
  return { success: true as const }
}

/** Gast ohne Konto entfernen (Zimmerpartnerin wird gelöst). */
export async function gastEntfernen(slug: string, id: string) {
  const ctx = await requireProgramm()
  if (!ctx.organisatorin) return NUR_ORGA
  if (!SLUG_RE.test(slug) || !GAST_ID_RE.test(id) || !programmFuer(slug)) return { error: 'Ungültige Angaben.' }
  let details: TeDetails
  try { details = await ladeDetails(ctx.admin, slug) } catch (err) { return { error: err instanceof Error ? err.message : 'Fehler.' } }
  if (!details[id]) return { error: 'Gast nicht gefunden.' }
  delete details[id]
  for (const [k, d] of Object.entries(details)) if (d.zimmerMit === id) details[k] = { ...d, zimmer: null, zimmerMit: null }
  const err = await schreibeDetails(ctx.admin, slug, details)
  if (err) return err
  return { success: true as const }
}


/** Pre Registration erledigt (Haken pro Person, nur Organisatorin). */
export async function preRegSetzen(slug: string, profileId: string, wert: boolean) {
  const ctx = await requireProgramm()
  if (!ctx.organisatorin) return NUR_ORGA
  if (!SLUG_RE.test(slug) || !(UUID_RE.test(profileId) || GAST_ID_RE.test(profileId)) || !programmFuer(slug)) return { error: 'Ungültige Angaben.' }
  let details: TeDetails
  try { details = await ladeDetails(ctx.admin, slug) } catch (err) { return { error: err instanceof Error ? err.message : 'Fehler.' } }
  details[profileId] = { ...(details[profileId] ?? leeresDetail()), preReg: wert === true }
  const err = await schreibeDetails(ctx.admin, slug, details)
  if (err) return err
  return { success: true as const }
}

// ── Sensible Daten löschen ──────────────────────────────────────────────

/** Nach der Reise: Ausweisdaten (Nummer, Datum, Bilder) und Allergieangaben
 *  ALLER Teilnehmenden dieses Anlasses löschen. Bestätigung durch Eingabe
 *  des Wortes «löschen». */
export async function sensibleDatenLoeschen(slug: string, bestaetigung: string) {
  const ctx = await requireProgramm()
  if (!ctx.organisatorin) return NUR_ORGA
  if (!SLUG_RE.test(slug) || !programmFuer(slug)) return { error: 'Teamevent nicht gefunden.' }
  if ((bestaetigung ?? '').trim().toLowerCase() !== 'löschen') return { error: 'Bitte zur Bestätigung das Wort löschen eingeben.' }
  let ids: string[]
  try { ids = parseTeilnehmer(await ladeZeile(ctx.admin, teilnehmerKey(slug)))?.ids ?? [] } catch (e) { return { error: e instanceof Error ? e.message : 'Fehler.' } }
  let ausweise = 0, allergien = 0
  const dateien: string[] = []
  for (const id of ids) {
    const { data: aRow } = await ctx.admin.from('zeiterfassung_comments').select('comment')
      .eq('user_full_name', ausweisKey(id)).eq('schedule_date', AUSWEIS_ANCHOR).maybeSingle()
    if (aRow) {
      const a = parseAusweisGeheim(id, (aRow as { comment: string }).comment)
      for (const b of a.bilder) dateien.push(bildPfad(id, b))
      const { error } = await ctx.admin.from('zeiterfassung_comments').delete().eq('user_full_name', ausweisKey(id)).eq('schedule_date', AUSWEIS_ANCHOR)
      if (!error) ausweise++
    }
    const { data: cRow } = await ctx.admin.from('zeiterfassung_comments').select('comment')
      .eq('user_full_name', checkKey(slug, id)).eq('schedule_date', TE_PROGRAMM_ANCHOR).maybeSingle()
    if (cRow) {
      const c = parseCheckGeheim((cRow as { comment: string }).comment)
      if (c.allergien || c.keineAllergien) {
        await schreibeZeile(ctx.admin, checkKey(slug, id), checkZuObjekt({ ...c, allergien: null, keineAllergien: false, aktualisiertAm: new Date().toISOString() }))
        allergien++
      }
    }
  }
  for (let i = 0; i < dateien.length; i += 100) await ctx.admin.storage.from(TE_BUCKET).remove(dateien.slice(i, i + 100))
  return { success: true as const, ausweise, allergien, bilder: dateien.length }
}
