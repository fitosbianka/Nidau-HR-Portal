'use server'

import { randomUUID } from 'crypto'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { LEITENDE_TITLE, LEITENDE_KEY, monthAnchor, isMonthReleasedToLeitende } from '@/lib/leitende'
import { PLAN_NOTES_KEY, PLAN_NOTES_ADMIN_KEY, PLAN_DAY_NOTE_KEY, PLAN_WEEK_NOTE_KEY, PLAN_QUESTION_KEY, mondayOf, sundayOf, parseNoteComment, leereNotiz, encodeNoteEntries, eintragAnfuegen, eintragAendern, type NoteEntry } from '@/lib/plan-notes'
import { kuerzelFuer } from '@/lib/kuerzel'
import { PLAN_LOG_PREFIX, getPlanLogEntries, type PlanLogEntry, type PlanLogKind } from '@/lib/plan-log'
import { getStandardWeeks, STD_WEEK_PREFIX, STD_WEEK_DATE } from '@/lib/plan-standards'
import { TEAM_EVENT_KEY } from '@/lib/team-events'
import { ferienWeight } from '@/lib/ferien'
import { istBehandler } from '@/lib/ferien-kapazitaet'

/** Behandler (ZAZ, DH / PA) führen ihre freien Tage im Plan LEER statt mit
 *  «%» (Regel seit Oktober 2026, siehe CLAUDE.md): ein «%» aus ihrer
 *  Standardwoche wird deshalb beim Anwenden nie in den Plan geschrieben. */
async function behandlerIds(adminClient: Awaited<ReturnType<typeof createAdminClient>>): Promise<Set<string>> {
  const { data } = await adminClient.from('profiles').select('id, job_title')
  return new Set(((data ?? []) as Array<{ id: string; job_title: string | null }>).filter(p => istBehandler(p.job_title)).map(p => p.id))
}
const standardFuer = (week: Record<string, string> | undefined, isoDow: string, behandler: boolean): string => {
  const v = (week?.[isoDow] ?? '').trim()
  return behandler && /^(%|FREI)$/i.test(v) ? '' : v
}

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') throw new Error('Keine Berechtigung')
  return await createAdminClient()
}

/** Allows admins always; Leitende DA for months released to them or
 *  published; employees with the legacy can_edit_schedule flag ONLY for
 *  published months (the flag never grants early access to a plan that is
 *  not yet published to the team). `date` = the day being edited. */
async function requireEditor(date?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, can_edit_schedule, job_title')
    .eq('id', user.id)
    .single()
  const p = profile as { role: string; can_edit_schedule: boolean; job_title: string | null } | null
  const adminClient = await createAdminClient()
  if (p?.role === 'admin') return adminClient
  if (date && (p?.can_edit_schedule || p?.job_title === LEITENDE_TITLE)) {
    const [y, m] = date.split('-').map(Number)
    const { data: pub } = await adminClient
      .from('schedule_publications')
      .select('year')
      .eq('year', y)
      .eq('month', m)
      .maybeSingle()
    if (pub) return adminClient
    if (p?.job_title === LEITENDE_TITLE && await isMonthReleasedToLeitende(adminClient, y, m)) return adminClient
  }
  throw new Error('Keine Berechtigung')
}

/** Upsert a single schedule cell. Pass empty string to clear it. */
export async function upsertShift(employeeId: string, date: string, entry: string) {
  const adminClient = await requireEditor(date)

  const { data: prev } = await adminClient
    .from('work_schedule')
    .select('entry')
    .eq('employee_id', employeeId)
    .eq('schedule_date', date)
    .maybeSingle()
  const oldValue = ((prev as { entry?: string } | null)?.entry ?? '').trim()
  const newValue = entry.trim()

  if (newValue === '') {
    await adminClient
      .from('work_schedule')
      .delete()
      .eq('employee_id', employeeId)
      .eq('schedule_date', date)
  } else {
    const { error } = await adminClient
      .from('work_schedule')
      .upsert(
        { employee_id: employeeId, schedule_date: date, entry: newValue },
        { onConflict: 'employee_id,schedule_date' }
      )
    if (error) return { error: error.message }
  }

  if (oldValue !== newValue) {
    const emp = await employeeName(adminClient, employeeId)
    await logPlanChanges(adminClient, [{ datum: date, kind: 'zelle', emp, old: oldValue, neu: newValue }])
  }

  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true }
}

/** Grant or revoke schedule-edit rights for an employee. Admin-only. */
export async function setScheduleEditor(employeeId: string, canEdit: boolean) {
  const adminClient = await requireAdmin()
  const { error } = await adminClient
    .from('profiles')
    .update({ can_edit_schedule: canEdit } as never)
    .eq('id', employeeId)
  if (error) return { error: error.message }
  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true }
}

/** Publish a month's schedule so all employees can see it. */
export async function publishMonth(year: number, month: number) {
  const adminClient = await requireAdmin()
  const { error } = await adminClient
    .from('schedule_publications')
    .upsert({ year, month }, { onConflict: 'year,month' })
  if (error) return { error: error.message }
  await logPlanChanges(adminClient, [{ datum: monthAnchor(year, month), kind: 'status', text: 'Plan veröffentlicht' }])
  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true }
}

/** Release a month's draft plan to the Leitenden (read + edit for them).
 *  Distinct from publishMonth, which opens the plan read-only to everyone. */
export async function releaseMonthToLeitende(year: number, month: number) {
  const adminClient = await requireAdmin()
  const { error } = await adminClient
    .from('zeiterfassung_comments')
    .upsert(
      { user_full_name: LEITENDE_KEY, schedule_date: monthAnchor(year, month), comment: 'freigegeben', updated_at: new Date().toISOString() },
      { onConflict: 'user_full_name,schedule_date' },
    )
  if (error) return { error: error.message }
  await logPlanChanges(adminClient, [{ datum: monthAnchor(year, month), kind: 'status', text: 'Für Leitende freigegeben' }])
  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true }
}

/** Withdraw the Leitende release for a month. */
export async function unreleaseMonthFromLeitende(year: number, month: number) {
  const adminClient = await requireAdmin()
  const { error } = await adminClient
    .from('zeiterfassung_comments')
    .delete()
    .eq('user_full_name', LEITENDE_KEY)
    .eq('schedule_date', monthAnchor(year, month))
  if (error) return { error: error.message }
  await logPlanChanges(adminClient, [{ datum: monthAnchor(year, month), kind: 'status', text: 'Freigabe für Leitende zurückgezogen' }])
  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true }
}

/** Flag a day as "manual planning needed" (red column). Editors only. */
export async function flagReviewDay(date: string, reason?: string) {
  const adminClient = await requireEditor(date)
  const { error } = await adminClient
    .from('schedule_review_days')
    .upsert({ schedule_date: date, reason: reason ?? null }, { onConflict: 'schedule_date' })
  if (error) return { error: error.message }
  await logPlanChanges(adminClient, [{ datum: date, kind: 'marker', text: 'Tag rot markiert (manuelle Planung)' }])
  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true }
}

/** Mark a day as Teamevent (pastel-brown column). With fillEntries, every
 *  existing entry that day (except planned Ferien) becomes «TE», which the
 *  Zeiterfassung credits like a worked day (8:30). Editors only. */
