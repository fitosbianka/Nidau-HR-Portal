// Ferienvertretung für die Zahnärztinnen und Zahnärzte (ZAZ): wer vertritt
// während einer eingetragenen Abwesenheit.
//
// Ablage pro TAG als reservierte Zeile in zeiterfassung_comments:
//   user_full_name = __ferien_vertretung__<employee_id>, schedule_date = Tag,
//   comment = {"name":"…"}. Pro Tag gespeichert, damit das Anpassen oder
//   teilweise Entfernen einer Ferienperiode die Vertretung sauber mitnimmt.
// Nur Admins und die Ferien-Editorin sehen und setzen die
// Vertretung — die Mitarbeiter-Ferienplanung erhält diese Daten nicht.

import { weekdaysBetween } from '@/lib/ferien-wuensche'

export const VERTRETUNG_PREFIX = '__ferien_vertretung__'

export type FerienVertretung = { employeeId: string; date: string; name: string }

/** ZAZ-Gruppe (Zahnärztinnen und Zahnärzte) — nur dort gibt es eine Ferienvertretung. */
export function istZaz(jobTitle: string | null | undefined): boolean {
  return (jobTitle ?? '').trim() === 'ZAZ'
}

export function parseVertretungRows(
  rows: Array<{ user_full_name: string; schedule_date: string; comment: string }>,
): FerienVertretung[] {
  const out: FerienVertretung[] = []
  for (const r of rows) {
    if (!r.user_full_name.startsWith(VERTRETUNG_PREFIX)) continue
    try {
      const meta = JSON.parse(r.comment) as { name?: unknown }
      const name = typeof meta.name === 'string' ? meta.name.trim() : ''
      if (!name) continue
      out.push({ employeeId: r.user_full_name.slice(VERTRETUNG_PREFIX.length), date: r.schedule_date, name })
    } catch { /* kaputte Zeile überspringen */ }
  }
  return out
}

/** Schlüssel `${employeeId}|${date}` → Name der Vertretung. */
export function vertretungMap(list: FerienVertretung[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const v of list) out[`${v.employeeId}|${v.date}`] = v.name
  return out
}

export type VertretungDetail = { name: string; tage: string[] }

/** Vertretungen einer Periode mit ihren Tagen, nach Name gruppiert
 *  (Reihenfolge: erster Vertretungstag). */
export function vertretungDetails(
  map: Record<string, string> | undefined,
  employeeId: string,
  from: string,
  to: string,
): VertretungDetail[] {
  if (!map) return []
  const out: VertretungDetail[] = []
  for (const d of weekdaysBetween(from, to)) {
    const n = map[`${employeeId}|${d}`]
    if (!n) continue
    const e = out.find(x => x.name === n)
    if (e) e.tage.push(d); else out.push({ name: n, tage: [d] })
  }
  return out
}

const WOCHENTAG_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

/** «Mo 15.02.» */
export function tagKurz(d: string): string {
  const dt = new Date(`${d}T00:00:00`)
  return `${WOCHENTAG_KURZ[dt.getDay()]} ${d.slice(8, 10)}.${d.slice(5, 7)}.`
}

/** «Mo 15.02., Di 16.02., Fr 19.02.» */
export function tageText(tage: string[]): string {
  return tage.map(tagKurz).join(', ')
}

/** Vertretung(en) einer Periode — eindeutige Namen in Reihenfolge der Tage. */
export function vertretungFuerPeriode(
  map: Record<string, string> | undefined,
  employeeId: string,
  from: string,
  to: string,
): string[] {
  if (!map) return []
  const namen: string[] = []
  for (const d of weekdaysBetween(from, to)) {
    const n = map[`${employeeId}|${d}`]
    if (n && !namen.includes(n)) namen.push(n)
  }
  return namen
}
