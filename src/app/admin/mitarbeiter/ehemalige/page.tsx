import { ohneGaesteErgebnis } from '@/lib/gaeste'
import { hatPortalKonto, OHNE_KONTO_TEXT } from '@/lib/konto-status'
import Link from 'next/link'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import { ladeExterne, istExternProfil } from '@/lib/externe'

export const dynamic = 'force-dynamic'

// Ehemalige Mitarbeitende: inaktive Konten getrennt von den Aktiven. Alle
// Daten (Dokumente, Zeiten, Lohn, Verlauf) bleiben vollständig erhalten —
// Aufbewahrungspflicht 10 Jahre. Über die Detailseite lässt sich ein Konto
// jederzeit wieder aktivieren.

const fmtCH = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`
const initials = (name: string) => name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'

export default async function EhemaligePage() {
  const supabase = await createClient()
  const admin = await createAdminClient()
  const [{ data: rows }, { data: docData }, externeIds] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, job_title, last_login, created_at, eintrittsdatum')
      .in('role', ['employee', 'admin'])
      .eq('is_active', false)
      .order('full_name')
      .then(ohneGaesteErgebnis),
    supabase.from('documents').select('employee_id').not('employee_id', 'is', null),
    ladeExterne(admin),
  ])
  const countMap: Record<string, number> = {}
  for (const d of (docData ?? []) as Array<{ employee_id: string }>) countMap[d.employee_id] = (countMap[d.employee_id] ?? 0) + 1
  const ehemalige = (rows ?? []) as Array<{ id: string; full_name: string; email: string; job_title: string | null; last_login: string | null; created_at: string; eintrittsdatum: string | null }>

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/mitarbeiter" className="inline-flex items-center gap-1.5 text-sm text-ink-4 hover:text-accent-600 transition-colors font-medium">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          Zurück zu den aktiven Mitarbeitenden
        </Link>
        <h1 className="page-title mt-2">Ehemalige Mitarbeitende</h1>
        <p className="page-subtitle">Inaktive Konten. Dokumente, Zeiten, Lohn und Verlauf bleiben vollständig erhalten (Aufbewahrung 10 Jahre).</p>
      </div>

      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-edge-soft flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-ink-2">Archiv</h2>
          <span className="text-[11px] text-ink-4 tnum">{ehemalige.length} Person{ehemalige.length !== 1 ? 'en' : ''}</span>
        </div>
        {ehemalige.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-semibold text-ink-2">Keine ehemaligen Mitarbeitenden</p>
            <p className="text-xs text-ink-4 mt-1">Deaktivierte Konten erscheinen hier automatisch.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-edge-soft bg-surface/60">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider">Mitarbeiter</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider hidden sm:table-cell">Kategorie</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider hidden sm:table-cell">Eintritt</th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">Dok.</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider hidden md:table-cell">Letzter Login</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge-row">
                {ehemalige.map(e => (
                  <tr key={e.id} className="hover:bg-hovrow transition-colors group">
                    <td className="px-6 py-4">
                      <Link href={`/admin/employees/${e.id}`} className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-edge-row flex items-center justify-center flex-shrink-0">
                          <span className="text-ink-3 text-xs font-bold">{initials(e.full_name)}</span>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-ink group-hover:text-accent-600 transition-colors">{e.full_name}</p>
                          <p className="text-xs text-ink-4">{hatPortalKonto(e.email) ? e.email : OHNE_KONTO_TEXT}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-6 py-4 hidden sm:table-cell">
                      {e.job_title ? <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-accent-100 text-accent-600">{e.job_title}</span> : <span className="text-sm text-ink-5">—</span>}
                      {istExternProfil(e, externeIds) && <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-steel-bg text-steel-ink">Extern</span>}
                    </td>
                    <td className="px-6 py-4 hidden sm:table-cell text-sm text-ink-2 tnum">{e.eintrittsdatum ? fmtCH(e.eintrittsdatum) : '—'}</td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-full bg-edge-row text-xs font-semibold text-ink-2">{countMap[e.id] ?? 0}</span>
                    </td>
                    <td className="px-6 py-4 hidden md:table-cell text-sm text-ink-3">{e.last_login ? formatDate(e.last_login) : '—'}</td>
                    <td className="px-6 py-4">
                      <span className="badge badge-gray"><span className="w-1.5 h-1.5 rounded-full bg-ink-4" />Inaktiv</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-[11px] text-ink-4 px-1">Auf der Detailseite einer Person lassen sich alle Dokumente weiterhin öffnen, und das Konto kann mit «Aktivieren» wieder in die aktive Liste zurückgeholt werden.</p>
    </div>
  )
}
