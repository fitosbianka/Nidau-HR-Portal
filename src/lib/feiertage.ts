// Gesetzliche Feiertage im Kanton Bern, die auf einen Werktag fallen. Eine
// gemeinsame Liste für Konto (Soll), Ferienplanung (Ferientage, Plätze) und
// das Eintragen von Ferien (an Feiertagen wird kein F geschrieben).

export const FEIERTAGE_NAMEN: Record<string, string> = {
  '2026-01-01': 'Neujahr', '2026-01-02': 'Berchtoldstag', '2026-04-03': 'Karfreitag', '2026-04-06': 'Ostermontag',
  '2026-05-14': 'Auffahrt', '2026-05-25': 'Pfingstmontag', '2026-12-25': 'Weihnachten',
  // 2027: Neujahr (Freitag), Karfreitag, Ostermontag, Auffahrt, Pfingstmontag; Weihnachten und Stephanstag fallen aufs Wochenende
  '2027-01-01': 'Neujahr', '2027-03-26': 'Karfreitag', '2027-03-29': 'Ostermontag', '2027-05-06': 'Auffahrt', '2027-05-17': 'Pfingstmontag',
}

export const FEIERTAGE: Record<number, string[]> = {
  2026: Object.keys(FEIERTAGE_NAMEN).filter(d => d.startsWith('2026')).sort(),
  2027: Object.keys(FEIERTAGE_NAMEN).filter(d => d.startsWith('2027')).sort(),
}

const ALLE = new Set(Object.values(FEIERTAGE).flat())

export const istFeiertag = (datum: string) => ALLE.has(datum)
/** Name des Feiertags an einem Tag, sonst null (für den Arbeitsplan). */
export const feiertagName = (datum: string): string | null => FEIERTAGE_NAMEN[datum] ?? null

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Arbeitstage (Mo bis Fr ohne Feiertage) zwischen zwei Daten, inklusive. */
export function arbeitstageBetween(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  while (d <= end) {
    const dow = d.getDay()
    const ds = iso(d)
    if (dow !== 0 && dow !== 6 && !istFeiertag(ds)) out.push(ds)
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** Feiertage innerhalb eines Zeitraums (nur Werktage sind gelistet). */
export const feiertageIn = (from: string, to: string) => Object.values(FEIERTAGE).flat().filter(d => d >= from && d <= to).sort()
