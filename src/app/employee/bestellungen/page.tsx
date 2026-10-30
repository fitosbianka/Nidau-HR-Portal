import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import BestellungenClient from '@/components/bestellungen/BestellungenClient'
import { loadBestellungenData } from '@/lib/bestellungen-data'
import { hatBestellZugang } from '@/lib/bestellungen'
import { LEITENDE_TITLE } from '@/lib/leitende'

export const dynamic = 'force-dynamic'

// Bestellungen für die Berechtigten ausserhalb des Admin-Bereichs:
// die Leitenden DA und die Bestell-Verantwortliche (Neya).
export default async function EmployeeBestellungenPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, job_title')
    .eq('id', user.id)
    .single()
  const p = profile as { role: string; full_name: string; job_title: string | null } | null
  if (!hatBestellZugang(p?.role, p?.job_title, p?.full_name, LEITENDE_TITLE)) redirect('/employee')

  const data = await loadBestellungenData(await createAdminClient())

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Bestellungen</h1>
        <p className="page-subtitle">Material bestellen: Produkte, Bestellliste nach Firmen, Empfehlungen und Verlauf</p>
      </div>
      <BestellungenClient data={data} />
    </div>
  )
}
