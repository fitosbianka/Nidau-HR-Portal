// Planning notes for the Arbeitsplan (admin + Leitende).
// Stored as reserved zeiterfassung_comments rows — same mechanism as the
// __plan_leitende__ release marker (no DDL possible).
//   __plan_notiz__        + month anchor → month note (admin + Leitende)
//   __plan_notiz_admin__  + month anchor → month note (admin only)
//   __plan_tag_notiz__    + date         → note for a single day
//   __plan_woche_notiz__  + Monday date  → note for a calendar week (Mo–So)
//   __plan_frage__        + date         → fraglicher Termin (open question)
// The comment holds JSON { t, by, to, e } — e is the list of entries
// [{ t, by, at, ge }], one per person and time, so admin and Leitende can
// note to the same day one after another; t/by stay filled with the summary
// for older readers. Legacy rows ({ t, by } or plain text) parse as ONE entry.

import type { SupabaseClient } from '@supabase/supabase-js'
import { monthAnchor } from './leitende'

export const PLAN_NOTES_KEY       = '__plan_notiz__'
export const PLAN_NOTES_ADMIN_KEY = '__plan_notiz_admin__'
export const PLAN_DAY_NOTE_KEY    = '__plan_tag_notiz__'
export const PLAN_WEEK_NOTE_KEY   = '__plan_woche_notiz__'
export const PLAN_QUESTION_KEY    = '__plan_frage__'

/** Ein Eintrag einer Notiz: Text, Kürzel der Verfasserin, Zeitpunkt;
 *  `geaendert` = Kürzel, wenn später jemand anderes den Text angepasst hat. */
export type NoteEntry      = { text: string; by: string | null; at: string | null; geaendert: string | null }
export type NoteVal        = { text: string; by: string | null; to: string | null; eintraege: NoteEntry[] }
// anchor = YYYY-MM-DD; to (optional) makes it a range — multi-day notes /
// questions, or the Sunday of the last week for multi-week notes.
export type PlanPeriodNote = { anchor: string; note: string; by: string | null; to: string | null; eintraege: NoteEntry[] }
export type MonthPlanNotes = {
  shared: NoteVal
  adminOnly?: NoteVal         // only filled when requested (admin viewers)
  dayNotes: PlanPeriodNote[]
  weekNotes: PlanPeriodNote[] // anchored on the first week's Monday (may fall in the previous month)
  questions: PlanPeriodNote[] // fragliche Termine
}

const istText  = (x: unknown): x is string => typeof x === 'string'
const istDatum = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)

/** Zusammengefasster Text einer Notiz (Bänder über dem Plan, PDF,
 *  Protokoll): ein Eintrag = sein Text, mehrere Einträge mit Kürzel davor,
 *  durch · getrennt. */
export function notizText(eintraege: NoteEntry[]): string {
  if (eintraege.length === 1) return eintraege[0].text
  return eintraege.map(e => (e.by ? `${e.by}: ${e.text}` : e.text)).join(' · ')
}
/** Kürzel, wenn alle Einträge von derselben Person stammen, sonst null. */
export function einzigerAutor(eintraege: NoteEntry[]): string | null {
  const by = eintraege[0]?.by ?? null
  return by && eintraege.every(e => e.by === by) ? by : null
}
export const leereNotiz = (): NoteVal => ({ text: '', by: null, to: null, eintraege: [] })

/** Parse a stored note comment — JSON {t, by, to, e} or legacy plain text. */
export function parseNoteComment(raw: string): NoteVal {
  try {
    const j = JSON.parse(raw) as { t?: unknown; by?: unknown; to?: unknown; e?: unknown }
    if (j && typeof j === 'object') {
      const to = istDatum(j.to) ? j.to : null
      if (Array.isArray(j.e)) {
        const eintraege: NoteEntry[] = []
        for (const x of j.e as Array<Record<string, unknown> | null>) {
          if (!x || !istText(x.t) || !x.t.trim()) continue
          eintraege.push({
            text: x.t,
            by: istText(x.by) && x.by ? x.by : null,
            at: istText(x.at) && x.at ? x.at : null,
            geaendert: istText(x.ge) && x.ge ? x.ge : null,
          })
        }
        return { text: notizText(eintraege), by: einzigerAutor(eintraege), to, eintraege }
      }
      if (istText(j.t)) {
        const by = istText(j.by) && j.by ? j.by : null
        return { text: j.t, by, to, eintraege: j.t.trim() ? [{ text: j.t, by, at: null, geaendert: null }] : [] }
      }
    }
  } catch { /* legacy plain-text row */ }
  const text = raw ?? ''
  return { text, by: null, to: null, eintraege: text.trim() ? [{ text, by: null, at: null, geaendert: null }] : [] }
}

