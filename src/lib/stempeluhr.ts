// Persönliche Stempeluhr für Bianka (Admin) — wie TimeMoto: Einstempeln,
// Pause, Zurück, Ausstempeln. Die Stempel landen als Portal-Events in
// attendance_events (timemoto_event_id «portal_…»), im selben In/Out-
// Paar-Format wie die TimeMoto-Stempel. Die Mitarbeiter-Berichte und das
// Konto laden nur role='employee'-Profile — Admin-Stempel erscheinen dort
// nicht.

import { PRAXIS } from '@/config/praxis'

export const STEMPELUHR_NAME = PRAXIS.portalAdmin

export type StempelAktion = 'einstempeln' | 'pause' | 'zurueck' | 'ausstempeln'

export type Stempel = {
  id: string
  typ: 'In' | 'Out'
  zeit: string                 // ISO (UTC), auf die Minute gerundet
  pairId: string | null
  /** Bei «Out»: war es eine Pause oder Feierabend? (aus raw_payload) */
  aktion: 'pause' | 'ausstempeln' | null
}

export type StempelSession = {
  von: string
  bis: string | null
  /** Zeilen-IDs für Bearbeiten/Löschen (outId null = laufende Session) */
  inId: string
  outId: string | null
}

export type StempelStatus = 'draussen' | 'eingestempelt' | 'pause' | 'fertig'

export const zurichDateOf = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })

export const fmtStempelZeit = (iso: string) =>
  new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' })

export function fmtStunden(min: number): string {
  const m = Math.max(0, Math.round(min))
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`
}

/** In/Out-Stempel eines Tages (aufsteigend sortiert) zu Sessions paaren.
 *  Gepaart wird über die pairId; ein «Out» ohne offenes «In» wird
 *  übersprungen, ein offenes «In» bleibt als laufende Session (bis null). */
export function sessionsFor(stempel: Stempel[]): StempelSession[] {
  const sessions: StempelSession[] = []
  let offen: Stempel | null = null
  for (const s of stempel) {
    if (s.typ === 'In') {
      if (offen) sessions.push({ von: offen.zeit, bis: null, inId: offen.id, outId: null })   // In ohne Out — defensiv schliessen
      offen = s
    } else if (offen) {
      sessions.push({ von: offen.zeit, bis: s.zeit, inId: offen.id, outId: s.id })
      offen = null
    }
  }
  if (offen) sessions.push({ von: offen.zeit, bis: null, inId: offen.id, outId: null })
  return sessions
}

/** Aktueller Status aus den heutigen Stempeln (aufsteigend sortiert). */
export function statusFor(heute: Stempel[]): StempelStatus {
  const letzter = heute[heute.length - 1]
  if (!letzter) return 'draussen'
  if (letzter.typ === 'In') return 'eingestempelt'
  return letzter.aktion === 'pause' ? 'pause' : 'fertig'
}

/** Arbeits- und Pausenminuten eines Tages; eine laufende Session zählt bis
 *  `nowMs`, Pausen sind die Lücken zwischen den Sessions. */
export function tagesStatistik(sessions: StempelSession[], nowMs: number): { arbeit: number; pause: number } {
  let arbeit = 0
  let pause = 0
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i]
    const ende = s.bis ? new Date(s.bis).getTime() : nowMs
    arbeit += Math.max(0, Math.round((ende - new Date(s.von).getTime()) / 60000))
    if (i > 0 && sessions[i - 1].bis) {
      pause += Math.max(0, Math.round((new Date(s.von).getTime() - new Date(sessions[i - 1].bis!).getTime()) / 60000))
    }
  }
  return { arbeit, pause }
}
