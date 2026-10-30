// Shared Zeiterfassung report builder: pairing of stamp events, day
// grouping with plan absences, credit logic and the PDF payload. Used by
// the Berichte page (client) AND the server-side bulk export, so both
// always produce identical numbers and documents.

import { ferienWeight } from '@/lib/ferien'
import { teamEventLabel } from '@/lib/team-events'
import { istFerienAlsMinusstunden } from '@/lib/ferien-minusstunden'

// ── Types ─────────────────────────────────────────────────────────────────────

export type AttendanceEvent = {
  timemoto_event_id: string
  user_full_name:    string | null
  clocking_type:     string | null
  time_logged:       string | null
  clocking_pair_id:  string | null
  location_name:     string | null
}

export type Shift = {
  pairId:      string
  inEventId:   string | null
  outEventId:  string | null
  fullName:    string
  date:        string          // YYYY-MM-DD Zurich
  dateDisplay: string          // Di. 21.05.2026
  clockIn:     string | null
  clockOut:    string | null
  durationMin: number | null
  location:    string | null
  incomplete:  boolean
}

export type EmployeeReport = {
  fullName:     string
  shifts:       Shift[]
  totalMinutes: number
}

// Rows rendered inside a single day's table
export type DayRow =
  | { kind: 'shift'; shift: Shift }
  | { kind: 'break'; breakMin: number | null; outTime: string | null; inTime: string | null }

// Arbeitsplan-Code eines Tages (Kompensation / Ferien / Ferien als
// Minusstunden / Krank / Unfall / Teamevent / überbetrieblicher Kurs /
// Bezahlt frei / Unbezahlte Ferien / Weiterbildung). «FM» steht nicht im
// Arbeitsplan: ein dort geplantes «F» wird für die in
// FERIEN_ALS_MINUSSTUNDEN hinterlegten Personen/Monate zu «FM».
export type AbsenceCode = 'KO' | 'F' | 'FM' | 'K' | 'U' | 'TE' | 'ÜK' | 'BF' | 'UF' | 'WB'
export type AbsenceTone = 'ferien' | 'fm' | 'krank' | 'unfall' | 'komp' | 'teamevent' | 'uek' | 'bf' | 'uf' | 'wb'

export type DayGroup = {
  date:        string
  dateDisplay: string
  dayTotal:    number
  rows:        DayRow[]
  absence?:    AbsenceCode | null
  fWeight?:    number                     // counted weight of a Ferien day (1 or fractional)
}

// ── Credit logic ─────────────────────────────────────────────────────────────

// One planned absence day = 8:30 h. Ferien is ADDED (a vacation day counts
// as if the employee had worked 8:30). Krank is topped up to 8:30: a fully
// sick day credits 8:30, a partial sick day (went home sick) credits the
// difference between the clocked hours and 8:30. Teamevent (TE) and
// überbetrieblicher Kurs (ÜK) count like a worked day — topped up to 8:30.
// Kompensation credits NOTHING and deducts nothing: the day counts 0:00,
// and the Zeitkonto drops by the missed hours automatically because the
// Konto's Soll (working days × pensum) still counts the day. An explicit
// −8:30 here would deduct the day twice against that full Soll.
export const KOMP_MIN = 510

/** Credit minutes an absence day adds to the total. Ferien days credit
 *  weight × 8:30 (weight < 1 for fractional angerechnete Tage of
 *  part-timers with flexible schedules). */
