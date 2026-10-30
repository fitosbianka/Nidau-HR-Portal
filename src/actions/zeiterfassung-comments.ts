'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') throw new Error('Keine Berechtigung')
  return await createAdminClient()
}

/** Save (or clear, when empty) a per-day comment for an employee's Zeiterfassung. */
export async function upsertZeiterfassungComment(userFullName: string, date: string, comment: string) {
  const admin = await requireAdmin()
  const trimmed = comment.trim()
  if (trimmed === '') {
    await admin.from('zeiterfassung_comments').delete()
      .eq('user_full_name', userFullName).eq('schedule_date', date)
  } else {
    const { error } = await admin.from('zeiterfassung_comments')
      .upsert({ user_full_name: userFullName, schedule_date: date, comment: trimmed, updated_at: new Date().toISOString() },
        { onConflict: 'user_full_name,schedule_date' })
    if (error) return { error: error.message }
  }
  revalidatePath('/admin/zeiterfassung/berichte')
  return { success: true }
}