export async function flagTeamEventDay(date: string, fillEntries = true) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Ungültiges Datum.' }
  const adminClient = await requireEditor(date)

  const { error } = await adminClient
    .from('zeiterfassung_comments')
    .upsert(
      { user_full_name: TEAM_EVENT_KEY, schedule_date: date, comment: 'Teamevent', updated_at: new Date().toISOString() },
      { onConflict: 'user_full_name,schedule_date' },
    )
  if (error) return { error: error.message }

  let filled = 0
  if (fillEntries) {
    const { data: rows } = await adminClient
      .from('work_schedule')
      .select('employee_id, entry')
      .eq('schedule_date', date)
    const targets = ((rows ?? []) as Array<{ employee_id: string; entry: string }>)
      .filter(r => r.entry.trim() !== '' && ferienWeight(r.entry) == null && r.entry.trim().toUpperCase() !== 'TE')
    if (targets.length > 0) {
      const { error: upErr } = await adminClient
        .from('work_schedule')
        .upsert(
          targets.map(r => ({ employee_id: r.employee_id, schedule_date: date, entry: 'TE' })),
          { onConflict: 'employee_id,schedule_date' },
        )
      if (upErr) return { error: upErr.message }
      filled = targets.length
      // Jede überschriebene Zelle EINZELN mit altem Wert protokollieren —
      // damit das Protokoll zeigt, was ersetzt wurde, und ein Versehen
      // über «Teamevent rückgängig» exakt wiederherstellbar ist
      const { data: profs } = await adminClient
        .from('profiles').select('id, full_name')
        .in('id', targets.map(t => t.employee_id))
      const nameById = new Map(((profs ?? []) as Array<{ id: string; full_name: string }>).map(p => [p.id, p.full_name]))
      await logPlanChanges(adminClient, targets.map(t => ({
        datum: date, kind: 'zelle' as const,
        emp: nameById.get(t.employee_id) ?? '?', old: t.entry.trim(), neu: 'TE',
      })))
    }
  }

  await logPlanChanges(adminClient, [{
    datum: date, kind: 'marker',
    text: filled > 0 ? `Teamevent markiert (${filled} Einträge auf «TE» gesetzt)` : 'Teamevent markiert',
  }])
  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true, filled }
}

export type TeVorschlag = {
  employeeId: string
  emp: string
  /** null = kein früherer Wert rekonstruierbar — die Zelle bleibt «TE» */
  vorschlag: string | null
  quelle: 'protokoll' | 'standardwoche' | null
}

/** Teamevent-Überschreibung rückgängig machen: stellt alle Zellen des Tages,
 *  die aktuell «TE» sind, auf den letzten bekannten Stand zurück und
 *  entfernt die Teamevent-Markierung. Quellen je Zelle: der zuletzt
 *  protokollierte Wert aus dem Änderungsprotokoll (bei neueren Teamevent-
 *  Aktionen exakt der ersetzte Wert), sonst die Standardwoche.
 *  Mit anwenden=false kommt nur die Vorschau — es wird nichts verändert. */
export async function teameventRueckgaengig(date: string, anwenden: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Ungültiges Datum.' }
  const adminClient = await requireEditor(date)
  const y = parseInt(date.slice(0, 4), 10)
  const m = parseInt(date.slice(5, 7), 10)

  const [{ data: rows }, logEntries, standards, { data: profs }] = await Promise.all([
    adminClient.from('work_schedule').select('employee_id, entry').eq('schedule_date', date),
    getPlanLogEntries(adminClient, y, m),
    getStandardWeeks(adminClient),
    adminClient.from('profiles').select('id, full_name, job_title'),
  ])
  const profList = (profs ?? []) as Array<{ id: string; full_name: string; job_title: string | null }>
  const nameById = new Map(profList.map(p => [p.id, p.full_name]))
  const behandler = new Set(profList.filter(p => istBehandler(p.job_title)).map(p => p.id))
  const isoDow = String(((new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1)

  const vorschlaege: TeVorschlag[] = []
  for (const r of (rows ?? []) as Array<{ employee_id: string; entry: string }>) {
    if (r.entry.trim().toUpperCase() !== 'TE') continue
    const emp = nameById.get(r.employee_id) ?? '?'
    // Neuester protokollierter Zellen-Wert dieses Tages (Liste ist neuste zuerst)
    const letzter = logEntries.find(l => l.kind === 'zelle' && l.datum === date && l.emp === emp)
    const neuWert = (letzter?.neu ?? '').trim()
    const altWert = (letzter?.old ?? '').trim()
    if (neuWert !== '' && neuWert.toUpperCase() !== 'TE') {
      // Letzter bekannter Stand VOR der Teamevent-Aktion
      vorschlaege.push({ employeeId: r.employee_id, emp, vorschlag: neuWert, quelle: 'protokoll' })
      continue
    }
    if (neuWert.toUpperCase() === 'TE' && altWert !== '' && altWert.toUpperCase() !== 'TE') {
      // Protokollierte Teamevent-Überschreibung: alt → TE — alt zurückholen
      vorschlaege.push({ employeeId: r.employee_id, emp, vorschlag: altWert, quelle: 'protokoll' })
      continue
    }
    if (neuWert.toUpperCase() === 'TE') {
      // bewusst von Hand auf «TE» gesetzt — so lassen
      vorschlaege.push({ employeeId: r.employee_id, emp, vorschlag: null, quelle: null })
      continue
    }
    const standard = standardFuer(standards[r.employee_id], isoDow, behandler.has(r.employee_id))
    vorschlaege.push(standard !== ''
      ? { employeeId: r.employee_id, emp, vorschlag: standard, quelle: 'standardwoche' }
      : { employeeId: r.employee_id, emp, vorschlag: null, quelle: null })
  }
  vorschlaege.sort((a, b) => a.emp.localeCompare(b.emp, 'de-CH'))

  if (!anwenden) return { vorschlaege }

  const wiederherstellbar = vorschlaege.filter(v => v.vorschlag != null)
  if (wiederherstellbar.length > 0) {
    const { error } = await adminClient.from('work_schedule').upsert(
      wiederherstellbar.map(v => ({ employee_id: v.employeeId, schedule_date: date, entry: v.vorschlag! })),
      { onConflict: 'employee_id,schedule_date' },
    )
    if (error) return { error: error.message }
  }
  const { error: unflagErr } = await adminClient
    .from('zeiterfassung_comments')
    .delete()
    .eq('user_full_name', TEAM_EVENT_KEY)
    .eq('schedule_date', date)
  if (unflagErr) return { error: unflagErr.message }

  await logPlanChanges(adminClient, [
    ...wiederherstellbar.map(v => ({ datum: date, kind: 'zelle' as const, emp: v.emp, old: 'TE', neu: v.vorschlag! })),
    { datum: date, kind: 'marker' as const, text: `Teamevent rückgängig gemacht (${wiederherstellbar.length} Einträge wiederhergestellt)` },
  ])
  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { vorschlaege, wiederhergestellt: wiederherstellbar.length }
}

/** Remove the Teamevent marker from a day («TE» entries stay). Editors only. */
export async function unflagTeamEventDay(date: string) {
  const adminClient = await requireEditor(date)
  const { error } = await adminClient
    .from('zeiterfassung_comments')
    .delete()
    .eq('user_full_name', TEAM_EVENT_KEY)
    .eq('schedule_date', date)
  if (error) return { error: error.message }
  await logPlanChanges(adminClient, [{ datum: date, kind: 'marker', text: 'Teamevent-Markierung entfernt' }])
  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true }
}

/** Remove the red "manual planning needed" flag from a day. Editors only. */
export async function unflagReviewDay(date: string) {
  const adminClient = await requireEditor(date)
  const { error } = await adminClient
    .from('schedule_review_days')
    .delete()
    .eq('schedule_date', date)
  if (error) return { error: error.message }
  await logPlanChanges(adminClient, [{ datum: date, kind: 'marker', text: 'Rote Markierung entfernt' }])
  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true }
}

