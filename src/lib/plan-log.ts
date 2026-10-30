// Änderungsprotokoll for the Arbeitsplan (visible to the admin only).
// Stored as reserved zeiterfassung_comments rows (no DDL possible):
//   user_full_name = __planlog__<id>  (unique per entry)
//   schedule_date  = the affected plan day (month anchor for month-wide ops)
//   comment        = JSON { at, by, kind, emp?, old?, neu?, text? }
// Berichte/Konto loaders ignore __-prefixed rows, so log entries never show
// up in the reports themselves.

import type { SupabaseClient } from '@supabase/supabase-js'

export const PLAN_LOG_PREFIX = '__planlog__'

export type PlanLogKind =
  | 'zelle'   // a single plan cell: emp + old → neu
  | 'notiz'   // a note changed: text = note label, old → neu
  | 'marker'  // day marker (red / Teamevent): text
  | 'aktion'  // bulk helper (copy previous month, standard weeks, copy day): text
  | 'status'  // month status (published / released to Leitende): text

export type PlanLogEntry = {
  key: string           // reserved user_full_name (unique per entry)
  datum: string         // affected plan day (YYYY-MM-DD)
  at: string            // ISO timestamp of the change
  by: string            // full name of who made the change
  kind: PlanLogKind
  emp: string | null    // employee whose cell changed (kind 'zelle')
  old: string | null    // previous value ('' = empty cell / no note)
  neu: string | null    // new value
  text: string | null   // description (notes label, marker, action, status)
}

const KINDS: PlanLogKind[] = ['zelle', 'notiz', 'marker', 'aktion', 'status']

/** All log entries whose affected day falls in the given month, newest first. */
export async function getPlanLogEntries(
  client: SupabaseClient,
  year: number,
  month: number,
): Promise<PlanLogEntry[]> {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay  = `${year}-${String(month).padStart(2, '0')}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`
  const { data } = await client
    .from('zeiterfassung_comments')
    .select('user_full_name, schedule_date, comment')
    .like('user_full_name', `${PLAN_LOG_PREFIX.replace(/_/g, '\\_')}%`)
    .gte('schedule_date', firstDay)
    .lte('schedule_date', lastDay)

  const list: PlanLogEntry[] = []
  for (const r of (data ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>) {
    try {
      const p = JSON.parse(r.comment) as {
        at?: string; by?: string; kind?: string; emp?: string; old?: string; neu?: string; text?: string
      }
      if (!p.at || !KINDS.includes(p.kind as PlanLogKind)) continue
      list.push({
        key:   r.user_full_name,
        datum: r.schedule_date,
        at:    p.at,
        by:    p.by ?? '?',
        kind:  p.kind as PlanLogKind,
        emp:   p.emp ?? null,
        old:   p.old ?? null,
        neu:   p.neu ?? null,
        text:  p.text ?? null,
      })
    } catch { /* ignore bad rows */ }
  }
  list.sort((a, b) => b.at.localeCompare(a.at))
  return list
}
