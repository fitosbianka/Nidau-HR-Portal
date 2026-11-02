import { ohneGaesteErgebnis } from '@/lib/gaeste'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import WorkScheduleGrid from '@/components/schedule/WorkScheduleGrid'
import Link from 'next/link'
import { LEITENDE_TITLE, isMonthReleasedToLeitende } from '@/lib/leitende'
import { getMonthPlanNotes } from '@/lib/plan-notes'
import { getTeamEventDays } from '@/lib/team-events'
import { maskUfEntries } from '@/lib/plan-privacy'
import { istVerfuegbarkeitPerson, type EinsatzAnfrage, type Entscheidungen } from '@/lib/verfuegbarkeit'
import { ladeVerfuegbarkeit, ladeAnfragen, ladeEntscheidungen, ladePlanEintraege, type PlanEintrag } from '@/lib/verfuegbarkeit-data'
import VerfuegbarkeitClient from '@/components/schedule/VerfuegbarkeitClient'
import { kuerzelFuer } from '@/lib/kuerzel'
import { getTeamHinweise } from '@/lib/plan-hinweise'

interface PageProps {
  searchParams: Promise<{ m?: string }>
}

const MONTH_NAMES = [
  'Januar','Februar','März','April','Mai','Juni',
  'Juli','August','September','Oktober','November','Dezember',
]

