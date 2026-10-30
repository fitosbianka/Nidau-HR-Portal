// Planning notes for the Arbeitsplan (admin + Leitende).
// Stored as reserved zeiterfassung_comments rows — same mechanism as the
// __plan_leitende__ release marker (no DDL possible).
//   __plan_notiz__        + month anchor → month note (admin + Leitende)
//   __plan_notiz_admin__  + month anchor → month note (admin only)
//   __plan_tag_notiz__    + date         → note for a single day
//   __plan_woche_notiz__  + Monday date  → note for a calendar week (Mo–So)
//   __plan_frage__        + date         → fraglicher Termin (open question)
// The comment holds JSON { t: text, by: initials } — legacy rows with plain
// text still parse (no author shown).

import type { SupabaseClient } from '@supabase/supabase-js'
import { monthAnchor } from './leitende'

export const PLAN_NOTES_KEY       = '__plan_notiz__'
export const PLAN_NOTES_ADMIN_KEY = '__plan_notiz_admin__'
export const PLAN_DAY_NOTE_KEY    = '__plan_tag_notiz__'
export const PLAN_WEEK_NOTE_KEY   = '__plan_woche_notiz__'
export const PLAN_QUESTION_KEY    = '__plan_frage__'

export type NoteVal        = { text: string; by: string | null; to: string | null }
// anchor = YYYY-MM-DD; to (optional) makes it a range — multi-day notes /
// questions, or the Sunday of the last week for multi-week notes.
export type PlanPeriodNote = { anchor: string; note: string; by: string | null; to: string | null }
export type MonthPlanNotes = {
  shared: NoteVal
  adminOnly?: NoteVal         // only filled when requested (admin viewers)
  dayNotes: PlanPeriodNote[]
  weekNotes: PlanPeriodNote[] // anchored on the first week's Monday (may fall in the previous month)
  questions: PlanPeriodNote[] // fragliche Termine
}

/** Parse a stored note comment — JSON {t, by, to} or legacy plain text. */
export function parseNoteComment(raw: string): NoteVal {
  try {
    const j = JSON.parse(raw) as { t?: unknown; by?: unknown; to?: unknown }
    if (j && typeof j.t === 'string') {
      return {
        text: j.t,
        by: typeof j.by === 'string' && j.by ? j.by : null,
        to: typeof j.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.to) ? j.to : null,
      }
    }
  } catch { /* legacy plain-text row */ }
  return { text: raw ?? '', by: null, to: null }
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
    shared: { text: '', by: null, to: null },
    dayNotes: [], weekNotes: [], questions: [],
  }
  if (opts.includeAdminOnly) result.adminOnly = { text: '', by: null, to: null }

  for (const r of rows) {
    const val = parseNoteComment(r.comment ?? '')
    const item = { anchor: r.schedule_date, note: val.text, by: val.by, to: val.to }
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
