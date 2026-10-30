// Programm eines Teamevents: Infotexte (Standard aus der Datendatei, von
// der Organisatorin auf der Seite anpassbar), Teilnehmende, persönliche
// Checkliste pro Person und die Admin Checkliste der Organisatorin.
// Ablage als reservierte Zeilen in zeiterfassung_comments (kein DDL):
//   __teamevent_texte__<slug>                 @ 1970-01-01 → { bloecke: { [blockId]: string[] } }
//   __teamevent_teilnehmer__<slug>            @ 1970-01-01 → { ids: string[], nichtZugeordnet: string[] }
//   __teamevent_check__<slug>__<profileId>    @ 1970-01-01 → TeCheck (nur eigene Person + Organisatorin)
//   __teamevent_admincheck__<slug>__<profileId> @ 1970-01-01 → { ticks } (nur Organisatorin)
//   __teamevent_details__<slug>               @ 1970-01-01 → { [profileId]: TeDetail } (Zimmer, Reservation, Menü, Pre Registration; nur Organisatorin schreibt)
// Textregeln für alles, was Mitarbeitende sehen: Schweizer Schreibweise
// ohne scharfes s, keine Binde oder Gedankenstriche, keine Doppelpunkte,
// Zeiten als 8.00 Uhr, Du Form, kurz und freundlich.

import { TE_ANCHOR } from './teamevents'

export const TE_TEXTE_PREFIX = '__teamevent_texte__'
export const TE_TEILNEHMER_PREFIX = '__teamevent_teilnehmer__'
export const TE_CHECK_PREFIX = '__teamevent_check__'
export const TE_ADMINCHECK_PREFIX = '__teamevent_admincheck__'
export const TE_DETAILS_PREFIX = '__teamevent_details__'
export const TE_PROGRAMM_ANCHOR = TE_ANCHOR

export const texteKey = (slug: string) => `${TE_TEXTE_PREFIX}${slug}`
export const teilnehmerKey = (slug: string) => `${TE_TEILNEHMER_PREFIX}${slug}`
export const checkKey = (slug: string, profileId: string) => `${TE_CHECK_PREFIX}${slug}__${profileId}`
export const adminCheckKey = (slug: string, profileId: string) => `${TE_ADMINCHECK_PREFIX}${slug}__${profileId}`
export const detailsKey = (slug: string) => `${TE_DETAILS_PREFIX}${slug}`

// ── Infotexte ───────────────────────────────────────────────────────────

/** ort 'info' = Block im Infoteil; 'checkliste' = Text, der in der
 *  Checkliste erscheint (z. B. eine Frist) und gleich bearbeitet wird. */
export type InfoBlock = { id: string; titel: string; zeilen: string[]; ort: 'info' | 'checkliste' }
export type TeTexte = Record<string, string[]>

export function parseTexte(comment: string | null | undefined): TeTexte {
  if (!comment) return {}
  try {
    const j = JSON.parse(comment) as { bloecke?: Record<string, unknown> }
    const out: TeTexte = {}
    for (const [k, v] of Object.entries(j.bloecke ?? {})) {
      if (Array.isArray(v)) out[k] = v.filter((z): z is string => typeof z === 'string').map(z => z.trim()).filter(Boolean).slice(0, 60)
    }
    return out
  } catch { return {} }
}

/** Standardblöcke mit den gespeicherten Anpassungen überlagert. */
export function bloeckeMit(standard: InfoBlock[], texte: TeTexte): Array<InfoBlock & { angepasst: boolean }> {
  return standard.map(b => (texte[b.id] ? { ...b, zeilen: texte[b.id], angepasst: true } : { ...b, angepasst: false }))
}

const PLATZHALTER_RE = /\[[^\]]*\]/

/** Platzhalter in eckigen Klammern: für die Organisatorin sichtbar
 *  markiert, für alle anderen wird die ganze Zeile ausgeblendet, bis der
 *  Platzhalter ausgefüllt ist. */
