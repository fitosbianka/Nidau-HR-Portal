'use server'

// Personal-Änderungen (admin only): upcoming staff changes — extra vacation
// days, salary/Pensum changes, Austritte etc. Stored as reserved
// zeiterfassung_comments rows:
//   __personal__<key> @ <Wirkungsdatum> → JSON { typ, emp, text, erledigt, by }

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

const PERSONAL_PREFIX = '__personal__'

export type PersonalTyp = 'Ferien' | 'Lohn' | 'Pensum' | 'Austritt' | 'Eintritt' | 'Sonstiges'
const TYPEN: PersonalTyp[] = ['Ferien', 'Lohn', 'Pensum', 'Austritt', 'Eintritt', 'Sonstiges']

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase
    .from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (p?.role !== 'admin') throw new Error('Keine Berechtigung')
  return { admin: await createAdminClient(), name: p.full_name }
}

const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/
const revalidate = () => revalidatePath('/admin/personal')

export async function savePersonalAenderung(input: {
  key: string | null          // null = new entry
  oldDatum: string | null     // set when editing (row is keyed by date)
  datum: string
  emp: string
  typ: PersonalTyp
  text: string
  erledigt: boolean
}) {
  const { admin, name } = await requireAdmin()
  if (!DATUM_RE.test(input.datum)) return { error: 'Bitte ein gültiges Datum wählen.' }
  if (!input.emp.trim()) return { error: 'Bitte die betroffene Person angeben.' }
  if (!TYPEN.includes(input.typ)) return { error: 'Ungültiger Typ.' }

  const key = input.key ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  if (input.key && input.oldDatum && input.oldDatum !== input.datum) {
    await admin.from('zeiterfassung_comments').delete()
      .eq('user_full_name', `${PERSONAL_PREFIX}${input.key}`)
      .eq('schedule_date', input.oldDatum)
  }
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    {
      user_full_name: `${PERSONAL_PREFIX}${key}`,
      schedule_date: input.datum,
      comment: JSON.stringify({
        typ: input.typ,
        emp: input.emp.trim(),
        text: input.text.trim(),
        erledigt: input.erledigt,
        by: name,
      }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  revalidate()
  return { success: true }
}

export async function setPersonalErledigt(key: string, datum: string, erledigt: boolean) {
  const { admin } = await requireAdmin()
  const { data } = await admin.from('zeiterfassung_comments')
    .select('comment')
    .eq('user_full_name', `${PERSONAL_PREFIX}${key}`)
    .eq('schedule_date', datum)
    .maybeSingle()
  if (!data) return { error: 'Eintrag nicht gefunden.' }
  let j: Record<string, unknown> = {}
  try { j = JSON.parse((data as { comment: string }).comment) } catch { /* keep empty */ }
  const { error } = await admin.from('zeiterfassung_comments').update({
    comment: JSON.stringify({ ...j, erledigt }),
    updated_at: new Date().toISOString(),
  })
    .eq('user_full_name', `${PERSONAL_PREFIX}${key}`)
    .eq('schedule_date', datum)
  if (error) return { error: error.message }
  revalidate()
  return { success: true }
}

export async function deletePersonalAenderung(key: string, datum: string) {
  const { admin } = await requireAdmin()
  const { error } = await admin.from('zeiterfassung_comments').delete()
    .eq('user_full_name', `${PERSONAL_PREFIX}${key}`)
    .eq('schedule_date', datum)
  if (error) return { error: error.message }
  revalidate()
  return { success: true }
}
