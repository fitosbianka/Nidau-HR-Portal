import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import AdminDocumentFolders from '@/components/admin/AdminDocumentFolders'
import UploadDocumentForm from '@/components/admin/UploadDocumentForm'
import EmployeeActions from '@/components/admin/EmployeeActions'
import ExternToggle from '@/components/admin/ExternToggle'
import DeleteEmployeeButton from '@/components/admin/DeleteEmployeeButton'
import { ladeExterne, istExtern } from '@/lib/externe'
import AccessSection from '@/components/admin/AccessSection'
import PersonalDetailsSection from '@/components/admin/PersonalDetailsSection'
import AccountingSection from '@/components/admin/AccountingSection'
import HrSection from '@/components/admin/HrSection'
import FerienAnteilSection from '@/components/admin/FerienAnteilSection'
import { ladeFerienAnteilRows } from '@/lib/ferien-anteil-data'
import { anteilAuswirkung, anteilRegelFuer } from '@/lib/ferien-anteil'
import { zurichToday } from '@/lib/salary-sync'
import { bvgAbgleich, ladeBvgStand } from '@/lib/lohn-bvg'
import { formatDateTime, formatDate } from '@/lib/utils'
import type { Profile, SalaryHistory } from '@/lib/supabase/types'

function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).map((n) => n[0]).join('').toUpperCase().slice(0, 2) || '?'
}

