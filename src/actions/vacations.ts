'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { FERIEN_EDITORS } from '@/lib/leitende'
import { loescheVertretung, schreibeVertretung } from '@/lib/ferien-vertretung-db'
import { ferienTage } from '@/lib/ferien-eintrag'
import { ND_PREFIX, ND_BEDARF_STANDARD, ndAnmeldungKey, ndRolle } from '@/lib/notfalldienste'

/** Admins — plus designated Ferien editors — may plan vacation. */
async function requireFerienEditor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (p?.role !== 'admin' && !FERIEN_EDITORS.includes(p?.full_name ?? '')) throw new Error('Keine Berechtigung')
  return await createAdminClient()
}

/** Alle Seiten, die Ferien-/Plan-Einträge zeigen — inklusive der
 *  Mitarbeiter- und Team-Ferienplanung, damit der Jahresplan überall
 *  sofort aktualisiert erscheint. */
function revalidateFerienPages() {
  for (const path of [
    '/admin/zeiterfassung/ferien/planung', '/admin/zeiterfassung/konto',
    '/admin/arbeitsplan', '/employee/arbeitsplan',
    '/employee/ferien', '/employee/team/ferien',
  ]) revalidatePath(path)
}

/** List weekdays (Mon–Fri) between two ISO dates, inclusive. */
function weekdaysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  while (d <= end) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    }
    d.setDate(d.getDate() + 1)
  }
  return out
}

/**
 * Plan vacation for an employee over a date range. Writes the Ferien code "F"
 * into work_schedule for every weekday in range — which makes it show up
 * automatically in the Arbeitsplan.
 *
 * `angerechnet` (optional, decimal) overrides how many vacation days the
 * period COUNTS as — for part-timers with flexible schedules. E.g. a 50%
 * employee away Mo–Fr: 5 weekdays, angerechnet 2.5. The weight is spread
 * evenly over the weekdays (entry "F:0.5" per day); the Arbeitsplan still
 * shows «F» on every day.
 *
 * `vertretung` (nur ZAZ): Name der Ferienvertretung für diese Tage. Nicht
 * übergeben = unverändert lassen; leer/null = allfällige Vertretung löschen.
 */
export async function addVacation(employeeId: string, from: string, to: string, code: 'F' | 'K' = 'F', angerechnet?: number | null, vertretung?: string | null, vertretungTage?: string[] | null) {
  const adminClient = await requireFerienEditor()
  if (!employeeId || !from || !to) return { error: 'Mitarbeiter und Zeitraum sind erforderlich.' }
  if (to < from) return { error: 'Das End-Datum liegt vor dem Start-Datum.' }

  // Ab 2027 nur Arbeitstage ohne Feiertage; jeder Tag zählt einen Ferientag
  // (tagesgenau), ausser «angerechnet» verteilt eine andere Zahl auf die Tage
  const days = code === 'F' ? ferienTage(from, to) : weekdaysBetween(from, to)
  if (days.length === 0) return { error: 'Keine Arbeitstage im gewählten Zeitraum.' }

  let entryValue: string = code
  let counted = days.length
  if (code === 'F' && angerechnet != null) {
    if (!(angerechnet > 0)) return { error: 'Angerechnete Tage müssen grösser als 0 sein.' }
    const weight = angerechnet / days.length
    if (Math.abs(weight - 1) > 1e-9) entryValue = `F:${parseFloat(weight.toFixed(4))}`
    counted = Math.round(angerechnet * 100) / 100
  }

  const rows = days.map(d => ({ employee_id: employeeId, schedule_date: d, entry: entryValue }))
  const { error } = await adminClient
    .from('work_schedule')
    .upsert(rows, { onConflict: 'employee_id,schedule_date' })
  if (error) return { error: error.message }
  if (vertretung !== undefined) {
    const vErr = (await loescheVertretung(adminClient, employeeId, from, to)) ?? (await schreibeVertretung(adminClient, employeeId, days, vertretung, vertretungTage))
    if (vErr) return { error: `Ferien eingetragen, aber die Vertretung konnte nicht gespeichert werden: ${vErr}` }
  }

  revalidateFerienPages()
  return { success: true, count: days.length, counted }
}

/** Remove vacation (F / F:x) entries for an employee over a range. */
export async function removeVacation(employeeId: string, from: string, to: string) {
  const adminClient = await requireFerienEditor()
  const { error } = await adminClient
    .from('work_schedule')
    .delete()
    .eq('employee_id', employeeId)
    .or('entry.eq.F,entry.like.F:*')
    .gte('schedule_date', from)
    .lte('schedule_date', to)
  if (error) return { error: error.message }
  await loescheVertretung(adminClient, employeeId, from, to)
  revalidateFerienPages()
  return { success: true }
}

/** Eingetragene Ferienperiode (F / F:x) anpassen: die Tage des alten
 *  Zeitraums werden entfernt und der neue Zeitraum eingetragen — in DIESER
 *  Reihenfolge erst NACH kompletter Validierung, damit ein Fehler nie die
 *  bestehende Periode löscht, ohne die neue zu schreiben. */