/** Speicherform einer Notiz mit Einträgen; t und by bleiben als
 *  Zusammenfassung gefüllt. */
export function encodeNoteEntries(eintraege: NoteEntry[], to: string | null): string {
  const e = eintraege.map(x => ({ t: x.text, by: x.by, at: x.at, ...(x.geaendert ? { ge: x.geaendert } : {}) }))
  return JSON.stringify({ t: notizText(eintraege), by: einzigerAutor(eintraege), ...(to ? { to } : {}), e })
}

/** Eintrag anfügen (eigene Notiz zu einem Tag, der schon Notizen hat). */
export function eintragAnfuegen(eintraege: NoteEntry[], text: string, by: string | null, at: string | null, geaendert: string | null = null): NoteEntry[] {
  return [...eintraege, { text, by, at, geaendert }]
}

/** Eintrag an Position index ändern; leerer Text entfernt ihn. Ändert
 *  jemand anderes den Text, bleibt das Kürzel der Verfasserin stehen und
 *  das Kürzel der ändernden Person kommt dazu. */
export function eintragAendern(eintraege: NoteEntry[], index: number, text: string, by: string | null): NoteEntry[] {
  if (!Number.isInteger(index) || index < 0 || index >= eintraege.length) return eintraege
  if (!text.trim()) return eintraege.filter((_, i) => i !== index)
  return eintraege.map((e, i) => {
    if (i !== index) return e
    if (e.text === text) return e
    return { ...e, text, geaendert: by && by !== e.by ? by : e.geaendert }
  })
}

/** Monday (YYYY-MM-DD) of the calendar week a date falls in. */
export function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** Sunday (YYYY-MM-DD) of the calendar week a date falls in. */
export function sundayOf(dateStr: string): string {
  const d = new Date(mondayOf(dateStr) + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 6)
  return d.toISOString().slice(0, 10)
}

/** ISO-8601 week number (the week containing the first Thursday is week 1). */
export function isoWeekNumber(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7))
  const week1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function getMonthPlanNotes(
  client: SupabaseClient,
  year: number,
  month: number,
  opts: { includeAdminOnly?: boolean } = {},
): Promise<MonthPlanNotes> {
  const monthStart = monthAnchor(year, month)
  const lastDay    = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const monthEnd   = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  // Window starts early so ranged notes anchored in the previous month (up to
  // ~5 weeks back) whose span reaches into this month are included.
  const from = addDays(monthStart, -34)

  const keys = [PLAN_NOTES_KEY, PLAN_DAY_NOTE_KEY, PLAN_WEEK_NOTE_KEY, PLAN_QUESTION_KEY]
  if (opts.includeAdminOnly) keys.push(PLAN_NOTES_ADMIN_KEY)

  const { data } = await client
    .from('zeiterfassung_comments')
    .select('user_full_name, schedule_date, comment')
    .in('user_full_name', keys)
    .gte('schedule_date', from)
    .lte('schedule_date', monthEnd)

  const rows = (data ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>

  const result: MonthPlanNotes = {
    shared: leereNotiz(),
    dayNotes: [], weekNotes: [], questions: [],
  }
  if (opts.includeAdminOnly) result.adminOnly = leereNotiz()

  for (const r of rows) {
    const val = parseNoteComment(r.comment ?? '')
    const item: PlanPeriodNote = { anchor: r.schedule_date, note: val.text, by: val.by, to: val.to, eintraege: val.eintraege }
    if (r.user_full_name === PLAN_NOTES_KEY && r.schedule_date === monthStart) {
      result.shared = val
    } else if (r.user_full_name === PLAN_NOTES_ADMIN_KEY && r.schedule_date === monthStart) {
      if (opts.includeAdminOnly) result.adminOnly = val
    } else if (r.user_full_name === PLAN_DAY_NOTE_KEY) {
      if ((val.to ?? r.schedule_date) >= monthStart) result.dayNotes.push(item)
    } else if (r.user_full_name === PLAN_WEEK_NOTE_KEY) {
      if ((val.to ?? sundayOf(r.schedule_date)) >= monthStart) result.weekNotes.push(item)
    } else if (r.user_full_name === PLAN_QUESTION_KEY) {
      if ((val.to ?? r.schedule_date) >= monthStart) result.questions.push(item)
    }
  }
  result.dayNotes.sort((a, b) => a.anchor.localeCompare(b.anchor))
  result.weekNotes.sort((a, b) => a.anchor.localeCompare(b.anchor))
  result.questions.sort((a, b) => a.anchor.localeCompare(b.anchor))
  return result
}
