import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { hatFinanzZugang } from '@/lib/finanzen/zugang'
import { ladeFinanzBestand } from '@/lib/finanzen/daten'
import { zaehleRegelTreffer } from '@/lib/finanzen/kategorien'
import RegelnClient from '@/components/finanzen/RegelnClient'

export const dynamic = 'force-dynamic'

// Kategorien & Regeln der Geschäftsanalyse — gleicher Zugangsschutz wie
// die Hauptseite. Die Treffer-Zahlen (letzte 12 Monate) werden hier auf
// dem Server gezählt; Buchungstexte gehen nur über «Regel testen» und
// bewusst auf Klick an den Browser.
export default async function FinanzRegelnPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (!hatFinanzZugang(p?.role, p?.full_name)) redirect('/admin')

  const admin = await createAdminClient()
  const bestand = await ladeFinanzBestand(admin)

  const grenze = new Date()
  grenze.setMonth(grenze.getMonth() - 12)
  const ab = grenze.toISOString().slice(0, 10)
  const letzteBuchungen: Parameters<typeof zaehleRegelTreffer>[0] = []
  bestand.buchungenProKonto.forEach(bs => {
    for (const b of bs) if (b.buchungsdatum >= ab) letzteBuchungen.push(b)
  })
  const trefferMap = zaehleRegelTreffer(letzteBuchungen, bestand.ctx)
  const treffer: Record<string, number> = {}
  trefferMap.forEach((n, id) => { treffer[id] = n })

  return (
    <RegelnClient
      kategorien={bestand.kategorien}
      regeln={bestand.regeln}
      kontos={bestand.kontos}
      treffer={treffer}
    />
  )
}
