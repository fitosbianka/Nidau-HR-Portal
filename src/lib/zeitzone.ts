// Zürcher Zeitzone ohne feste Annahmen: der Offset zu UTC kommt aus Intl
// für den jeweiligen Zeitpunkt. Die Sommerzeit beginnt am letzten Sonntag
// im März und endet am letzten Sonntag im Oktober. Vorher rechnete der Code
// an mehreren Stellen mit «April bis Oktober = +02:00», was in den letzten
// Oktobertagen und den letzten Märztagen eine Stunde daneben lag (eine
// Korrektur auf 07:10 wurde als 06:10 gespeichert).

export const ZUERICH = 'Europe/Zurich'

const FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: ZUERICH, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
})

/** Wandzeit in Zürich für einen Zeitpunkt, als Zahlen */
function wandzeit(d: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const p = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 }
  for (const x of FMT.formatToParts(d)) if (x.type in p) p[x.type as keyof typeof p] = parseInt(x.value, 10)
  return p
}

/** Offset Zürich gegenüber UTC in Minuten für diesen Zeitpunkt (60 im Winter, 120 im Sommer) */
export function zurichOffsetMinuten(d: Date): number {
  const p = wandzeit(d)
  const alsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((alsUtc - d.getTime()) / 60000)
}

/** «+01:00» oder «+02:00» für diesen Zeitpunkt */
export function zurichOffsetText(d: Date): string {
  const m = zurichOffsetMinuten(d)
  const a = Math.abs(m)
  return `${m < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

/** Zürcher Wandzeit (Datum yyyy-mm-dd, Zeit HH:MM oder HH:MM:SS) als Zeitpunkt.
 *  Erster Versuch mit dem Offset, der zur Wandzeit (als UTC gelesen) gilt,
 *  dann mit dem Offset des gefundenen Zeitpunkts nachjustiert, damit die
 *  Tage der Zeitumstellung stimmen. */
export function zurichZuDate(datum: string, zeit = '00:00'): Date {
  const [y, mo, d] = datum.split('-').map(n => parseInt(n, 10))
  const [h = 0, mi = 0, s = 0] = zeit.split(':').map(n => parseInt(n, 10))
  const wand = Date.UTC(y, mo - 1, d, h, mi, s)
  const erster = wand - zurichOffsetMinuten(new Date(wand)) * 60000
  return new Date(wand - zurichOffsetMinuten(new Date(erster)) * 60000)
}

/** Dasselbe als ISO Text (UTC), so wie attendance_events.time_logged gespeichert wird */
export const zurichZuIso = (datum: string, zeit = '00:00') => zurichZuDate(datum, zeit).toISOString()

/** Heutiges Datum in Zürich, yyyy-mm-dd */
export const zurichHeute = () => new Date().toLocaleDateString('en-CA', { timeZone: ZUERICH })

/** Datum in Zürich eines Zeitpunkts, yyyy-mm-dd */
export const zurichDatum = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: ZUERICH })

/** UTC Fenster eines Zürcher Tages als ISO: start (inklusive) bis ende (exklusive).
 *  Am Tag der Zeitumstellung ist das Fenster 23 oder 25 Stunden lang. */
export function zurichTagesFenster(datum = zurichHeute()): { start: string; ende: string } {
  const [y, m, d] = datum.split('-').map(n => parseInt(n, 10))
  const naechster = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  return { start: zurichZuIso(datum), ende: zurichZuIso(naechster) }
}

/** UTC Beginn (ISO) des Zürcher Monats, in dem das Datum liegt */
export const zurichMonatsStart = (datum = zurichHeute()) => zurichZuIso(`${datum.slice(0, 7)}-01`)

/** TimeMoto schickt timeLogged als Zürcher Wandzeit ohne UTC Kennzeichen
 *  («2026-10-29T07:10:00»). Mit Kennzeichen («Z» oder «+01:00») wird der
 *  Text direkt gelesen. Ohne Kennzeichen werden beide Schweizer Offsets
 *  probiert und der genommen, der die Wandzeit reproduziert; bei der
 *  doppelten Stunde im Herbst gewinnt die Sommerzeit, in der
 *  Frühlingslücke gilt Normalzeit. (Vorher im Webhook, unverändert.) */
export function timemotoZeitZuDate(raw: string): Date | null {
  if (!raw) return null
  if (raw.includes('+') || raw.toUpperCase().endsWith('Z')) {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d
  }
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  const naiveUTC = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0)
  const wall = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`
  for (const offMin of [120, 60]) {
    const cand = new Date(naiveUTC - offMin * 60000)
    const back = cand.toLocaleString('sv-SE', { timeZone: ZUERICH })
    if (back.slice(0, 16) === wall) return cand
  }
  return new Date(naiveUTC - 60 * 60000)
}

