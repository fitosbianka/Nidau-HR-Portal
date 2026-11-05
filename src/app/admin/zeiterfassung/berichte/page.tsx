import { createClient } from '@/lib/supabase/server'
import { loadBerichteData } from '@/lib/berichte-data'
import BerichteClient from './BerichteClient'

export const dynamic = 'force-dynamic'

export default async function AdminBerichtePage() {
  const supabase = await createClient()
  const { events, initialComments, planAbsences, profiles, anteile } = await loadBerichteData(supabase)

  return (
    <BerichteClient
      events={events as never}
      initialComments={initialComments}
      planAbsences={planAbsences}
      profiles={profiles}
      anteile={anteile}
    />
  )
}
