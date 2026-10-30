import { ohneGaesteErgebnis } from '@/lib/gaeste'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import EmployeeDocumentList from '@/components/employee/EmployeeDocumentList'
import ZeitKorrekturCard from '@/components/employee/ZeitKorrekturCard'
import AnekdotenBox from '@/components/anekdoten/AnekdotenBox'
import KontoClient from '@/app/admin/zeiterfassung/konto/KontoClient'
import { loadKontoEmployees } from '@/lib/konto-data'
import { getZeitKorrekturen } from '@/lib/korrekturen'
import { getAnekdoten, anekdotenAktiv, type Anekdote } from '@/lib/anekdoten'
import { LEITENDE_TITLE } from '@/lib/leitende'
import { formatDateOptional } from '@/lib/utils'
import { istExternNutzer } from '@/lib/externe'
import { modulAktiv } from '@/config/module'

export const dynamic = 'force-dynamic'

function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).map((n) => n[0]).join('').toUpperCase().slice(0, 2) || '?'
}

export default async function EmployeeDossierPage() {
  if (!modulAktiv('hrDokumente')) redirect('/employee/zeiterfassung')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Profile, documents and the Konto are independent — one parallel
  // round-trip instead of three sequential ones. Service client only AFTER
  // the auth check above.
  const adminClient = await createAdminClient()
  const [{ data: profile }, { data: documents }, kontoResult, alleKorrekturen] = await Promise.all([
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single(),
    supabase
      .from('documents')
      .select('*')
      .eq('employee_id', user.id)
      .order('created_at', { ascending: false }),
    // Employees see a completed month only after it was controlled and its
    // exports were placed in the Dokumente folders (releasedOnly).
    loadKontoEmployees(adminClient, { releasedOnly: true }),
    getZeitKorrekturen(adminClient),
  ])

  if (!profile) {
    return (
      <div className="card p-8 text-center">
        <p className="text-ink-3 text-sm">Ihr Profil konnte nicht geladen werden. Bitte kontaktieren Sie den Administrator.</p>
      </div>
    )
  }

  const docs = documents ?? []
  const unreadCount = docs.filter((d) => !d.viewed_at).length

  // Own Arbeitszeit- und Ferienkonto — computed exactly like the admin page,
  // then filtered to this employee only.
  const { employees: kontoAll, year } = kontoResult
  const myKonto = kontoAll.filter(e => e.id === user.id)
  const meineKorrekturen = alleKorrekturen.filter(k => k.name === profile.full_name)

  const eintritt = (profile.eintrittsdatum as string | null) ?? null
  // Externe (selbständig): kein Pensum, kein Arbeitszeit und Ferienkonto, keine Korrekturmeldungen
  const extern = await istExternNutzer(adminClient, { id: user.id, full_name: profile.full_name })

  // ── Anekdoten-Box fürs Teamevent: nur für Leitende, befristet bis 16.10.
  //    Sichtbar sind Einträge für alle Leitenden plus die eigenen.
  const todayZ = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })
  let anekdoten: Anekdote[] | null = null
  let anekdotenNamen: string[] = []
  if (profile.job_title === LEITENDE_TITLE && anekdotenAktiv(todayZ)) {
    const [alle, { data: nameRows }] = await Promise.all([
      getAnekdoten(adminClient),
      adminClient.from('profiles').select('full_name, is_active, job_title').eq('role', 'employee').order('full_name').then(ohneGaesteErgebnis),
    ])
    anekdoten = alle.filter(a => a.sicht === 'leitende' || a.vonId === user.id)
    anekdotenNamen = ((nameRows ?? []) as Array<{ full_name: string; is_active: boolean }>)
      .filter(r => r.is_active).map(r => r.full_name)
  }

  const angaben: Array<{ label: string; value: string }> = extern
    ? [
        { label: 'Funktion', value: profile.job_title ?? '—' },
        { label: 'Geburtsdatum', value: formatDateOptional(profile.birthday) },
        { label: 'Vertragsbeginn', value: formatDateOptional(eintritt) },
      ]
    : [
        { label: 'Funktion', value: profile.job_title ?? '—' },
        { label: 'Pensum', value: profile.pensum != null ? `${profile.pensum}%` : '—' },
        { label: 'Geburtsdatum', value: formatDateOptional(profile.birthday) },
        { label: 'Eintrittsdatum', value: formatDateOptional(eintritt) },
      ]

  return (
    <div className="space-y-6">
      {/* ── Profile / persönliche Angaben ────────────────── */}
      <div className="card p-6">
        <div className="flex items-center gap-4">
          <div className="avatar w-14 h-14 text-xl">
            {getInitials(profile.full_name)}
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink">{profile.full_name}</h1>
            <p className="text-sm text-ink-3 mt-0.5">
              {profile.job_title ?? 'Mitarbeiterin / Mitarbeiter'}
            </p>
          </div>
        </div>

        <div className="mt-5 pt-5 border-t border-edge-soft">
          <p className="eyebrow mb-3">Persönliche Angaben</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4">
            {angaben.map(a => (
              <div key={a.label}>
                <p className="text-[10px] font-semibold text-ink-4 uppercase tracking-[.14em]">{a.label}</p>
                <p className="text-sm font-semibold text-ink mt-1 tnum break-words">{a.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Anekdoten fürs Teamevent (nur Leitende, bis 16.10.) ── */}
      {anekdoten !== null && (
        <AnekdotenBox items={anekdoten} meId={user.id} isAdmin={false} nameVorschlaege={anekdotenNamen} />
      )}

      {/* ── Own Arbeitszeit- und Ferienkonto ─────────────── */}
      {!extern && myKonto.length > 0 && (
        <div>
          <p className="eyebrow mb-2.5">Mein Arbeitszeit- und Ferienkonto {year}</p>
          <KontoClient employees={myKonto} year={year} readOnly hideHeader />
        </div>
      )}

      {/* ── Zeiterfassung correction requests ────────────── */}
      {!extern && <ZeitKorrekturCard mine={meineKorrekturen} />}

      {/* ── Document list ────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-edge-soft flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-2">Meine Dokumente</h2>
          {unreadCount > 0 && (
            <span className="badge badge-teal">
              <span className="w-1.5 h-1.5 rounded-full bg-mint-mid" />
              {unreadCount} neu
            </span>
          )}
        </div>
        <EmployeeDocumentList documents={docs} />
      </div>
    </div>
  )
}
