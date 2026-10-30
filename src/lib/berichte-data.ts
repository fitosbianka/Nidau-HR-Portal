import { ohneGaesteErgebnis } from '@/lib/gaeste'
import type { SupabaseClient } from '@supabase/supabase-js'
import { makeNameCanonicalizer } from '@/lib/names'

/** Server data for the Zeiterfassung reports view (admin page and the
 *  read-only Leitende team page share this loader). Pass a `period` to
 *  restrict the queries to one date window — server-side period exports use
 *  this so a request never loads the full history. Events get a generous
 *  UTC margin because they are assigned to Zurich days later. */
export async function loadBerichteData(
  supabase: SupabaseClient,
  period?: { dateFrom: string; dateTo: string },
) {
  let eventsQuery = supabase
    .from('attendance_events')
    .select('timemoto_event_id, user_full_name, clocking_type, time_logged, clocking_pair_id, location_name')
    .is('deleted_at', null)
    .order('time_logged', { ascending: false })
  let commentsQuery = supabase
    .from('zeiterfassung_comments')
    .select('user_full_name, schedule_date, comment')
  // Arbeitsplan absence codes = the "basic plan": Kompensation (KO),
  // Ferien (F / fractional F:x), Krank (K), Teamevent (TE) and
  // überbetrieblicher Kurs (ÜK — counts like a worked day)
  let planQuery = supabase
    .from('work_schedule')
    .select('employee_id, schedule_date, entry')
    .or('entry.in.(KO,F,K,U,TE,ÜK,UK,BF,UF,WB),entry.like.F:*')

  if (period) {
    const utcFrom = new Date(new Date(`${period.dateFrom}T00:00:00Z`).getTime() - 86400000).toISOString()
    const utcTo   = new Date(new Date(`${period.dateTo}T00:00:00Z`).getTime() + 2 * 86400000).toISOString()
    eventsQuery   = eventsQuery.gte('time_logged', utcFrom).lt('time_logged', utcTo)
    commentsQuery = commentsQuery.gte('schedule_date', period.dateFrom).lte('schedule_date', period.dateTo)
    planQuery     = planQuery.gte('schedule_date', period.dateFrom).lte('schedule_date', period.dateTo)
  }

  const [{ data: events }, { data: comments }, { data: plan }, { data: profiles }] = await Promise.all([
    eventsQuery,
    commentsQuery,
    planQuery,
    supabase
      .from('profiles')
      .select('id, full_name, job_title')
      .eq('role', 'employee')
      .then(ohneGaesteErgebnis),
  ])

  // Display names are unified to the canonical PROFILE spelling everywhere
  // (e.g. attendance "Laura Gerisch" → profile "Laura Gerisch-Rudin").
  const profileList = ((profiles ?? []) as Array<{ id: string; full_name: string; job_title: string | null }>)
  const canonical = makeNameCanonicalizer(profileList.map(p => p.full_name))
  const canonicalEvents = ((events ?? []) as Array<{ user_full_name: string | null } & Record<string, unknown>>)
    .map(e => ({ ...e, user_full_name: canonical(e.user_full_name) }))

  // key: `${full_name}||${YYYY-MM-DD}` (canonical names, incl. old comments
  // stored under the TimeMoto spelling). `__`-prefixed rows are reserved
  // storage (Konto overrides, Leitende releases) — never day comments.
  const initialComments: Record<string, string> = {}
  for (const c of (comments ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>) {
    if (c.user_full_name.startsWith('__')) continue
    initialComments[`${canonical(c.user_full_name)}||${c.schedule_date}`] = c.comment
  }

  // Map plan absences to first-name keys (unique among staff) to bridge name
  // variants like "Laura Gerisch" (attendance) vs "Laura Gerisch-Rudin" (profile)
  const nameById: Record<string, string> = {}
  for (const p of profileList) nameById[p.id] = p.full_name
  const planAbsences: Record<string, string> = {}
  for (const r of (plan ?? []) as Array<{ employee_id: string; schedule_date: string; entry: string }>) {
    const nm = nameById[r.employee_id]
    if (nm) planAbsences[`${nm.split(' ')[0]}||${r.schedule_date}`] = r.entry
  }

  return {
    events: canonicalEvents,
    initialComments,
    planAbsences,
    profiles: profileList.sort((a, b) => a.full_name.localeCompare(b.full_name)),
  }
}

/** Same data, filtered server-side to ONE employee — for the personal
 *  "Meine Zeiten" page. Nothing about anyone else reaches the client. */
export async function loadOwnBerichteData(supabase: SupabaseClient, ownId: string, ownFullName: string) {
  const all = await loadBerichteData(supabase)
  const first = ownFullName.split(' ')[0]
  return {
    events: all.events.filter(e => e.user_full_name === ownFullName),
    initialComments: Object.fromEntries(
      Object.entries(all.initialComments).filter(([k]) => k.startsWith(`${ownFullName}||`)),
    ),
    planAbsences: Object.fromEntries(
      Object.entries(all.planAbsences).filter(([k]) => k.startsWith(`${first}||`)),
    ),
    profiles: all.profiles.filter(p => p.id === ownId),
  }
}

/** Daten für die persönliche Stempeluhr-Berichtsansicht (Bianka, Admin):
 *  NUR die eigenen Events, ohne die Mitarbeiter-Namens-Kanonisierung —
 *  der Admin-Name ist kein Mitarbeiter-Profil und würde dort herausfallen.
 *  Quelle ist dieselbe attendance_events-Tabelle; ob ein Stempel vom
 *  TimeMoto-Webhook oder von der Portal-Stempeluhr stammt, spielt keine
 *  Rolle. */
export async function loadStempeluhrBerichteData(
  supabase: SupabaseClient,
  ownId: string,
  ownFullName: string,
) {
  const [{ data: events }, { data: comments }] = await Promise.all([
    supabase
      .from('attendance_events')
      .select('timemoto_event_id, user_full_name, clocking_type, time_logged, clocking_pair_id, location_name')
      .eq('user_full_name', ownFullName)
      .is('deleted_at', null)
      .order('time_logged', { ascending: false }),
    supabase
      .from('zeiterfassung_comments')
      .select('user_full_name, schedule_date, comment')
      .eq('user_full_name', ownFullName),
  ])
  const initialComments: Record<string, string> = {}
  for (const c of (comments ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>) {
    initialComments[`${ownFullName}||${c.schedule_date}`] = c.comment
  }
  return {
    events: (events ?? []),
    initialComments,
    planAbsences: {} as Record<string, string>,   // Admin hat keinen Arbeitsplan
    profiles: [{ id: ownId, full_name: ownFullName }],
  }
}