export async function updateVacationRange(
  employeeId: string,
  oldFrom: string,
  oldTo: string,
  newFrom: string,
  newTo: string,
  angerechnet?: number | null,
  /** nur ZAZ: Vertretung für den neuen Zeitraum (null = keine) */
  vertretung?: string | null,
  /** nur ZAZ: Tage, an denen die Vertretung kommt (null = alle) */
  vertretungTage?: string[] | null,
) {
  const adminClient = await requireFerienEditor()
  if (!employeeId || !oldFrom || !oldTo || !newFrom || !newTo) return { error: 'Mitarbeiter und Zeitraum sind erforderlich.' }
  if (newTo < newFrom) return { error: 'Das End-Datum liegt vor dem Start-Datum.' }
  const days = ferienTage(newFrom, newTo)
  if (days.length === 0) return { error: 'Keine Arbeitstage (Mo–Fr) im neuen Zeitraum.' }
  let entryValue = 'F'
  let counted = days.length
  if (angerechnet != null) {
    if (!(angerechnet > 0)) return { error: 'Angerechnete Tage müssen grösser als 0 sein.' }
    const weight = angerechnet / days.length
    if (Math.abs(weight - 1) > 1e-9) entryValue = `F:${parseFloat(weight.toFixed(4))}`
    counted = Math.round(angerechnet * 100) / 100
  }

  const { error: delError } = await adminClient
    .from('work_schedule')
    .delete()
    .eq('employee_id', employeeId)
    .or('entry.eq.F,entry.like.F:*')
    .gte('schedule_date', oldFrom)
    .lte('schedule_date', oldTo)
  if (delError) return { error: delError.message }
  await loescheVertretung(adminClient, employeeId, oldFrom, oldTo)

  const rows = days.map(d => ({ employee_id: employeeId, schedule_date: d, entry: entryValue }))
  const { error } = await adminClient
    .from('work_schedule')
    .upsert(rows, { onConflict: 'employee_id,schedule_date' })
  if (error) return { error: error.message }
  const vErr = await schreibeVertretung(adminClient, employeeId, days, vertretung, vertretungTage)
  if (vErr) return { error: `Ferien angepasst, aber die Vertretung konnte nicht gespeichert werden: ${vErr}` }

  revalidateFerienPages()
  return { success: true, count: days.length, counted }
}

/** Notfalldienst «ND» für einen Zeitraum eintragen (Mo–Fr). Erscheint im
 *  Arbeitsplan und farbig im Ferienkalender; zählt weder als Ferien noch
 *  als Absenz (ist Arbeit). Nur Admins und die Ferien-Editorin. */
export async function addNotfalldienst(employeeId: string, from: string, to: string) {
  const adminClient = await requireFerienEditor()
  if (!employeeId || !from || !to) return { error: 'Mitarbeiter und Zeitraum sind erforderlich.' }
  if (to < from) return { error: 'Das End-Datum liegt vor dem Start-Datum.' }
  const days = weekdaysBetween(from, to)
  if (days.length === 0) return { error: 'Keine Arbeitstage (Mo–Fr) im gewählten Zeitraum.' }
  // Ein Notfalldienst überschreibt nie Ferien
  const { data: ferien } = await adminClient.from('work_schedule').select('schedule_date').eq('employee_id', employeeId)
    .in('schedule_date', days).or('entry.eq.F,entry.like.F:*,entry.eq.UF').limit(1)
  if ((ferien ?? []).length > 0) return { error: 'In diesem Zeitraum sind Ferien eingetragen, ein Notfalldienst ist dann nicht möglich.' }
  const rows = days.map(d => ({ employee_id: employeeId, schedule_date: d, entry: 'ND' }))
  const { error } = await adminClient
    .from('work_schedule')
    .upsert(rows, { onConflict: 'employee_id,schedule_date' })
  if (error) return { error: error.message }
  // Gleichzeitig als Notfalldienst mit Anmeldung führen, damit er in der
  // Liste steht und weitere Personen sich anmelden können.
  const am = new Date().toISOString()
  const { data: vorhanden } = await adminClient.from('zeiterfassung_comments').select('schedule_date').eq('user_full_name', ND_PREFIX).eq('schedule_date', from).maybeSingle()
  if (!vorhanden) {
    await adminClient.from('zeiterfassung_comments').upsert(
      { user_full_name: ND_PREFIX, schedule_date: from, comment: JSON.stringify({ bis: to, notiz: '', bedarf: ND_BEDARF_STANDARD, erstelltAm: am }), updated_at: am },
      { onConflict: 'user_full_name,schedule_date' },
    )
  }
  const { data: prof } = await adminClient.from('profiles').select('job_title').eq('id', employeeId).maybeSingle()
  await adminClient.from('zeiterfassung_comments').upsert(
    { user_full_name: ndAnmeldungKey(employeeId), schedule_date: from, comment: JSON.stringify({ rolle: ndRolle((prof as { job_title: string | null } | null)?.job_title) ?? 'zahnarzt', am, status: 'bestaetigt', durchAdmin: true }), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  revalidateFerienPages()
  return { success: true, count: days.length }
}

/** Remove Notfalldienst (ND) entries for an employee over a range. */
export async function removeNotfalldienst(employeeId: string, from: string, to: string) {
  const adminClient = await requireFerienEditor()
  const { error } = await adminClient
    .from('work_schedule')
    .delete()
    .eq('employee_id', employeeId)
    .eq('entry', 'ND')
    .gte('schedule_date', from)
    .lte('schedule_date', to)
  if (error) return { error: error.message }
  // zugehörige Anmeldung der Person entfernen (Dienst beginnt am Von)
  await adminClient.from('zeiterfassung_comments').delete().eq('user_full_name', ndAnmeldungKey(employeeId)).gte('schedule_date', from).lte('schedule_date', to)
  revalidateFerienPages()
  return { success: true }
}
