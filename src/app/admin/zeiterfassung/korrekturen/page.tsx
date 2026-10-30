import { createClient } from '@/lib/supabase/server'
import { getZeitKorrekturen } from '@/lib/korrekturen'
import KorrekturenTabelle from '@/components/admin/KorrekturenTabelle'

export default async function KorrekturenPage() {
  const supabase = await createClient()
  const alle = await getZeitKorrekturen(supabase)
  const erledigte = alle.filter(k => k.done)
  const offene = alle.filter(k => !k.done).length

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Korrekturen</h1>
        <p className="page-subtitle">Korrigierte Zeiterfassungs-Meldungen pro Mitarbeiterin</p>
      </div>
      <KorrekturenTabelle erledigte={erledigte} offene={offene} />
    </div>
  )
}