/** Full name of the signed-in user (e.g. "Bianka Fitos").
 *  Login profiles don't always carry a clean "Vorname Nachname" (e.g. just
 *  "Fitos"), so single-word/empty names are resolved against the roster via
 *  the profile word(s) and the e-mail local part before falling back. */
async function currentFullName(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('profiles').select('full_name').eq('id', user.id).single()
  const own = ((data as { full_name?: string } | null)?.full_name ?? '').trim()
  const parts = own.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return own

  const adminClient = await createAdminClient()
  const { data: all } = await adminClient.from('profiles').select('full_name')
  const hay = `${own} ${(user.email ?? '').split('@')[0]}`.toLowerCase()
  for (const row of (all ?? []) as Array<{ full_name: string | null }>) {
    const ps = (row.full_name ?? '').trim().split(/\s+/).filter(Boolean)
    if (ps.length < 2) continue
    if (hay.includes(ps[0].toLowerCase()) && hay.includes(ps[1].toLowerCase())) {
      return (row.full_name ?? '').trim()
    }
  }
  return own || null
}

/** Kürzel der angemeldeten Person (z.B. «Bianka Fitos» → BF, feste Kürzel
 *  aus KUERZEL_FEST, z.B. LRG). */
async function currentInitials(): Promise<string | null> {
  return kuerzelFuer(await currentFullName())
}

// ── Änderungsprotokoll (admin-only view; see src/lib/plan-log.ts) ────────────

type PlanLogWrite = { datum: string; kind: PlanLogKind; emp?: string; old?: string; neu?: string; text?: string }

function clip(s: string): string {
  return s.length > 160 ? s.slice(0, 159) + '…' : s
}

/** Best-effort append to the plan change log — must never break the save. */
async function logPlanChanges(
  adminClient: Awaited<ReturnType<typeof createAdminClient>>,
  changes: PlanLogWrite[],
) {
  if (changes.length === 0) return
  try {
    const by = (await currentFullName()) ?? 'Unbekannt'
    const at = new Date().toISOString()
    const rows = changes.map(c => ({
      user_full_name: `${PLAN_LOG_PREFIX}${randomUUID().slice(0, 12)}`,
      schedule_date: c.datum,
      comment: JSON.stringify({
        at, by, kind: c.kind,
        ...(c.emp  != null ? { emp:  c.emp } : {}),
        ...(c.old  != null ? { old:  clip(c.old) } : {}),
        ...(c.neu  != null ? { neu:  clip(c.neu) } : {}),
        ...(c.text != null ? { text: clip(c.text) } : {}),
      }),
    }))
    await adminClient.from('zeiterfassung_comments').insert(rows)
  } catch { /* logging must never break the actual save */ }
}

async function employeeName(
  adminClient: Awaited<ReturnType<typeof createAdminClient>>,
  employeeId: string,
): Promise<string> {
  const { data } = await adminClient.from('profiles').select('full_name').eq('id', employeeId).single()
  return ((data as { full_name?: string } | null)?.full_name ?? '').trim() || 'Unbekannt'
}

/** Change log of the shown month for the admin popup (newest first). */
export async function getPlanAenderungen(year: number, month: number): Promise<{ entries?: PlanLogEntry[]; error?: string }> {
  try {
    const adminClient = await requireAdmin()
    const entries = await getPlanLogEntries(adminClient, year, month)
    return { entries }
  } catch {
    return { error: 'Keine Berechtigung.' }
  }
}

function encodeNote(text: string, by: string | null, to: string | null = null): string {
  return to ? JSON.stringify({ t: text, by, to }) : JSON.stringify({ t: text, by })
}

/** Current text of one reserved note row ('' if none) — for the change log. */
async function readNoteText(
  adminClient: Awaited<ReturnType<typeof createAdminClient>>,
  key: string,
  anchor: string,
): Promise<string> {
  const { data } = await adminClient
    .from('zeiterfassung_comments')
    .select('comment')
    .eq('user_full_name', key)
    .eq('schedule_date', anchor)
    .maybeSingle()
  const raw = (data as { comment?: string } | null)?.comment
  return raw ? parseNoteComment(raw).text : ''
}

/** Upsert or delete (empty note) one reserved note row. */
async function writeNoteRow(
  adminClient: Awaited<ReturnType<typeof createAdminClient>>,
  key: string,
  anchor: string,
  note: string,
) {
  if (note === '') {
    const { error } = await adminClient
      .from('zeiterfassung_comments')
      .delete()
      .eq('user_full_name', key)
      .eq('schedule_date', anchor)
    if (error) return { error: error.message }
  } else {
    const { error } = await adminClient
      .from('zeiterfassung_comments')
      .upsert(
        { user_full_name: key, schedule_date: anchor, comment: note, updated_at: new Date().toISOString() },
        { onConflict: 'user_full_name,schedule_date' },
      )
    if (error) return { error: error.message }
  }
  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true }
}

/** Save the planning note for a month (things to regard when doing the plan).
 *  The shared note is allowed for everyone who may edit that month's plan
 *  (admin, legacy can_edit_schedule, Leitende for released/published months);
 *  the admin-only note requires the admin role. An empty note deletes it. */
export async function upsertMonthPlanNote(year: number, month: number, note: string, adminOnly = false) {
  const adminClient = adminOnly
    ? await requireAdmin()
    : await requireEditor(monthAnchor(year, month))

  const trimmed = note.trim()
  if (trimmed.length > 2000) return { error: 'Notiz ist zu lang (max. 2000 Zeichen).' }

  const by  = trimmed ? await currentInitials() : null
  const key = adminOnly ? PLAN_NOTES_ADMIN_KEY : PLAN_NOTES_KEY
  const anchor  = monthAnchor(year, month)
  const oldText = await readNoteText(adminClient, key, anchor)
  const result  = await writeNoteRow(adminClient, key, anchor, trimmed ? encodeNote(trimmed, by) : '')
  if (!('error' in result) && oldText !== trimmed) {
    await logPlanChanges(adminClient, [{
      datum: anchor, kind: 'notiz',
      text: adminOnly ? 'Monatsnotiz (nur Admin)' : 'Monatsnotiz',
      old: oldText, neu: trimmed,
    }])
  }
  return result
}

/** Save a planning note for a day/day range, one or more calendar weeks, or a
 *  fraglicher Termin of the plan being viewed (ctxYear/ctxMonth authorize the
 *  caller). Week notes are anchored to the first week's Monday; a range end
 *  is stored as `to` in the payload (Sunday of the last week for weeks).
 *  An empty note deletes it. */
