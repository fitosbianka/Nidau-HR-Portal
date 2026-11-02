import { ohneGaesteErgebnis } from '@/lib/gaeste'
import { createClient } from '@/lib/supabase/server'
import WorkScheduleGrid from '@/components/schedule/WorkScheduleGrid'
import { isMonthReleasedToLeitende } from '@/lib/leitende'
import { getMonthPlanNotes } from '@/lib/plan-notes'
import { getTeamEventDays } from '@/lib/team-events'
import { ladeVerfuegbarkeiten } from '@/lib/verfuegbarkeit-data'
import VerfuegbarkeitClient from '@/components/schedule/VerfuegbarkeitClient'
import { kuerzelFuer } from '@/lib/kuerzel'
import { getTeamHinweise } from '@/lib/plan-hinweise'

interface PageProps {
  searchParams: Promise<{ m?: string }>
}

export default async function AdminArbeitsplanPage({ searchParams }: PageProps) {
  const { m } = await searchParams

  let year  = new Date().getFullYear()
  let month = new Date().getMonth() + 1

  if (m && /^\d{4}-\d{2}$/.test(m)) {
    const [y, mo] = m.split('-').map(Number)
    if (y >= 2020 && y <= 2099 && mo >= 1 && mo <= 12) {
      year  = y
      month = mo
    }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay  = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`

  // All queries are independent — one parallel round-trip instead of five
  // sequential ones (this page re-renders after every saved cell edit).
  // Plan rows: all active employees PLUS Admin-titled profiles regardless of
  // login role (Peter's account is role=admin but he keeps his plan row).
  const [empResult, entriesResult, pubResult, reviewResult, leitendeReleased, planNotes, teamEventDays, verfuegbarkeiten, alleNamen, ich, teamHinweise] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, job_title, can_edit_schedule, abbreviation, schedule_order')
      .or('role.eq.employee,job_title.eq.Admin')
      .eq('is_active', true)
      .order('schedule_order', { ascending: true, nullsFirst: false })
      .order('full_name', { ascending: true })
      .then(ohneGaesteErgebnis),
    supabase
      .from('work_schedule')
      .select('employee_id, schedule_date, entry')
      .gte('schedule_date', firstDay)
      .lte('schedule_date', lastDay),
    supabase
      .from('schedule_publications')
      .select('year')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle(),
    supabase
      .from('schedule_review_days')
      .select('schedule_date')
      .gte('schedule_date', firstDay)
      .lte('schedule_date', lastDay),
    isMonthReleasedToLeitende(supabase, year, month),
    getMonthPlanNotes(supabase, year, month, { includeAdminOnly: true }),
    getTeamEventDays(supabase, firstDay, lastDay),
    // Verfügbarkeit der Personen mit flexiblem Einsatz (z. B. Emese), nur für Admins
    ladeVerfuegbarkeiten(supabase, year, month),
    // Kürzel aller Personen (Vorschläge im Notizfenster, Umwandeln alter Monatsnotizen)
    supabase.from('profiles').select('full_name'),
    user ? supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle() : Promise.resolve({ data: null }),
    // Hinweise für das Team (für alle sichtbar, auch im PDF)
    getTeamHinweise(supabase, year, month),
  ])
  const kuerzel = Array.from(new Set(((alleNamen.data ?? []) as Array<{ full_name: string | null }>).map(p => kuerzelFuer(p.full_name)).filter((k): k is string => !!k)))
  const meinKuerzel = kuerzelFuer((ich.data as { full_name?: string | null } | null)?.full_name)

  const employees = empResult.data
  const isPublished = !!pubResult.data
  const reviewDays = (reviewResult.data ?? []).map((r: { schedule_date: string }) => r.schedule_date)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Arbeitsplan</h1>
        <p className="page-subtitle">Monatliche Dienstplanung — klicken Sie eine Zelle um sie zu bearbeiten</p>
      </div>

      <div className="card overflow-hidden">
        <WorkScheduleGrid
          employees={(employees ?? []) as Array<{ id: string; full_name: string; job_title: string | null; can_edit_schedule?: boolean; abbreviation?: string | null }>}
          entries={(entriesResult.data ?? []) as Array<{ employee_id: string; schedule_date: string; entry: string }>}
          year={year}
          month={month}
          canEdit={true}
          isPublished={isPublished}
          isAdmin={true}
          leitendeReleased={leitendeReleased}
          reviewDays={reviewDays}
          teamEventDays={teamEventDays}
          planNotes={planNotes}
          notizenErlaubt
          kuerzel={kuerzel}
          meinKuerzel={meinKuerzel}
          teamHinweise={teamHinweise}
          basePath="/admin/arbeitsplan"
        />
      </div>

      {verfuegbarkeiten.map(v => (
        <VerfuegbarkeitClient key={`${v.profileId}-${year}-${month}`} profileId={v.profileId} name={v.name} year={year} month={month} initial={v.verfuegbarkeit} anfragen={v.anfragen} entscheidungen={v.entscheidungen} eigene={false}
          planEintraege={((entriesResult.data ?? []) as Array<{ employee_id: string; schedule_date: string; entry: string }>)
            .filter(e => e.employee_id === v.profileId).map(e => ({ datum: e.schedule_date, position: e.entry }))} />
      ))}
    </div>
  )
}
