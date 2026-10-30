import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { LEITENDE_TITLE } from '@/lib/leitende'
import { loadKontoEmployees } from '@/lib/konto-data'
import KontoClient from '@/app/admin/zeiterfassung/konto/KontoClient'

export const dynamic = 'force-dynamic'

/** Read-only team Arbeitszeit- und Ferienkonto for the Leitenden DA. */
export default async function TeamKontoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('job_title').eq('id', user.id).single()
  if ((profile as { job_title: string | null } | null)?.job_title !== LEITENDE_TITLE) {
    redirect('/employee')
  }

  const adminClient = await createAdminClient()
  const { employees, year } = await loadKontoEmployees(adminClient)

  return <KontoClient employees={employees} year={year} readOnly />
}