export async function upsertPlanPeriodNote(
  scope: 'day' | 'week' | 'question',
  anchorDate: string,
  note: string,
  ctxYear: number,
  ctxMonth: number,
  toDate?: string | null,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) return { error: 'Ungültiges Datum.' }
  if (toDate && !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return { error: 'Ungültiges Bis-Datum.' }
  const adminClient = await requireEditor(monthAnchor(ctxYear, ctxMonth))

  const trimmed = note.trim()
  if (trimmed.length > 500) return { error: 'Notiz ist zu lang (max. 500 Zeichen).' }

  const by     = trimmed ? await currentInitials() : null
  const anchor = scope === 'week' ? mondayOf(anchorDate) : anchorDate
  let to: string | null = null
  if (toDate) {
    to = scope === 'week' ? sundayOf(toDate) : toDate
    if (to < anchor) return { error: 'Das Bis-Datum liegt vor dem Von-Datum.' }
    // a single day / single week needs no range
    if (scope !== 'week' && to === anchor) to = null
    if (scope === 'week' && to === sundayOf(anchor)) to = null
  }
  const key = scope === 'week' ? PLAN_WEEK_NOTE_KEY : scope === 'question' ? PLAN_QUESTION_KEY : PLAN_DAY_NOTE_KEY
  const oldText = await readNoteText(adminClient, key, anchor)
  const result  = await writeNoteRow(adminClient, key, anchor, trimmed ? encodeNote(trimmed, by, to) : '')
  if (!('error' in result) && oldText !== trimmed) {
    await logPlanChanges(adminClient, [{
      datum: anchor, kind: 'notiz',
      text: scope === 'week' ? 'Wochennotiz' : scope === 'question' ? 'Fraglicher Termin' : 'Tagesnotiz',
      old: oldText, neu: trimmed,
    }])
  }
  return result
}

/** Kürzel für einen neuen Eintrag: das eigene, oder ein im Fenster
 *  gewähltes (zum Beispiel wenn die Admin für eine Leitende notiert); dann
 *  wird das eigene Kürzel als «bearbeitet von» vermerkt. */
async function kuerzelWahl(gewuenscht: string | null | undefined): Promise<{ by: string | null; ich: string | null; geaendert: string | null } | { error: string }> {
  const ich = await currentInitials()
  if (gewuenscht === undefined) return { by: ich, ich, geaendert: null }
  const by = (gewuenscht ?? '').trim().toUpperCase() || null
  if (by && !/^[A-ZÄÖÜ]{1,5}$/.test(by)) return { error: `Ungültiges Kürzel «${by}».` }
  return { by, ich, geaendert: ich && ich !== by ? ich : null }
}

/** Notiz zu einem Tag, einer Woche oder einem fraglichen Termin: einen
 *  Eintrag anfügen (index null) oder einen bestehenden Eintrag ändern
 *  (leerer Text löscht ihn). Jeder Eintrag trägt automatisch das Kürzel und
 *  den Zeitpunkt der Person, die ihn geschrieben hat, so können Admin und
 *  Leitende zum selben Tag nacheinander notieren, ohne sich zu
 *  überschreiben. `to` zählt nur beim ersten Eintrag eines Tages. */
export async function planNotizEintrag(
  scope: 'day' | 'week' | 'question',
  anchorDate: string,
  ctxYear: number,
  ctxMonth: number,
  eintrag: { index: number | null; text: string; to?: string | null; by?: string | null },
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) return { error: 'Ungültiges Datum.' }
  const toDate = eintrag?.to ?? null
  if (toDate && !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return { error: 'Ungültiges Bis-Datum.' }
  const adminClient = await requireEditor(monthAnchor(ctxYear, ctxMonth))

  const text = (eintrag?.text ?? '').trim()
  if (text.length > 500) return { error: 'Notiz ist zu lang (max. 500 Zeichen).' }
  const index = eintrag?.index ?? null
  if (index != null && (!Number.isInteger(index) || index < 0)) return { error: 'Ungültiger Eintrag.' }
  if (index == null && !text) return { error: 'Bitte einen Text eingeben.' }

  const key    = scope === 'week' ? PLAN_WEEK_NOTE_KEY : scope === 'question' ? PLAN_QUESTION_KEY : PLAN_DAY_NOTE_KEY
  const anchor = scope === 'week' ? mondayOf(anchorDate) : anchorDate
  const { data } = await adminClient
    .from('zeiterfassung_comments')
    .select('comment')
    .eq('user_full_name', key)
    .eq('schedule_date', anchor)
    .maybeSingle()
  const raw    = (data as { comment?: string } | null)?.comment
  const bisher = raw ? parseNoteComment(raw) : leereNotiz()
  if (index != null && index >= bisher.eintraege.length) return { error: 'Dieser Eintrag ist nicht mehr da — bitte die Seite neu laden.' }

  let to: string | null = bisher.eintraege.length > 0 ? bisher.to : null
  if (bisher.eintraege.length === 0 && toDate) {
    to = scope === 'week' ? sundayOf(toDate) : toDate
    if (to < anchor) return { error: 'Das Bis-Datum liegt vor dem Von-Datum.' }
    if (scope !== 'week' && to === anchor) to = null
    if (scope === 'week' && to === sundayOf(anchor)) to = null
  }

  const k = await kuerzelWahl(eintrag.by)
  if ('error' in k) return k
  const eintraege = index == null
    ? eintragAnfuegen(bisher.eintraege, text, k.by, new Date().toISOString(), k.geaendert)
    : eintragAendern(bisher.eintraege, index, text, k.ich)
  const gespeichert = eintraege.length ? encodeNoteEntries(eintraege, to) : ''
  const neu = gespeichert ? parseNoteComment(gespeichert) : leereNotiz()
  const result = await writeNoteRow(adminClient, key, anchor, gespeichert)
  if ('error' in result && result.error) return { error: result.error }
  if (bisher.text !== neu.text) {
    await logPlanChanges(adminClient, [{
      datum: anchor, kind: 'notiz',
      text: scope === 'week' ? 'Wochennotiz' : scope === 'question' ? 'Fraglicher Termin' : 'Tagesnotiz',
      old: bisher.text, neu: neu.text,
    }])
  }
  return { success: true as const, anchor, note: neu.text, by: neu.by, to: neu.to, eintraege: neu.eintraege }
}

/** Monatsnotiz (Admin + Leitende) als Einträge mit Kürzel: einen Eintrag
 *  anfügen (index null) oder einen bestehenden ändern (leerer Text löscht
 *  ihn). Dieselbe Logik wie planNotizEintrag, nur für den Monat. */
