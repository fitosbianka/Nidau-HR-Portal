import { ohneGaesteErgebnis } from '@/lib/gaeste'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ZEITERFASSUNG_EXCLUDED } from '@/lib/attendance-exclude'
import { makeNameCanonicalizer } from '@/lib/names'
import { zurichHeute, zurichMonatsStart, zurichTagesFenster } from '@/lib/zeitzone'

// Shared "Jetzt anwesend" computation — used by the Anwesenheits-Seite AND
// the admin Start page, so both always show exactly the same status.

export type AnwStatus = 'eingestempelt' | 'zurueck' | 'pause' | 'ausgestempelt' | 'abwesend'

export type AnwEmployee = {
  name: string
  status: AnwStatus
  inSince?: string
  lastOutAt?: string
  completedPairs: number
  workedMinutes: number
  hadMonthEvent: boolean
}

export type AnwCounts = { anwesend: number; pause: number; ausgest: number; abwesend: number }

export function fmtZurichTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-CH', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich',
  })
}

export function fmtMinutesH(min: number): string {
  if (min <= 0) return '0:00 h'
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`
}

export async function loadAnwesenheit(supabase: SupabaseClient): Promise<{ list: AnwEmployee[]; counts: AnwCounts }> {
  // ── Heutiger Zürcher Tag und laufender Monat als UTC Fenster, mit dem
  //    echten Offset (Sommer- oder Winterzeit) des jeweiligen Tages ────────
  const todayStr = zurichHeute()
  const { start: dayStartIso, ende: dayEndIso } = zurichTagesFenster(todayStr)
  const monthStartIso = zurichMonatsStart(todayStr)

  const [{ data: events }, { data: profiles }, { data: monthEvents }] = await Promise.all([
    supabase
      .from('attendance_events')
      .select('timemoto_event_id, user_full_name, clocking_type, time_logged, clocking_pair_id')
      .is('deleted_at', null)
      .gte('time_logged', dayStartIso)
      .lt('time_logged',  dayEndIso)
      .order('time_logged', { ascending: true }),
    supabase
      .from('profiles')
      .select('full_name, job_title')
      .eq('is_active', true)
      .eq('role', 'employee')
      .order('full_name')
      .then(ohneGaesteErgebnis),
    supabase
      .from('attendance_events')
      .select('user_full_name')
      .is('deleted_at', null)
      .gte('time_logged', monthStartIso)
      .lt('time_logged',  dayEndIso),
  ])

  // Set of employees who had any event this month
  const hadMonthEvent = new Set(
    (monthEvents ?? []).map(e => makeNameCanonicalizer((profiles ?? []).map(p => p.full_name))(e.user_full_name)).filter(Boolean)
  )

  // ── Build employee state ───────────────────────────────────────────────────
  type EmpState = {
    name:             string
    completedPairs:   number
    completedMinutes: number
    currentlyIn:      boolean
    inSince?:         string
    lastOutAt?:       string
  }

  const empMap = new Map<string, EmpState>()
  for (const p of profiles ?? []) {
    if (ZEITERFASSUNG_EXCLUDED.has(p.full_name)) continue
    empMap.set(p.full_name, {
      name: p.full_name, completedPairs: 0, completedMinutes: 0, currentlyIn: false,
    })
  }

  const openIns = new Map<string, string>()   // pairKey → in time ISO

  const canonical = makeNameCanonicalizer((profiles ?? []).map(p => p.full_name))
  for (const ev of events ?? []) {
    const name = canonical(ev.user_full_name)
    if (!name) continue
    if (ZEITERFASSUNG_EXCLUDED.has(name)) continue
    if (!empMap.has(name)) {
      empMap.set(name, { name, completedPairs: 0, completedMinutes: 0, currentlyIn: false })
    }
    const emp = empMap.get(name)!
    // Include employee name in key to prevent cross-employee pair collisions
    // (imported events may share numeric pair IDs across different employees)
    const key = ev.clocking_pair_id
      ? `${name}||${ev.clocking_pair_id}`
      : `orphan_${ev.timemoto_event_id}`

    if (ev.clocking_type === 'In') {
      emp.currentlyIn = true
      emp.inSince     = ev.time_logged ?? undefined
      emp.lastOutAt   = undefined
      openIns.set(key, ev.time_logged ?? '')
    } else {
      emp.currentlyIn = false
      emp.lastOutAt   = ev.time_logged ?? undefined
      emp.inSince     = undefined
      if (openIns.has(key)) {
        const inISO = openIns.get(key)!
        if (inISO && ev.time_logged) {
          emp.completedMinutes += Math.round(
            (new Date(ev.time_logged).getTime() - new Date(inISO).getTime()) / 60000
          )
        }
        emp.completedPairs++
        openIns.delete(key)
      }
    }
  }

  // Real UTC epoch — needed for duration math.
  // NOTE: nowZ.getTime() must NOT be used for epoch arithmetic — on a UTC server
  // it is the Zurich local time interpreted as UTC (offset by +1h/+2h), so any
  // subtraction from a stored UTC timestamp would be wrong by that offset.
  const realNowMs = Date.now()

  // ── Status logic ──────────────────────────────────────────────────────────
  // Pause: ≤1 completed pair, currently out, clock-out was before 16:00 Zurich.
  // Using the clock-out hour (not elapsed time) avoids the nowZ epoch bug.
  function getStatus(emp: EmpState): AnwStatus {
    if (emp.currentlyIn) {
      return emp.completedPairs > 0 ? 'zurueck' : 'eingestempelt'
    }
    if (!emp.lastOutAt && emp.completedPairs === 0) return 'abwesend'
    if (emp.lastOutAt && emp.completedPairs <= 1) {
      const outHour = parseInt(
        new Date(emp.lastOutAt).toLocaleTimeString('en-GB', {
          hour: '2-digit', timeZone: 'Europe/Zurich',
        }),
        10,
      )
      // Clocked out before 16:00 → most likely a break, not end of shift
      if (outHour >= 8 && outHour < 16) return 'pause'
    }
    return 'ausgestempelt'
  }

  // ── Hours worked today ─────────────────────────────────────────────────────
  function getWorkedMinutes(emp: EmpState): number {
    let min = emp.completedMinutes
    if (emp.currentlyIn && emp.inSince) {
      min += Math.round((realNowMs - new Date(emp.inSince).getTime()) / 60000)
    }
    return min
  }

  const list: AnwEmployee[] = Array.from(empMap.values()).map(emp => ({
    name:           emp.name,
    status:         getStatus(emp),
    inSince:        emp.inSince,
    lastOutAt:      emp.lastOutAt,
    completedPairs: emp.completedPairs,
    workedMinutes:  getWorkedMinutes(emp),
    hadMonthEvent:  hadMonthEvent.has(emp.name),
  }))

  const statusOrder: Record<AnwStatus, number> = {
    eingestempelt: 0, zurueck: 1, pause: 2, ausgestempelt: 3, abwesend: 4,
  }
  list.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.name.localeCompare(b.name))

  const counts: AnwCounts = {
    anwesend:  list.filter(e => e.status === 'eingestempelt' || e.status === 'zurueck').length,
    pause:     list.filter(e => e.status === 'pause').length,
    ausgest:   list.filter(e => e.status === 'ausgestempelt').length,
    abwesend:  list.filter(e => e.status === 'abwesend').length,
  }

  return { list, counts }
}