export function absenceCredit(absence: AbsenceCode | null | undefined, dayTotal: number, fWeight = 1): number {
  if (absence === 'KO') return 0
  // FM = Ferien als Minusstunden (Vereinbarung): kein Ferienbezug, aber auch
  // keine Gutschrift — der Tag zählt 0:00 und fehlt gegenüber dem Soll
  if (absence === 'FM') return 0
  // Ferien credits its counted weight ALWAYS — also on days with clockings
  // (same as TimeMoto: vacation day + worked hours both count)
  if (absence === 'F')  return Math.round(KOMP_MIN * fWeight)
  if (absence === 'K')  return Math.max(0, KOMP_MIN - dayTotal)
  if (absence === 'U')  return Math.max(0, KOMP_MIN - dayTotal)   // Unfall: wie Krank auf 8:30 aufgefüllt
  if (absence === 'TE') return Math.max(0, KOMP_MIN - dayTotal)
  if (absence === 'ÜK') return Math.max(0, KOMP_MIN - dayTotal)
  // BF = bezahlt frei: der Tag zählt wie ein gearbeiteter Tag (8:30), KEIN Bezug ab Zeitkonto
  if (absence === 'BF') return Math.max(0, KOMP_MIN - dayTotal)
  // UF = unbezahlte Ferien: Zeitkonto-neutral (8:30 gutgeschrieben, kein Ferienbezug) —
  // der Lohnabzug für den Tag läuft über die Lohnabrechnung, nicht über das Zeitkonto
  if (absence === 'UF') return Math.max(0, KOMP_MIN - dayTotal)
  // WB = Weiterbildung: zählt als Arbeitszeit (8:30)
  if (absence === 'WB') return Math.max(0, KOMP_MIN - dayTotal)
  // Schule (S) der Lernenden bringt bewusst KEINE Gutschrift: Lernende sind
  // mit 80 % Pensum erfasst (4 Praxistage), der Schultag ist im Soll bereits
  // ausgeklammert — eine Gutschrift würde ihn doppelt zählen.
  return 0
}

// One-off day labels: replaces the absence label of a single employee day on
// screen and on the PDF (key: `${profile full_name}||${YYYY-MM-DD}`). The
// credit logic of the underlying Arbeitsplan code stays unchanged.
export const ABSENCE_LABEL_OVERRIDES: Record<string, string> = {
  'Neya Krishnamoorthy||2026-08-12': 'Schnuppertag Fribourg',
}

// ── Zurich formatters ─────────────────────────────────────────────────────────

export function toZurichDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })
}

export function toZurichDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString('de-CH', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'Europe/Zurich',
  })
}

export function toZurichDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('de-CH', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'Europe/Zurich',
  })
}

export function toZurichTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('de-CH', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich',
  })
}

export function fmtDuration(min: number | null): string {
  if (min === null || min < 0) return '—'
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`
}

export function fmtHours(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`
}

// ── Event pairing ─────────────────────────────────────────────────────────────

export function pairEvents(events: AttendanceEvent[]): Shift[] {
  // Deterministische Reihenfolge, unabhängig davon, wie der Aufrufer die
  // Ereignisse geladen hat (Berichte: neuste zuerst, Zeitkonto/Kontrolle:
  // älteste zuerst). Gibt es zu einem Paar mehrere gleiche Ereignisse
  // (z. B. zwei «Out»), gewinnt überall dasselbe — sonst zeigen Zeitkonto und
  // Zeiterfassung für denselben Monat verschiedene Ist-Stunden.
  const sortiert = [...events].sort((a, b) =>
    (b.time_logged ?? '').localeCompare(a.time_logged ?? '') || b.timemoto_event_id.localeCompare(a.timemoto_event_id))
  const map = new Map<string, { inEv?: AttendanceEvent; outEv?: AttendanceEvent }>()
  for (const ev of sortiert) {
    // Prefix with employee name so imported sequential pair IDs can't
    // accidentally cross-pair events from different employees
    const key = ev.clocking_pair_id
      ? `${ev.user_full_name ?? ''}||${ev.clocking_pair_id}`
      : `orphan_${ev.timemoto_event_id}`
    if (!map.has(key)) map.set(key, {})
    const p = map.get(key)!
    if (ev.clocking_type === 'In') p.inEv  = ev
    else                            p.outEv = ev
  }
  const shifts: Shift[] = []
  map.forEach((p, pairId) => {
    const anchor = p.inEv ?? p.outEv
    if (!anchor?.time_logged) return
    const inISO  = p.inEv?.time_logged  ?? null
    const outISO = p.outEv?.time_logged ?? null
    const durMin = inISO && outISO
      ? Math.round((new Date(outISO).getTime() - new Date(inISO).getTime()) / 60000)
      : null
    shifts.push({
      pairId,
      inEventId:   p.inEv?.timemoto_event_id  ?? null,
      outEventId:  p.outEv?.timemoto_event_id ?? null,
      fullName:    anchor.user_full_name ?? '—',
      date:        toZurichDate(inISO ?? outISO!),
      dateDisplay: toZurichDateShort(inISO ?? outISO!),
      clockIn:     inISO,
      clockOut:    outISO,
      durationMin: durMin,
      // «HR-Portal» ist nur die interne Quelle der Portal-Stempeluhr —
      // neben den Zeiten wäre der Text reines Rauschen (alles Manuelle
      // läuft übers Portal); echte TimeMoto-Standorte bleiben sichtbar.
      location:    anchor.location_name === 'HR-Portal' ? null : anchor.location_name ?? null,
      incomplete:  !outISO && !!inISO,
    })
  })
  // Tage neuste zuerst; INNERHALB eines Tages chronologisch, damit die
  // Einträge als Einstempeln → Pause → Zurück → Ausstempeln lesbar sind
  return shifts.sort((a, b) =>
    b.date.localeCompare(a.date) ||
    (a.clockIn ?? a.clockOut ?? '').localeCompare(b.clockIn ?? b.clockOut ?? ''))
}

