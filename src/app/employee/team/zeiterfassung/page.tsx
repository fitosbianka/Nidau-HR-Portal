import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { LEITENDE_TITLE } from '@/lib/leitende'
import { loadBerichteData } from '@/lib/berichte-data'
import BerichteClient from '@/app/admin/zeiterfassung/berichte/BerichteClient'

export const dynamic = 'force-dynamic'

/** Read-only team Zeiterfassung for the Leitenden DA. */
export default async function TeamZeiterfassungPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('job_title').eq('id', user.id).single()
  if ((profile as { job_title: string | null } | null)?.job_title !== LEITENDE_TITLE) {
    redirect('/employee')
  }

  // Leitende see the team's times — data is read with the service client
  // AFTER the gate above (RLS keeps these tables admin-only otherwise).
  const adminClient = await createAdminClient()
  const { events, initialComments, planAbsences, profiles } = await loadBerichteData(adminClient)

  return (
    <BerichteClient
      events={events as never}
      initialComments={initialComments}
      planAbsences={planAbsences}
      profiles={profiles}
      readOnly
    />
  )
}
