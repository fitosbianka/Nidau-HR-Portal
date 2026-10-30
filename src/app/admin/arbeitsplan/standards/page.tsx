import { ohneGaesteErgebnis } from '@/lib/gaeste'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getStandardWeeks } from '@/lib/plan-standards'
import StandardsClient from './StandardsClient'

export const dynamic = 'force-dynamic'

export default async function StandardsPage() {
  const supabase = await createClient()

  // Same rows as the Arbeitsplan (employees + Admin-titled profiles)
  const { data: employees } = await supabase
    .from('profiles')
    .select('id, full_name, job_title, schedule_order')
    .or('role.eq.employee,job_title.eq.Admin')
    .eq('is_active', true)
    .order('schedule_order', { ascending: true, nullsFirst: false })
    .order('full_name', { ascending: true })
    .then(ohneGaesteErgebnis)

  const adminClient = await createAdminClient()
  const standards = await getStandardWeeks(adminClient)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Mitarbeiter-Standards</h1>
        <p className="page-subtitle">
          Standardwoche pro Mitarbeiter/in — beim Speichern werden die Regeln automatisch auf alle künftigen Monate im Arbeitsplan angewendet
        </p>
      </div>

      <StandardsClient
        employees={(employees ?? []) as Array<{ id: string; full_name: string; job_title: string | null }>}
        standards={standards}
      />
    </div>
  )
}
