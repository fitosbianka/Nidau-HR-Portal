import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import BerichteClient from '@/app/admin/zeiterfassung/berichte/BerichteClient'
import { loadOwnBerichteData } from '@/lib/berichte-data'
import { istExternNutzer } from '@/lib/externe'

export const dynamic = 'force-dynamic'

/** Personal live Zeiterfassung — the same report view the admin uses,
 *  filtered server-side to the signed-in employee only. */
export default async function EmployeeMeineZeitenPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single()
  const fullName = ((profile as { full_name?: string } | null)?.full_name ?? '').trim()
  if (!fullName) redirect('/employee')

  const adminClient = await createAdminClient()
  // Externe haben keine Zeiterfassung
  if (await istExternNutzer(adminClient, { id: user.id, full_name: fullName })) redirect('/employee')
  const { events, initialComments, planAbsences, profiles, anteile } = await loadOwnBerichteData(adminClient, user.id, fullName)

  return (
    <BerichteClient
      events={events as never}
      initialComments={initialComments}
      planAbsences={planAbsences}
      profiles={profiles}
      anteile={anteile}
      readOnly
      title="Meine Zeiten"
      subtitle="Ihre persönliche Zeiterfassung aus den TimeMoto Stempelungen"
    />
  )
}
