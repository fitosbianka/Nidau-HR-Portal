'use server'

// Wochenanmeldung der Ferienplanung 2027 (first come first served, auch als
// Doppelwoche, bei Teilzeit mit Auswahl der konkreten Tage) sowie Ablehnen
// und Zurücknehmen durch Admins und Laura, Wochenfarbe, zentrale Regeln,
// Personenregeln, feste Einsätze und Anspruch Anpassung. Alle Prüfungen
// laufen serverseitig.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { FERIEN_EDITORS } from '@/lib/leitende'
import {
  WUNSCH_PREFIX, PLAN_YEAR, parseWunschRows, phaseKeyForTitle, phaseStateFor, zurichNow, normalizeWunschArt, wunschArtCode,
  type FerienWunsch, type WunschArt,
} from '@/lib/ferien-wuensche'
import { getPhasenDeadlines } from '@/lib/ferien-reminder'
import { loescheVertretung } from '@/lib/ferien-vertretung-db'
import { FERIEN_EXCLUDED } from '@/lib/ferienplanung-data'
import { ladeExterne } from '@/lib/externe'
import { ohneGaeste } from '@/lib/gaeste'
import { anspruchTageFor } from '@/lib/ferien-anspruch'
import { istFerienAlsMinusstunden } from '@/lib/ferien-minusstunden'
import {
  WOCHENFARBE_KEY, KONFIG_ANCHOR, anspruchKey, istFarbe, wochen2027, kategorieFuer, FARBEN,
  type WochenFarbe, type Person, type Woche,
} from '@/lib/ferien-wochen'
import { REGELN_KEY, EINSATZ_KEY, personKey, parseRegeln, parseEinsatzRows, type Regeln, type PersonRegel, type Einsatz } from '@/lib/ferien-regeln'
import { kapazitaetFuer, pruefeAnmeldung, mitAnmeldung, type Kontext , anmeldeFehler, VOLL_HINWEIS } from '@/lib/ferien-kapazitaet'
import { ladeFerienKontext, meineTage } from '@/lib/ferien-wochen-data'

type Admin = Awaited<ReturnType<typeof createAdminClient>>
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/
const ZEIT_RE = /^\d{2}:\d{2}$/
const UUID_RE = /^[0-9a-f-]{8,64}$/i
const NUR_VERWALTUNG = { error: 'Das kann nur die Praxisleitung.' }
const NUR_ADMIN = { error: 'Das können nur Admins.' }

function revalidateAll() {
  for (const p of [
    '/admin/zeiterfassung/ferien/planung', '/employee/team/ferien', '/employee/ferien',
    '/admin/arbeitsplan', '/employee/arbeitsplan', '/employee',
    '/admin/zeiterfassung/konto', '/employee/team/konto', '/employee/zeiterfassung/ferienkonto',
  ]) revalidatePath(p)
}

async function nutzer() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase.from('profiles').select('role, full_name, job_title, pensum, eintrittsdatum').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string; job_title: string | null; pensum: number | null; eintrittsdatum: string | null } | null
  const name = p?.full_name ?? ''
  return {
    admin: await createAdminClient(), userId: user.id, name, jobTitle: p?.job_title ?? null, pensum: p?.pensum ?? null, eintrittsdatum: p?.eintrittsdatum ?? null,
    isAdmin: p?.role === 'admin', verwaltet: p?.role === 'admin' || FERIEN_EDITORS.includes(name),
  }
}

/** Aktive Mitarbeitende der Ferienplanung (ohne Inhaber, Externe, Gäste). */
async function personen(admin: Admin): Promise<Person[]> {
  const [{ data }, externe] = await Promise.all([
    admin.from('profiles').select('id, full_name, job_title, pensum, eintrittsdatum').eq('role', 'employee').eq('is_active', true),
    ladeExterne(admin),
  ])
  return ohneGaeste((data ?? []) as Person[]).filter(p => !FERIEN_EXCLUDED.has(p.full_name) && !externe.has(p.id))
}

