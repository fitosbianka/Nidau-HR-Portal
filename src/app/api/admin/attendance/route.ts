import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createAuthClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logZeitChange, zurichDateOf, zurichTimeOf } from '@/lib/zeit-log'

// Every change to attendance times must reach the employees' own
// "Meine Zeiten" pages and the admin views immediately.
function revalidateZeitPages() {
  revalidatePath('/admin/zeiterfassung/berichte')
  revalidatePath('/admin/zeiterfassung/kontrolle')
  revalidatePath('/employee/zeiterfassung')
}

// The middleware only role-guards page routes, so every handler here must
// verify the admin role itself before touching attendance data.
async function requireAdmin(): Promise<NextResponse | null> {
  const auth = await createAuthClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const { data: profile } = await auth.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
  }
  return null
}

// PATCH /api/admin/attendance
// Body: { timemoto_event_id: string, time_logged: string }  (time_logged as UTC ISO)
export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { timemoto_event_id, time_logged } = body as { timemoto_event_id?: string; time_logged?: string }

  if (!timemoto_event_id || !time_logged) {
    return NextResponse.json({ error: 'Missing timemoto_event_id or time_logged' }, { status: 400 })
  }

  // Validate ISO date string
  const parsed = new Date(time_logged)
  if (isNaN(parsed.getTime())) {
    return NextResponse.json({ error: 'Invalid time_logged format' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Previous state — for the change log
  const { data: prev } = await supabase
    .from('attendance_events')
    .select('user_full_name, clocking_type, time_logged')
    .eq('timemoto_event_id', timemoto_event_id)
    .maybeSingle()

  const { error } = await supabase
    .from('attendance_events')
    .update({ time_logged: parsed.toISOString() })
    .eq('timemoto_event_id', timemoto_event_id)

  if (error) {
    console.error('[admin/attendance PATCH]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const p = prev as { user_full_name: string | null; clocking_type: string | null; time_logged: string | null } | null
  if (p?.time_logged && p.time_logged !== parsed.toISOString()) {
    await logZeitChange(supabase, {
      datum: zurichDateOf(p.time_logged),
      emp: p.user_full_name ?? '?',
      text: `${p.clocking_type === 'In' ? 'Einstempeln' : 'Ausstempeln'} ${zurichTimeOf(p.time_logged)} → ${zurichTimeOf(parsed.toISOString())}`,
    })
  }
  revalidateZeitPages()

  return NextResponse.json({ ok: true })
}

// POST /api/admin/attendance
// Body: { userFullName: string, clockIn: string (UTC ISO), clockOut?: string | null }
// Creates a manual shift entry (an In event and optionally an Out event
// sharing one pair id) that behaves exactly like a TimeMoto entry.
export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { userFullName, clockIn, clockOut } = body as { userFullName?: string; clockIn?: string; clockOut?: string | null }
  if (!userFullName || !clockIn) {
    return NextResponse.json({ error: 'Mitarbeiter und Einstempel-Zeit sind erforderlich' }, { status: 400 })
  }
  const inDate = new Date(clockIn)
  if (isNaN(inDate.getTime())) {
    return NextResponse.json({ error: 'Ungültige Einstempel-Zeit' }, { status: 400 })
  }
  let outDate: Date | null = null
  if (clockOut) {
    outDate = new Date(clockOut)
    if (isNaN(outDate.getTime())) return NextResponse.json({ error: 'Ungültige Ausstempel-Zeit' }, { status: 400 })
    if (outDate.getTime() <= inDate.getTime()) {
      return NextResponse.json({ error: 'Ausstempeln muss nach dem Einstempeln liegen' }, { status: 400 })
    }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Link the profile: exact name first, then first-name match (bridges
  // variants like "Laura Gerisch" vs "Laura Gerisch-Rudin")
  let employeeId: string | null = null
  const { data: exact } = await supabase.from('profiles').select('id').eq('full_name', userFullName).maybeSingle()
  employeeId = exact?.id ?? null
  if (!employeeId) {
    const { data: byFirst } = await supabase.from('profiles').select('id, full_name').ilike('full_name', `${userFullName.split(' ')[0]}%`).limit(2)
    if (byFirst?.length === 1) employeeId = byFirst[0].id
  }

  const stamp  = Date.now()
  const pairId = `manualpair_${stamp}`
  const rows = [{
    timemoto_event_id: `manual_${stamp}_in`,
    employee_id:       employeeId,
    user_full_name:    userFullName,
    clocking_type:     'In',
    time_logged:       inDate.toISOString(),
    clocking_pair_id:  pairId,
    raw_payload:       { source: 'manual_admin' },
  }]
  if (outDate) {
    rows.push({
      timemoto_event_id: `manual_${stamp}_out`,
      employee_id:       employeeId,
      user_full_name:    userFullName,
      clocking_type:     'Out',
      time_logged:       outDate.toISOString(),
      clocking_pair_id:  pairId,
      raw_payload:       { source: 'manual_admin' },
    })
  }

  const { error } = await supabase.from('attendance_events').insert(rows)
  if (error) {
    console.error('[admin/attendance POST]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logZeitChange(supabase, {
    datum: zurichDateOf(inDate.toISOString()),
    emp: userFullName,
    text: `Eintrag hinzugefügt: ${zurichTimeOf(inDate.toISOString())}${outDate ? ` – ${zurichTimeOf(outDate.toISOString())}` : ''}`,
  })
  revalidateZeitPages()
  return NextResponse.json({ ok: true })
}

// PUT /api/admin/attendance
// Body: { timemoto_event_id: string, time_logged: string }  (time_logged as UTC ISO)
// Completes an incomplete stamp pair: timemoto_event_id names the existing
// lone In or Out event, time_logged is the missing counterpart's time. The
// counterpart is inserted with the same pair id (assigned first if the lone
// event has none), so the pair behaves like a normal TimeMoto entry.
export async function PUT(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { timemoto_event_id, time_logged } = body as { timemoto_event_id?: string; time_logged?: string }
  if (!timemoto_event_id || !time_logged) {
    return NextResponse.json({ error: 'Missing timemoto_event_id or time_logged' }, { status: 400 })
  }
  const parsed = new Date(time_logged)
  if (isNaN(parsed.getTime())) {
    return NextResponse.json({ error: 'Invalid time_logged format' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: existingRow } = await supabase
    .from('attendance_events')
    .select('employee_id, user_full_name, clocking_type, time_logged, clocking_pair_id')
    .eq('timemoto_event_id', timemoto_event_id)
    .is('deleted_at', null)
    .maybeSingle()
  const existing = existingRow as { employee_id: string | null; user_full_name: string | null; clocking_type: string | null; time_logged: string | null; clocking_pair_id: string | null } | null
  if (!existing?.time_logged) {
    return NextResponse.json({ error: 'Stempel-Eintrag nicht gefunden' }, { status: 404 })
  }

  const isIn   = existing.clocking_type === 'In'
  const inISO  = isIn ? existing.time_logged : parsed.toISOString()
  const outISO = isIn ? parsed.toISOString() : existing.time_logged
  if (new Date(outISO).getTime() <= new Date(inISO).getTime()) {
    return NextResponse.json({ error: 'Ausstempeln muss nach dem Einstempeln liegen' }, { status: 400 })
  }

  const stamp = Date.now()
  let pairId = existing.clocking_pair_id
  if (!pairId) {
    pairId = `manualpair_${stamp}`
    const { error: pairErr } = await supabase
      .from('attendance_events')
      .update({ clocking_pair_id: pairId })
      .eq('timemoto_event_id', timemoto_event_id)
    if (pairErr) {
      console.error('[admin/attendance PUT]', pairErr.message)
      return NextResponse.json({ error: pairErr.message }, { status: 500 })
    }
  }

  const { error } = await supabase.from('attendance_events').insert({
    timemoto_event_id: `manual_${stamp}_${isIn ? 'out' : 'in'}`,
    employee_id:       existing.employee_id,
    user_full_name:    existing.user_full_name,
    clocking_type:     isIn ? 'Out' : 'In',
    time_logged:       parsed.toISOString(),
    clocking_pair_id:  pairId,
    raw_payload:       { source: 'manual_admin_complete' },
  })
  if (error) {
    console.error('[admin/attendance PUT]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logZeitChange(supabase, {
    datum: zurichDateOf(inISO),
    emp: existing.user_full_name ?? '?',
    text: `${isIn ? 'Ausstempeln' : 'Einstempeln'} ergänzt → Eintrag ${zurichTimeOf(inISO)} – ${zurichTimeOf(outISO)}`,
  })
  revalidateZeitPages()
  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/attendance
// Body: { timemoto_event_ids: string[] }
// Soft-deletes the events (deleted_at) so the entry disappears from all
// reports but stays recoverable in the database.
export async function DELETE(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const ids = (body as { timemoto_event_ids?: unknown }).timemoto_event_ids
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every(id => typeof id === 'string' && id.length > 0)) {
    return NextResponse.json({ error: 'Missing timemoto_event_ids' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // State before deletion — for the change log
  const { data: prevRows } = await supabase
    .from('attendance_events')
    .select('user_full_name, clocking_type, time_logged')
    .in('timemoto_event_id', ids)

  const { error } = await supabase
    .from('attendance_events')
    .update({ deleted_at: new Date().toISOString() })
    .in('timemoto_event_id', ids)

  if (error) {
    console.error('[admin/attendance DELETE]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (prevRows ?? []) as Array<{ user_full_name: string | null; clocking_type: string | null; time_logged: string | null }>
  const anchor = rows.find(r => r.clocking_type === 'In') ?? rows[0]
  if (anchor?.time_logged) {
    const inT  = rows.find(r => r.clocking_type === 'In')?.time_logged
    const outT = rows.find(r => r.clocking_type === 'Out')?.time_logged
    await logZeitChange(supabase, {
      datum: zurichDateOf(anchor.time_logged),
      emp: anchor.user_full_name ?? '?',
      text: `Eintrag gelöscht${inT ? `: ${zurichTimeOf(inT)}${outT ? ` – ${zurichTimeOf(outT)}` : ''}` : ''}`,
    })
  }
  revalidateZeitPages()
  return NextResponse.json({ ok: true })
}
