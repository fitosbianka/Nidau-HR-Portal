// Shared Arbeitsplan metadata: used by the on-screen grid (WorkScheduleGrid)
// AND the server-side PDF export, so both always show the same roster rules,
// month notices, cell colors and legend.

// Employees whose plan row disappears from a given month on (e.g. leaving).
export const PLAN_HIDDEN_FROM: Record<string, string> = {}

// Employees whose plan row appears only FROM a given month on (later start).
export const PLAN_VISIBLE_FROM: Record<string, string> = {}

/** Row visibility for a plan month: hides leavers from their departure
 *  month on and late starters before their first month. */
export function planRowVisible(fullName: string, monthKey: string): boolean {
  const hiddenFrom = PLAN_HIDDEN_FROM[fullName]
  if (hiddenFrom && monthKey >= hiddenFrom) return false
  const visibleFrom = PLAN_VISIBLE_FROM[fullName]
  if (visibleFrom && monthKey < visibleFrom) return false
  return true
}

/** Row label on the plan (screen + PDF): «Vorname N.» — full names do not
 *  fit the name column anyway. */
export function planKurzname(fullName: string): string {
  const teile = fullName.trim().split(/\s+/)
  if (teile.length < 2) return fullName
  return `${teile[0]} ${teile[teile.length - 1][0]}.`
}

// Month-specific notices shown above the grid and on the PDF export.
export const PLAN_MONTH_NOTES: Record<string, string> = {
  '2026-07': 'Betriebsferien: 20. – 24. Juli 2026',
  '2026-09': 'Betriebsferien: 28. September – 2. Oktober 2026',
}

export const PLAN_MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
export const PLAN_DAY_SHORT   = ['So','Mo','Di','Mi','Do','Fr','Sa']

/** Category groups in display order (match on profiles.job_title). */
export const PLAN_GROUP_DEFS: Array<{ key: string; label: string; match: (t: string | null) => boolean }> = [
  { key: 'ZAZ',      label: 'ZAZ',      match: t => t === 'ZAZ' },
  { key: 'DH_PA',    label: 'DH / PA',  match: t => t === 'DH / PA' || t === 'DH' || t === 'PA' },
  { key: 'DA',       label: 'DA',       match: t => t === 'DA' || t === 'Leitende DA' },
  { key: 'Lernende', label: 'Lernende', match: t => t === 'Lernende' },
  { key: 'Admin',    label: 'Verwaltung', match: t => t === 'Admin' || t === 'HR & Finanzen' },
  { key: 'Andere',   label: 'Weitere',  match: t => !['ZAZ','DH / PA','DH','PA','DA','Leitende DA','Lernende','Admin','HR & Finanzen'].includes(t ?? '') },
]

export const PLAN_PENSUM_STEPS = [100, 90, 80, 70, 60, 50, 40, 30, 20]

