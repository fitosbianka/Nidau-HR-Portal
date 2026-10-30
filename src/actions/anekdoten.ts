'use server'

// Mitarbeiter-Anekdoten für das Teamevent — erfassen dürfen der Admin und
// die Leitenden DA; sichtbar je nach gewählter Sichtbarkeit.

import { randomUUID } from 'crypto'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { ANEKDOTE_PREFIX, ANEKDOTEN_DEADLINE, type AnekdoteSicht } from '@/lib/anekdoten'
import { LEITENDE_TITLE } from '@/lib/leitende'

async function requireLeitendeOderAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht angemeldet.')
  const { data: profile } = await supabase
    .from('profiles').select('role, full_name, job_title').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string; job_title: string | null } | null
  const isAdmin = p?.role === 'admin'
  if (!isAdmin && p?.job_title !== LEITENDE_TITLE) throw new Error('Keine Berechtigung.')
  return { userId: user.id, name: p!.full_name, isAdmin, admin: await createAdminClient() }
}

const revalidate = () => {
  revalidatePath('/admin')
  revalidatePath('/employee')
}

export async function addAnekdote(ueber: string, text: string, sicht: AnekdoteSicht) {
  let ctx
  try { ctx = await requireLeitendeOderAdmin() } catch { return { error: 'Keine Berechtigung.' } }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })
  // Nach dem 16.10. darf nur noch der Admin ergänzen (die Leitenden-Box
  // verschwindet dann ohnehin von deren Startseite).
  if (!ctx.isAdmin && today > ANEKDOTEN_DEADLINE) return { error: 'Die Sammelfrist ist abgelaufen (16.10.).' }
  const ueberT = ueber.trim()
  const textT = text.trim()
  if (!ueberT) return { error: 'Bitte angeben, über wen die Anekdote ist.' }
  if (!textT) return { error: 'Bitte die Anekdote eingeben.' }
  if (ueberT.length > 80) return { error: 'Der Name ist zu lang (max. 80 Zeichen).' }
  if (textT.length > 1000) return { error: 'Die Anekdote ist zu lang (max. 1000 Zeichen).' }

  const { error } = await ctx.admin.from('zeiterfassung_comments').insert({
    user_full_name: `${ANEKDOTE_PREFIX}${randomUUID().slice(0, 8)}`,
    schedule_date:  today,
    comment: JSON.stringify({
      von: ctx.name,
      vonId: ctx.userId,
      ueber: ueberT.slice(0, 80),
      text: textT.slice(0, 1000),
      sicht: sicht === 'admin' ? 'admin' : 'leitende',
      am: today,
    }),
  })
  if (error) return { error: error.message }
  revalidate()
  return { success: true }
}

/** Nach dem PDF Export genau die exportierten Einträge entfernen (nur Admin). */
export async function deleteAnekdotenNachExport(keys: string[]) {
  let ctx
  try { ctx = await requireLeitendeOderAdmin() } catch { return { error: 'Keine Berechtigung.' } }
  if (!ctx.isAdmin) return { error: 'Das kann nur der Admin.' }
  const sauber = Array.from(new Set((keys ?? []).filter(k => typeof k === 'string' && k.startsWith(ANEKDOTE_PREFIX) && /^[\w-]{1,40}$/.test(k.slice(ANEKDOTE_PREFIX.length)))))
  if (sauber.length === 0) return { error: 'Keine Einträge zum Entfernen.' }
  const { data, error } = await ctx.admin.from('zeiterfassung_comments').delete().in('user_full_name', sauber).select('user_full_name')
  if (error) return { error: error.message }
  revalidate()
  return { success: true as const, anzahl: (data ?? []).length }
}

/** Löschen: die Erfasserin ihre eigenen Einträge, der Admin alle. */
export async function deleteAnekdote(key: string) {
  let ctx
  try { ctx = await requireLeitendeOderAdmin() } catch { return { error: 'Keine Berechtigung.' } }
  if (!key.startsWith(ANEKDOTE_PREFIX)) return { error: 'Ungültiger Eintrag.' }

  const { data: row } = await ctx.admin
    .from('zeiterfassung_comments')
    .select('comment')
    .eq('user_full_name', key)
    .maybeSingle()
  if (!row) return { error: 'Eintrag nicht gefunden.' }
  if (!ctx.isAdmin) {
    try {
      const p = JSON.parse((row as { comment: string }).comment) as { vonId?: string }
      if (p.vonId !== ctx.userId) return { error: 'Nur eigene Einträge können gelöscht werden.' }
    } catch { return { error: 'Eintrag ist beschädigt.' } }
  }

  const { error } = await ctx.admin.from('zeiterfassung_comments').delete().eq('user_full_name', key)
  if (error) return { error: error.message }
  revalidate()
  return { success: true }
}