export default async function AdminDossierPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const adminClient = await createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Auch Admin Konten werden hier geführt, darum kein Rollenfilter
  const { data: employee } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .in('role', ['employee', 'admin'])
    .single()

  if (!employee) notFound()

  const emp = employee as Profile

  const [documentsResult, salaryResult] = await Promise.all([
    supabase
      .from('documents')
      .select('*')
      .eq('employee_id', id)
      .order('created_at', { ascending: false }),
    adminClient
      .from('salary_history')
      .select('*')
      .eq('employee_id', id)
      .order('effective_date', { ascending: false }),
  ])

  const docList       = (documentsResult.data ?? [])
  const salaryHistory = (salaryResult.data ?? []) as SalaryHistory[]
  // BVG: ohne bestätigten Stand den Betrag der letzten Abrechnung übernehmen,
  // dann den gültigen Stand für den HR-Abschnitt laden
  await bvgAbgleich(adminClient, id)
  const bvg = await ladeBvgStand(adminClient, id)
  const externeIds = await ladeExterne(adminClient)
  const externFest = istExtern(emp.full_name)
  const extern = externFest || externeIds.has(emp.id)
  const unreadCount   = docList.filter((d) => !d.viewed_at).length
  // Ferienanteil pro Wochentag: geltende Regel und die F-Tage im Arbeitsplan,
  // die dadurch anders zählen (Liste der korrigierten Tage)
  const anteilRows = extern ? {} : await ladeFerienAnteilRows(adminClient)
  const anteilGespeichert = anteilRows[emp.id] ?? null
  const anteilRegel = anteilRegelFuer(emp.full_name, anteilGespeichert)
  const anteilStandard = anteilRegelFuer(emp.full_name)
  const anteilAb = anteilRegel?.perioden[0]?.ab ?? null
  const { data: fRows } = anteilAb
    ? await adminClient.from('work_schedule').select('schedule_date, entry').eq('employee_id', emp.id).gte('schedule_date', anteilAb).or('entry.eq.F,entry.like.F:*').order('schedule_date')
    : { data: [] as Array<{ schedule_date: string; entry: string }> }
  const auswirkung = anteilAuswirkung((fRows ?? []) as Array<{ schedule_date: string; entry: string }>, anteilRegel)

  return (
    <div className="space-y-5">
      {/* ── Back link ──────────────────────────────────── */}
      <Link
        href={emp.is_active ? '/admin/mitarbeiter' : '/admin/mitarbeiter/ehemalige'}
        className="inline-flex items-center gap-1.5 text-sm text-ink-4 hover:text-accent-600 transition-colors font-medium"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        {emp.is_active ? 'Zurück zur Übersicht' : 'Zurück zu den Ehemaligen'}
      </Link>

      {/* ── Employee header ─────────────────────────────── */}
      <div className="card p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-accent-300 flex items-center justify-center flex-shrink-0 shadow-md">
              <span className="text-white text-xl font-bold">{getInitials(emp.full_name)}</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-ink">{emp.full_name}</h1>
              {emp.job_title && (
                <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-accent-100 text-accent-600">
                  {emp.job_title}
                </span>
              )}
              {extern && (
                <span className="inline-flex items-center mt-1 ml-1.5 px-2 py-0.5 rounded-md text-xs font-semibold bg-steel-bg text-steel-ink" title="Selbständig, kein Anstellungsverhältnis — zählt nicht als Angestellte/r">
                  Extern
                </span>
              )}
              {!emp.is_active && (
                <span className="inline-flex items-center mt-1 ml-1.5 px-2 py-0.5 rounded-md text-xs font-semibold bg-edge-row text-ink-3" title="Inaktives Konto, Daten und Dokumente bleiben erhalten (Aufbewahrung 10 Jahre)">
                  Ehemalig
                </span>
              )}
              <p className="text-sm text-ink-4 mt-0.5">{emp.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ExternToggle employeeId={emp.id} extern={extern} fest={externFest} />
            <EmployeeActions employee={emp} />
            {(extern || !emp.is_active) && (emp as { role?: string }).role !== 'admin' && (
              <DeleteEmployeeButton employeeId={emp.id} fullName={emp.full_name} extern={extern} />
            )}
          </div>
        </div>

        <div className="mt-5 pt-5 border-t border-edge-soft grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-[10px] font-semibold text-ink-4 uppercase tracking-widest">Status</p>
            <span className={`badge mt-1.5 ${emp.is_active ? 'badge-green' : 'badge-gray'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${emp.is_active ? 'bg-mint-mid' : 'bg-ink-4'}`} />
              {emp.is_active ? 'Aktiv' : 'Inaktiv'}
            </span>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-ink-4 uppercase tracking-widest">Dokumente</p>
            <p className="text-lg font-bold text-ink mt-1">{docList.length}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-ink-4 uppercase tracking-widest">Letzter Login</p>
            <p className="text-sm text-ink-2 mt-1.5" suppressHydrationWarning>
              {emp.last_login ? formatDateTime(emp.last_login) : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-ink-4 uppercase tracking-widest">Dabei seit</p>
            <p className="text-sm text-ink-2 mt-1.5" suppressHydrationWarning>
              {emp.eintrittsdatum ? formatDate(emp.eintrittsdatum) : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Detail sections ─────────────────────────────── */}
      <PersonalDetailsSection employee={emp} />

      {/* ── Zugriff (Rolle) ─────────────────────────────── */}
      <AccessSection
        employeeId={emp.id}
        fullName={emp.full_name}
        role={(emp as { role?: string }).role ?? 'employee'}
        isSelf={emp.id === user?.id}
      />
      <AccountingSection employee={emp} />
      {!extern && <HrSection employee={emp} salaryHistory={salaryHistory} bvg={bvg} />}
      {!extern && (
        <FerienAnteilSection employeeId={emp.id} vorname={(emp.full_name ?? '').split(' ')[0] || 'diese Person'} pensum={(emp as { pensum?: number | null }).pensum ?? null}
          regel={anteilRegel} gespeichert={anteilGespeichert !== null} standard={anteilStandard} auswirkung={auswirkung} heute={zurichToday()} />
      )}

      {/* ── Documents ───────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-edge-soft flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-2">
            Dokumente
            <span className="ml-2 text-ink-4 font-normal">({docList.length})</span>
          </h2>
          {unreadCount > 0 && (
            <span className="badge badge-teal">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
              {unreadCount} nicht gelesen
            </span>
          )}
        </div>
        <AdminDocumentFolders documents={docList} />
      </div>

      <div className="card p-6">
        <h2 className="text-sm font-semibold text-ink-2 mb-5">Dokument hochladen</h2>
        <UploadDocumentForm employeeId={id} />
      </div>
    </div>
  )
}
