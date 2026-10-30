// Kontrollansicht «Abgelegte PDFs» auf der Lohnseite: pro Mitarbeiterin die
// Lohn-Dateien in ihrem Dokumentenordner für einen Monat, und ob der Name
// im PDF zur Ordnerinhaberin passt. Grundlage ist der PDF-Titel, den das
// Portal beim Erzeugen setzt («<Titel> <Periode> <Name>», siehe newDoc in
// src/lib/pdf/hr-pdfs.mjs); von Hand hochgeladene Fremd-PDFs ohne Titel
// gelten als «nicht prüfbar». Reine Logik ohne Datenbank, die Route
// /api/admin/lohn-kontrolle liefert die Daten.

export const LOHN_MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

/** «Oktober 2026» aus «2026-10» */
export function monatLabel(monat: string): string {
  return `${LOHN_MONATE[parseInt(monat.slice(5, 7), 10) - 1]} ${monat.slice(0, 4)}`
}

/** Gehört eine Lohn-Datei (nach ihrer Bezeichnung) zum Monat? Monatslohn
 *  «… Oktober 2026», Umsatzabrechnung «… 4. Quartal 2026» oder
 *  «… 2. Halbjahr 2026», wenn der Monat in der Periode liegt. */
export function bezugZumMonat(label: string, monat: string): 'monat' | 'periode' | null {
  const jahr = monat.slice(0, 4)
  const m = parseInt(monat.slice(5, 7), 10)
  const l = label.replace(/\s+/g, ' ')
  if (l.includes(monatLabel(monat))) return 'monat'
  const q = l.match(/(\d)\. Quartal (\d{4})/)
  if (q && q[2] === jahr && Math.ceil(m / 3) === parseInt(q[1], 10)) return 'periode'
  const h = l.match(/(\d)\. Halbjahr (\d{4})/)
  if (h && h[2] === jahr && (m <= 6 ? 1 : 2) === parseInt(h[1], 10)) return 'periode'
  return null
}

export type TitelPruefung = { status: 'ok' | 'fremd' | 'unbekannt'; name: string | null }

/** PDF-Titel gegen die Ordnerinhaberin prüfen. «fremd» = im Titel steht
 *  der Name einer anderen Mitarbeiterin (die Datei liegt im falschen
 *  Ordner), «unbekannt» = kein oder kein lesbarer Titel. */
export function titelPruefen(titel: string | null | undefined, inhaberin: string, alleNamen: string[]): TitelPruefung {
  const t = (titel ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return { status: 'unbekannt', name: null }
  const andere = alleNamen.filter(n => n && n !== inhaberin).sort((a, b) => b.length - a.length)
  if (t.endsWith(inhaberin)) return { status: 'ok', name: inhaberin }
  const fremdEnde = andere.find(n => t.endsWith(n))
  if (fremdEnde) return { status: 'fremd', name: fremdEnde }
  if (t.includes(inhaberin)) return { status: 'ok', name: inhaberin }
  const fremd = andere.find(n => t.includes(n))
  if (fremd) return { status: 'fremd', name: fremd }
  return { status: 'unbekannt', name: null }
}

export type KontrolleDatei = {
  id: string
  label: string
  fileName: string
  createdAt: string
  abgelegtVon: string | null
  bezug: 'monat' | 'periode'
  titel: string | null
  pruefung: TitelPruefung
}

export type Urteil = 'ok' | 'fehlt' | 'doppelt' | 'fremd' | 'unbekannt' | 'nicht_faellig'

export type KontrollePerson = {
  profileId: string
  name: string
  aktiv: boolean
  /** Für den Monat ist eine Abrechnung fällig (aktiv, nicht extern, schon eingetreten) */
  faellig: boolean
  abrechnungGespeichert: boolean
  dateien: KontrolleDatei[]
  urteil: Urteil
}

export type KontrolleErgebnis = {
  monat: string
  label: string
  geprueftAm: string
  personen: KontrollePerson[]
  zaehler: Record<Urteil, number>
}

export function beurteile(faellig: boolean, dateien: Array<Pick<KontrolleDatei, 'pruefung'>>): Urteil {
  if (dateien.some(d => d.pruefung.status === 'fremd')) return 'fremd'
  if (dateien.length === 0) return faellig ? 'fehlt' : 'nicht_faellig'
  if (dateien.some(d => d.pruefung.status === 'unbekannt')) return 'unbekannt'
  if (dateien.length > 1) return 'doppelt'
  return 'ok'
}

export const URTEIL_TEXT: Record<Urteil, string> = {
  ok: 'in Ordnung',
  fehlt: 'kein PDF im Ordner',
  doppelt: 'mehrere PDFs im Ordner',
  fremd: 'PDF einer anderen Person im Ordner',
  unbekannt: 'Name im PDF nicht prüfbar',
  nicht_faellig: 'keine Abrechnung fällig',
}

export function zaehle(personen: KontrollePerson[]): Record<Urteil, number> {
  const z: Record<Urteil, number> = { ok: 0, fehlt: 0, doppelt: 0, fremd: 0, unbekannt: 0, nicht_faellig: 0 }
  for (const p of personen) z[p.urteil]++
  return z
}
