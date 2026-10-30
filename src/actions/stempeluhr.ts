'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { STEMPELUHR_NAME, type StempelAktion } from '@/lib/stempeluhr'
import { zurichTagesFenster } from '@/lib/zeitzone'

// Nur Bianka (Admin) stempelt hier — die Stempel landen als Portal-Events
// in attendance_events, im gleichen In/Out-Paar-Format wie TimeMoto.
// Nachtragen/Bearbeiten/Löschen läuft über die Berichtsansicht auf der
// Seite (gleiche Werkzeuge wie die Zeiterfassungs-Seite: /api/admin/
// attendance mit weichem Löschen in den Papierkorb).
async function requireBianka() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (p?.role !== 'admin' || p.full_name !== STEMPELUHR_NAME) throw new Error('Keine Berechtigung')
  return { admin: await createAdminClient(), profileId: user.id }
}

export async function stempeln(aktion: StempelAktion) {
  const { admin, profileId } = await requireBianka()
  const { start, ende } = zurichTagesFenster()

  const { data, error: ladeFehler } = await admin
    .from('attendance_events')
    .select('clocking_type, clocking_pair_id, time_logged')
    .eq('user_full_name', STEMPELUHR_NAME)
    .is('deleted_at', null)
    .gte('time_logged', start)
    .lt('time_logged', ende)
    .order('time_logged', { ascending: true })
  if (ladeFehler) return { error: `Stempel-Status konnte nicht geladen werden: ${ladeFehler.message}` }

  const heute = (data ?? []) as Array<{ clocking_type: string; clocking_pair_id: string | null; time_logged: string }>
  const letzter = heute[heute.length - 1]
  const drin = letzter?.clocking_type === 'In'

  // Zustands-Prüfung — verhindert Doppelstempel (z.B. zweimal Einstempeln)
  if ((aktion === 'einstempeln' || aktion === 'zurueck') && drin) {
    return { error: 'Du bist bereits eingestempelt.' }
  }
  if ((aktion === 'pause' || aktion === 'ausstempeln') && !drin) {
    return { error: 'Du bist zurzeit nicht eingestempelt.' }
  }

  // Zeitstempel wie TimeMoto auf die ganze Minute gerundet
  const jetzt = new Date()
  jetzt.setUTCSeconds(0, 0)
  const id = `portal_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

  let pairId: string
  if (aktion === 'einstempeln' || aktion === 'zurueck') {
    pairId = `portalpair_${id}`
  } else {
    // «Out» gehört zum Paar des letzten offenen «In»
    const letztesIn = [...heute].reverse().find(e => e.clocking_type === 'In')
    pairId = letztesIn?.clocking_pair_id ?? `portalpair_${id}`
  }

  const zeile = {
    timemoto_event_id: id,
    timemoto_user_id: null,
    employee_id: profileId,
    user_full_name: STEMPELUHR_NAME,
    clocking_type: aktion === 'einstempeln' || aktion === 'zurueck' ? 'In' : 'Out',
    time_logged: jetzt.toISOString(),
    time_inserted: new Date().toISOString(),
    clocking_pair_id: pairId,
    department_name: null,
    // kein location_name: die Quelle steht im raw_payload — neben den
    // Zeiten soll kein «HR-Portal»-Text erscheinen
    location_name: null,
    raw_payload: { source: 'portal-stempeluhr', aktion },
    deleted_at: null,
  }
  // Zuverlässigkeit: schlägt der Insert vorübergehend fehl, wird einmal
  // automatisch wiederholt (Upsert auf die feste ID — nie doppelt); erst
  // danach gibt es eine sichtbare Fehlermeldung, damit KEIN Stempel still
  // verloren geht.
  let { error } = await admin.from('attendance_events')
    .upsert(zeile, { onConflict: 'timemoto_event_id', ignoreDuplicates: true })
  if (error) {
    await new Promise(r => setTimeout(r, 400))
    ;({ error } = await admin.from('attendance_events')
      .upsert(zeile, { onConflict: 'timemoto_event_id', ignoreDuplicates: true }))
  }
  if (error) return { error: `Der Stempel wurde NICHT gespeichert (${error.message}) — bitte erneut drücken.` }

  revalidatePath('/admin/stempeluhr')
  return { success: true }
}
