// Ferien entries in work_schedule:
//   'F'      → one full counted vacation day (weight 1)
//   'F:0.5'  → fractional counted day (for part-timers with flexible
//              schedules, e.g. a 50% employee away a full Mo–Fr week
//              booked as 5 calendar days = 2.5 angerechnete Tage)
// The Arbeitsplan displays all of them as «F»; only the counting differs.

/** Counted weight of a Ferien entry, or null if the entry is not Ferien. */
export function ferienWeight(entry: string | null | undefined): number | null {
  if (!entry) return null
  if (entry === 'F') return 1
  const m = entry.match(/^F:(\d*\.?\d+)$/i)
  if (!m) return null
  const w = parseFloat(m[1])
  return isNaN(w) ? null : w
}

export const round2 = (n: number) => Math.round(n * 100) / 100

/** ISO-Kalenderwoche (Montag-basiert) eines Datums YYYY-MM-DD. */
export function isoKw(ds: string): number {
  const d = new Date(`${ds}T00:00:00`)
  const t = new Date(d)
  t.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const jan4 = new Date(t.getFullYear(), 0, 4)
  return 1 + Math.round(((t.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7)
}

/** «KW 7» bzw. «KW 7 – 8» für einen Zeitraum — steht überall neben Ferien-
 *  und Abwesenheitsdaten (Listen, Dialoge, Info-Karte im Kalender). */
export function kwBereich(from: string, to: string): string {
  const a = isoKw(from), b = isoKw(to)
  return a === b ? `KW ${a}` : `KW ${a} – ${b}`
}