async function alleWuensche(admin: Admin): Promise<FerienWunsch[]> {
  const { data } = await admin.from('zeiterfassung_comments').select('user_full_name, schedule_date, comment')
    .like('user_full_name', `${WUNSCH_PREFIX.replace(/_/g, '\\_')}%`)
  return parseWunschRows((data ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>)
}

const wunschKey = (employeeId: string) => `${WUNSCH_PREFIX}${employeeId}`

async function loadWunsch(admin: Admin, employeeId: string, from: string) {
  const { data } = await admin.from('zeiterfassung_comments').select('comment').eq('user_full_name', wunschKey(employeeId)).eq('schedule_date', from).maybeSingle()
  if (!data) return null
  try { return JSON.parse((data as { comment: string }).comment) as Omit<FerienWunsch, 'employeeId' | 'from'> } catch { return null }
}
async function saveWunsch(admin: Admin, employeeId: string, from: string, meta: Omit<FerienWunsch, 'employeeId' | 'from'>) {
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: wunschKey(employeeId), schedule_date: from, comment: JSON.stringify(meta), updated_at: new Date().toISOString() },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error?.message ?? null
}
async function deleteWunsch(admin: Admin, employeeId: string, from: string) {
  await admin.from('zeiterfassung_comments').delete().eq('user_full_name', wunschKey(employeeId)).eq('schedule_date', from)
}
/** Einträge dieser Art im Zeitraum entfernen (F und F:x bei Ferien). */
async function removeFerienDays(admin: SupabaseClient, employeeId: string, from: string, to: string, art: WunschArt) {
  let q = admin.from('work_schedule').delete().eq('employee_id', employeeId).gte('schedule_date', from).lte('schedule_date', to)
  q = art === 'ferien' ? q.or('entry.eq.F,entry.like.F:*') : q.eq('entry', wunschArtCode(art))
  const { error } = await q
  return error?.message ?? null
}

const addTage = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Wochenanmeldung (eigene Person) ─────────────────────────────────────

/** Eine Woche oder zwei aufeinanderfolgende Wochen (Doppelwoche) anmelden.
 *  Teilzeit wählt pro Woche die konkreten Tage (tageAuswahl, Montag der
 *  Woche → Tage), jeder gewählte Tag zählt einen Ferientag; bei 100 Prozent
 *  gilt die ganze Woche. Prüfung der Reihe nach: Phase, Farbe,
 *  Doppelanmeldung, Regeln der eigenen Kategorie, verbleibende Ferientage.
 *  Bei der Doppelwoche müssen beide Wochen bestehen, sonst wird keine
 *  gespeichert. */
