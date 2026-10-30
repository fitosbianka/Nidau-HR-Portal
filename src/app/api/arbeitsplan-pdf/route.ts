import { ohneGaesteErgebnis } from '@/lib/gaeste'
import { feiertagName } from '@/lib/feiertage'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateArbeitsplanPdf } from '@/lib/pdf/hr-pdfs.mjs'
import { LEITENDE_TITLE, isMonthReleasedToLeitende } from '@/lib/leitende'
import { getTeamEventDays } from '@/lib/team-events'
import { getMonthPlanNotes, sundayOf } from '@/lib/plan-notes'
import { maskUfEntries } from '@/lib/plan-privacy'
import {
  PLAN_MONTH_NOTES, PLAN_MONTH_NAMES, PLAN_DAY_SHORT,
  PLAN_GROUP_DEFS, PLAN_GROUP_COLORS, PLAN_PENSUM_STEPS, planWorkingDays,
  planFmtHM, planFirstPart, planPdfCell, planRowVisible, planKurzname,
  PLAN_LEGEND, PLAN_SHIFT_LEGEND, PLAN_TIME_LINES,
} from '@/lib/plan-meta'

// The Arbeitsplan as a real PDF file — same colors and legend as the portal.
// GET ?m=YYYY-MM (&dl=1 → download with Content-Disposition attachment, which
// saves reliably on desktop AND phone; without dl it opens in the viewer).
// Visibility mirrors the Arbeitsplan pages: employees get published or past
// months only, plan editors and the released Leitenden see drafts too.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const m = req.nextUrl.searchParams.get('m') ?? ''
  const dl = req.nextUrl.searchParams.get('dl') === '1'
  const parsed = /^(\d{4})-(\d{2})$/.exec(m)
  if (!parsed) return NextResponse.json({ error: 'Ungültiger Monat' }, { status: 400 })
  const year = Number(parsed[1])
  const month = Number(parsed[2])
  if (year < 2020 || year > 2099 || month < 1 || month > 12) {
    return NextResponse.json({ error: 'Ungültiger Monat' }, { status: 400 })
  }

  const { data: profRow } = await supabase
    .from('profiles')
    .select('role, job_title, can_edit_schedule')
    .eq('id', user.id)
    .single()
  const prof = profRow as { role: string; job_title: string | null; can_edit_schedule: boolean | null } | null
  const admin = await createAdminClient()

  const { data: pub } = await admin
    .from('schedule_publications')
    .select('year')
    .eq('year', year)
    .eq('month', month)
    .maybeSingle()
  const isPublished = !!pub
  const isLeitende = prof?.job_title === LEITENDE_TITLE
  const released = isLeitende ? await isMonthReleasedToLeitende(admin, year, month) : false
  const now = new Date()
  const isPast = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)
  // Legacy editor flag: only published months, never early access
  const canEdit = prof?.role === 'admin' || (isLeitende && (released || isPublished)) || (prof?.can_edit_schedule === true && isPublished)
  if (!(canEdit || isPast || isPublished)) {
    return NextResponse.json({ error: 'Dieser Monat ist noch nicht veröffentlicht' }, { status: 403 })
  }

  const mm = String(month).padStart(2, '0')
  const daysInMonth = new Date(year, month, 0).getDate()
  const firstDay = `${year}-${mm}-01`
  const lastDay = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`

  const [empRes, entryRes, reviewRes, teamEventDays, planNotes] = await Promise.all([
    admin.from('profiles')
      .select('id, full_name, job_title')
      .or('role.eq.employee,job_title.eq.Admin')
      .eq('is_active', true)
      .order('schedule_order', { ascending: true, nullsFirst: false })
      .order('full_name', { ascending: true })
      .then(ohneGaesteErgebnis),
    admin.from('work_schedule')
      .select('employee_id, schedule_date, entry')
      .gte('schedule_date', firstDay)
      .lte('schedule_date', lastDay),
    admin.from('schedule_review_days')
      .select('schedule_date')
      .gte('schedule_date', firstDay)
      .lte('schedule_date', lastDay),
    getTeamEventDays(admin, firstDay, lastDay),
    // note bands (Betriebsferien etc.) are editor-internal on screen — the
    // PDF shows them only to people who see them in the portal too
    // Planning notes only for admins and Leitende
    canEdit && (prof?.role === 'admin' || isLeitende) ? getMonthPlanNotes(admin, year, month) : Promise.resolve(null),
  ])

  const entryMap: Record<string, string> = {}
  // UF anderer Personen erscheint im PDF als F — gleiche Sichtbarkeitsregel
  // wie im Portal (nur Admins und die betroffene Person sehen «UF»).
  const entryRows = maskUfEntries(
    (entryRes.data ?? []) as Array<{ employee_id: string; schedule_date: string; entry: string }>,
    user.id,
    prof?.role === 'admin',
  )
  for (const r of entryRows) {
    entryMap[`${r.employee_id}||${r.schedule_date}`] = planFirstPart(r.entry)
  }
  const reviewSet = new Set(((reviewRes.data ?? []) as Array<{ schedule_date: string }>).map(r => r.schedule_date))
  const teSet = new Set(teamEventDays)

  const monthKey = `${year}-${mm}`
  const emps = ((empRes.data ?? []) as Array<{ id: string; full_name: string; job_title: string | null }>)
    .filter(e => planRowVisible(e.full_name, monthKey))

  const dateOf = (day: number) => `${year}-${mm}-${String(day).padStart(2, '0')}`
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1
    const dow = new Date(year, month - 1, day).getDay()
    const ds = dateOf(day)
    return {
      num: day,
      wd: PLAN_DAY_SHORT[dow],
      we: dow === 0 || dow === 6,
      review: reviewSet.has(ds),
      te: teSet.has(ds) || !!feiertagName(ds),
    }
  })

  const groups = PLAN_GROUP_DEFS
    .map(g => ({
      key: g.key,
      label: g.label,
      rows: emps.filter(e => g.match(e.job_title)).map(e => ({
        name: planKurzname(e.full_name),
        cells: days.map(day => {
          const v = entryMap[`${e.id}||${dateOf(day.num)}`] ?? ''
          return v ? planPdfCell(v) : null
        }),
      })),
    }))
    .filter(g => g.rows.length > 0)

  // Day/week note bands, clamped to this month
  const clamp = (from: string, to: string) => {
    const a = from <= firstDay ? 1 : from.slice(0, 7) === monthKey ? Number(from.slice(8)) : null
    const b = to >= lastDay ? daysInMonth : to.slice(0, 7) === monthKey ? Number(to.slice(8)) : null
    if (a === null && from > lastDay) return null
    if (b === null && to < firstDay) return null
    const start = a ?? 1
    const end = b ?? daysInMonth
    return start <= end ? { start, end } : null
  }
  const bands: Array<{ start: number; end: number; note: string }> = []
  if (planNotes) {
    for (const n of planNotes.weekNotes) {
      const r = clamp(n.anchor, n.to ?? sundayOf(n.anchor))
      if (r) bands.push({ ...r, note: n.note })
    }
    for (const n of planNotes.dayNotes) {
      const r = clamp(n.anchor, n.to ?? n.anchor)
      if (r) bands.push({ ...r, note: n.note })
    }
    bands.sort((a, b) => a.start - b.start)
  }

  const workingDays = planWorkingDays(year, month)
  const soll100 = workingDays * 8.5

  let bytes: Uint8Array
  try {
    bytes = await generateArbeitsplanPdf({
      monthLabel: `${PLAN_MONTH_NAMES[month - 1]} ${year}`,
      createdLabel: `Erstellt am ${new Date().toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })}`,
      monthNote: PLAN_MONTH_NOTES[monthKey] ?? null,
      workingDays,
      soll: PLAN_PENSUM_STEPS.map(p => ({ pct: String(p), val: planFmtHM(soll100 * p / 100) })),
      days,
      bands,
      groups,
      groupColors: PLAN_GROUP_COLORS,
      legend: PLAN_LEGEND,
      shifts: PLAN_SHIFT_LEGEND,
      timeLines: PLAN_TIME_LINES,
    })
  } catch (err) {
    console.error('[arbeitsplan-pdf]', err)
    return NextResponse.json({ error: 'PDF-Erstellung fehlgeschlagen' }, { status: 500 })
  }

  // ASCII-safe file name for the Content-Disposition header (März → Maerz)
  const monthAscii = PLAN_MONTH_NAMES[month - 1].replace('ä', 'ae').replace('ö', 'oe').replace('ü', 'ue')
  const fname = `Arbeitsplan_${monthAscii}_${year}.pdf`
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${dl ? 'attachment' : 'inline'}; filename="${fname}"`,
    },
  })
}