/** Count Mon–Fri working days in a month (no public-holiday adjustment). */
export function planWorkingDays(year: number, month: number): number {
  const total = new Date(year, month, 0).getDate()
  let count = 0
  for (let d = 1; d <= total; d++) {
    const dow = new Date(year, month - 1, d).getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return count
}

export function planFmtHM(decHours: number): string {
  const h = Math.floor(decHours)
  const m = Math.round((decHours - h) * 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

// Position in einer Plan Zelle: Raum oder Code 1 bis 99 (6 Empfang, 7 Steri,
// 8 Tagesleitung, 10), Joker (Stern), PA, HO. Zwei Positionen lassen sich mit
// Schrägstrich kombinieren, zum Beispiel Stern/7s = Joker, dann Spätsteri in
// der Spätschicht, oder 6/8t. Dahinter optional die Schicht f, t, s oder h.
const POSITION = '(?:\\*|\\d{1,2}|PA|HO)'
/** Positionen ohne Schicht, zum Beispiel 3, 6/8 oder Stern/7 */
export const PLAN_POSITION_RE = new RegExp(`^${POSITION}(?:\\/${POSITION})?$`, 'i')
/** Positionen mit Schicht: Gruppe 1 = Positionen, Gruppe 2 = Schicht */
export const PLAN_SHIFT_RE = new RegExp(`^(${POSITION}(?:\\/${POSITION})?)([ftsh])$`, 'i')

/** Legacy: entries could hold two '|'-separated parts — only the first shows. */
export function planFirstPart(raw: string): string {
  return raw.includes('|') ? raw.split('|')[0] : raw
}

/** Display of one plan cell for the PDF export (hex colors; '' bg = none). */
export function planPdfCell(value: string): { bg: string; fg: string; text: string } {
  if (!value) return { bg: '', fg: '#3E3A45', text: '' }
  const sm = value.match(PLAN_SHIFT_RE)
  if (sm) {
    const map: Record<string, { bg: string; fg: string }> = {
      f: { bg: '#F6DFE3', fg: '#A85B6B' },
      t: { bg: '#F7EAD9', fg: '#96703F' },
      s: { bg: '#DFE7F2', fg: '#4F6B8F' },
      h: { bg: '#DFEDE8', fg: '#3F6B62' },
    }
    return { ...map[sm[2].toLowerCase()], text: sm[1] }
  }
  const v = value.trim().toUpperCase()
  // '✓' is drawn as a small vector in the PDF (Helvetica has no check glyph)
  if (v === '✓' || v === 'ANWESEND')             return { bg: '', fg: '#3E3A45', text: '✓' }
  if (['6', '7', '8', '10', '*'].includes(v))    return { bg: '', fg: '#3E3A45', text: value }
  if (v === 'HO' || v === 'S' || v === 'SCHULE') return { bg: '#EAE7F1', fg: '#5A5170', text: value }
  if (v === 'F' || v === 'FERIEN')               return { bg: '#DFEDE8', fg: '#3F6B62', text: value }
  if (/^F:\d*\.?\d+$/.test(v))                   return { bg: '#DFEDE8', fg: '#3F6B62', text: 'F' }
  if (v === '%' || v === 'FREI')                 return { bg: '', fg: '#A9A3B1', text: value }
  if (v === 'K' || v === 'KRANK')                return { bg: '#F6DFE3', fg: '#A85B6B', text: value }
  if (v === 'U' || v === 'UNFALL')               return { bg: '#F8E0CF', fg: '#A85E38', text: 'U' }
  if (v === 'WB' || v === 'WEITERBILDUNG')       return { bg: '#EAE7F1', fg: '#5A5170', text: value }
  if (v === 'ÜK' || v === 'UK')                  return { bg: '#EAE7F1', fg: '#5A5170', text: 'ÜK' }
  if (v === 'KO' || v === 'KOMPENSATION')        return { bg: '#DFE7F2', fg: '#4F6B8F', text: value }
  if (v === 'TE' || v === 'TEAMEVENT')           return { bg: '#EADAC8', fg: '#7E5F44', text: 'TE' }
  if (v === 'BF')                                return { bg: '#EFEBCF', fg: '#7E7433', text: 'BF' }
  if (v === 'UF')                                return { bg: '#E3E0D5', fg: '#6E6749', text: 'UF' }
  if (v === 'ND' || v === 'NOTFALLDIENST')       return { bg: '#F8DCD2', fg: '#A6492F', text: 'ND' }
  return { bg: '', fg: '#3E3A45', text: value }
}

export const PLAN_LEGEND = [
  { code: '✓',  label: 'Anwesend',       bg: '#FFFFFF', fg: '#374151', bd: '#D1D5DB' },
  { code: '6',  label: 'Empfang',        bg: '#FFFFFF', fg: '#374151', bd: '#D1D5DB' },
  { code: '7',  label: 'Steri',          bg: '#FFFFFF', fg: '#374151', bd: '#D1D5DB' },
  { code: '8',  label: 'Tagesleit.',     bg: '#FFFFFF', fg: '#374151', bd: '#D1D5DB' },
  { code: 'HO', label: 'Home Office',    bg: '#EAE7F1', fg: '#5A5170', bd: '#EAE7F1' },
  { code: '*',  label: 'Joker',          bg: '#FFFFFF', fg: '#374151', bd: '#D1D5DB' },
  { code: 'S',  label: 'Schule',         bg: '#EAE7F1', fg: '#5A5170', bd: '#EAE7F1' },
  { code: 'F',  label: 'Ferien',         bg: '#DFEDE8', fg: '#3F6B62', bd: '#DFEDE8' },
  { code: '%',  label: 'Frei',           bg: '#FFFFFF', fg: '#A9A3B1', bd: '#EAE8E3' },
  { code: 'K',  label: 'Krank',          bg: '#F6DFE3', fg: '#A85B6B', bd: '#F6DFE3' },
  { code: 'U',  label: 'Unfall',         bg: '#F8E0CF', fg: '#A85E38', bd: '#F8E0CF' },
  { code: 'WB', label: 'Weiterbild.',    bg: '#EAE7F1', fg: '#5A5170', bd: '#EAE7F1' },
  { code: 'ÜK', label: 'Überbetr. Kurs', bg: '#EAE7F1', fg: '#5A5170', bd: '#EAE7F1' },
  { code: 'KO', label: 'Kompensation',   bg: '#DFE7F2', fg: '#4F6B8F', bd: '#DFE7F2' },
  { code: 'TE', label: 'Teamevent',      bg: '#EADAC8', fg: '#7E5F44', bd: '#EADAC8' },
  { code: 'BF', label: 'Bezahlt frei',   bg: '#EFEBCF', fg: '#7E7433', bd: '#EFEBCF' },
  { code: 'UF', label: 'Unbez. Ferien',  bg: '#E3E0D5', fg: '#6E6749', bd: '#E3E0D5' },
  { code: 'ND', label: 'Notfalldienst',  bg: '#F8DCD2', fg: '#A6492F', bd: '#F8DCD2' },
]

export const PLAN_SHIFT_LEGEND = [
  { label: 'Frühschicht',     bg: '#F6DFE3' },
  { label: 'Mittelschicht',   bg: '#F7EAD9' },
  { label: 'Spätschicht',     bg: '#DFE7F2' },
  { label: 'Halbtagsschicht', bg: '#DFEDE8' },
]

export const PLAN_TIME_LINES = [
  'Assistenz 7:45–12:00 (flexibel) 13:00–17:15   ·   Steri 8:00–12:15 13:00–17:15   ·   Empfang 7:45–12:15 13:15–17:15',
  'Frühschicht 06:30–13:30   ·   Halbtagsschicht 6:45/7:45–12:15   ·   Mittelschicht 6:45–16:15   ·   Spätschicht 12:00–20:15',
]

export const PLAN_GROUP_COLORS: Record<string, { bg: string; fg: string }> = {
  ZAZ:      { bg: '#DFEDE8', fg: '#3F6B62' },
  DH_PA:    { bg: '#DFE7F2', fg: '#4F6B8F' },
  DA:       { bg: '#F7EAD9', fg: '#96703F' },
  Lernende: { bg: '#EAE7F1', fg: '#5A5170' },
  Admin:    { bg: '#F1EFEA', fg: '#55525E' },
  Andere:   { bg: '#F3F1EE', fg: '#55525E' },
}
