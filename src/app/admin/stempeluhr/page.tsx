import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import StempeluhrClient from '@/components/stempeluhr/StempeluhrClient'
import AufgabenZeitClient from '@/components/stempeluhr/AufgabenZeitClient'
import { ladeAufgabenZeit } from '@/lib/aufgaben-zeit'
import BerichteClient from '@/app/admin/zeiterfassung/berichte/BerichteClient'
import { loadStempeluhrBerichteData } from '@/lib/berichte-data'
import { STEMPELUHR_NAME, type Stempel } from '@/lib/stempeluhr'
import { zurichHeute, zurichTagesFenster } from '@/lib/zeitzone'

export const dynamic = 'force-dynamic'

// Persönliche Stempeluhr — NUR für Bianka (Admin). Oben die grosse
// Stempel-Karte, dann die Aufgaben Zeiterfassung (Kategorien, Aufgaben,
// Zeit pro Tag, Auswertung pro Woche, Monat, Jahr), darunter DIESELBE
// Berichtsansicht wie die Zeiterfassungs-Seite (öffnet auf dem laufenden
// Monat), nur mit den eigenen Zeiten: inklusive «＋ Eintrag hinzufügen»
// (mit Pause/Zurück), Bearbeiten, Löschen in den Papierkorb
// (wiederherstellbar), Protokoll, CSV und PDF.
export default async function StempeluhrPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (p?.role !== 'admin' || p.full_name !== STEMPELUHR_NAME) redirect('/admin')

  const admin = await createAdminClient()

  // Berichtsdaten (eigene Events, ganze Historie) für die Detailansicht,
  // dazu die Aufgaben Zeiterfassung (Kategorien und alle Einträge)
  const [daten, aufgaben] = await Promise.all([
    loadStempeluhrBerichteData(admin, user.id, STEMPELUHR_NAME),
    ladeAufgabenZeit(admin),
  ])

  // Heutige Stempel separat und MIT raw_payload — nur so weiss die
  // Statusanzeige, ob ein «Out» eine Pause oder Feierabend war
  const todayStr = zurichHeute()
  const { start: dayStart, ende: dayEnd } = zurichTagesFenster(todayStr)
  const { data: heuteRows } = await admin
    .from('attendance_events')
    .select('timemoto_event_id, clocking_type, time_logged, clocking_pair_id, raw_payload')
    .eq('user_full_name', STEMPELUHR_NAME)
    .is('deleted_at', null)
    .gte('time_logged', dayStart)
    .lt('time_logged', dayEnd)
    .order('time_logged', { ascending: true })
  type Row = {
    timemoto_event_id: string
    clocking_type: string
    time_logged: string | null
    clocking_pair_id: string | null
    raw_payload: { aktion?: string } | null
  }
  const stempel: Stempel[] = ((heuteRows ?? []) as Row[])
    .filter(r => r.time_logged && (r.clocking_type === 'In' || r.clocking_type === 'Out'))
    .map(r => ({
      id: r.timemoto_event_id,
      typ: r.clocking_type as 'In' | 'Out',
      zeit: r.time_logged!,
      pairId: r.clocking_pair_id,
      aktion: r.clocking_type === 'Out'
        ? (r.raw_payload?.aktion === 'pause' ? 'pause' : 'ausstempeln')
        : null,
    }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Meine Stempeluhr</h1>
        <p className="page-subtitle">Stempeln, Aufgaben erfassen, Auswertung</p>
      </div>

      {/* Grosse Stempel-Karte, zentriert */}
      <StempeluhrClient stempel={stempel} />

      {/* Aufgaben Zeiterfassung: erfassen, Auswertung, Einträge, Verwaltung */}
      <AufgabenZeitClient konfig={aufgaben.konfig} eintraege={aufgaben.eintraege} heute={todayStr} />

      {/* Dieselbe Ansicht wie die Zeiterfassungs-Seite, nur mit den eigenen
          Zeiten — öffnet auf dem laufenden Monat */}
      <BerichteClient
        events={daten.events as never}
        initialComments={daten.initialComments}
        planAbsences={daten.planAbsences}
        profiles={daten.profiles}
        title="Meine Stempelzeiten"
        subtitle="Laufender Monat"
      />
    </div>
  )
}