export const hatPlatzhalter = (zeile: string) => PLATZHALTER_RE.test(zeile)
export const zeilenFuer = (zeilen: string[], verwaltet: boolean) => (verwaltet ? zeilen : zeilen.filter(z => !hatPlatzhalter(z)))
/** Zeile in Text und Platzhalter Teile zerlegen (zum Hervorheben). */
export function platzhalterTeile(zeile: string): Array<{ text: string; platzhalter: boolean }> {
  const out: Array<{ text: string; platzhalter: boolean }> = []
  let rest = zeile
  for (;;) {
    const m = /\[[^\]]*\]/.exec(rest)
    if (!m) { if (rest) out.push({ text: rest, platzhalter: false }); return out }
    if (m.index > 0) out.push({ text: rest.slice(0, m.index), platzhalter: false })
    out.push({ text: m[0], platzhalter: true })
    rest = rest.slice(m.index + m[0].length)
  }
}
export const anzahlPlatzhalter = (bloecke: Array<{ zeilen: string[] }>) =>
  bloecke.reduce((n, b) => n + b.zeilen.filter(hatPlatzhalter).length, 0)

// ── Teilnehmende ────────────────────────────────────────────────────────

export type TeTeilnehmer = { ids: string[]; nichtZugeordnet: string[] }

export function parseTeilnehmer(comment: string | null | undefined): TeTeilnehmer | null {
  if (!comment) return null
  try {
    const j = JSON.parse(comment) as Partial<TeTeilnehmer>
    if (!Array.isArray(j.ids)) return null
    return {
      ids: Array.from(new Set(j.ids.filter((x): x is string => typeof x === 'string'))),
      nichtZugeordnet: Array.isArray(j.nichtZugeordnet) ? j.nichtZugeordnet.filter((x): x is string => typeof x === 'string') : [],
    }
  } catch { return null }
}

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Vornamen (mit Kurzformen) den Profilen zuordnen. Liefert die
 *  gefundenen Profil IDs und die Namen ohne Treffer. */
export function teilnehmerZuordnen(
  vornamen: Array<{ vorname: string; alias?: string[] }>,
  profile: Array<{ id: string; full_name: string }>,
): TeTeilnehmer {
  const ids: string[] = []
  const nichtZugeordnet: string[] = []
  for (const v of vornamen) {
    const kandidaten = [v.vorname, ...(v.alias ?? [])].map(normal)
    const treffer = profile.filter(p => kandidaten.includes(normal(p.full_name.split(/\s+/)[0] ?? '')))
    if (treffer.length === 1) ids.push(treffer[0].id)
    else nichtZugeordnet.push(v.vorname)
  }
  return { ids: Array.from(new Set(ids)), nichtZugeordnet }
}

// ── Persönliche Checkliste ──────────────────────────────────────────────

export type Einstieg = 'kehrsatz' | 'bern'
export type CheckArt = 'ausweis' | 'einstieg' | 'allergien' | 'manuell' | 'packliste' | 'fotos'
export type CheckItem = {
  id: string
  titel: string
  text?: string
  frist?: string            // Fristtext für die Anzeige
  fristBis?: string         // ISO Zeitpunkt; danach ist die Eingabe für das Team geschlossen (Organisatorin weiterhin)
  geschlossenText?: string  // Hinweis nach Ablauf der Frist
  fristBlock?: string       // oder Frist aus einem bearbeitbaren Textblock (ort 'checkliste')
  art: CheckArt
  packlisteBlock?: string   // bei art 'packliste': Block mit der Packliste
}

/** Frist abgelaufen? jetzt als ISO Zeitpunkt (vom Server übergeben, damit
 *  Browser und Server dieselbe Uhr verwenden). */
export const fristAbgelaufen = (fristBis: string | undefined, jetzt: string) => !!fristBis && Date.parse(jetzt) >= Date.parse(fristBis)

export type TeCheck = {
  ticks: Record<string, boolean>
  einstieg: Einstieg | null
  allergien: string | null
  keineAllergien: boolean
  aktualisiertAm: string | null
}

export const leererCheck = (): TeCheck => ({ ticks: {}, einstieg: null, allergien: null, keineAllergien: false, aktualisiertAm: null })

