import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { timemotoProtokoll } from '@/actions/timemoto-import'
import ImportClient from './ImportClient'

export const dynamic = 'force-dynamic'

export default async function TimemotoImportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const protokoll = await timemotoProtokoll()

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">TimeMoto Import</h1>
        <p className="page-subtitle">
          Monatsexport der Stempelungen aus dem TimeMoto Portal hochladen. Die Zeiten erscheinen danach in der Zeiterfassung, im Arbeitszeit- und Ferienkonto und bei den Mitarbeitenden unter «Meine Zeiten».
        </p>
      </div>
      <ImportClient protokoll={protokoll} />
    </div>
  )
}
