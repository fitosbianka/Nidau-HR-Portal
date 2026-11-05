import { createClient } from '@/lib/supabase/server'
import { loadKontoEmployees } from '@/lib/konto-data'
import KontoClient from './KontoClient'

export const dynamic = 'force-dynamic'

export default async function KontoPage() {
  const supabase = await createClient()
  // laufenderMonat: admins see the current month as a running Zwischenstand
  const { employees, year, pruefung, pruefZeitraum } = await loadKontoEmployees(supabase, { laufenderMonat: true })
  return <KontoClient employees={employees} year={year} pruefung={pruefung} pruefZeitraum={pruefZeitraum} />
}
