// Änderungsprotokoll for the Zeiterfassung (admin-only view; only the admin
// can change times, so no author is stored or shown).
// Stored as reserved zeiterfassung_comments rows (no DDL possible):
//   user_full_name = __zeitlog__<id>  (unique per entry)
//   schedule_date  = the affected day
//   comment        = JSON { at, emp, text }
// Berichte/Konto loaders ignore __-prefixed rows.

import type { SupabaseClient } from '@supabase/supabase-js'

export const ZEIT_LOG_PREFIX = '__zeitlog__'

export type ZeitLogEntry = {
  key: string       // reserved user_full_name (unique per entry)
  datum: string     // affected day (YYYY-MM-DD)
  at: string        // ISO timestamp of the change
  emp: string       // employee whose times changed
  text: string      // what changed, e.g. "Ausstempeln 16:15 → 17:11"
}

/** All log entries whose affected day falls in the given month, newest first. */
export async function getZeitLogEntries(
  client: SupabaseClient,
  year: number,
  month: number,
): Promise<ZeitLogEntry[]> {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay  = `${year}-${String(month).padStart(2, '0')}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`
  const { data } = await client
    .from('zeiterfassung_comments')
    .select('user_full_name, schedule_date, comment')
    .like('user_full_name', `${ZEIT_LOG_PREFIX.replace(/_/g, '\\_')}%`)
    .gte('schedule_date', firstDay)
    .lte('schedule_date', lastDay)

  const list: ZeitLogEntry[] = []
  for (const r of (data ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>) {
    try {
      const p = JSON.parse(r.comment) as { at?: string; emp?: string; text?: string }
      if (!p.at || !p.text) continue
      list.push({ key: r.user_full_name, datum: r.schedule_date, at: p.at, emp: p.emp ?? '?', text: p.text })
    } catch { /* ignore bad rows */ }
  }
  list.sort((a, b) => b.at.localeCompare(a.at))
  return list
}

/** Best-effort append (server-side, service client) — never breaks the save. */
export async function logZeitChange(
  client: SupabaseClient,
  entry: { datum: string; emp: string; text: string },
) {
  try {
    const id = Math.random().toString(36).slice(2, 12)
    await client.from('zeiterfassung_comments').insert({
      user_full_name: `${ZEIT_LOG_PREFIX}${id}`,
      schedule_date: entry.datum,
      comment: JSON.stringify({
        at: new Date().toISOString(),
        emp: entry.emp,
        text: entry.text.length > 160 ? entry.text.slice(0, 159) + '…' : entry.text,
      }),
    })
  } catch { /* logging must never break the actual save */ }
}

export function zurichDateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })
}
export function zurichTimeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' })
}