export default async function EmployeeArbeitsplanPage({ searchParams }: PageProps) {
  const { m } = await searchParams

  const now   = new Date()
  let year    = now.getFullYear()
  let month   = now.getMonth() + 1

  if (m && /^\d{4}-\d{2}$/.test(m)) {
    const [y, mo] = m.split('-').map(Number)
    if (y >= 2020 && y <= 2099 && mo >= 1 && mo <= 12) {
      year  = y
      month = mo
    }
  }

  const supabase = await createClient()

  // Current employee's edit rights
  const { data: { user } } = await supabase.auth.getUser()
  // Plan data is read with the service client AFTER the session check: the
  // tables are locked down by RLS (profiles contain salary data), but every
  // logged-in employee may see the published plan (names + entries only).
  const planClient = user ? await createAdminClient() : supabase
  // Profile, publication and Leitende-release are independent — fetch them in
  // one parallel round-trip instead of three sequential ones.
  const [profileResult, pubResult, leitendeReleased] = await Promise.all([
    user
      ? supabase.from('profiles').select('can_edit_schedule, job_title, role, full_name').eq('id', user.id).single()
      : Promise.resolve({ data: null }),
    planClient
      .from('schedule_publications')
      .select('year')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle(),
    user ? isMonthReleasedToLeitende(planClient, year, month) : Promise.resolve(false),
  ])
  const prof = profileResult.data as { can_edit_schedule?: boolean; job_title?: string | null; role?: string; full_name?: string } | null
  // Eigene Verfügbarkeitsliste (z. B. Emese): erscheint unter dem Plan, auch
  // wenn der Monat noch nicht veröffentlicht ist. Dazu die Rückmeldung der
  // Admins pro Tag und die eigenen Plan Einträge für den Stand pro Tag
  // (Positionen erst, wenn der Monat sichtbar ist, siehe planSichtbar)
  const [verfuegbarkeit, anfragen, entscheidungen, eigenePlanEintraege] = user && istVerfuegbarkeitPerson(prof?.full_name)
    ? await Promise.all([
        ladeVerfuegbarkeit(planClient, user.id, year, month), ladeAnfragen(planClient, user.id, year, month),
        ladeEntscheidungen(planClient, user.id, year, month), ladePlanEintraege(planClient, user.id, year, month),
      ])
    : [null, [] as EinsatzAnfrage[], {} as Entscheidungen, [] as PlanEintrag[]]
  const isLeitende = prof?.job_title === LEITENDE_TITLE
  const isPublished = !!pubResult.data

  // Leitende may view AND edit months that were released to them (before
  // publication) as well as published months. The legacy per-employee flag
  // only allows editing ALREADY PUBLISHED months: no employee sees a plan
  // before it is published to the team.
  const canEdit = (isLeitende && (leitendeReleased || isPublished)) || (prof?.can_edit_schedule === true && isPublished)

  // Access logic
  const isPast = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)
  const canView = canEdit || isPast || isPublished

  // Navigation helpers
  function prevMonth() {
    let pm = month - 1, py = year
    if (pm < 1) { pm = 12; py-- }
    return `?m=${py}-${String(pm).padStart(2,'0')}`
  }
  function nextMonth() {
    let nm = month + 1, ny = year
    if (nm > 12) { nm = 1; ny++ }
    return `?m=${ny}-${String(nm).padStart(2,'0')}`
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Arbeitsplan</h1>
        <p className="page-subtitle">Monatsübersicht des Dienstplans</p>
      </div>

      {canView ? (
        <>
          {/* Full grid */}
          {(async () => {
            const firstDay = `${year}-${String(month).padStart(2,'0')}-01`
            const lastDay  = `${year}-${String(month).padStart(2,'0')}-${new Date(year, month, 0).getDate()}`

            const [empResult, entryResult, reviewResult, planNotes, teamEventDays, namenResult, teamHinweise] = await Promise.all([
              planClient
                .from('profiles')
                .select('id, full_name, job_title, abbreviation, schedule_order')
                .or('role.eq.employee,job_title.eq.Admin')
                .eq('is_active', true)
                .order('schedule_order', { ascending: true, nullsFirst: false })
                .order('full_name', { ascending: true })
                .then(ohneGaesteErgebnis),
              planClient
                .from('work_schedule')
                .select('employee_id, schedule_date, entry')
                .gte('schedule_date', firstDay)
                .lte('schedule_date', lastDay),
              planClient
                .from('schedule_review_days')
                .select('schedule_date')
                .gte('schedule_date', firstDay)
                .lte('schedule_date', lastDay),
              // Planning notes are internal to the admins and the Leitende; other
              // employees (also legacy editors) never get them. The admin-only
              // note is never loaded here.
              canEdit && isLeitende ? getMonthPlanNotes(planClient, year, month) : Promise.resolve(undefined),
              // Teamevent columns are visible to everyone who may see the plan
              getTeamEventDays(planClient, firstDay, lastDay),
              // Kürzel des Teams für den Dialog «Notiz bearbeiten» (nur Leitende, die Notizen führen)
              canEdit && isLeitende ? planClient.from('profiles').select('full_name') : Promise.resolve({ data: [] as Array<{ full_name: string | null }> }),
              // Hinweise für das Team: für alle sichtbar, die den Plan sehen
              getTeamHinweise(planClient, year, month),
            ])
            const reviewDays = (reviewResult.data ?? []).map((r: { schedule_date: string }) => r.schedule_date)
            const kuerzel = Array.from(new Set(((namenResult.data ?? []) as Array<{ full_name: string | null }>).map(p => kuerzelFuer(p.full_name)).filter((k): k is string => !!k)))

            return (
              <div className="card overflow-hidden">
                <WorkScheduleGrid
                  employees={(empResult.data ?? []) as Array<{ id: string; full_name: string; job_title: string | null; abbreviation?: string | null }>}
                  entries={maskUfEntries(
                    (entryResult.data ?? []) as Array<{ employee_id: string; schedule_date: string; entry: string }>,
                    user?.id ?? '',
                    prof?.role === 'admin',
                  )}
                  year={year}
                  month={month}
                  canEdit={canEdit}
                  isPublished={isPublished}
                  leitendeReleased={leitendeReleased}
                  reviewDays={reviewDays}
                  teamEventDays={teamEventDays}
                  planNotes={planNotes}
                  notizenErlaubt={isLeitende}
                  kuerzel={kuerzel}
                  meinKuerzel={kuerzelFuer(prof?.full_name)}
                  teamHinweise={teamHinweise}
                  basePath="/employee/arbeitsplan"
                />
              </div>
            )
          })()}
        </>
      ) : (
        /* Locked — not yet published */
        <div className="card overflow-hidden">
          {/* Mini month nav so they can still go back */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-edge-soft">
            <Link
              href={prevMonth()}
              className="p-2 rounded-lg hover:bg-edge-row text-ink-4 hover:text-ink-2 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <p className="text-sm font-bold text-ink">{MONTH_NAMES[month - 1]} {year}</p>
            <Link
              href={nextMonth()}
              className="p-2 rounded-lg hover:bg-edge-row text-ink-4 hover:text-ink-2 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>

          <div className="px-6 py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-edge-row flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-ink-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-ink-2">Noch nicht veröffentlicht</p>
            <p className="text-xs text-ink-4 mt-1">
              Der Arbeitsplan für {MONTH_NAMES[month - 1]} {year} wurde noch nicht freigegeben.
            </p>
          </div>
        </div>
      )}

      {user && verfuegbarkeit && (
        <VerfuegbarkeitClient key={`${year}-${month}`} profileId={user.id} name={prof?.full_name ?? ''} year={year} month={month} initial={verfuegbarkeit} anfragen={anfragen}
          entscheidungen={entscheidungen} planEintraege={eigenePlanEintraege} planSichtbar={canView} eigene />
      )}
    </div>
  )
}