// ── Employee grouping ─────────────────────────────────────────────────────────

export function groupByEmployee(shifts: Shift[]): EmployeeReport[] {
  const map = new Map<string, Shift[]>()
  for (const s of shifts) {
    if (!map.has(s.fullName)) map.set(s.fullName, [])
    map.get(s.fullName)!.push(s)
  }
  return Array.from(map.entries())
    .map(([fullName, empShifts]) => ({
      fullName,
      shifts:       empShifts,
      totalMinutes: empShifts.reduce((sum, s) => sum + (s.durationMin ?? 0), 0),
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
}

/** planAbsences is keyed `${first name}||${date}` — narrow to one employee. */
export function absencesForEmployee(planAbsences: Record<string, string>, fullName: string): Record<string, string> {
  const first = fullName.split(' ')[0]
  const out: Record<string, string> = {}
  for (const key of Object.keys(planAbsences)) {
    const [fn, date] = key.split('||')
    if (fn === first) out[date] = planAbsences[key]
  }
  return out
}

// ── Day grouping (with break rows) ────────────────────────────────────────────

export function buildDayGroups(shifts: Shift[], absences: Record<string, string> = {}, from = '', to = '', fullName?: string | null): DayGroup[] {
  const byDate = new Map<string, Shift[]>()
  for (const s of shifts) {
    if (!byDate.has(s.date)) byDate.set(s.date, [])
    byDate.get(s.date)!.push(s)
  }
  // Include absence-only days (Kompensation / Ferien) planned in the Arbeitsplan,
  // even when there are no clock-ins that day.
  for (const date of Object.keys(absences)) {
    if (from && date < from) continue
    if (to && date > to) continue
    if (!byDate.has(date)) byDate.set(date, [])
  }
  return Array.from(byDate.entries())
    .map(([date, dayShifts]) => {
      const sorted = [...dayShifts].sort((a, b) => (a.clockIn ?? '').localeCompare(b.clockIn ?? ''))
      const rows: DayRow[] = []
      for (let i = 0; i < sorted.length; i++) {
        if (i > 0) {
          const prev = sorted[i - 1]
          const curr = sorted[i]
          const breakMin = prev.clockOut && curr.clockIn
            ? Math.round((new Date(curr.clockIn).getTime() - new Date(prev.clockOut).getTime()) / 60000)
            : null
          rows.push({ kind: 'break', breakMin, outTime: prev.clockOut, inTime: curr.clockIn })
        }
        rows.push({ kind: 'shift', shift: sorted[i] })
      }
      const dayTotal = dayShifts.reduce((sum, s) => sum + (s.durationMin ?? 0), 0)
      const code = absences[date]
      const cu = code ? code.trim().toUpperCase() : ''
      const fw = code ? ferienWeight(code) : null
      const planCode: AbsenceCode | null =
        cu === 'KO' ? 'KO' : cu === 'K' ? 'K' : cu === 'U' || cu === 'UNFALL' ? 'U' : cu === 'TE' ? 'TE' : cu === 'ÜK' || cu === 'UK' ? 'ÜK' : cu === 'BF' ? 'BF' : cu === 'UF' ? 'UF' : cu === 'WB' || cu === 'WEITERBILDUNG' ? 'WB' : fw != null ? 'F' : null
      // Vereinbarte Ausnahme: «F» zählt als Minusstunden statt als Ferienbezug
      const absence: AbsenceCode | null = planCode === 'F' && istFerienAlsMinusstunden(fullName, date) ? 'FM' : planCode
      return { date, dateDisplay: toZurichDateLong(date + 'T12:00:00Z'), dayTotal, rows, absence, fWeight: fw ?? undefined }
    })
    // Chronological order — 1st of the month at the top, last day at the bottom
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ── PDF payload (identical for manual save, print and bulk export) ───────────

export type PdfReportData = {
  employeeName: string
  totalDisplay: string
  totalNote:    string | null
  dayGroups: Array<{
    dateDisplay:     string
    dayTotalDisplay: string
    absenceLabel:    string | null
    absenceTone:     AbsenceTone | null
    comment:         string | null
    rows: Array<
      | { kind: 'break'; label: string }
      | { kind: 'note'; label: string; tone?: AbsenceTone }
      | { kind: 'shift'; clockIn: string; clockOut: string; duration: string; incomplete: boolean }
    >
  }>
}

export function buildPdfReportData(
  report: EmployeeReport,
  absences: Record<string, string>,
  comments: Record<string, string>,   // key `${fullName}||${date}`
  dateFrom: string,
  dateTo: string,
): PdfReportData {
  const dayGroups = buildDayGroups(report.shifts, absences, dateFrom, dateTo, report.fullName)
  const creditSum = dayGroups.reduce((s, d) => s + absenceCredit(d.absence, d.dayTotal, d.fWeight ?? 1), 0)
  const fmTage    = Math.round(dayGroups.filter(d => d.absence === 'FM').reduce((s, d) => s + (d.fWeight ?? 1), 0) * 100) / 100
  const netTotal  = report.totalMinutes + creditSum
  const ferienMin = dayGroups.filter(d => d.absence === 'F').reduce((s, d) => s + absenceCredit('F', d.dayTotal, d.fWeight ?? 1), 0)
  const krankMin  = dayGroups.filter(d => d.absence === 'K').reduce((s, d) => s + absenceCredit('K', d.dayTotal), 0)
  const unfallMin = dayGroups.filter(d => d.absence === 'U').reduce((s, d) => s + absenceCredit('U', d.dayTotal), 0)
  const kompDays  = dayGroups.filter(d => d.absence === 'KO' && d.dayTotal === 0).length
  const teMin     = dayGroups.filter(d => d.absence === 'TE').reduce((s, d) => s + absenceCredit('TE', d.dayTotal), 0)
  const uekMin    = dayGroups.filter(d => d.absence === 'ÜK').reduce((s, d) => s + absenceCredit('ÜK', d.dayTotal), 0)

  const pdfDayGroups = dayGroups.map(dg => {
    type PdfRow = PdfReportData['dayGroups'][number]['rows'][number]
    const rows: PdfRow[] = dg.rows.map(row => {
      if (row.kind === 'break') {
        return {
          kind:  'break' as const,
          label: row.breakMin !== null ? `${row.breakMin} min Pause` : 'Pause',
        }
      }
      const s = row.shift
      return {
        kind:       'shift' as const,
        clockIn:    toZurichTime(s.clockIn),
        clockOut:   s.incomplete ? 'Anwesend' : toZurichTime(s.clockOut),
        duration:   s.incomplete ? '—' : fmtDuration(s.durationMin),
        incomplete: s.incomplete,
      }
    })
    // Absence note row (Ferien / Krank / Kompensation) under the day's shifts
    const fw = dg.fWeight ?? 1
    if (dg.absence === 'F') rows.push({ kind: 'note', tone: 'ferien', label: `Ferientag${fw !== 1 ? ` (angerechnet ${fw})` : ''}  +${fmtHours(absenceCredit('F', dg.dayTotal, fw))}` })
    if (dg.absence === 'FM') rows.push({ kind: 'note', tone: 'fm', label: `Ferientag ohne Gutschrift${fw !== 1 ? ` (${fw} Tag)` : ''} — zählt als Minusstunden, kein Ferienbezug (Vereinbarung)` })
    if (dg.absence === 'KO' && dg.dayTotal === 0) rows.push({ kind: 'note', tone: 'komp', label: `${ABSENCE_LABEL_OVERRIDES[`${report.fullName}||${dg.date}`] ?? 'Kompensation'} — Bezug ab Zeitkonto` })
    if (dg.absence === 'K') rows.push({ kind: 'note', tone: 'krank', label: dg.dayTotal > 0 ? 'Krank — Tag zählt 8:30' : `Krankheitstag  +${fmtHours(KOMP_MIN)}` })
    if (dg.absence === 'U') rows.push({ kind: 'note', tone: 'unfall', label: dg.dayTotal > 0 ? 'Unfall — Tag zählt 8:30' : `Unfalltag  +${fmtHours(KOMP_MIN)}` })
    if (dg.absence === 'TE') rows.push({ kind: 'note', tone: 'teamevent', label: `${teamEventLabel(dg.date)}  +${fmtHours(absenceCredit('TE', dg.dayTotal))}` })
    if (dg.absence === 'ÜK') rows.push({ kind: 'note', tone: 'uek', label: `Überbetrieblicher Kurs  +${fmtHours(absenceCredit('ÜK', dg.dayTotal))}` })
    if (dg.absence === 'BF') rows.push({ kind: 'note', tone: 'bf', label: `Bezahlt frei  +${fmtHours(absenceCredit('BF', dg.dayTotal))}` })
    if (dg.absence === 'UF') rows.push({ kind: 'note', tone: 'uf', label: `Unbezahlte Ferien  +${fmtHours(absenceCredit('UF', dg.dayTotal))} (Lohnabzug via Lohnabrechnung)` })
    if (dg.absence === 'WB') rows.push({ kind: 'note', tone: 'wb', label: `Weiterbildung  +${fmtHours(absenceCredit('WB', dg.dayTotal))}` })

    const credited = dg.dayTotal + absenceCredit(dg.absence, dg.dayTotal, fw)
    const commentText = comments[`${report.fullName}||${dg.date}`] ?? ''
    return {
      dateDisplay:     dg.dateDisplay,
      dayTotalDisplay: credited < 0 ? `−${fmtHours(-credited)}` : fmtHours(credited),
      absenceLabel:    dg.absence === 'F' ? `Ferien${fw !== 1 ? ` (${fw} Tag)` : ''}` : dg.absence === 'FM' ? `Ferien · Minusstunden${fw !== 1 ? ` (${fw} Tag)` : ''}` : dg.absence === 'K' ? 'Krank' : dg.absence === 'U' ? 'Unfall' : dg.absence === 'KO' ? (ABSENCE_LABEL_OVERRIDES[`${report.fullName}||${dg.date}`] ?? 'Kompensation') : dg.absence === 'TE' ? teamEventLabel(dg.date) : dg.absence === 'ÜK' ? 'Überbetrieblicher Kurs' : dg.absence === 'BF' ? 'Bezahlt frei' : dg.absence === 'UF' ? 'Unbezahlte Ferien' : dg.absence === 'WB' ? 'Weiterbildung' : null,
      absenceTone:     dg.absence === 'F' ? 'ferien' as const : dg.absence === 'FM' ? 'fm' as const : dg.absence === 'K' ? 'krank' as const : dg.absence === 'U' ? 'unfall' as const : dg.absence === 'KO' ? 'komp' as const : dg.absence === 'TE' ? 'teamevent' as const : dg.absence === 'ÜK' ? 'uek' as const : dg.absence === 'BF' ? 'bf' as const : dg.absence === 'UF' ? 'uf' as const : dg.absence === 'WB' ? 'wb' as const : null,
      comment:         commentText || null,
      rows,
    }
  })

  const totalNoteParts = [
    ferienMin > 0 ? `inkl. +${fmtHours(ferienMin)} Ferien` : null,
    fmTage    > 0 ? `${fmTage} Ferientag${fmTage !== 1 ? 'e' : ''} ohne Gutschrift` : null,
    krankMin  > 0 ? `inkl. +${fmtHours(krankMin)} Krank` : null,
    unfallMin > 0 ? `inkl. +${fmtHours(unfallMin)} Unfall` : null,
    kompDays  > 0 ? `${kompDays} Kompensationstag${kompDays !== 1 ? 'e' : ''}` : null,
    teMin     > 0 ? `inkl. +${fmtHours(teMin)} Teamevent` : null,
    uekMin    > 0 ? `inkl. +${fmtHours(uekMin)} ÜK` : null,
  ].filter(Boolean)

  return {
    employeeName: report.fullName,
    totalDisplay: fmtHours(netTotal),
    totalNote:    totalNoteParts.join(', ') || null,
    dayGroups:    pdfDayGroups,
  }
}
