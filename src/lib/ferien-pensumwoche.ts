// Pensumwoche für Teilzeit mit ganzen Tagen: ist eine Kalenderwoche an allen
// Arbeitstagen (Montag bis Freitag ohne Feiertage) mit F belegt, zählt sie
// Pensum mal Arbeitstage, bei 50 Prozent also 2.5 Tage und 21.15 Stunden,
// nicht 5 Tage und 42.30 Stunden. Einzelne F-Tage zählen weiter je einen
// Tag (die Person hat an diesem Tag wirklich gearbeitet). Dieselbe Regel
// gilt in der Ferienplanung (ferientageZaehlen, ganze Woche nach Pensum),
// so rechnen Konto, Zeiterfassung und Ferienplanung gleich. Wer einen
// Ferienanteil pro Wochentag hat (zum Beispiel Annegret), wird dort
// gewichtet und hier nicht angefasst.
//
// Dazu die Prüfung für Admins: pro Person und Woche, wo seit Juli mehr
// F-Tage stehen, als das Pensum hergibt, oder ein F auf einem freien Tag
// laut Standardwoche liegt. Reine Logik ohne Datenbank.

import { arbeitstageBetween } from './feiertage'
import { ferienWeight, round2 } from './ferien'
import { anteilAm, ferienGewicht, type AnteilRegel } from './ferien-anteil'
import { codeInfo } from './ferien-kapazitaet'

const addTage = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const isoWd = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7 + 1
export const montagVon = (d: string) => addTage(d, -(isoWd(d) - 1))
const istF = (entry: string | undefined) => entry != null && ferienWeight(entry) != null
const istGlattesF = (entry: string | undefined) => (entry ?? '').trim().toUpperCase() === 'F'

/** Wochen (Montag) der Tage, die F tragen */
function fWochen(absences: Record<string, string>): string[] {
  const m = new Set<string>()
  for (const d of Object.keys(absences)) if (istF(absences[d]) && isoWd(d) <= 5) m.add(montagVon(d))
  return Array.from(m).sort()
}

/** Glatte F einer ganz belegten Woche als F:<Pensum> gewichten. faktor =
 *  Pensum als Bruch (0.5); 1 oder ungültig lässt alles unverändert. Tage,
 *  die ein Ferienanteil pro Wochentag abdeckt, bleiben unverändert. */
export function pensumWocheGewichte(absences: Record<string, string>, faktor: number | null | undefined, regel?: AnteilRegel | null): Record<string, string> {
  if (!(faktor != null && faktor > 0 && faktor < 1)) return absences
  const out = { ...absences }
  for (const montag of fWochen(absences)) {
    const tage = arbeitstageBetween(montag, addTage(montag, 4))
    if (tage.length === 0 || !tage.every(d => istF(absences[d]))) continue
    for (const d of tage) {
      if (anteilAm(regel, d) != null) continue
      if (istGlattesF(absences[d])) out[d] = `F:${parseFloat(faktor.toFixed(4))}`
    }
  }
  return out
}

export type PruefArt = 'pensumwoche' | 'zuviel' | 'freier_tag'
export type PruefTag = { datum: string; entry: string; bisher: number; neu: number; frei: boolean }
export type PruefWoche = {
  montag: string
  /** Arbeitstage der Woche ohne Feiertage */
  arbeitstage: number
  tage: PruefTag[]
  ganzeWoche: boolean
  /** Bisherige Zählung (F = 1, F:x = x) und neue Zählung (Pensumwoche, Ferienanteil) */
  bisher: number
  neu: number
  /** Höchstens so viele Tage ergibt das Pensum in dieser Woche (aufgerundet) */
  erlaubt: number
  arten: PruefArt[]
}

export type FerienPruefungPerson = { id: string; name: string; pensumLabel: string; wochen: PruefWoche[] }

export const PRUEF_ART_LABEL: Record<PruefArt, string> = {
  pensumwoche: 'Ganze Woche F, zählt neu nach Pensum',
  zuviel: 'Mehr F-Tage als das Pensum ergibt',
  freier_tag: 'F an einem freien Tag laut Standardwoche',
}

/** Wochen mit Auffälligkeiten einer Person im Zeitraum. standardwoche =
 *  Codes pro ISO Wochentag («1» bis «5»); leer heisst keine Vorgabe. */
export function ferienPruefung(opts: {
  absences: Record<string, string>
  faktor: number | null | undefined
  regel?: AnteilRegel | null
  standardwoche?: Record<string, string> | null
  from: string
  to: string
}): PruefWoche[] {
  const { absences, regel, standardwoche, from, to } = opts
  const faktor = opts.faktor != null && opts.faktor > 0 && opts.faktor <= 1 ? opts.faktor : 1
  const gewichtet = pensumWocheGewichte(absences, faktor, regel)
  const out: PruefWoche[] = []
  for (const montag of fWochen(absences)) {
    const freitag = addTage(montag, 4)
    if (freitag < from || montag > to) continue
    const arbeitstage = arbeitstageBetween(montag, freitag)
    const tage: PruefTag[] = []
    for (const d of arbeitstageBetween(montag, freitag).concat(Object.keys(absences).filter(x => x >= montag && x <= freitag && !arbeitstageBetween(montag, freitag).includes(x))).sort()) {
      const entry = absences[d]
      if (!istF(entry)) continue
      const code = standardwoche?.[String(isoWd(d))]
      const info = codeInfo(code)
      const frei = !!code && !info.arbeitet && !info.ho
      tage.push({ datum: d, entry, bisher: ferienWeight(entry) ?? 0, neu: ferienGewicht(gewichtet[d], regel, d) ?? 0, frei })
    }
    if (tage.length === 0) continue
    const ganzeWoche = arbeitstage.length > 0 && arbeitstage.every(d => istF(absences[d]))
    const bisher = round2(tage.reduce((s, t) => s + t.bisher, 0))
    const neu = round2(tage.reduce((s, t) => s + t.neu, 0))
    const erlaubt = Math.ceil(arbeitstage.length * faktor - 1e-9)
    const arten: PruefArt[] = []
    const mitAnteil = tage.some(t => anteilAm(regel, t.datum) != null)
    if (ganzeWoche && faktor < 1 && !mitAnteil) arten.push('pensumwoche')
    if (!ganzeWoche && faktor < 1 && !mitAnteil && neu > erlaubt + 1e-9) arten.push('zuviel')
    if (tage.some(t => t.frei)) arten.push('freier_tag')
    if (arten.length > 0) out.push({ montag, arbeitstage: arbeitstage.length, tage, ganzeWoche, bisher, neu, erlaubt, arten })
  }
  return out
}
