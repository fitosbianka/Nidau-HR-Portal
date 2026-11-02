// Eine alte Monatsnotiz (ein Textblock, eine Zeile pro Hinweis, Kürzel am
// Zeilenende) in Einträge pro Tag zerlegen: Kürzel abtrennen, Tag, Zeitraum
// oder Woche im Text erkennen. Das Ergebnis ist ein Vorschlag, den die
// Admin in der Vorschau prüft und anpasst, bevor gespeichert wird.

import { mondayOf, sundayOf } from './plan-notes'

export type UmwandlungScope = 'day' | 'week' | 'month'
export type UmwandlungItem = {
  original: string
  text: string
  by: string | null
  scope: UmwandlungScope
  anchor: string | null     // Tag oder Montag der Woche (YYYY-MM-DD)
  to: string | null         // Ende eines Zeitraums (nur Tage)
}

const MONATSNAMEN = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember']
const WOCHENTAG = '(?:Mo|Di|Mi|Do|Fr|Sa|So)(?:ntag|enstag|ttwoch|nnerstag|eitag|mstag)?\\.?'

function monatAusText(s: string | undefined, fallback: number): number | null {
  if (!s) return fallback
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  const low = s.toLowerCase().replace('maerz', 'märz')
  const idx = MONATSNAMEN.findIndex(m => m.startsWith(low.slice(0, 3)))
  return idx >= 0 ? idx + 1 : null
}

/** Kürzel am Zeilenende abtrennen, wenn es ein bekanntes Kürzel ist
 *  («… bf», «… (lrg)», «… – DT.»). */
export function kuerzelAbtrennen(zeile: string, bekannte: string[]): { text: string; by: string | null } {
  const m = zeile.match(/^(.*?)[\s,;:\-–—(\[]*\(?([A-Za-z]{2,4})\)?[.\s]*$/)
  if (m) {
    const token = m[2].toUpperCase()
    if (bekannte.map(k => k.toUpperCase()).includes(token)) {
      return { text: m[1].replace(/[\s,;:\-–—(\[]+$/, '').trim(), by: token }
    }
  }
  return { text: zeile.trim(), by: null }
}

/** Tag, Zeitraum oder Woche im Text erkennen (nur im Planmonat). */
export function datumErkennen(text: string, year: number, month: number): { scope: UmwandlungScope; anchor: string | null; to: string | null } {
  const mm = String(month).padStart(2, '0')
  const tage = new Date(year, month, 0).getDate()
  const tag = (d: number) => (d >= 1 && d <= tage ? `${year}-${mm}-${String(d).padStart(2, '0')}` : null)
  const keins = { scope: 'month' as const, anchor: null, to: null }

  // Zeitraum: 3.-5.12. | 3. bis 5.12. | 3.12. – Mi 5.12. | 3.–5. Dezember
  const bereich = text.match(new RegExp(`\\b(\\d{1,2})\\.\\s*(?:(\\d{1,2})\\.)?\\s*(?:-|–|—|bis)\\s*(?:${WOCHENTAG}\\s+)?(\\d{1,2})\\.(?:\\s*(\\d{1,2})\\.|\\s*([A-Za-zäöüÄÖÜ]{3,9}))?(?!\\d)`))
  if (bereich) {
    const d1 = parseInt(bereich[1], 10), d2 = parseInt(bereich[3], 10)
    const m2 = monatAusText(bereich[4] ?? bereich[5], monatAusText(bereich[2], month) ?? month)
    if (m2 === month && tag(d1) && tag(d2)) return { scope: 'day', anchor: tag(d1), to: d2 > d1 ? tag(d2) : null }
  }
  // Einzelner Tag mit Monat: 3.12. | 3. Dezember | 3. Dez
  const mitMonat = text.match(/\b(\d{1,2})\.\s?(\d{1,2})\.(?!\d)/) ?? text.match(/\b(\d{1,2})\.\s*([A-Za-zäöüÄÖÜ]{3,9})\b/)
  if (mitMonat) {
    const d = parseInt(mitMonat[1], 10)
    const m = monatAusText(mitMonat[2], month)
    if (m === month && tag(d)) return { scope: 'day', anchor: tag(d), to: null }
    if (m != null && m !== month && /^\d+$/.test(mitMonat[2])) return keins   // anderer Monat: nicht zuordnen
  }
  // Wochentag + Tag: «Mo 3.», oder «am 3.», «ab 3.»
  const wtag = text.match(new RegExp(`\\b${WOCHENTAG}\\s+(\\d{1,2})\\.(?!\\d)`)) ?? text.match(/\b(?:am|ab|vom|den|der)\s+(\d{1,2})\.(?!\d)/i)
  if (wtag) {
    const d = parseInt(wtag[1], 10)
    if (tag(d)) return { scope: 'day', anchor: tag(d), to: null }
  }
  // Kalenderwoche: KW 50
  const kw = text.match(/\bKW\s*(\d{1,2})\b/i)
  if (kw) {
    const n = parseInt(kw[1], 10)
    const montag1 = mondayOf(`${year}-01-04`)
    const d = new Date(`${montag1}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + (n - 1) * 7)
    const montag = d.toISOString().slice(0, 10)
    const ersterTag = `${year}-${mm}-01`, letzterTag = `${year}-${mm}-${String(tage).padStart(2, '0')}`
    if (sundayOf(montag) >= ersterTag && montag <= letzterTag) return { scope: 'week', anchor: montag, to: null }
  }
  return keins
}

/** Monatsnotiz in Zeilen zerlegen; jede Zeile wird ein Vorschlag. */
export function monatsnotizZerlegen(text: string, year: number, month: number, bekannteKuerzel: string[]): UmwandlungItem[] {
  return text
    .split(/\r?\n/)
    .map(z => z.replace(/^[\s\-–—•*·▪►>]+/, '').trim())
    .filter(Boolean)
    .map(original => {
      const { text: rest, by } = kuerzelAbtrennen(original, bekannteKuerzel)
      const datum = datumErkennen(rest, year, month)
      return { original, text: rest || original, by, ...datum }
    })
}
