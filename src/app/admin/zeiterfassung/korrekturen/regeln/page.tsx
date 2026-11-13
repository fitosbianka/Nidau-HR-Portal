import { createAdminClient, createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getKontrollRegeln } from '@/lib/kontrolle'
import { modulAktiv } from '@/config/module'
import RegelnClient from './RegelnClient'

export const dynamic = 'force-dynamic'

export default async function KontrollRegelnPage() {
  if (!modulAktiv('kontrolle')) redirect('/admin/zeiterfassung/berichte')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const regeln = await getKontrollRegeln(await createAdminClient())

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Kontroll-Regeln</h1>
        <p className="page-subtitle">
          Diese Regeln prüfen die Zeiterfassungen unter «Kontrolle Vormonat»: passt ein Tag zu einer Regel,
          wird die Korrektur auf 8:30 mit dem Schicht-Namen als Notiz empfohlen
        </p>
      </div>
      <RegelnClient initial={regeln} />
    </div>
  )
}
