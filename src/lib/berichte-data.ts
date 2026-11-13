import { ohneGaesteErgebnis } from '@/lib/gaeste'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ladeFerienAnteile } from '@/lib/ferien-anteil-data'
import { anteilAus, type AnteilKarte } from '@/lib/ferien-anteil'
import { pensumWocheGewichte } from '@/lib/ferien-pensumwoche'
import { faktorVon } from '@/lib/ferien-wochen'

const tageVerschieben = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
import { makeNameCanonicalizer } from '@/lib/names'
import { ladeAlleSeiten, RESERVIERT_LIKE } from '@/lib/seiten'

type EventRow = { timemoto_event_id: string; user_full_name: string | null; clocking_type: string | null; time_logged: string | null; clocking_pair_id: string | null; location_name: string | null }
type CommentRow = { user_full_name: string; schedule_date: string; comment: string }
type PlanRow = { employee_id: string; schedule_date: string; entry: string }

/** Server data for the Zeiterfassung reports view (admin page and the
 *  read-only Leitende team page share this loader). Pass a `period` to
 *  restrict the queries to one date window — server-side period exports use
 *  this so a request never loads the full history. Events get a generous
 *  UTC margin because they are assigned to Zurich days later.
 *
 *  Alles wird seitenweise geladen (Supabase gibt höchstens 1000 Zeilen pro
 *  Abfrage): vorher fehlten in vollen Monaten stillschweigend Zeilen, zum
 *  Beispiel die Tagesnotizen der Kontrolle, weil die Tabelle daneben auch
 *  die Protokolle (eine Zeile pro Planänderung) enthält. Reservierte Zeilen
 *  (`__`-Präfix) werden schon in der Datenbank ausgeschlossen. */
export async function loadBerichteData(
  supabase: SupabaseClient,
  period?: { dateFrom: string; dateTo: string },
  opts?: {
    /** nur die Zeilen einer Person (Vorname als Präfix, damit TimeMoto-Schreibweisen mitkommen) */
    vorname?: string
  },
) {
  const utcFrom = period ? new Date(new Date(`${period.dateFrom}T00:00:00Z`).getTime() - 86400000).toISOString() : null
  const utcTo   = period ? new Date(new Date(`${period.dateTo}T00:00:00Z`).getTime() + 2 * 86400000).toISOString() : null

  const [events, comments, plan, { data: profiles }] = await Promise.all([
    ladeAlleSeiten<EventRow>((von, bis) => {
      let q = supabase
        .from('attendance_events')
        .select('timemoto_event_id, user_full_name, clocking_type, time_logged, clocking_pair_id, location_name')
        .is('deleted_at', null)
      if (utcFrom && utcTo) q = q.gte('time_logged', utcFrom).lt('time_logged', utcTo)
      if (opts?.vorname) q = q.ilike('user_full_name', `${opts.vorname}%`)
      return q.order('time_logged', { ascending: false }).order('timemoto_event_id', { ascending: false }).range(von, bis)
    }),
    // Tagesnotizen: nur echte Namen, keine reservierten Zeilen
    ladeAlleSeiten<CommentRow>((von, bis) => {
      let q = supabase
        .from('zeiterfassung_comments')
        .select('user_full_name, schedule_date, comment')
        .not('user_full_name', 'like', RESERVIERT_LIKE)
      if (period) q = q.gte('schedule_date', period.dateFrom).lte('schedule_date', period.dateTo)
      if (opts?.vorname) q = q.ilike('user_full_name', `${opts.vorname}%`)
      return q.order('schedule_date', { ascending: true }).order('user_full_name', { ascending: true }).range(von, bis)
    }),
    // Arbeitsplan absence codes = the "basic plan": Kompensation (KO),
    // Ferien (F / fractional F:x), Krank (K), Teamevent (TE) and
    // überbetrieblicher Kurs (ÜK — counts like a worked day)
    ladeAlleSeiten<PlanRow>((von, bis) => {
      let q = supabase
        .from('work_schedule')
        .select('employee_id, schedule_date, entry')
        .or('entry.in.(KO,F,K,U,TE,ÜK,UK,BF,UF,WB),entry.like.F:*')
      // sechs Tage Rand, damit ganze F-Wochen am Monatsrand erkannt werden (Pensumwoche)
      if (period) q = q.gte('schedule_date', tageVerschieben(period.dateFrom, -6)).lte('schedule_date', tageVerschieben(period.dateTo, 6))
      return q.order('schedule_date', { ascending: true }).order('employee_id', { ascending: true }).range(von, bis)
    }),
    supabase
      .from('profiles')
      .select('id, full_name, job_title, pensum')
      .eq('role', 'employee')
      .then(ohneGaesteErgebnis),
  ])

  // Display names are unified to the canonical PROFILE spelling everywhere
  // (e.g. attendance "Anna Muster" → profile "Anna Muster-Beispiel").
  const profileList = ((profiles ?? []) as Array<{ id: string; full_name: string; job_title: string | null; pensum?: number | null }>)
  const canonical = makeNameCanonicalizer(profileList.map(p => p.full_name))
  // Ferienanteil pro Wochentag (glattes F zählt den Anteil des Tags)
  const anteile = await ladeFerienAnteile(supabase, profileList)
  const canonicalEvents = events.map(e => ({ ...e, user_full_name: canonical(e.user_full_name) }))

  // key: `${full_name}||${YYYY-MM-DD}` (canonical names, incl. old comments
  // stored under the TimeMoto spelling). `__`-prefixed rows are reserved
  // storage (Konto overrides, Leitende releases) — never day comments.
  const initialComments: Record<string, string> = {}
  for (const c of comments) {
    if (c.user_full_name.startsWith('__')) continue
    initialComments[`${canonical(c.user_full_name)}||${c.schedule_date}`] = c.comment
  }

  // Map plan absences to first-name keys (unique among staff) to bridge name
  // variants like "Anna Muster" (attendance) vs "Anna Muster-Beispiel" (profile)
  const nameById: Record<string, string> = {}
  for (const p of profileList) nameById[p.id] = p.full_name
  // Pro Person: ganze F-Wochen bei Teilzeit zählen nach Pensum (F:<Pensum>)
  const proPerson = new Map<string, Record<string, string>>()
  for (const r of plan) { const m = proPerson.get(r.employee_id) ?? {}; m[r.schedule_date] = r.entry; proPerson.set(r.employee_id, m) }
  const pensumById: Record<string, number | null | undefined> = {}
  for (const p of profileList) pensumById[p.id] = p.pensum
  const planAbsences: Record<string, string> = {}
  proPerson.forEach((m, employeeId) => {
    const nm = nameById[employeeId]
    if (!nm) return
    const gewichtet = pensumWocheGewichte(m, faktorVon(pensumById[employeeId]), anteilAus(anteile, employeeId))
    for (const [d, e] of Object.entries(gewichtet)) planAbsences[`${nm.split(' ')[0]}||${d}`] = e
  })

  return {
    events: canonicalEvents,
    initialComments,
    planAbsences,
    // ohne Pensum an den Browser
    profiles: profileList.sort((a, b) => a.full_name.localeCompare(b.full_name)).map(p => ({ id: p.id, full_name: p.full_name, job_title: p.job_title })),
    anteile,
  }
}