export async function wochenAnmelden(montage: string[], tageAuswahl?: Record<string, string[]> | null) {
  const n = await nutzer()
  const liste = Array.from(new Set((montage ?? []).filter(m => typeof m === 'string' && DATUM_RE.test(m)))).sort()
  const teilzeit = n.pensum != null && n.pensum > 0 && n.pensum < 100
  if (liste.length === 0 || liste.length > 2) return { error: 'Bitte eine Woche oder zwei aufeinanderfolgende Wochen wählen.' }
  if (liste.length === 2 && addTage(liste[0], 7) !== liste[1]) return { error: 'Die zwei Wochen müssen aufeinander folgen.' }
  const kat = kategorieFuer(n.jobTitle)
  if (!kat) return { error: 'Für deine Kategorie gibt es keine Wochenanmeldung.' }
  if (!n.verwaltet && !FERIEN_EDITORS.includes(n.name)) {
    const state = phaseStateFor(await getPhasenDeadlines(n.admin), phaseKeyForTitle(n.jobTitle), zurichNow())
    if (state === 'abgeschlossen') return { error: 'Die Eingabefrist für deine Gruppe ist abgelaufen. Bitte melde dich bei der Praxisleitung.' }
    if (state !== 'aktiv') return { error: 'Die Anmeldung ist für deine Gruppe noch nicht offen.' }
  }
  const [wishes, pers] = await Promise.all([alleWuensche(n.admin), personen(n.admin)])
  const ich: Person = pers.find(p => p.id === n.userId) ?? { id: n.userId, full_name: n.name, job_title: n.jobTitle, pensum: n.pensum, eintrittsdatum: n.eintrittsdatum }
  const basis = await ladeFerienKontext(n.admin, pers, wishes)
  const wochen: Woche[] = []
  for (const m of liste) {
    const w = basis.wochen.find(x => x.montag === m)
    if (!w) return { error: 'Diese Woche gehört nicht zur Planung 2027.' }
    wochen.push(w)
  }
  const kwText = (w: Woche) => (liste.length === 2 ? `KW ${w.kw}: ` : '')

  // Gewählte Tage pro Woche; ohne Auswahl gilt bei 100 Prozent die ganze Woche
  const tageVon = new Map<string, string[]>()
  for (const woche of wochen) {
    const erlaubt = new Set(woche.arbeitstage)
    const auswahl = Array.from(new Set((tageAuswahl?.[woche.montag] ?? []).filter(t => typeof t === 'string' && erlaubt.has(t)))).sort()
    const gewaehlt = auswahl.length > 0 ? auswahl : (teilzeit ? [] : [...woche.arbeitstage])
    if (gewaehlt.length === 0) return { error: `${kwText(woche)}Bitte wähle mindestens einen Tag, an dem du Ferien nimmst.` }
    tageVon.set(woche.montag, gewaehlt)
  }

  let ctx: Kontext = basis
  for (const woche of wochen) {
    if (woche.arbeitstage.length === 0) return { error: `${kwText(woche)}Diese Woche hat keine Arbeitstage.` }
    const k = kapazitaetFuer(ctx, woche)
    // Rot: gesperrt, ausser für die Assistenz an Tagen, an denen eine ZAZ fest fehlt (die Tage prüft pruefeAnmeldung)
    if (woche.farbe === 'rot' && (kat !== 'ASSISTENZ' || !k.oeffnung || k.oeffnung.offen.length === 0)) return { error: `${kwText(woche)}${FARBEN.rot.titel}. Keine Ferien, Ausnahmen nur nach Absprache mit Bianka.` }
    if (Array.from(k.belegung.values()).flat().some(b => b.employeeId === n.userId)) return { error: `${kwText(woche)}In dieser Woche hast du schon Ferien oder eine Anmeldung.` }
    // Volle Woche (Plätze der Kategorie belegt, Assistenz reicht nicht): keine
    // Anmeldung, stattdessen ein Ferienwunsch. Gilt für alle Mitarbeitenden.
    const gruende = pruefeAnmeldung(ctx, woche, ich, tageVon.get(woche.montag))
    if (gruende.length > 0) return anmeldeFehler(gruende, kwText(woche))
    ctx = mitAnmeldung(ctx, ich, woche, tageVon.get(woche.montag))
  }

  // Verbleibende Ferientage (ausser bei Personen ohne festes Kontingent); jeder gewählte Tag zählt einen Tag
  const anspruch = anspruchTageFor(n.name, n.pensum, basis.konfig.anspruch[n.userId])
  const kosten = wochen.reduce((s, w) => s + (tageVon.get(w.montag)?.length ?? 0), 0)
  if (anspruch.tage != null) {
    const t = meineTage(basis.eintraege, wishes, n.userId, n.pensum, basis.wochen, d => istFerienAlsMinusstunden(n.name, d))
    const frei = Math.round((anspruch.tage - t.akzeptiert - t.angemeldet) * 100) / 100
    if (kosten > frei + 0.005) return { error: `Nicht genug Ferientage. ${liste.length === 2 ? 'Diese zwei Wochen zählen' : 'Diese Woche zählt'} ${kosten} Tage, frei sind noch ${Math.max(0, frei)} Tage.` }
  }

  const createdAt = new Date().toISOString()
  const gruppe = liste.length === 2 ? `dw-${Date.now().toString(36)}` : null
  for (const woche of wochen) {
    const err = await saveWunsch(n.admin, n.userId, woche.montag, {
      to: woche.freitag, art: 'ferien', prio: 3, status: 'offen', createdAt, quelle: 'woche', kw: woche.kw, grund: null, gruppe, tage: tageVon.get(woche.montag) ?? null,
    })
    if (err) { for (const w of wochen) await deleteWunsch(n.admin, n.userId, w.montag); return { error: err } }
  }

  // Gegen gleichzeitige Klicks: nach dem Speichern alle Regeln erneut mit
  // allen nicht abgelehnten Anmeldungen prüfen, sortiert nach Eingang. Ist
  // die eigene Anmeldung nicht mehr möglich, sofort wieder löschen.
  const nachher = await alleWuensche(n.admin)
  for (const woche of wochen) {
    const frueher = nachher.filter(w => !(w.employeeId === n.userId && w.from === woche.montag) && !(w.quelle === 'woche' && w.from === woche.montag && w.createdAt > createdAt))
    if (pruefeAnmeldung({ ...basis, wishes: frueher }, woche, ich, tageVon.get(woche.montag)).length > 0) {
      for (const w of wochen) await deleteWunsch(n.admin, n.userId, w.montag)
      return { error: `Diese Woche ist inzwischen voll. ${VOLL_HINWEIS}`, voll: true }
    }
  }
  revalidateAll()
  return { success: true as const, tage: kosten }
}

