import { ohneGaesteErgebnis } from '@/lib/gaeste'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { makeNameCanonicalizer } from '@/lib/names'
import { getKontrollRegeln, regelPasst } from '@/lib/kontrolle'
import { isZeiterfassungPerson } from '@/lib/attendance-exclude'
import { ladeAlleSeiten, RESERVIERT_LIKE } from '@/lib/seiten'
import KontrolleClient, { type KontrollDay, type KontrollEmployee } from './KontrolleClient'

export const dynamic = 'force-dynamic'

const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']

function zurichDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })
}
function zurichTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' })
}
function zurichMin(iso: string): number {
  const [h, m] = zurichTime(iso).split(':').map(Number)
  return h * 60 + m
}

export default async function KontrollePage() {
  const supabase = await createClient()
  const admin = await createAdminClient()

  // Previous month (Zurich)
  const nowZ = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Zurich' }))
  let y = nowZ.getFullYear()
  let m = nowZ.getMonth()        // 0-based → previous month
  if (m === 0) { m = 12; y-- }
  const mm = String(m).padStart(2, '0')
  const firstDay = `${y}-${mm}-01`
  const lastDay  = `${y}-${mm}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}`
  const monthLabel = `${MONTH_NAMES[m - 1]} ${y}`

  type Ev = { timemoto_event_id: string; user_full_name: string | null; clocking_type: string | null; time_logged: string | null; clocking_pair_id: string | null }
  // Seitenweise (höchstens 1000 Zeilen pro Abfrage), damit in vollen Monaten
  // weder Stempel noch Tagesnotizen fehlen; Protokollzeilen (`__`) bleiben
  // schon in der Datenbank draussen.
  const [events, { data: profiles }, commentRows, planRows, regeln] = await Promise.all([
    // generous UTC window; events are assigned to Zurich days below
    ladeAlleSeiten<Ev>((von, bis) => supabase
      .from('attendance_events')
      .select('timemoto_event_id, user_full_name, clocking_type, time_logged, clocking_pair_id')
      .is('deleted_at', null)
      .gte('time_logged', `${firstDay}T00:00:00Z`)
      .lt('time_logged', new Date(new Date(`${lastDay}T00:00:00Z`).getTime() + 2 * 86400000).toISOString())
      .order('time_logged', { ascending: true }).order('timemoto_event_id', { ascending: true })
      .range(von, bis)),
    supabase.from('profiles').select('id, full_name, job_title').eq('role', 'employee').then(ohneGaesteErgebnis),
    ladeAlleSeiten<{ user_full_name: string; schedule_date: string; comment: string }>((von, bis) => admin
      .from('zeiterfassung_comments')
      .select('user_full_name, schedule_date, comment')
      .not('user_full_name', 'like', RESERVIERT_LIKE)
      .gte('schedule_date', firstDay)
      .lte('schedule_date', lastDay)
      .order('schedule_date', { ascending: true }).order('user_full_name', { ascending: true })
      .range(von, bis)),
    // Arbeitsplan entries of the month — read live, so every change by the
    // admin or the Leitenden shows here immediately
    ladeAlleSeiten<{ employee_id: string; schedule_date: string; entry: string }>((von, bis) => admin
      .from('work_schedule')
      .select('employee_id, schedule_date, entry')
      .gte('schedule_date', firstDay)
      .lte('schedule_date', lastDay)
      .order('schedule_date', { ascending: true }).order('employee_id', { ascending: true })
      .range(von, bis)),
    getKontrollRegeln(admin),
  ])

  const profileList = (profiles ?? []) as Array<{ id: string; full_name: string; job_title: string | null }>
  const canonical = makeNameCanonicalizer(profileList.map(p => p.full_name))

  // Plan entry per (canonical name, day)
  const nameById = new Map(profileList.map(p => [p.id, p.full_name]))
  const planMap: Record<string, string> = {}
  for (const r of planRows) {
    const nm = nameById.get(r.employee_id)
    if (nm && r.entry.trim()) planMap[`${nm}||${r.schedule_date}`] = r.entry.trim()
  }

  const comments: Record<string, string> = {}
  for (const c of commentRows) {
    if (c.user_full_name.startsWith('__')) continue
    comments[`${canonical(c.user_full_name)}||${c.schedule_date}`] = c.comment
  }

  // Pair events per employee
  type Pair = { inISO?: string; outISO?: string; inId?: string; outId?: string }
  const pairs = new Map<string, Pair & { name: string }>()
  for (const e of events) {
    const name = canonical(e.user_full_name)
    if (!name || !e.time_logged) continue
    const key = e.clocking_pair_id ? `${name}||${e.clocking_pair_id}` : `orphan_${e.timemoto_event_id}`
    if (!pairs.has(key)) pairs.set(key, { name })
    const p = pairs.get(key)!
    if (e.clocking_type === 'In') { p.inISO = e.time_logged; p.inId = e.timemoto_event_id }
    else { p.outISO = e.time_logged; p.outId = e.timemoto_event_id }
  }

  // Group into (employee, Zurich day) records for the previous month
  type DayAgg = {
    spans: Array<{ inISO: string; outISO: string; inId: string | null; outId: string }>
    incomplete: boolean
  }
  const dayMap = new Map<string, DayAgg>()
  pairs.forEach(p => {
    const anchor = p.inISO ?? p.outISO
    if (!anchor) return
    const date = zurichDate(anchor)
    if (date < firstDay || date > lastDay) return
    const key = `${p.name}||${date}`
    if (!dayMap.has(key)) dayMap.set(key, { spans: [], incomplete: false })
    const d = dayMap.get(key)!
    if (p.inISO && p.outISO && p.outId) d.spans.push({ inISO: p.inISO, outISO: p.outISO, inId: p.inId ?? null, outId: p.outId })
    else d.incomplete = true
  })

  const byEmployee = new Map<string, KontrollDay[]>()
  dayMap.forEach((agg, key) => {
    const [name, date] = key.split('||')
    const spans = agg.spans.sort((a, b) => a.inISO.localeCompare(b.inISO))
    const totalMin = spans.reduce((s, sp) => s + Math.round((new Date(sp.outISO).getTime() - new Date(sp.inISO).getTime()) / 60000), 0)
    const note = comments[key] ?? null
    const day: KontrollDay = {
      date,
      plan: planMap[key] ?? null,
      zeiten: spans.map(sp => `${zurichTime(sp.inISO)} – ${zurichTime(sp.outISO)}`).join(' · ') + (agg.incomplete ? ' · offen' : ''),
      totalMin,
      pausen: Math.max(0, spans.length - 1),
      incomplete: agg.incomplete,
      note,
      // Already-controlled days stay visibly marked (also after a reload):
      // the note carries a shift name (or the legacy "Korrigiert auf 8:30")
      korrigiert: !!note && (
        note.includes('Korrigiert auf 8:30') ||
        regeln.some(r => r.name.trim() && note.includes(r.name.trim()))
      ),
      empfehlung: null,
      spans: spans.map(sp => ({
        inId: sp.inId,
        outId: sp.outId,
        inHHMM: zurichTime(sp.inISO),
        outHHMM: zurichTime(sp.outISO),
      })),
    }
    // Recommendation: cleanly stamped days whose total is not the credited
    // 8:30. Days with a Pause get one too — accepting adjusts the LAST
    // block's clock-out so the day total becomes 8:30.
    if (!agg.incomplete && spans.length >= 1 && totalMin !== 510 && !day.korrigiert) {
      const tag = {
        startMin: zurichMin(spans[0].inISO),
        endMin:   zurichMin(spans[spans.length - 1].outISO),
        totalMin,
        pairs: spans.length,
      }
      const rule = regeln.find(r => regelPasst(r, tag))
      if (rule) {
        const last = spans[spans.length - 1]
        const vorherMin = spans.slice(0, -1)
          .reduce((s, sp) => s + Math.round((new Date(sp.outISO).getTime() - new Date(sp.inISO).getTime()) / 60000), 0)
        if (vorherMin < 510) {
          day.empfehlung = {
            shiftName: rule.name,
            outEventId: last.outId,
            clockInISO: last.inISO,
            vorherMin,
          }
        }
      }
    }
    if (!byEmployee.has(name)) byEmployee.set(name, [])
    byEmployee.get(name)!.push(day)
  })

  // Alphabetical and stable — employees keep their place (and stay listed)
  // after their times have been controlled.
  const employees: KontrollEmployee[] = Array.from(byEmployee.entries())
    .map(([name, days]) => ({
      name,
      days: days.sort((a, b) => a.date.localeCompare(b.date)),
      findings: days.filter(d => d.empfehlung).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Export roster = exactly the people who belong to the Zeiterfassung
  // (Leitende, DAs, Lernende and the individually included ones — see
  // isZeiterfassungPerson), also when they have no stamp this month: the
  // export reports them as skipped, so nobody can be silently missing.
  const exportEmployees = profileList
    .filter(isZeiterfassungPerson)
    .map(p => ({ id: p.id, name: p.full_name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return <KontrolleClient monthLabel={monthLabel} employees={employees} exportFrom={firstDay} exportTo={lastDay} exportEmployees={exportEmployees} />
}