export async function planMonatsnotizEintrag(year: number, month: number, eintrag: { index: number | null; text: string; by?: string | null }) {
  const anchor = monthAnchor(year, month)
  const adminClient = await requireEditor(anchor)
  const text = (eintrag?.text ?? '').trim()
  if (text.length > 1000) return { error: 'Notiz ist zu lang (max. 1000 Zeichen).' }
  const index = eintrag?.index ?? null
  if (index != null && (!Number.isInteger(index) || index < 0)) return { error: 'Ungültiger Eintrag.' }
  if (index == null && !text) return { error: 'Bitte einen Text eingeben.' }

  const { data } = await adminClient
    .from('zeiterfassung_comments')
    .select('comment')
    .eq('user_full_name', PLAN_NOTES_KEY)
    .eq('schedule_date', anchor)
    .maybeSingle()
  const raw    = (data as { comment?: string } | null)?.comment
  const bisher = raw ? parseNoteComment(raw) : leereNotiz()
  if (index != null && index >= bisher.eintraege.length) return { error: 'Dieser Eintrag ist nicht mehr da — bitte die Seite neu laden.' }

  const k = await kuerzelWahl(eintrag.by)
  if ('error' in k) return k
  const eintraege = index == null
    ? eintragAnfuegen(bisher.eintraege, text, k.by, new Date().toISOString(), k.geaendert)
    : eintragAendern(bisher.eintraege, index, text, k.ich)
  const gespeichert = eintraege.length ? encodeNoteEntries(eintraege, null) : ''
  const neu = gespeichert ? parseNoteComment(gespeichert) : leereNotiz()
  const result = await writeNoteRow(adminClient, PLAN_NOTES_KEY, anchor, gespeichert)
  if ('error' in result && result.error) return { error: result.error }
  if (bisher.text !== neu.text) {
    await logPlanChanges(adminClient, [{ datum: anchor, kind: 'notiz', text: 'Monatsnotiz', old: bisher.text, neu: neu.text }])
  }
  return { success: true as const, note: neu }
}

/** Eine alte Monatsnotiz (Textblock) in Einträge pro Tag umwandeln, nach
 *  der Vorschau der Admin: jede Zeile wird ein Eintrag mit dem Kürzel vom
 *  Zeilenende und ohne Zeit (die ist nicht bekannt). Zeilen ohne Tag
 *  bleiben als Einträge in der Monatsnotiz. Die bisherige Monatsnotiz wird
 *  vorher unverändert als Sicherung abgelegt (__plan_notiz_alt_…), damit
 *  nichts verloren gehen kann. Nur Admin. */
