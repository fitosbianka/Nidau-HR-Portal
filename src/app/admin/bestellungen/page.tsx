import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import BestellungenClient from '@/components/bestellungen/BestellungenClient'
import { loadBestellungenData } from '@/lib/bestellungen-data'

export const dynamic = 'force-dynamic'

export default async function AdminBestellungenPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Zugang: das Admin-Layout lässt nur Admins hierher
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
