import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import ExternEinsaetze from '@/components/admin/ExternEinsaetze'
import { ladeExterneEinsaetze } from '@/lib/externe-einsaetze-data'
import { istExternNutzer } from '@/lib/externe'
import { zurichToday } from '@/lib/salary-sync'

export const dynamic = 'force-dynamic'

/** Eigene Einsätze einer externen Person (zum Beispiel Fritz): dieselbe
 *  Liste wie auf der Mitarbeiterseite der Admins, nur zum Lesen. */
export default async function EinsaetzePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single()
  const fullName = (profile as { full_name: string | null } | null)?.full_name ?? null
  const adminClient = await createAdminClient()
  if (!(await istExternNutzer(adminClient, { id: user.id, full_name: fullName }))) redirect('/employee')
  const einsaetze = await ladeExterneEinsaetze(adminClient, { id: user.id, full_name: fullName })
  const vorname = (fullName ?? '').split(' ')[0] || 'dich'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Meine Einsätze</h1>
        <p className="mt-1.5 text-[12.5px] text-ink-3">Feste Einsätze und Vertretungswochen mit Datum und Zeit. Erledigte und abgesagte Einsätze markiert die Praxis.</p>
      </div>
      <ExternEinsaetze employeeId={user.id} vorname={vorname} einsaetze={einsaetze} heute={zurichToday()} readOnly />
    </div>
  )
}
