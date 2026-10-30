// Serverseitiges Laden des Teamevent Programms (Admin Client). Die
// Datengrenze liegt HIER: an den Browser gehen nur die eigenen Angaben der
// angemeldeten Person (mein) — die Organisatorin erhält zusätzlich die
// Verwaltung (alle Teilnehmenden, Ausweis und Allergieangaben, ihre Admin
// Checkliste). Niemand sonst, auch keine anderen Admins.

import type { SupabaseClient } from '@supabase/supabase-js'
import { parseOrdner, parseFotos, darfOrdnerSehen, escLike, type TeOrdner } from './teamevents'
import { ladeTeameventRows, ladeTeam, type TeamPerson, type Viewer, type Row } from './teamevents-data'
import { AUSWEIS_PREFIX, ausweisStatus, type Ausweis, type AusweisStatus } from './ausweise'
import { zurichToday } from './salary-sync'
import { parseAusweisGeheim, parseCheckGeheim } from './teamevent-geheim'
import { ladeAusweis, type AusweisMitBildern } from './ausweise-data'
import { programmFuer, rufname, type EpDetail } from './teamevent-europapark'
import {
  TE_PROGRAMM_ANCHOR, texteKey, teilnehmerKey, checkKey, adminCheckKey, detailsKey,
  parseTexte, parseTeilnehmer, parseAdminCheck, parseDetailsRoh, teilnehmerZuordnen, bloeckeMit, zeilenFuer, anzahlPlatzhalter,
  itemErledigt, fortschritt, leeresDetail, leererCheck, istGastId, gastId,
  type InfoBlock, type CheckItem, type AdminPhase, type Einstieg, type TeCheck, type TeAdminCheck, type TeTeilnehmer, type TeDetail, type TeDetails,
} from './teamevent-programm'

export type ProgrammViewer = Viewer & { name: string }

export type TeilnehmerZeile = {
  id: string
  name: string
  check: TeCheck
  ausweis: { art: Ausweis['art']; nummer: string | null; ablauf: string | null; komplett: boolean; bilder: number; status: AusweisStatus }
  fotos: number
  erledigt: number
  total: number
  offen: string[]            // Titel der offenen Punkte
  detail: TeDetail
  zimmerMitName: string | null
  reihenfolge: number        // Position in der Zimmereinteilung (für die Gruppierung)
  gast: boolean              // Person ohne Konto (nur Zimmer, Reservation, Menü)
}

export type ProgrammDaten = {
  ordner: TeOrdner
  bloecke: Array<InfoBlock & { angepasst: boolean }>
  platzhalter: number
  checkliste: CheckItem[]
  einstieg: Record<Einstieg, string>
  binTeilnehmer: boolean
  jetzt: string               // Serverzeit (ISO) für Fristen
  menue: { vorspeise: string[]; hauptgang: string[]; dessert: string[] }
  mein: { check: TeCheck; ausweis: AusweisMitBildern; fotos: number; detail: TeDetail; zimmerMitName: string | null } | null
  verwaltung: {
    teilnehmer: TeilnehmerZeile[]
    gaeste: TeilnehmerZeile[]
    nichtZugeordnet: string[]
    team: TeamPerson[]
    adminPhasen: AdminPhase[]
    adminCheck: TeAdminCheck
  } | null
}

export const ausweisKomplett = (a: Ausweis | null | undefined) => !!(a && a.art && a.nummer && a.ablauf)

const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
/** Profil ID zu einem Vornamen (mit Kurzformen); null, wenn nicht eindeutig. */
function idFuerVorname(team: TeamPerson[], vorname: string, alias?: string[]): string | null {
  const k = [vorname, ...(alias ?? [])].map(normal)
  const t = team.filter(p => k.includes(normal(p.full_name.split(/\s+/)[0] ?? '')))
  return t.length === 1 ? t[0].id : null
}