export async function monatsnotizUmwandeln(
  year: number,
  month: number,
  items: Array<{ scope: 'day' | 'week' | 'month'; anchor: string | null; to: string | null; by: string | null; text: string }>,
) {
  const adminClient = await requireAdmin()
  const monthStart = monthAnchor(year, month)
  const mm = String(month).padStart(2, '0')
  if (!Array.isArray(items) || items.length === 0) return { error: 'Keine Einträge zum Umwandeln.' }
  const sauber: Array<{ scope: 'day' | 'week' | 'month'; anchor: string | null; to: string | null; by: string | null; text: string }> = []
  for (const it of items) {
    const text = (it?.text ?? '').trim()
    if (!text) continue
    if (text.length > 1000) return { error: 'Ein Eintrag ist zu lang (max. 1000 Zeichen).' }
    const by = (it.by ?? '').trim().toUpperCase() || null
    if (by && !/^[A-ZÄÖÜ]{1,5}$/.test(by)) return { error: `Ungültiges Kürzel «${by}».` }
    if (it.scope === 'month') { sauber.push({ scope: 'month', anchor: null, to: null, by, text }); continue }
    if (!it.anchor || !/^\d{4}-\d{2}-\d{2}$/.test(it.anchor)) return { error: 'Ein Eintrag hat keinen gültigen Tag.' }
    if (it.scope === 'day' && !it.anchor.startsWith(`${year}-${mm}`)) return { error: 'Ein Tag liegt ausserhalb des Monats.' }
    let to: string | null = null
    if (it.scope === 'day' && it.to) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(it.to) || it.to < it.anchor) return { error: 'Ein Bis-Datum liegt vor dem Von-Datum.' }
      to = it.to === it.anchor ? null : it.to
    }
    sauber.push({ scope: it.scope, anchor: it.scope === 'week' ? mondayOf(it.anchor) : it.anchor, to, by, text })
  }
  if (sauber.length === 0) return { error: 'Keine Einträge zum Umwandeln.' }

  // Bisherige Monatsnotiz lesen und sichern
  const { data } = await adminClient
    .from('zeiterfassung_comments')
    .select('comment')
    .eq('user_full_name', PLAN_NOTES_KEY)
    .eq('schedule_date', monthStart)
    .maybeSingle()
  const raw = (data as { comment?: string } | null)?.comment ?? ''
  if (!raw) return { error: 'Für diesen Monat gibt es keine Monatsnotiz mehr — bitte die Seite neu laden.' }
  const am = new Date().toISOString()
  const { error: sErr } = await adminClient.from('zeiterfassung_comments').upsert(
    { user_full_name: `__plan_notiz_alt_${Date.now().toString(36)}__`, schedule_date: monthStart, comment: raw, updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (sErr) return { error: `Sicherung fehlgeschlagen: ${sErr.message}` }

  // Nach Tag beziehungsweise Woche gruppieren und an bestehende Notizen anfügen
  const gruppen = new Map<string, { key: string; anchor: string; to: string | null; eintraege: NoteEntry[] }>()
  const monatsEintraege: NoteEntry[] = []
  for (const it of sauber) {
    if (it.scope === 'month' || !it.anchor) { monatsEintraege.push({ text: it.text, by: it.by, at: null, geaendert: null }); continue }
    const key = it.scope === 'week' ? PLAN_WEEK_NOTE_KEY : PLAN_DAY_NOTE_KEY
    const id = `${key}|${it.anchor}`
    const g = gruppen.get(id) ?? { key, anchor: it.anchor, to: it.to, eintraege: [] }
    g.eintraege.push({ text: it.text, by: it.by, at: null, geaendert: null })
    gruppen.set(id, g)
  }
  for (const g of Array.from(gruppen.values())) {
    const { data: row } = await adminClient
      .from('zeiterfassung_comments')
      .select('comment')
      .eq('user_full_name', g.key)
      .eq('schedule_date', g.anchor)
      .maybeSingle()
    const bisher = (row as { comment?: string } | null)?.comment ? parseNoteComment((row as { comment: string }).comment) : leereNotiz()
    const eintraege = [...bisher.eintraege, ...g.eintraege]
    const to = bisher.eintraege.length ? bisher.to : g.to
    const r = await writeNoteRow(adminClient, g.key, g.anchor, encodeNoteEntries(eintraege, to))
    if ('error' in r && r.error) return { error: r.error }
  }
  const r = await writeNoteRow(adminClient, PLAN_NOTES_KEY, monthStart, monatsEintraege.length ? encodeNoteEntries(monatsEintraege, null) : '')
  if ('error' in r && r.error) return { error: r.error }
  await logPlanChanges(adminClient, [{
    datum: monthStart, kind: 'notiz', text: 'Monatsnotiz in Notizen pro Tag umgewandelt',
    old: parseNoteComment(raw).text, neu: `${sauber.length} Einträge (${gruppen.size} Tage/Wochen, ${monatsEintraege.length} im Monat)`,
  }])
  return { success: true as const, anzahl: sauber.length }
}

export type NotizScope = 'day' | 'week' | 'question' | 'month'
const notizKey = (scope: NotizScope) =>
  scope === 'month' ? PLAN_NOTES_KEY : scope === 'week' ? PLAN_WEEK_NOTE_KEY : scope === 'question' ? PLAN_QUESTION_KEY : PLAN_DAY_NOTE_KEY

/** Einen bestehenden Eintrag bearbeiten: Text, Kürzel sowie Tag, Zeitraum,
 *  Woche oder Monat, dem er gilt. Wechselt der Tag, wandert der Eintrag
 *  mit seiner Schreibzeit in die Notiz des neuen Tages. Ändert jemand
 *  anderes als die genannte Verfasserin Text oder Kürzel, wird das Kürzel
 *  der ändernden Person vermerkt. Der Zeitraum eines Tages folgt dem
 *  Fenster nur, wenn der Eintrag dort allein steht (sonst gilt der
 *  bestehende Zeitraum für alle Einträge des Tages). */
export async function planNotizEintragBearbeiten(
  year: number,
  month: number,
  von: { scope: NotizScope; anchor: string | null; index: number },
  neu: { scope: NotizScope; anchor: string | null; to: string | null; by: string | null; text: string },
) {
  const monthStart = monthAnchor(year, month)
  const mm = String(month).padStart(2, '0')
  const istDatum = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)
  const ankerFuer = (scope: NotizScope, a: string | null): string | null =>
    scope === 'month' ? monthStart : !istDatum(a) ? null : scope === 'week' ? mondayOf(a) : a
  const qAnker = ankerFuer(von?.scope, von?.anchor ?? null)
  const zAnker = ankerFuer(neu?.scope, neu?.anchor ?? null)
  if (!qAnker || !zAnker) return { error: 'Ungültiges Datum.' }
  if (!Number.isInteger(von.index) || von.index < 0) return { error: 'Ungültiger Eintrag.' }
  if ((neu.scope === 'day' || neu.scope === 'question') && !zAnker.startsWith(`${year}-${mm}`)) return { error: 'Der Tag muss im angezeigten Monat liegen.' }
  const text = (neu.text ?? '').trim()
  if (!text) return { error: 'Bitte einen Text eingeben, zum Entfernen «Löschen» verwenden.' }
  if (text.length > 1000) return { error: 'Notiz ist zu lang (max. 1000 Zeichen).' }
  const by = (neu.by ?? '').trim().toUpperCase() || null
  if (by && !/^[A-ZÄÖÜ]{1,5}$/.test(by)) return { error: `Ungültiges Kürzel «${by}».` }
  let zuTo: string | null = null
  if (neu.to && neu.scope !== 'month') {
    if (!istDatum(neu.to)) return { error: 'Ungültiges Bis-Datum.' }
    zuTo = neu.scope === 'week' ? sundayOf(neu.to) : neu.to
    if (zuTo < zAnker) return { error: 'Das Bis-Datum liegt vor dem Von-Datum.' }
    if ((neu.scope === 'week' && zuTo === sundayOf(zAnker)) || (neu.scope !== 'week' && zuTo === zAnker)) zuTo = null
  }

  const adminClient = await requireEditor(monthStart)
  const qKey = notizKey(von.scope), zKey = notizKey(neu.scope)
  const lese = async (key: string, anchor: string) => {
    const { data } = await adminClient.from('zeiterfassung_comments').select('comment').eq('user_full_name', key).eq('schedule_date', anchor).maybeSingle()
    const raw = (data as { comment?: string } | null)?.comment
    return raw ? parseNoteComment(raw) : leereNotiz()
  }
  const quelle = await lese(qKey, qAnker)
  const alt = quelle.eintraege[von.index]
  if (!alt) return { error: 'Dieser Eintrag ist nicht mehr da — bitte die Seite neu laden.' }
  const ich = await currentInitials()
  const veraendert = text !== alt.text || by !== alt.by
  const eintrag: NoteEntry = { text, by, at: alt.at, geaendert: veraendert ? (ich && ich !== by ? ich : null) : alt.geaendert }
  const gleich = qKey === zKey && qAnker === zAnker

  type Zeile = { scope: NotizScope; anchor: string; note: string; by: string | null; to: string | null; eintraege: NoteEntry[] }
  const zeilen: Zeile[] = []
  const schreibe = async (scope: NotizScope, key: string, anchor: string, eintraege: NoteEntry[], to: string | null) => {
    const raw = eintraege.length ? encodeNoteEntries(eintraege, scope === 'month' ? null : to) : ''
    const r = await writeNoteRow(adminClient, key, anchor, raw)
    if ('error' in r && r.error) throw new Error(r.error)
    const n = raw ? parseNoteComment(raw) : leereNotiz()
    zeilen.push({ scope, anchor, note: n.text, by: n.by, to: n.to, eintraege: n.eintraege })
  }
  try {
    if (gleich) {
      const eintraege = quelle.eintraege.map((e, i) => (i === von.index ? eintrag : e))
      await schreibe(neu.scope, zKey, zAnker, eintraege, eintraege.length === 1 ? zuTo : quelle.to)
    } else {
      await schreibe(von.scope, qKey, qAnker, quelle.eintraege.filter((_, i) => i !== von.index), quelle.to)
      const ziel = await lese(zKey, zAnker)
      await schreibe(neu.scope, zKey, zAnker, [...ziel.eintraege, eintrag], ziel.eintraege.length ? ziel.to : zuTo)
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Speichern fehlgeschlagen.' }
  }
  await logPlanChanges(adminClient, [{
    datum: zAnker, kind: 'notiz', text: gleich ? 'Notiz geändert' : 'Notiz verschoben',
    old: `${alt.by ? `${alt.by}: ` : ''}${alt.text}`, neu: `${by ? `${by}: ` : ''}${text}`,
  }])
  return { success: true as const, zeilen }
}

function monthDays(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
function dstr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
async function loadMonthEntries(
  adminClient: Awaited<ReturnType<typeof createAdminClient>>,
  year: number,
  month: number,
) {
  const { data } = await adminClient
    .from('work_schedule')
    .select('employee_id, schedule_date, entry')
    .gte('schedule_date', dstr(year, month, 1))
    .lte('schedule_date', dstr(year, month, monthDays(year, month)))
  return (data ?? []) as Array<{ employee_id: string; schedule_date: string; entry: string }>
}

// Month-specific absence/event codes that must NOT be carried over when
// copying a previous month's pattern.
const NO_COPY = new Set(['K', 'KO', 'WB', 'ÜK', 'UK'])
function isCopyable(entry: string): boolean {
  const v = entry.trim().toUpperCase()
  if (!v) return false
  if (NO_COPY.has(v)) return false
  if (ferienWeight(v) != null) return false
  return true
}

/** Copy the previous month's plan into the given month (existing entries are
 *  overwritten, planned Ferien days excepted), matching weekday occurrences
 *  (2nd Monday ← 2nd Monday, …). Absence codes (F, K, KO, WB) are never
 *  copied. Editors only. */
export async function copyPreviousMonth(year: number, month: number) {
  const adminClient = await requireEditor(monthAnchor(year, month))

  let py = year, pm = month - 1
  if (pm < 1) { pm = 12; py-- }

  const [prevEntries, targetEntries] = await Promise.all([
    loadMonthEntries(adminClient, py, pm),
    loadMonthEntries(adminClient, year, month),
  ])
  if (prevEntries.length === 0) return { error: 'Der Vormonat enthält keine Einträge.' }

  // Previous month: entries per employee per weekday, in day order
  const prevOcc = new Map<string, Map<number, string[]>>()
  for (const e of prevEntries.sort((a, b) => a.schedule_date.localeCompare(b.schedule_date))) {
    if (!isCopyable(e.entry)) continue
    const dow = new Date(e.schedule_date + 'T12:00:00Z').getUTCDay()
    if (!prevOcc.has(e.employee_id)) prevOcc.set(e.employee_id, new Map())
    const byDow = prevOcc.get(e.employee_id)!
    if (!byDow.has(dow)) byDow.set(dow, [])
    byDow.get(dow)!.push(e.entry)
  }

  // Planned Ferien in the target month are never overwritten
  const ferienCells = new Set(
    targetEntries
      .filter(e => ferienWeight(e.entry) != null)
      .map(e => `${e.employee_id}_${e.schedule_date}`)
  )
  const rows: Array<{ employee_id: string; schedule_date: string; entry: string }> = []
  const total = monthDays(year, month)
  const occIdx = new Map<number, number>()   // weekday → occurrence counter this month
  for (let d = 1; d <= total; d++) {
    const ds  = dstr(year, month, d)
    const dow = new Date(ds + 'T12:00:00Z').getUTCDay()
    const k   = occIdx.get(dow) ?? 0
    occIdx.set(dow, k + 1)
    for (const [empId, byDow] of Array.from(prevOcc.entries())) {
      if (ferienCells.has(`${empId}_${ds}`)) continue
      const list = byDow.get(dow)
      if (!list || list.length === 0) continue
      rows.push({ employee_id: empId, schedule_date: ds, entry: list[Math.min(k, list.length - 1)] })
    }
  }

  if (rows.length > 0) {
    const { error } = await adminClient
      .from('work_schedule')
      .upsert(rows, { onConflict: 'employee_id,schedule_date' })
    if (error) return { error: error.message }
  }

  await logPlanChanges(adminClient, [{
    datum: monthAnchor(year, month), kind: 'aktion',
    text: `Vormonat übernommen (${rows.length} Einträge)`,
  }])
  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true, filled: rows.length }
}

/** Fill empty cells of a month from the employees' Standardwochen. Editors only. */
export async function applyStandardWeeks(year: number, month: number) {
  const adminClient = await requireEditor(monthAnchor(year, month))

  const [standards, targetEntries, behandler] = await Promise.all([
    getStandardWeeks(adminClient),
    loadMonthEntries(adminClient, year, month),
    behandlerIds(adminClient),
  ])
  if (Object.keys(standards).length === 0) {
    return { error: 'Noch keine Standardwochen hinterlegt (Admin → Mitarbeiter-Standards).' }
  }

  const occupied = new Set(targetEntries.map(e => `${e.employee_id}_${e.schedule_date}`))
  const rows: Array<{ employee_id: string; schedule_date: string; entry: string }> = []
  const total = monthDays(year, month)
  for (let d = 1; d <= total; d++) {
    const ds     = dstr(year, month, d)
    const isoDow = String(((new Date(ds + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1)
    for (const [empId, week] of Object.entries(standards)) {
      const entry = standardFuer(week, isoDow, behandler.has(empId))
      if (!entry) continue
      if (occupied.has(`${empId}_${ds}`)) continue
      rows.push({ employee_id: empId, schedule_date: ds, entry })
    }
  }

  if (rows.length > 0) {
    const { error } = await adminClient
      .from('work_schedule')
      .upsert(rows, { onConflict: 'employee_id,schedule_date' })
    if (error) return { error: error.message }
  }

  await logPlanChanges(adminClient, [{
    datum: monthAnchor(year, month), kind: 'aktion',
    text: `Standardwochen angewendet (${rows.length} Einträge)`,
  }])
  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true, filled: rows.length }
}

/** Copy one day's column onto another day of the same month (the target day
 *  becomes an exact copy of the source day). Editors only. */
export async function copyScheduleDay(year: number, month: number, fromDay: number, toDay: number) {
  const adminClient = await requireEditor(monthAnchor(year, month))
  const total = monthDays(year, month)
  if (fromDay < 1 || fromDay > total || toDay < 1 || toDay > total || fromDay === toDay) {
    return { error: 'Ungültige Tage.' }
  }
  const fromDs = dstr(year, month, fromDay)
  const toDs   = dstr(year, month, toDay)

  const { data: srcRows, error: srcError } = await adminClient
    .from('work_schedule')
    .select('employee_id, entry')
    .eq('schedule_date', fromDs)
  if (srcError) return { error: srcError.message }

  // Alten Stand des Zieltags festhalten, BEVOR er ersetzt wird — jede
  // veränderte Zelle wird einzeln protokolliert (alt → neu), damit ein
  // Versehen aus dem Änderungsprotokoll rekonstruierbar bleibt
  const { data: oldRows } = await adminClient
    .from('work_schedule')
    .select('employee_id, entry')
    .eq('schedule_date', toDs)

  const { error: delError } = await adminClient
    .from('work_schedule')
    .delete()
    .eq('schedule_date', toDs)
  if (delError) return { error: delError.message }

  const rows = ((srcRows ?? []) as Array<{ employee_id: string; entry: string }>)
    .map(r => ({ employee_id: r.employee_id, schedule_date: toDs, entry: r.entry }))
  if (rows.length > 0) {
    const { error } = await adminClient.from('work_schedule').insert(rows)
    if (error) return { error: error.message }
  }

  const altById = new Map(((oldRows ?? []) as Array<{ employee_id: string; entry: string }>).map(r => [r.employee_id, r.entry.trim()]))
  const neuById = new Map(rows.map(r => [r.employee_id, r.entry.trim()]))
  const beteiligte = Array.from(new Set([...Array.from(altById.keys()), ...Array.from(neuById.keys())]))
  const geaendert = beteiligte.filter(id => (altById.get(id) ?? '') !== (neuById.get(id) ?? ''))
  const zellenLogs: Array<{ datum: string; kind: 'zelle'; emp: string; old: string; neu: string }> = []
  if (geaendert.length > 0) {
    const { data: profs } = await adminClient.from('profiles').select('id, full_name').in('id', geaendert)
    const nameById = new Map(((profs ?? []) as Array<{ id: string; full_name: string }>).map(p => [p.id, p.full_name]))
    for (const id of geaendert) {
      zellenLogs.push({
        datum: toDs, kind: 'zelle',
        emp: nameById.get(id) ?? '?',
        old: altById.get(id) ?? '', neu: neuById.get(id) ?? '',
      })
    }
  }

  await logPlanChanges(adminClient, [
    ...zellenLogs,
    {
      datum: toDs, kind: 'aktion',
      text: `Tag ${fromDay}. auf Tag ${toDay}. kopiert (${rows.length} Einträge)`,
    },
  ])
  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true, filled: rows.length }
}

/** Apply one value to Mo–Fr of the week containing `date` for one employee
 *  (same month only). Planned Ferien days are never overwritten. Editors only. */
export async function applyWeekValue(employeeId: string, date: string, entry: string) {
  const adminClient = await requireEditor(date)
  const value = entry.trim()
  if (!value) return { error: 'Kein Wert zum Übernehmen.' }

  const monday = mondayOf(date)
  const monthPrefix = date.slice(0, 7)
  const targets: string[] = []
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + i)
    const ds = d.toISOString().slice(0, 10)
    if (ds.startsWith(monthPrefix)) targets.push(ds)
  }
  if (targets.length === 0) return { error: 'Keine Werktage in diesem Monat.' }

  const { data: existing } = await adminClient
    .from('work_schedule')
    .select('schedule_date, entry')
    .eq('employee_id', employeeId)
    .in('schedule_date', targets)
  const ferienDays = new Set(
    ((existing ?? []) as Array<{ schedule_date: string; entry: string }>)
      .filter(r => ferienWeight(r.entry) != null)
      .map(r => r.schedule_date)
  )

  const rows = targets
    .filter(ds => !ferienDays.has(ds))
    .map(ds => ({ employee_id: employeeId, schedule_date: ds, entry: value }))
  if (rows.length > 0) {
    const { error } = await adminClient
      .from('work_schedule')
      .upsert(rows, { onConflict: 'employee_id,schedule_date' })
    if (error) return { error: error.message }
  }

  const oldByDay = new Map(
    ((existing ?? []) as Array<{ schedule_date: string; entry: string }>)
      .map(r => [r.schedule_date, r.entry.trim()])
  )
  const changed = rows.filter(r => (oldByDay.get(r.schedule_date) ?? '') !== r.entry)
  if (changed.length > 0) {
    const emp = await employeeName(adminClient, employeeId)
    await logPlanChanges(adminClient, changed.map(r => ({
      datum: r.schedule_date, kind: 'zelle' as const, emp,
      old: oldByDay.get(r.schedule_date) ?? '', neu: r.entry,
    })))
  }

  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true, filled: rows.length, skippedFerien: ferienDays.size }
}