/** Eine einzelne Woche anmelden. */
export async function wocheAnmelden(montag: string) {
  return wochenAnmelden([montag])
}

/** Eigene offene Wochenanmeldung (oder offenen Wunsch) zurückziehen. */
export async function wocheZurueckziehen(from: string) {
  const n = await nutzer()
  if (!DATUM_RE.test(from)) return { error: 'Ungültige Angaben.' }
  const meta = await loadWunsch(n.admin, n.userId, from)
  if (!meta) return { error: 'Anmeldung nicht gefunden.' }
  if (meta.status === 'akzeptiert') return { error: 'Diese Anmeldung ist schon akzeptiert. Bitte melde dich bei der Praxisleitung.' }
  const { error } = await n.admin.from('zeiterfassung_comments').delete().eq('user_full_name', wunschKey(n.userId)).eq('schedule_date', from)
  if (error) return { error: error.message }
  revalidateAll()
  return { success: true as const }
}

// ── Admins und Laura ────────────────────────────────────────────────────

/** Wunsch oder Wochenanmeldung ablehnen, mit optionalem Grund. War der
 *  Eintrag akzeptiert, verschwinden die Tage aus dem Arbeitsplan. */
export async function wunschAblehnen(employeeId: string, from: string, grund: string) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  if (!UUID_RE.test(employeeId) || !DATUM_RE.test(from)) return { error: 'Ungültige Angaben.' }
  const meta = await loadWunsch(n.admin, employeeId, from)
  if (!meta) return { error: 'Wunsch nicht gefunden.' }
  if (meta.status === 'akzeptiert') {
    const err = await removeFerienDays(n.admin, employeeId, from, meta.to, normalizeWunschArt(meta.art))
    if (err) return { error: err }
    await loescheVertretung(n.admin, employeeId, from, meta.to)
  }
  const err = await saveWunsch(n.admin, employeeId, from, { ...meta, status: 'abgelehnt', decidedAt: new Date().toISOString(), decidedBy: n.name, grund: (grund ?? '').trim().slice(0, 300) || null })
  if (err) return { error: err }
  revalidateAll()
  return { success: true as const }
}

/** Akzeptierte Anmeldung zurücknehmen (Tage aus dem Arbeitsplan entfernen)
 *  oder eine Ablehnung aufheben. Der Eintrag ist danach wieder offen. */
export async function wunschZuruecknehmen(employeeId: string, from: string) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  if (!UUID_RE.test(employeeId) || !DATUM_RE.test(from)) return { error: 'Ungültige Angaben.' }
  const meta = await loadWunsch(n.admin, employeeId, from)
  if (!meta) return { error: 'Wunsch nicht gefunden.' }
  if (meta.status === 'akzeptiert') {
    const err = await removeFerienDays(n.admin, employeeId, from, meta.to, normalizeWunschArt(meta.art))
    if (err) return { error: err }
    await loescheVertretung(n.admin, employeeId, from, meta.to)
  }
  const err = await saveWunsch(n.admin, employeeId, from, { ...meta, status: 'offen', decidedAt: null, decidedBy: null, grund: null })
  if (err) return { error: err }
  revalidateAll()
  return { success: true as const }
}

