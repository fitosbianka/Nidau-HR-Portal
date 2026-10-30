// Standardwochen (per-employee standard working week) for the Arbeitsplan.
// Stored as reserved zeiterfassung_comments rows (no DDL possible):
//   user_full_name = "__std_woche_<employeeId>", schedule_date = 1970-01-01,
//   comment = JSON { "1": "3f", "2": "5t", ... } keyed by ISO weekday (1=Mo…7=So).

import type { SupabaseClient } from '@supabase/supabase-js'

export const STD_WEEK_PREFIX = '__std_woche_'
export const STD_WEEK_DATE   = '1970-01-01'

/** entry per ISO weekday 1 (Mo) … 7 (So); missing/empty = no standard */
export type StandardWeek = Record<string, string>

export async function getStandardWeeks(
  client: SupabaseClient,
): Promise<Record<string, StandardWeek>> {
  const { data } = await client
    .from('zeiterfassung_comments')
    .select('user_full_name, comment')
    .like('user_full_name', `${STD_WEEK_PREFIX}%`)
    .eq('schedule_date', STD_WEEK_DATE)

  const out: Record<string, StandardWeek> = {}
  for (const r of (data ?? []) as Array<{ user_full_name: string; comment: string }>) {
    try {
      const week = JSON.parse(r.comment) as StandardWeek
      out[r.user_full_name.slice(STD_WEEK_PREFIX.length)] = week
    } catch { /* ignore bad rows */ }
  }
  return out
}
