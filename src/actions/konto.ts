'use server'

import { KONTO_YEAR, LIVE_FROM_MONTH } from '@/data/arbeitszeit-konto-2026'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// Admin corrections for the Excel-imported history months of the
// Arbeitszeit- und Ferienkonto. Stored in zeiterfassung_comments under
// reserved keys (no dedicated table available):
//   user_full_name = "__konto__<employee_id>",     schedule_date = YYYY-MM-01,
//     comment = JSON { istMin?, ferien?, krank? }
//   user_full_name = "__konto_bem__<employee_id>", schedule_date = YYYY-01-01,
//     comment = Bemerkungen text
//   user_full_name = "__konto_start__<employee_id>", schedule_date = YYYY-01-01,
//     comment = Ferien-Startguthaben in Tagen (Restferien zu Beginn der
//     automatisch berechneten Monate; ersetzt den Excel-Stand bzw. setzt das
//     Guthaben für Neueintritte ohne Import)
const KONTO_OVERRIDE_PREFIX = '__konto__'
const KONTO_BEMERK_PREFIX = '__konto_bem__'
const KONTO_START_PREFIX = '__konto_start__'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') throw new Error('Keine Berechtigung')
  return await createAdminClient()
}

export async function saveKontoMonthOverride(
  employeeId: string,
  year: number,
  month: number,
  values: { istMin: number | null; ferien: number | null; krank: number | null; unfall?: number | null },
) {
  const admin = await requireAdmin()
  const key  = `${KONTO_OVERRIDE_PREFIX}${employeeId}`
  const date = `${year}-${String(month).padStart(2, '0')}-01`
  // Ist-Stunden lassen sich nur in den importierten Excel-Monaten (vor dem
  // Start der Zeiterfassung) korrigieren. Ab dann kommt das Ist immer aus
  // der Zeiterfassung — Korrekturen dort (Stempel bearbeiten), nicht hier.
  const istErlaubt = year < KONTO_YEAR || (year === KONTO_YEAR && month < LIVE_FROM_MONTH)
  const sauber = { ...values, istMin: istErlaubt ? values.istMin : null }
  if (sauber.istMin == null && sauber.ferien == null && sauber.krank == null && (sauber.unfall ?? null) == null) {
    // nichts mehr fixiert → Korrekturzeile entfernen
    const { error } = await admin.from('zeiterfassung_comments').delete()
      .eq('user_full_name', key).eq('schedule_date', date)
    if (error) return { error: error.message }
    revalidatePath('/admin/zeiterfassung/konto')
    return { success: true }
  }
  const { error } = await admin.from('zeiterfassung_comments')
    .upsert(
      { user_full_name: key, schedule_date: date, comment: JSON.stringify(sauber), updated_at: new Date().toISOString() },
      { onConflict: 'user_full_name,schedule_date' },
    )
  if (error) return { error: error.message }
  revalidatePath('/admin/zeiterfassung/konto')
  return { success: true }
}

/** Remove a manual month correction — the month falls back to the
 *  automatically computed values (and the chain re-computes). */
export async function clearKontoMonthOverride(employeeId: string, year: number, month: number) {
  const admin = await requireAdmin()
  const { error } = await admin.from('zeiterfassung_comments')
    .delete()
    .eq('user_full_name', `${KONTO_OVERRIDE_PREFIX}${employeeId}`)
    .eq('schedule_date', `${year}-${String(month).padStart(2, '0')}-01`)
  if (error) return { error: error.message }
  revalidatePath('/admin/zeiterfassung/konto')
  return { success: true }
}

export async function saveKontoFerienStart(employeeId: string, year: number, tage: number) {
  if (!Number.isFinite(tage)) return { error: 'Ungültiger Wert' }
  const admin = await requireAdmin()
  const { error } = await admin.from('zeiterfassung_comments')
    .upsert(
      { user_full_name: `${KONTO_START_PREFIX}${employeeId}`, schedule_date: `${year}-01-01`, comment: String(tage), updated_at: new Date().toISOString() },
      { onConflict: 'user_full_name,schedule_date' },
    )
  if (error) return { error: error.message }
  revalidatePath('/admin/zeiterfassung/konto')
  return { success: true }
}

/** Remove the manual Ferien-Startguthaben — the account falls back to the
 *  imported Excel value (or bleibt leer bei Neueintritten ohne Import). */
export async function clearKontoFerienStart(employeeId: string, year: number) {
  const admin = await requireAdmin()
  const { error } = await admin.from('zeiterfassung_comments')
    .delete()
    .eq('user_full_name', `${KONTO_START_PREFIX}${employeeId}`)
    .eq('schedule_date', `${year}-01-01`)
  if (error) return { error: error.message }
  revalidatePath('/admin/zeiterfassung/konto')
  return { success: true }
}

export async function saveKontoBemerkungen(employeeId: string, year: number, text: string) {
  const admin = await requireAdmin()
  const key  = `${KONTO_BEMERK_PREFIX}${employeeId}`
  const date = `${year}-01-01`
  const trimmed = text.trim()
  if (trimmed === '') {
    await admin.from('zeiterfassung_comments').delete()
      .eq('user_full_name', key).eq('schedule_date', date)
  } else {
    const { error } = await admin.from('zeiterfassung_comments')
      .upsert(
        { user_full_name: key, schedule_date: date, comment: trimmed, updated_at: new Date().toISOString() },
        { onConflict: 'user_full_name,schedule_date' },
      )
    if (error) return { error: error.message }
  }
  revalidatePath('/admin/zeiterfassung/konto')
  return { success: true }
}
