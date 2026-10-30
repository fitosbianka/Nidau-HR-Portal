import { ohneGaesteErgebnis } from '@/lib/gaeste'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { loadParkplatzData } from '@/lib/parkplatz'
import ParkplaetzeClient from './ParkplaetzeClient'

export const dynamic = 'force-dynamic'

/** Parkplatz-Vermietung (Einstellhalle) — admin only. The admin layout
 *  already redirects non-admins; this page double-checks on top. */
export default async function ParkplaetzePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') redirect('/employee')

  const admin = await createAdminClient()
  const [{ teilnehmer, zahlungen }, { data: profiles }] = await Promise.all([
    loadParkplatzData(admin),
    admin.from('profiles')
      .select('id, full_name, pensum, job_title')
      .in('role', ['employee', 'admin'])
      .eq('is_active', true)
      .order('full_name')
      .then(ohneGaesteErgebnis),
  ])

  return (
    <ParkplaetzeClient
      teilnehmer={teilnehmer}
      zahlungen={zahlungen}
      profiles={(profiles ?? []) as Array<{ id: string; full_name: string; pensum: number | null }>}
    />
  )
}
