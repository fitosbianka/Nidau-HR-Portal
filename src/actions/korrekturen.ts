'use server'

import { randomUUID } from 'crypto'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { KORREKTUR_PREFIX } from '@/lib/korrekturen'
import { zurichDateOf, zurichTimeOf } from '@/lib/zeit-log'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht angemeldet.')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') throw new Error('Keine Berechtigung.')
  return await createAdminClient()
}

type DayEvent = { timemoto_event_id: string; user_full_name: string | null; clocking_type: string | null; time_logged: string | null; clocking_pair_id: string | null }

/** All non-deleted stamp events of one employee (first-name match) on one
 *  Zurich day, ordered by time. */
async function loadDayEvents(admin: Awaited<ReturnType<typeof createAdminClient>>, name: string, datum: string): Promise<DayEvent[]> {
  const first = name.split(' ')[0]
  const from = new Date(new Date(`${datum}T00:00:00Z`).getTime() - 3 * 3600000).toISOString()
  const to   = new Date(new Date(`${datum}T00:00:00Z`).getTime() + 27 * 3600000).toISOString()
  const { data } = await admin
    .from('attendance_events')
    .select('timemoto_event_id, user_full_name, clocking_type, time_logged, clocking_pair_id')
    .is('deleted_at', null)
    .ilike('user_full_name', `${first}%`)
    .gte('time_logged', from)
    .lt('time_logged', to)
    .order('time_logged', { ascending: true })
  return ((data ?? []) as DayEvent[]).filter(e => e.time_logged && zurichDateOf(e.time_logged) === datum)
}

/** Current stamped times + day note for one employee day (Korrektur widget).
 *  Spans carry the event ids so the admin can adjust the times right in the
 *  dialog (saved via the attendance API, which logs and revalidates). */
export async function getKorrekturTagesZeiten(name: string, datum: string) {
  let admin
  try { admin = await requireAdmin() } catch { return { error: 'Keine Berechtigung.' } }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !name.trim()) return { error: 'Ungültige Anfrage.' }

  const events = await loadDayEvents(admin, name, datum)
  const byPair = new Map<string, { inISO?: string; outISO?: string; inId?: string; outId?: string }>()
  for (const e of events) {
    const key = e.clocking_pair_id ? `p_${e.clocking_pair_id}` : `o_${e.timemoto_event_id}`
    if (!byPair.has(key)) byPair.set(key, {})
    const p = byPair.get(key)!
    if (e.clocking_type === 'In') { p.inISO = e.time_logged ?? undefined; p.inId = e.timemoto_event_id }
    else { p.outISO = e.time_logged ?? undefined; p.outId = e.timemoto_event_id }
  }
  const spans: Array<{ zeit: string; komplett: boolean; inId: string | null; outId: string | null; inHHMM: string; outHHMM: string }> = []
  let totalMin = 0
  Array.from(byPair.values())
    .sort((a, b) => (a.inISO ?? a.outISO ?? '').localeCompare(b.inISO ?? b.outISO ?? ''))
    .forEach(p => {
      const komplett = !!(p.inISO && p.outISO)
      if (komplett) totalMin += Math.round((new Date(p.outISO!).getTime() - new Date(p.inISO!).getTime()) / 60000)
      spans.push({
        zeit: komplett
          ? `${zurichTimeOf(p.inISO!)} – ${zurichTimeOf(p.outISO!)}`
          : p.inISO ? `${zurichTimeOf(p.inISO)} – offen` : `? – ${zurichTimeOf(p.outISO!)}`,
        komplett,
        inId: p.inId ?? null,
        outId: p.outId ?? null,
        inHHMM: p.inISO ? zurichTimeOf(p.inISO) : '',
        outHHMM: p.outISO ? zurichTimeOf(p.outISO) : '',
      })
    })

  const first = name.split(' ')[0]
  const { data: noteRows } = await admin
    .from('zeiterfassung_comments')
    .select('user_full_name, comment')
    .eq('schedule_date', datum)
    .ilike('user_full_name', `${first}%`)
  const noteRow = ((noteRows ?? []) as Array<{ user_full_name: string; comment: string }>)
    .find(r => !r.user_full_name.startsWith('__'))

  return { spans, totalMin, note: noteRow?.comment ?? '' }
}

