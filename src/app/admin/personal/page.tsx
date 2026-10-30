import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { loadPersonalEintraege } from '@/lib/personal-data'
import PersonalClient from './PersonalClient'

export const dynamic = 'force-dynamic'

/** Personal-Änderungen (admin only): upcoming staff changes — manual entries
 *  plus automatic ones from the Lohn-Historie (future effective dates) and
 *  future Eintrittsdaten. */
export default async function PersonalPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') redirect('/employee')

  const admin = await createAdminClient()
  const { eintraege, namen, today } = await loadPersonalEintraege(admin)

  return (
    <PersonalClient
      eintraege={eintraege}
      namen={namen}
      today={today}
    />
  )
}