/** Schlüssel einer Vorlagenperson: Gast Schlüssel oder Profil ID. */
function schluesselAus(team: TeamPerson[], v: EpDetail | null | undefined): string | null {
  if (!v) return null
  return v.gast ? gastId(v.vorname) : idFuerVorname(team, v.vorname, v.alias)
}
function detailAusVorlage(team: TeamPerson[], vorlage: EpDetail[], d: EpDetail): TeDetail {
  const partner = d.zimmerMit ? vorlage.find(x => x.vorname === d.zimmerMit) : null
  return {
    name: d.gast ? d.vorname : null, zimmer: d.zimmerMit ? 'doppel' : 'einzel', zimmerMit: schluesselAus(team, partner),
    resName: d.resName, resNr: d.resNr, vorspeise: d.vorspeise, hauptgang: d.hauptgang, dessert: d.dessert, preReg: false,
  }
}

/** Zimmer, Reservation und Menü laden; beim ersten Aufruf aus der
 *  Datendatei den Konten zuordnen, Gäste ohne Konto einmalig ergänzen
 *  (ohne erneutes Lesen, Ergebnis aus dem Geschriebenen). */
async function detailsOderSeed(admin: SupabaseClient, slug: string, rows: Map<string, Row>, team: TeamPerson[], vorlage: EpDetail[]): Promise<TeDetails> {
  const roh = parseDetailsRoh(rows.get(detailsKey(slug))?.comment)
  if (roh?.gaesteOk) return roh.details
  const out: TeDetails = roh?.details ?? {}
  for (const d of vorlage) {
    const key = schluesselAus(team, d)
    if (!key) continue
    if (!out[key]) { out[key] = detailAusVorlage(team, vorlage, d); continue }
    // bestehender Eintrag ohne Partnerin, Vorlage kennt eine (z. B. Gast): nachtragen
    if (out[key].zimmer === 'doppel' && !out[key].zimmerMit && d.zimmerMit) {
      const pk = schluesselAus(team, vorlage.find(x => x.vorname === d.zimmerMit))
      if (pk) out[key] = { ...out[key], zimmerMit: pk }
    }
  }
  await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: detailsKey(slug), schedule_date: TE_PROGRAMM_ANCHOR, comment: JSON.stringify({ details: out, gaesteOk: true }), updated_at: new Date().toISOString() },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return out
}

/** Gast, der inzwischen ein eigenes Konto hat (z. B. Odette): Zimmer,
 *  Reservation und Menü auf das Konto übertragen, die Person als
 *  Teilnehmerin eintragen, die Zimmerpartnerin umhängen und die Gastzeile
 *  entfernen. So hat sie dieselbe Seite wie alle anderen. */
async function gaesteZuKonten(admin: SupabaseClient, slug: string, teilnehmer: TeTeilnehmer, details: TeDetails, team: TeamPerson[]): Promise<{ teilnehmer: TeTeilnehmer; details: TeDetails } | null> {
  let geaendert = false
  const neu: TeDetails = { ...details }
  const ids = [...teilnehmer.ids]
  for (const [k, d] of Object.entries(details)) {
    if (!istGastId(k) || !d.name) continue
    const id = idFuerVorname(team, d.name)
    if (!id || neu[id]) continue
    neu[id] = { ...d, name: null }
    delete neu[k]
    for (const [k2, d2] of Object.entries(neu)) if (d2.zimmerMit === k) neu[k2] = { ...d2, zimmerMit: id }
    if (!ids.includes(id)) ids.push(id)
    geaendert = true
  }
  if (!geaendert) return null
  const am = new Date().toISOString()
  const t: TeTeilnehmer = { ids, nichtZugeordnet: teilnehmer.nichtZugeordnet.filter(n => !team.some(p => idFuerVorname([p], n) && ids.includes(p.id))) }
  const { error } = await admin.from('zeiterfassung_comments').upsert([
    { user_full_name: detailsKey(slug), schedule_date: TE_PROGRAMM_ANCHOR, comment: JSON.stringify({ details: neu, gaesteOk: true }), updated_at: am },
    { user_full_name: teilnehmerKey(slug), schedule_date: TE_PROGRAMM_ANCHOR, comment: JSON.stringify(t), updated_at: am },
  ], { onConflict: 'user_full_name,schedule_date' })
  if (error) return null
  return { teilnehmer: t, details: neu }
}