/** Admin saves the day note for a Korrektur day (shows in the Zeiterfassung). */
export async function saveKorrekturTagesNotiz(name: string, datum: string, note: string) {
  let admin
  try { admin = await requireAdmin() } catch { return { error: 'Keine Berechtigung.' } }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !name.trim()) return { error: 'Ungültige Anfrage.' }
  const trimmed = note.trim()
  if (trimmed.length > 500) return { error: 'Die Notiz ist zu lang (max. 500 Zeichen).' }
  if (trimmed === '') {
    await admin.from('zeiterfassung_comments').delete().eq('user_full_name', name).eq('schedule_date', datum)
  } else {
    const { error } = await admin.from('zeiterfassung_comments').upsert(
      { user_full_name: name, schedule_date: datum, comment: trimmed, updated_at: new Date().toISOString() },
      { onConflict: 'user_full_name,schedule_date' },
    )
    if (error) return { error: error.message }
  }
  revalidatePath('/admin/zeiterfassung/berichte')
  revalidatePath('/employee/zeiterfassung')
  return { success: true }
}

/** A signed-in employee (incl. Leitende) reports a Zeiterfassung correction
 *  for one day. It shows up on the admin dashboard until marked done. */
export async function submitZeitKorrektur(datum: string, zeit: string, text: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Nicht angemeldet.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return { error: 'Bitte ein gültiges Datum wählen.' }
  const zeitT = zeit.trim()
  const textT = text.trim()
  if (!zeitT) return { error: 'Bitte die korrekte Zeit angeben.' }
  if (zeitT.length > 120) return { error: 'Die Zeitangabe ist zu lang (max. 120 Zeichen).' }
  if (textT.length > 500) return { error: 'Die Bemerkung ist zu lang (max. 500 Zeichen).' }

  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single()
  const name = ((profile as { full_name?: string } | null)?.full_name ?? '').trim()
  if (!name) return { error: 'Profil konnte nicht geladen werden.' }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })
  const admin = await createAdminClient()
  const { error } = await admin.from('zeiterfassung_comments').insert({
    user_full_name: `${KORREKTUR_PREFIX}${randomUUID().slice(0, 8)}`,
    schedule_date:  datum,
    comment:        JSON.stringify({ name, zeit: zeitT, text: textT, am: today }),
  })
  if (error) return { error: error.message }
  revalidatePath('/employee')
  revalidatePath('/admin')
  return { success: true }
}

/** Admin permanently deletes a correction request (e.g. a test entry).
 *  It disappears for the employee as well. */
export async function deleteZeitKorrektur(key: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Nicht angemeldet.' }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') return { error: 'Keine Berechtigung.' }
  if (!key.startsWith(KORREKTUR_PREFIX)) return { error: 'Ungültige Meldung.' }

  const admin = await createAdminClient()
  const { error } = await admin.from('zeiterfassung_comments').delete().eq('user_full_name', key)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/admin/zeiterfassung/korrekturen')
  revalidatePath('/employee')
  return { success: true }
}

/** Admin marks a correction request as done. The row is kept (stamped with
 *  the resolve date) so the history per employee stays available. */
export async function resolveZeitKorrektur(key: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Nicht angemeldet.' }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') return { error: 'Keine Berechtigung.' }
  if (!key.startsWith(KORREKTUR_PREFIX)) return { error: 'Ungültige Meldung.' }

  const admin = await createAdminClient()
  const { data: row } = await admin
    .from('zeiterfassung_comments')
    .select('comment')
    .eq('user_full_name', key)
    .single()
  if (!row) return { error: 'Meldung nicht gefunden.' }
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse((row as { comment: string }).comment) as Record<string, unknown>
  } catch {
    return { error: 'Meldung ist beschädigt.' }
  }
  payload.done = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })
  const { error } = await admin
    .from('zeiterfassung_comments')
    .update({ comment: JSON.stringify(payload) })
    .eq('user_full_name', key)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/admin/zeiterfassung/korrekturen')
  revalidatePath('/employee')
  return { success: true }
}
