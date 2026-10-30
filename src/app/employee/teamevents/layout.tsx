import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { istExternNutzer } from '@/lib/externe'
import { modulAktiv } from '@/config/module'

/** Teamevents gelten für Angestellte und Gäste. Externe (selbständig, zum
 *  Beispiel Fritz) kommen zurück auf ihre Startseite. */
export default async function TeameventsLayout({ children }: { children: React.ReactNode }) {
  if (!modulAktiv('teamevents')) redirect('/employee/zeiterfassung')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single()
  const fullName = (profile as { full_name: string | null } | null)?.full_name ?? null
  if (await istExternNutzer(await createAdminClient(), { id: user.id, full_name: fullName })) redirect('/employee')
  return <>{children}</>
}