export function parseCheck(comment: string | null | undefined): TeCheck {
  const leer = leererCheck()
  if (!comment) return leer
  try {
    const j = JSON.parse(comment) as Partial<TeCheck>
    const ticks: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(j.ticks ?? {})) if (typeof v === 'boolean') ticks[k] = v
    return {
      ticks,
      einstieg: j.einstieg === 'kehrsatz' || j.einstieg === 'bern' ? j.einstieg : null,
      allergien: typeof j.allergien === 'string' && j.allergien.trim() ? j.allergien.trim().slice(0, 500) : null,
      keineAllergien: j.keineAllergien === true,
      aktualisiertAm: typeof j.aktualisiertAm === 'string' ? j.aktualisiertAm : null,
    }
  } catch { return leer }
}

/** Kontext für die automatischen Haken: Ausweis vollständig (Art, Nummer
 *  und Ablaufdatum) und Anzahl eigener Fotos im Ordner. */
export type CheckKontext = { ausweisKomplett: boolean; fotos: number }

export function itemErledigt(item: CheckItem, c: TeCheck, k: CheckKontext): boolean {
  switch (item.art) {
    case 'ausweis': return k.ausweisKomplett
    case 'einstieg': return c.einstieg !== null
    case 'allergien': return c.keineAllergien || !!c.allergien
    case 'fotos': return k.fotos > 0 || c.ticks[item.id] === true
    default: return c.ticks[item.id] === true
  }
}
/** Haken, die man von Hand setzt (die anderen ergeben sich aus dem Feld). */
export const manuellAbhakbar = (item: CheckItem) => item.art === 'manuell' || item.art === 'packliste' || item.art === 'fotos'

export function fortschritt(items: CheckItem[], c: TeCheck, k: CheckKontext): { erledigt: number; total: number } {
  return { erledigt: items.filter(i => itemErledigt(i, c, k)).length, total: items.length }
}

// ── Admin Checkliste ────────────────────────────────────────────────────

export type AdminItem = { id: string; titel: string; text: string; vorerledigt?: boolean; eigen?: boolean }
export type AdminPhase = { id: string; titel: string; frist: string; items: AdminItem[] }
/** Von der Organisatorin selbst ergänzter Punkt (einer Phase zugeordnet). */
export type EigenerPunkt = { id: string; phase: string; titel: string; text: string; erstelltAm: string }
export type TeAdminCheck = { ticks: Record<string, boolean>; eigene: EigenerPunkt[] }

/** Sammelphase für eigene Punkte ausserhalb der vorgegebenen Phasen. */
export const EIGENE_PHASE: AdminPhase = { id: 'eigene', titel: 'Weitere Punkte', frist: 'eigene Ergänzungen', items: [] }
export const EIGEN_ID_RE = /^eigen-[a-z0-9]{6,24}$/

export function parseAdminCheck(comment: string | null | undefined): TeAdminCheck {
  if (!comment) return { ticks: {}, eigene: [] }
  try {
    const j = JSON.parse(comment) as Partial<TeAdminCheck>
    const ticks: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(j.ticks ?? {})) if (typeof v === 'boolean') ticks[k] = v
    const eigene: EigenerPunkt[] = Array.isArray(j.eigene)
      ? j.eigene.filter((e): e is EigenerPunkt => !!e && typeof e === 'object' && typeof (e as EigenerPunkt).id === 'string' && typeof (e as EigenerPunkt).titel === 'string')
          .map(e => ({ id: e.id, phase: typeof e.phase === 'string' ? e.phase : EIGENE_PHASE.id, titel: e.titel, text: typeof e.text === 'string' ? e.text : '', erstelltAm: typeof e.erstelltAm === 'string' ? e.erstelltAm : '' }))
      : []
    return { ticks, eigene }
  } catch { return { ticks: {}, eigene: [] } }
}

/** Vorgegebene Phasen plus eigene Punkte (am Ende der jeweiligen Phase);
 *  die Sammelphase «Weitere Punkte» steht immer zuletzt. */