/** Roll saved Standardwochen into every future month (next month through
 *  December of next year): empty cells get the new standard, cells still
 *  holding the PREVIOUS standard follow the new rule (updated, or cleared
 *  when the rule was removed). Ferien and manual entries stay untouched. */
async function applyStandardsToFutureMonths(
  adminClient: Awaited<ReturnType<typeof createAdminClient>>,
  before: Record<string, Record<string, string>>,
  after: Record<string, Record<string, string>>,
): Promise<number> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })
  let y = Number(today.slice(0, 4))
  let m = Number(today.slice(5, 7)) + 1
  if (m > 12) { m = 1; y++ }
  const months: Array<[number, number]> = []
  const endYear = Number(today.slice(0, 4)) + 1
  while (y < endYear || (y === endYear && m <= 12)) {
    months.push([y, m])
    m++
    if (m > 12) { m = 1; y++ }
  }

  const [monthEntries, behandler] = await Promise.all([
    Promise.all(months.map(([yy, mm]) => loadMonthEntries(adminClient, yy, mm))),
    behandlerIds(adminClient),
  ])

  let total = 0
  const logRows: PlanLogWrite[] = []
  for (let i = 0; i < months.length; i++) {
    const [yy, mm] = months[i]
    const byCell = new Map(monthEntries[i].map(e => [`${e.employee_id}_${e.schedule_date}`, e.entry.trim()]))
    const upserts: Array<{ employee_id: string; schedule_date: string; entry: string }> = []
    const clears = new Map<string, string[]>()   // employee_id → dates to clear

    const total_days = monthDays(yy, mm)
    for (let d = 1; d <= total_days; d++) {
      const ds     = dstr(yy, mm, d)
      const isoDow = String(((new Date(ds + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1)
      for (const [empId, week] of Object.entries(after)) {
        // Behandler: «%» im Standard heisst leer; so räumt das Speichern
        // der Standards ein altes «%» aus den künftigen Monaten weg
        const neu = standardFuer(week, isoDow, behandler.has(empId))
        const alt = ((before[empId] ?? {})[isoDow] ?? '').trim()
        const cur = byCell.get(`${empId}_${ds}`) ?? ''
        if (cur === '') {
          if (neu) upserts.push({ employee_id: empId, schedule_date: ds, entry: neu })
        } else if (alt && cur === alt && neu !== alt) {
          // cell still holds the old standard → follow the new rule
          if (neu) upserts.push({ employee_id: empId, schedule_date: ds, entry: neu })
          else {
            if (!clears.has(empId)) clears.set(empId, [])
            clears.get(empId)!.push(ds)
          }
        }
        // anything else (Ferien, manual entries) stays untouched
      }
    }

    let changed = 0
    if (upserts.length > 0) {
      const { error } = await adminClient
        .from('work_schedule')
        .upsert(upserts, { onConflict: 'employee_id,schedule_date' })
      if (!error) changed += upserts.length
    }
    for (const [empId, dates] of Array.from(clears.entries())) {
      const { error } = await adminClient
        .from('work_schedule')
        .delete()
        .eq('employee_id', empId)
        .in('schedule_date', dates)
      if (!error) changed += dates.length
    }

    if (changed > 0) {
      total += changed
      logRows.push({
        datum: monthAnchor(yy, mm), kind: 'aktion',
        text: `Standardwochen aktualisiert (${changed} Einträge)`,
      })
    }
  }

  await logPlanChanges(adminClient, logRows)
  return total
}

/** Save ALL Standardwochen at once and apply them to future months.
 *  Admin-only. `weeks` = entry per ISO weekday 1–7 per employee id. */
export async function saveAllStandardWeeks(weeks: Record<string, Record<string, string>>) {
  const adminClient = await requireAdmin()

  const clean: Record<string, Record<string, string>> = {}
  for (const [empId, week] of Object.entries(weeks ?? {})) {
    if (!empId) continue
    const c: Record<string, string> = {}
    for (let i = 1; i <= 7; i++) {
      const v = (week?.[String(i)] ?? '').trim()
      if (v) {
        if (v.length > 10) return { error: `Eintrag zu lang (max. 10 Zeichen): «${v.slice(0, 20)}»` }
        c[String(i)] = v
      }
    }
    clean[empId] = c
  }
  if (Object.keys(clean).length === 0) return { error: 'Keine Daten zum Speichern.' }

  const before = await getStandardWeeks(adminClient)

  const rows = Object.entries(clean)
    .filter(([, week]) => Object.keys(week).length > 0)
    .map(([empId, week]) => ({
      user_full_name: `${STD_WEEK_PREFIX}${empId}`,
      schedule_date: STD_WEEK_DATE,
      comment: JSON.stringify(week),
      updated_at: new Date().toISOString(),
    }))
  if (rows.length > 0) {
    const { error } = await adminClient
      .from('zeiterfassung_comments')
      .upsert(rows, { onConflict: 'user_full_name,schedule_date' })
    if (error) return { error: error.message }
  }
  const emptyKeys = Object.entries(clean)
    .filter(([empId, week]) => Object.keys(week).length === 0 && Object.keys(before[empId] ?? {}).length > 0)
    .map(([empId]) => `${STD_WEEK_PREFIX}${empId}`)
  if (emptyKeys.length > 0) {
    const { error } = await adminClient
      .from('zeiterfassung_comments')
      .delete()
      .in('user_full_name', emptyKeys)
      .eq('schedule_date', STD_WEEK_DATE)
    if (error) return { error: error.message }
  }

  const filled = await applyStandardsToFutureMonths(adminClient, before, clean)

  revalidatePath('/admin/arbeitsplan/standards')
  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true, filled }
}

/** Unpublish a month (revert to draft). */
export async function unpublishMonth(year: number, month: number) {
  const adminClient = await requireAdmin()
  const { error } = await adminClient
    .from('schedule_publications')
    .delete()
    .eq('year', year)
    .eq('month', month)
  if (error) return { error: error.message }
  await logPlanChanges(adminClient, [{ datum: monthAnchor(year, month), kind: 'status', text: 'Veröffentlichung aufgehoben' }])
  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true }
}
