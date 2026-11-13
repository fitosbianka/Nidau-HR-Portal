// Teamevent days in the Arbeitsplan (pastel-brown column + «TE» entries).
// The day marker is stored as a reserved zeiterfassung_comments row
// (no DDL possible): __plan_teamevent__ + date.
// «TE» work_schedule entries credit 8:30 in the Zeiterfassung like a
// normal working day.

import type { SupabaseClient } from '@supabase/supabase-js'

export const TEAM_EVENT_KEY = '__plan_teamevent__'

/** Known event names shown in the Zeiterfassung note, keyed by date. */
export const TEAM_EVENT_LABELS: Record<string, string> = {}

export function teamEventLabel(date: string): string {
  const name = TEAM_EVENT_LABELS[date]
  return name ? `Teamevent — ${name}` : 'Teamevent'
}

export async function getTeamEventDays(
  client: SupabaseClient,
  from: string,
  to: string,
): Promise<string[]> {
  const { data } = await client
    .from('zeiterfassung_comments')
    .select('schedule_date')
    .eq('user_full_name', TEAM_EVENT_KEY)
    .gte('schedule_date', from)
    .lte('schedule_date', to)
  return ((data ?? []) as Array<{ schedule_date: string }>).map(r => r.schedule_date)
}