/** Farbe einer Woche ändern; null = zurück zum Standard. */
export async function wochenfarbeSetzen(montag: string, farbe: WochenFarbe | null) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  if (!DATUM_RE.test(montag) || (farbe !== null && !istFarbe(farbe))) return { error: 'Ungültige Angaben.' }
  if (!wochen2027().some(w => w.montag === montag)) return { error: 'Diese Woche gehört nicht zur Planung 2027.' }
  if (farbe === null) {
    const { error } = await n.admin.from('zeiterfassung_comments').delete().eq('user_full_name', WOCHENFARBE_KEY).eq('schedule_date', montag)
    if (error) return { error: error.message }
  } else {
    const am = new Date().toISOString()
    const { error } = await n.admin.from('zeiterfassung_comments').upsert(
      { user_full_name: WOCHENFARBE_KEY, schedule_date: montag, comment: JSON.stringify({ farbe, von: n.name, am }), updated_at: am },
      { onConflict: 'user_full_name,schedule_date' },
    )
    if (error) return { error: error.message }
  }
  revalidateAll()
  return { success: true as const }
}

// ── Regeln ──────────────────────────────────────────────────────────────

/** Zentrale Regeln speichern (Plätze, Grundbedarf, Reserve, Schalter, Platzhalter). */
export async function regelnSpeichern(regeln: Regeln) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  let sauber: Regeln
  try { sauber = parseRegeln(JSON.stringify(regeln ?? {})) } catch { return { error: 'Ungültige Angaben.' } }
  const am = new Date().toISOString()
  const { error } = await n.admin.from('zeiterfassung_comments').upsert(
    { user_full_name: REGELN_KEY, schedule_date: KONFIG_ANCHOR, comment: JSON.stringify({ ...sauber, von: n.name, am }), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  revalidateAll()
  return { success: true as const }
}

/** Gültigkeit und Anrechnungsfaktor einer Person speichern; null = zurück zum Standard. */
export async function personRegelSpeichern(employeeId: string, regel: PersonRegel | null) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  if (!UUID_RE.test(employeeId)) return { error: 'Ungültige Angaben.' }
  if (regel === null) {
    const { error } = await n.admin.from('zeiterfassung_comments').delete().eq('user_full_name', personKey(employeeId)).eq('schedule_date', KONFIG_ANCHOR)
    if (error) return { error: error.message }
  } else {
    const d = (v: unknown) => (typeof v === 'string' && DATUM_RE.test(v) ? v : null)
    const f = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 100) / 100 : null)
    const sauber: PersonRegel = { ab: d(regel.ab), bis: d(regel.bis), faktor: f(regel.faktor), faktorBis: d(regel.faktorBis), faktorDanach: f(regel.faktorDanach) }
    if (sauber.ab && sauber.bis && sauber.bis < sauber.ab) return { error: 'Bis liegt vor Ab.' }
    const am = new Date().toISOString()
    const { error } = await n.admin.from('zeiterfassung_comments').upsert(
      { user_full_name: personKey(employeeId), schedule_date: KONFIG_ANCHOR, comment: JSON.stringify({ ...sauber, von: n.name, am }), updated_at: am },
      { onConflict: 'user_full_name,schedule_date' },
    )
    if (error) return { error: error.message }
  }
  revalidateAll()
  return { success: true as const }
}

// ── Feste Vertretungseinsätze ───────────────────────────────────────────

async function einsatzListe(admin: Admin, datum: string): Promise<Einsatz[]> {
  const { data } = await admin.from('zeiterfassung_comments').select('user_full_name, schedule_date, comment').eq('user_full_name', EINSATZ_KEY).eq('schedule_date', datum).maybeSingle()
  return data ? parseEinsatzRows([data as { user_full_name: string; schedule_date: string; comment: string }]) : []
}
async function einsatzListeSchreiben(admin: Admin, datum: string, liste: Einsatz[], von: string): Promise<string | null> {
  if (liste.length === 0) {
    const { error } = await admin.from('zeiterfassung_comments').delete().eq('user_full_name', EINSATZ_KEY).eq('schedule_date', datum)
    return error?.message ?? null
  }
  const am = new Date().toISOString()
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: EINSATZ_KEY, schedule_date: datum, comment: JSON.stringify({ liste: liste.map(e => ({ id: e.id, name: e.name, von: e.von, bis: e.bis, assistenz: e.assistenz })), von, am }), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error?.message ?? null
}

