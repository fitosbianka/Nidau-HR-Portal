import { PRAXIS } from '@/config/praxis'
// Leitende DA: senior assistants with early plan access and team views.

import type { SupabaseClient } from '@supabase/supabase-js'

export const LEITENDE_TITLE = 'Leitende DA'

/** Employees who may edit the Ferien planning like an admin. */
export const FERIEN_EDITORS: string[] = PRAXIS.ferienEditoren

/** Reserved zeiterfassung_comments row marking a month as released to the
 *  Leitenden (visible + editable for them BEFORE it is published to everyone).
 *  No DDL possible — same mechanism as the __konto__ rows. */
export const LEITENDE_KEY = '__plan_leitende__'

export function monthAnchor(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

export async function isMonthReleasedToLeitende(
  client: SupabaseClient,
  year: number,
  month: number,
): Promise<boolean> {
  const { data } = await client
    .from('zeiterfassung_comments')
    .select('comment')
    .eq('user_full_name', LEITENDE_KEY)
    .eq('schedule_date', monthAnchor(year, month))
    .maybeSingle()
  return !!data
}