/** Same loader, narrowed to ONE employee — used by the personal
 *  "Meine Zeiten" page. Nothing about anyone else reaches the client. */
export async function loadOwnBerichteData(supabase: SupabaseClient, ownId: string, ownFullName: string) {
  const first = ownFullName.split(' ')[0]
  const all = await loadBerichteData(supabase, undefined, { vorname: first })
  return {
    events: all.events.filter(e => e.user_full_name === ownFullName),
    initialComments: Object.fromEntries(
      Object.entries(all.initialComments).filter(([k]) => k.startsWith(`${ownFullName}||`)),
    ),
    planAbsences: Object.fromEntries(
      Object.entries(all.planAbsences).filter(([k]) => k.startsWith(`${first}||`)),
    ),
    profiles: all.profiles.filter(p => p.id === ownId),
    // nur die eigene Regel, nichts über andere
    anteile: Object.fromEntries(Object.entries(all.anteile).filter(([k]) => k === ownId || k === ownFullName)) as AnteilKarte,
  }
}

/** Tagesnotizen einer Person in einem Zeitraum, direkt nach Namen geladen
 *  (TimeMoto-Schreibweisen über den Vornamen eingeschlossen). Der Export in
 *  den Mitarbeiterordner holt damit die Notizen der Kontrolle ein zweites
 *  Mal, unabhängig vom Sammel-Lader, damit sie im PDF nie fehlen können. */
export async function ladeTagesNotizen(
  supabase: SupabaseClient,
  fullName: string,
  canonical: (raw: string | null) => string | null,
  dateFrom: string,
  dateTo: string,
): Promise<Record<string, string>> {
  const first = fullName.split(' ')[0]
  const rows = await ladeAlleSeiten<CommentRow>((von, bis) => supabase
    .from('zeiterfassung_comments')
    .select('user_full_name, schedule_date, comment')
    .ilike('user_full_name', `${first}%`)
    .gte('schedule_date', dateFrom).lte('schedule_date', dateTo)
    .order('schedule_date', { ascending: true }).order('user_full_name', { ascending: true })
    .range(von, bis))
  const out: Record<string, string> = {}
  for (const r of rows) {
    if (r.user_full_name.startsWith('__') || canonical(r.user_full_name) !== fullName) continue
    if (r.comment?.trim()) out[`${fullName}||${r.schedule_date}`] = r.comment
  }
  return out
}