export type EinsatzEingabe = { id?: string | null; datum: string; name: string; von: string; bis: string; assistenz: boolean }

/** Einsatz anlegen oder ändern (altesDatum, wenn das Datum geändert wurde). */
export async function einsatzSpeichern(e: EinsatzEingabe, altesDatum?: string | null) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  const name = (e?.name ?? '').trim().slice(0, 60)
  if (!name || !DATUM_RE.test(e.datum) || !ZEIT_RE.test(e.von) || !ZEIT_RE.test(e.bis) || e.bis <= e.von) return { error: 'Bitte Name, Datum sowie Von und Bis (Bis nach Von) angeben.' }
  if (!e.datum.startsWith(String(PLAN_YEAR))) return { error: `Der Einsatz muss im Jahr ${PLAN_YEAR} liegen.` }
  const dow = new Date(`${e.datum}T12:00:00`).getDay()
  if (dow === 0 || dow === 6) return { error: 'Bitte einen Wochentag wählen.' }
  const id = e.id && /^[\w-]{1,40}$/.test(e.id) ? e.id : `e-${Date.now().toString(36)}`
  if (altesDatum && DATUM_RE.test(altesDatum) && altesDatum !== e.datum) {
    const alt = await einsatzListe(n.admin, altesDatum)
    const err = await einsatzListeSchreiben(n.admin, altesDatum, alt.filter(x => x.id !== id), n.name)
    if (err) return { error: err }
  }
  const liste = (await einsatzListe(n.admin, e.datum)).filter(x => x.id !== id)
  liste.push({ id, datum: e.datum, name, kategorie: 'ZAZ', von: e.von, bis: e.bis, assistenz: e.assistenz !== false })
  const err = await einsatzListeSchreiben(n.admin, e.datum, liste, n.name)
  if (err) return { error: err }
  revalidateAll()
  return { success: true as const }
}

export async function einsatzLoeschen(datum: string, id: string) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  if (!DATUM_RE.test(datum) || !id) return { error: 'Ungültige Angaben.' }
  const liste = await einsatzListe(n.admin, datum)
  const err = await einsatzListeSchreiben(n.admin, datum, liste.filter(x => x.id !== id), n.name)
  if (err) return { error: err }
  revalidateAll()
  return { success: true as const }
}

// ── Anspruch ────────────────────────────────────────────────────────────

/** Ferienanspruch einer Person in Tagen anpassen (nur Admins). tage = Zahl,
 *  null = ohne festes Kontingent, undefined = zurück zur Praxisregel. */
export async function anspruchSetzen(employeeId: string, tage: number | null | undefined) {
  const n = await nutzer()
  if (!n.isAdmin) return NUR_ADMIN
  if (!UUID_RE.test(employeeId)) return { error: 'Ungültige Angaben.' }
  if (tage === undefined) {
    const { error } = await n.admin.from('zeiterfassung_comments').delete().eq('user_full_name', anspruchKey(employeeId)).eq('schedule_date', KONFIG_ANCHOR)
    if (error) return { error: error.message }
  } else {
    if (tage !== null && !(Number.isFinite(tage) && tage >= 0 && tage <= 365)) return { error: 'Bitte eine Zahl zwischen 0 und 365 Tagen eingeben.' }
    const am = new Date().toISOString()
    const { error } = await n.admin.from('zeiterfassung_comments').upsert(
      { user_full_name: anspruchKey(employeeId), schedule_date: KONFIG_ANCHOR, comment: JSON.stringify({ tage: tage === null ? null : Math.round(tage * 100) / 100, von: n.name, am }), updated_at: am },
      { onConflict: 'user_full_name,schedule_date' },
    )
    if (error) return { error: error.message }
  }
  revalidateAll()
  return { success: true as const }
}