export function phasenMitEigenen(phasen: AdminPhase[], eigene: EigenerPunkt[]): AdminPhase[] {
  const alle = [...phasen, EIGENE_PHASE]
  return alle.map(ph => ({
    ...ph,
    items: [...ph.items, ...eigene.filter(e => e.phase === ph.id || (ph.id === EIGENE_PHASE.id && !alle.some(x => x.id === e.phase))).map(e => ({ id: e.id, titel: e.titel, text: e.text, eigen: true }))],
  }))
}
/** Gespeicherter Haken, sonst die Vorgabe aus der Datendatei. */
export const adminErledigt = (item: AdminItem, a: TeAdminCheck) => (item.id in a.ticks ? a.ticks[item.id] : item.vorerledigt === true)

// ── Persönliche Details (Zimmer, Reservation, Abendessen) ───────────────

/** Schlüssel für Gäste ohne Konto (z. B. Odette): «gast:odette». Sie haben
 *  Zimmer, Reservation und Menü, aber keine Checkliste und keinen Ausweis im Portal. */
export const istGastId = (id: string) => id.startsWith('gast:')
export const gastId = (name: string) => `gast:${name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'gast'}`
export const GAST_ID_RE = /^gast:[a-z0-9-]{1,40}$/

export type TeDetail = {
  name: string | null             // nur bei Gästen ohne Konto
  zimmer: 'doppel' | 'einzel' | null
  zimmerMit: string | null        // Profil ID oder Gast Schlüssel der Zimmerpartnerin / des Zimmerpartners
  resName: string | null          // Reservation läuft auf
  resNr: string | null            // Reservierungs Nr.
  vorspeise: string | null
  hauptgang: string | null
  dessert: string | null          // «kein Dessert gewünscht» zählt als gewählt
  preReg: boolean                 // Pre Registration erledigt (nur Organisatorin)
}
export type TeDetails = Record<string, TeDetail>

export const leeresDetail = (): TeDetail => ({ name: null, zimmer: null, zimmerMit: null, resName: null, resNr: null, vorspeise: null, hauptgang: null, dessert: null, preReg: false })

const text = (v: unknown, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

export function parseDetail(v: unknown): TeDetail {
  const d = leeresDetail()
  if (!v || typeof v !== 'object') return d
  const j = v as Partial<TeDetail>
  return {
    name: text(j.name, 80),
    zimmer: j.zimmer === 'doppel' || j.zimmer === 'einzel' ? j.zimmer : null,
    zimmerMit: text(j.zimmerMit, 64),
    resName: text(j.resName), resNr: text(j.resNr, 40),
    vorspeise: text(j.vorspeise), hauptgang: text(j.hauptgang), dessert: text(j.dessert),
    preReg: j.preReg === true,
  }
}
/** gaesteOk = Gäste aus der Datendatei wurden schon ergänzt (einmalig). */
export function parseDetailsRoh(comment: string | null | undefined): { details: TeDetails; gaesteOk: boolean } | null {
  if (!comment) return null
  try {
    const j = JSON.parse(comment) as { details?: Record<string, unknown>; gaesteOk?: unknown }
    if (!j.details || typeof j.details !== 'object') return null
    const out: TeDetails = {}
    for (const [k, v] of Object.entries(j.details)) out[k] = parseDetail(v)
    return { details: out, gaesteOk: j.gaesteOk === true }
  } catch { return null }
}
export const parseDetails = (comment: string | null | undefined): TeDetails | null => parseDetailsRoh(comment)?.details ?? null

/** Offene Angaben einer Person (für die Hervorhebung in der Übersicht). */
export function detailOffen(d: TeDetail): string[] {
  const o: string[] = []
  if (!d.zimmer || (d.zimmer === 'doppel' && !d.zimmerMit)) o.push('Zimmer')
  if (!d.resNr) o.push('Reservierungs Nr.')
  if (!d.vorspeise) o.push('Vorspeise')
  if (!d.hauptgang) o.push('Hauptgang')
  if (!d.dessert) o.push('Dessert')
  return o
}