const rowMap = (rows: Row[]) => {
  const m = new Map<string, Row>()
  for (const r of rows) m.set(r.user_full_name, r)
  return m
}

/** Teilnehmende laden; beim ersten Aufruf aus den Vornamen der Datendatei
 *  anlegen — OHNE erneutes Lesen (Next.js dedupliziert identische Anfragen
 *  im selben Seitenaufbau), das Ergebnis wird aus dem Geschriebenen gebaut. */
async function teilnehmerOderSeed(admin: SupabaseClient, slug: string, rows: Map<string, Row>, team: TeamPerson[]): Promise<TeTeilnehmer> {
  const vorhanden = parseTeilnehmer(rows.get(teilnehmerKey(slug))?.comment)
  if (vorhanden) return vorhanden
  const p = programmFuer(slug)
  const neu = p ? teilnehmerZuordnen(p.teilnehmerVornamen, team) : { ids: [], nichtZugeordnet: [] }
  const am = new Date().toISOString()
  await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: teilnehmerKey(slug), schedule_date: TE_PROGRAMM_ANCHOR, comment: JSON.stringify(neu), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return neu
}

export async function ladeProgramm(admin: SupabaseClient, slug: string, viewer: ProgrammViewer): Promise<ProgrammDaten | null> {
  const programm = programmFuer(slug)
  if (!programm) return null
  const [rows, team] = await Promise.all([ladeTeameventRows(admin, slug), ladeTeam(admin)])
  const ordner = parseOrdner(rows).find(o => o.slug === slug)
  if (!ordner || !darfOrdnerSehen(ordner, viewer.id, viewer.verwaltet)) return null
  const byKey = rowMap(rows)

  const texte = parseTexte(byKey.get(texteKey(slug))?.comment)
  const alleBloecke = bloeckeMit(programm.bloecke, texte)
  const bloecke = alleBloecke.map(b => ({ ...b, zeilen: zeilenFuer(b.zeilen, viewer.verwaltet) }))

  let teilnehmer = await teilnehmerOderSeed(admin, slug, byKey, team)
  let details = await detailsOderSeed(admin, slug, byKey, team, programm.details)
  const uebernommen = await gaesteZuKonten(admin, slug, teilnehmer, details, team)
  if (uebernommen) { teilnehmer = uebernommen.teilnehmer; details = uebernommen.details }
  const binTeilnehmer = teilnehmer.ids.includes(viewer.id)
  const teamById = new Map(team.map(t => [t.id, t.full_name]))
  const vorlageIndex = (id: string) => {
    const name = teamById.get(id) ?? ''
    return programm.details.findIndex(d => [d.vorname, ...(d.alias ?? [])].map(normal).includes(normal(name.split(/\s+/)[0] ?? '')))
  }
  const partnerIdAus = (v: EpDetail) => schluesselAus(team, v.zimmerMit ? programm.details.find(x => x.vorname === v.zimmerMit) : null)
  /** Gespeicherte Details; fehlt ein Eintrag (Person später hinzugefügt)
   *  oder nur die Zimmerpartnerin (Konto gab es beim Anlegen noch nicht),
   *  wird die Lücke aus der Datendatei gefüllt. */
  const detailFuer = (id: string): TeDetail => {
    const gespeichert = details[id]
    const i = vorlageIndex(id)
    const v = i >= 0 ? programm.details[i] : null
    if (!gespeichert) return v ? detailAusVorlage(team, programm.details, v) : leeresDetail()
    if (gespeichert.zimmer === 'doppel' && !gespeichert.zimmerMit && v?.zimmerMit) {
      const pid = partnerIdAus(v)
      if (pid && (teilnehmer.ids.includes(pid) || (istGastId(pid) && details[pid]))) return { ...gespeichert, zimmerMit: pid }
    }
    return gespeichert
  }
  const zimmerMitName = (d: TeDetail): string | null => {
    if (d.zimmer !== 'doppel' || !d.zimmerMit) return null
    if (istGastId(d.zimmerMit)) return details[d.zimmerMit]?.name ?? null
    return rufname(teamById.get(d.zimmerMit) ?? '') || null
  }
  const reihenfolgeVon = (id: string) => { const i = vorlageIndex(id); return i < 0 ? 999 : i }

  const fotos = parseFotos(rows).filter(f => f.slug === slug)
  const fotosVon = new Map<string, number>()
  for (const f of fotos) fotosVon.set(f.von, (fotosVon.get(f.von) ?? 0) + 1)
  const fotosFuer = (id: string) => fotosVon.get(teamById.get(id) ?? '') ?? 0

  let mein: ProgrammDaten['mein'] = null
  if (binTeilnehmer) {
    const ausweis = await ladeAusweis(admin, viewer.id)
    const d = detailFuer(viewer.id)
    mein = { check: parseCheckGeheim(byKey.get(checkKey(slug, viewer.id))?.comment), ausweis, fotos: fotosFuer(viewer.id), detail: d, zimmerMitName: zimmerMitName(d) }
  }

  let verwaltung: ProgrammDaten['verwaltung'] = null
  if (viewer.verwaltet) {
    const heute = zurichToday()
    const { data: ausweisRows } = await admin.from('zeiterfassung_comments').select('user_full_name, comment')
      .like('user_full_name', `${escLike(AUSWEIS_PREFIX)}%`)
    const ausweisById = new Map<string, string>()
    for (const r of (ausweisRows ?? []) as Array<{ user_full_name: string; comment: string }>) {
      ausweisById.set(r.user_full_name.slice(AUSWEIS_PREFIX.length), r.comment)
    }
    const zeilen: TeilnehmerZeile[] = teilnehmer.ids
      .map(id => {
        const name = teamById.get(id)
        if (!name) return null
        const check = parseCheckGeheim(byKey.get(checkKey(slug, id))?.comment)
        const a = parseAusweisGeheim(id, ausweisById.get(id))
        const k = { ausweisKomplett: ausweisKomplett(a), fotos: fotosFuer(id) }
        const f = fortschritt(programm.checkliste, check, k)
        const d = detailFuer(id)
        return {
          id, name, check,
          ausweis: { art: a.art, nummer: a.nummer, ablauf: a.ablauf, komplett: k.ausweisKomplett, bilder: a.bilder.length, status: ausweisStatus(a, heute) },
          fotos: k.fotos, erledigt: f.erledigt, total: f.total,
          offen: programm.checkliste.filter(i => !itemErledigt(i, check, k)).map(i => i.titel),
          detail: d, zimmerMitName: zimmerMitName(d), reihenfolge: reihenfolgeVon(id), gast: false,
        }
      })
      .filter((z): z is TeilnehmerZeile => z !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'de-CH'))
    // Gäste ohne Konto (nur Zimmer, Reservation, Menü)
    const gaeste: TeilnehmerZeile[] = Object.entries(details)
      .filter(([k]) => istGastId(k))
      .map(([k, d]) => ({
        id: k, name: d.name ?? 'Gast', check: leererCheck(),
        ausweis: { art: null, nummer: null, ablauf: null, komplett: false, bilder: 0, status: 'fehlt' },
        fotos: 0, erledigt: 0, total: 0, offen: [],
        detail: d, zimmerMitName: zimmerMitName(d),
        reihenfolge: (() => { const i = programm.details.findIndex(x => x.gast && gastId(x.vorname) === k); return i < 0 ? 999 : i })(),
        gast: true,
      }))
    const bekannteVornamen = new Set(programm.teilnehmerVornamen.map(v => v.vorname))
    verwaltung = {
      teilnehmer: zeilen,
      gaeste,
      nichtZugeordnet: teilnehmer.nichtZugeordnet.filter(n => bekannteVornamen.has(n)),
      team,
      adminPhasen: programm.adminPhasen,
      adminCheck: parseAdminCheck(byKey.get(adminCheckKey(slug, viewer.id))?.comment),
    }
  }

  return {
    ordner, bloecke, platzhalter: anzahlPlatzhalter(alleBloecke),
    checkliste: programm.checkliste, einstieg: programm.einstieg, menue: programm.menue,
    binTeilnehmer, jetzt: new Date().toISOString(), mein,
    verwaltung,
  }
}
