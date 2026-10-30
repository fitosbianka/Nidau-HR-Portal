import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import FinanzenClient from '@/components/finanzen/FinanzenClient'
import { hatFinanzZugang } from '@/lib/finanzen/zugang'
import { ladeImportprotokoll } from '@/lib/finanzen/speicher'
import { ladeFinanzBestand, zaehleOffene } from '@/lib/finanzen/daten'

export const dynamic = 'force-dynamic'

// Geschäftsanalyse — nur für FINANZ_ZUGANG (die Admin-Rolle allein reicht
// nicht). An den Client gehen NUR Monats-Aggregate (Zahlen pro Kategorie
// und Monat), das Importprotokoll und die Kategorien-Namen — nie einzelne
// Buchungen (dort stehen Namen von Patienten und Löhne). Die Buchungslisten
// der Monatsdetails und der Prüfliste laden erst auf Klick über geschützte
// Server Actions.
export default async function FinanzenPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (!hatFinanzZugang(p?.role, p?.full_name)) redirect('/admin')

  const admin = await createAdminClient()
  const [bestand, protokoll] = await Promise.all([ladeFinanzBestand(admin), ladeImportprotokoll(admin)])
  const { unklassiertOffen, grosseOffen } = zaehleOffene(bestand)

  // Heutiger Monat in Zürich (bestimmt «laufend» und die Jahresvergleiche)
  const heuteMonat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' })
    .format(new Date()).slice(0, 7)

  return (
    <FinanzenClient
      kontos={bestand.kontos}
      kategorien={bestand.kategorien}
      aggregate={bestand.aggregate}
      ziel={bestand.ziel}
      protokoll={protokoll}
      heuteMonat={heuteMonat}
      unklassiertOffen={unklassiertOffen}
      grosseOffen={grosseOffen}
    />
  )
}
