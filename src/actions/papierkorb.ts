'use server'

// Papierkorb der Zeiterfassung: «weich» gelöschte Stempel-Einträge ansehen
// und wiederherstellen. Gelöscht wird im Portal nie endgültig (deleted_at),
// und auch der TimeMoto-Sync markiert Einträge nur als gelöscht — hier kann
// der Admin sie pro Tag und Mitarbeiterin zurückholen.

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logZeitChange, zurichDateOf, zurichTimeOf } from '@/lib/zeit-log'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht angemeldet.')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') throw new Error('Keine Berechtigung.')
  return await createAdminClient()
}

export type GeloeschterTag = {
  name: string
  datum: string          // YYYY-MM-DD (Zürich)
  ids: string[]          // timemoto_event_ids des Tages
  zeiten: string[]       // z.B. ['Ein 07:04', 'Aus 08:33']
  geloeschtAm: string    // jüngstes Löschdatum (YYYY-MM-DD) der Gruppe
  /** true = zu mind. einem Eintrag existiert eine AKTIVE Version desselben
   *  Stempelpaars (TimeMoto-Bearbeitungs-Versuch). Wiederherstellen würde
   *  die Zeit doppelt zählen — im UI gesperrt. */
  konflikt: boolean
}

type DeletedRow = {
  timemoto_event_id: string
  user_full_name: string | null
  clocking_type: string | null
  time_logged: string | null
  deleted_at: string | null
  clocking_pair_id: string | null
  raw_payload: { data?: { absenceTypeName?: string | null } } | null
}

const istAbsenzPlatzhalter = (r: DeletedRow) => !!r.raw_payload?.data?.absenceTypeName

/** Gelöschte Ein-/Ausstempel-Einträge eines Monats, gruppiert pro
 *  Mitarbeiterin und Tag (neuste Tage zuerst). Absenz-Platzhalter aus
 *  TimeMoto (Plan-Buchungen 07:45–16:15, bewusst nie aktiv) werden
 *  ausgeblendet — sie sind keine echten Stempel und dürfen nie
 *  wiederhergestellt werden. */
export async function getGeloeschteEintraege(monat: string): Promise<{ tage?: GeloeschterTag[]; error?: string }> {
  let admin
  try { admin = await requireAdmin() } catch { return { error: 'Keine Berechtigung.' } }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monat)) return { error: 'Ungültiger Monat.' }

  // UTC-Fenster mit 1 Tag Polster, danach exakt nach Zürich-Datum filtern
  const jahr = parseInt(monat.slice(0, 4), 10)
  const mon = parseInt(monat.slice(5, 7), 10)
  const from = new Date(Date.UTC(jahr, mon - 1, 1) - 86400000).toISOString()
  const to = new Date(Date.UTC(jahr, mon, 1) + 86400000).toISOString()

  const { data, error } = await admin
    .from('attendance_events')
    .select('timemoto_event_id, user_full_name, clocking_type, time_logged, deleted_at, clocking_pair_id, raw_payload')
    .not('deleted_at', 'is', null)
    .in('clocking_type', ['In', 'Out'])
    .gte('time_logged', from)
    .lt('time_logged', to)
    .order('time_logged', { ascending: true })
  if (error) return { error: error.message }

  const rows = ((data ?? []) as DeletedRow[]).filter(r => {
    if (!r.time_logged || istAbsenzPlatzhalter(r)) return false
    return zurichDateOf(r.time_logged).startsWith(monat)
  })

  // Aktive Versionen derselben Stempelpaare finden (Bearbeitungs-Versuche)
  const pairIds = Array.from(new Set(rows.map(r => r.clocking_pair_id).filter((x): x is string => !!x)))
  const aktivSet = new Set<string>()
  if (pairIds.length > 0) {
    const { data: aktive } = await admin
      .from('attendance_events')
      .select('clocking_pair_id, clocking_type')
      .in('clocking_pair_id', pairIds)
      .is('deleted_at', null)
    for (const a of (aktive ?? []) as Array<{ clocking_pair_id: string | null; clocking_type: string | null }>) {
      if (a.clocking_pair_id) aktivSet.add(`${a.clocking_pair_id}|${a.clocking_type}`)
    }
  }

  const groups = new Map<string, GeloeschterTag>()
  for (const r of rows) {
    const datum = zurichDateOf(r.time_logged!)
    const name = r.user_full_name ?? '?'
    const key = `${name}|${datum}`
    if (!groups.has(key)) groups.set(key, { name, datum, ids: [], zeiten: [], geloeschtAm: '', konflikt: false })
    const g = groups.get(key)!
    g.ids.push(r.timemoto_event_id)
    g.zeiten.push(`${r.clocking_type === 'In' ? 'Ein' : 'Aus'} ${zurichTimeOf(r.time_logged!)}`)
    const del = (r.deleted_at ?? '').slice(0, 10)
    if (del > g.geloeschtAm) g.geloeschtAm = del
    if (r.clocking_pair_id && aktivSet.has(`${r.clocking_pair_id}|${r.clocking_type}`)) g.konflikt = true
  }
  const tage = Array.from(groups.values())
    .sort((a, b) => b.datum.localeCompare(a.datum) || a.name.localeCompare(b.name))
  return { tage }
}

export type RohEintrag = {
  id: string             // timemoto_event_id
  name: string
  datum: string          // YYYY-MM-DD (Zürich)
  zeit: string           // HH:MM (Zürich)
  typ: string            // In / Out / anderes
  status: 'aktiv' | 'geloescht'
  quelle: string         // tm (Stempeluhr), manual (Portal), import/pdf (Aufbau)
}

/** Forensik: ALLE Roh-Einträge (aktiv und gelöscht, alle Typen) einer
 *  Mitarbeiterin in einem Zeitraum — um verschobene oder überschriebene
 *  Einträge zu finden, die im normalen Papierkorb nicht auftauchen. */
export async function sucheRohEintraege(nameTeil: string, von: string, bis: string): Promise<{ rows?: RohEintrag[]; abgeschnitten?: boolean; error?: string }> {
  let admin
  try { admin = await requireAdmin() } catch { return { error: 'Keine Berechtigung.' } }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(von) || !/^\d{4}-\d{2}-\d{2}$/.test(bis)) return { error: 'Bitte gültige Daten wählen.' }
  if (bis < von) return { error: 'Bis-Datum liegt vor dem Von-Datum.' }
  if ((new Date(bis).getTime() - new Date(von).getTime()) / 86400000 > 92) return { error: 'Bitte höchstens 3 Monate aufs Mal.' }
  const teil = nameTeil.trim()
  if (teil.length < 2) return { error: 'Bitte mindestens 2 Buchstaben des Namens eingeben.' }

  const from = new Date(new Date(`${von}T00:00:00Z`).getTime() - 86400000).toISOString()
  const to = new Date(new Date(`${bis}T00:00:00Z`).getTime() + 2 * 86400000).toISOString()
  const LIMIT = 1000
  const { data, error } = await admin
    .from('attendance_events')
    .select('timemoto_event_id, user_full_name, clocking_type, time_logged, deleted_at, raw_payload')
    .ilike('user_full_name', `%${teil.replace(/[%_]/g, '')}%`)
    .gte('time_logged', from)
    .lt('time_logged', to)
    .order('time_logged', { ascending: true })
    .limit(LIMIT)
  if (error) return { error: error.message }

  const raw = (data ?? []) as Array<DeletedRow & { deleted_at: string | null }>
  const abgeschnitten = raw.length >= LIMIT
  const rows: RohEintrag[] = []
  for (const r of raw) {
    if (!r.time_logged) continue
    const datum = zurichDateOf(r.time_logged)
    if (datum < von || datum > bis) continue
    rows.push({
      id: r.timemoto_event_id,
      name: r.user_full_name ?? '?',
      datum,
      zeit: zurichTimeOf(r.time_logged),
      typ: `${r.clocking_type ?? '?'}${istAbsenzPlatzhalter(r) ? ' (Absenz-Platzhalter)' : ''}`,
      status: r.deleted_at ? 'geloescht' : 'aktiv',
      quelle: r.timemoto_event_id.startsWith('tm_') ? 'Stempeluhr'
        : r.timemoto_event_id.startsWith('manual_') ? 'Portal'
        : r.timemoto_event_id.replace(/_.*$/, ''),
    })
  }
  return { rows, abgeschnitten }
}

/** Stellt die gelöschten Einträge eines Tages wieder her (deleted_at = null)
 *  und protokolliert die Wiederherstellung im Änderungsprotokoll.
 *  Schutz: Absenz-Platzhalter und Einträge, deren Stempelpaar noch eine
 *  aktive Version hat, werden serverseitig abgewiesen (doppelte Zählung). */
export async function eintraegeWiederherstellen(ids: string[]) {
  let admin
  try { admin = await requireAdmin() } catch { return { error: 'Keine Berechtigung.' } }
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every(id => typeof id === 'string' && id.length > 0)) {
    return { error: 'Ungültige Auswahl.' }
  }

  const { data: rowData } = await admin
    .from('attendance_events')
    .select('timemoto_event_id, user_full_name, clocking_type, time_logged, clocking_pair_id, raw_payload')
    .in('timemoto_event_id', ids)
  const rows = (rowData ?? []) as Array<DeletedRow>

  if (rows.some(istAbsenzPlatzhalter)) {
    return { error: 'Absenz-Platzhalter aus TimeMoto können nicht wiederhergestellt werden — sie sind keine echten Stempelzeiten.' }
  }
  const pairIds = Array.from(new Set(rows.map(r => r.clocking_pair_id).filter((x): x is string => !!x)))
  if (pairIds.length > 0) {
    const { data: aktive } = await admin
      .from('attendance_events')
      .select('clocking_pair_id, clocking_type')
      .in('clocking_pair_id', pairIds)
      .is('deleted_at', null)
    const aktivSet = new Set(((aktive ?? []) as Array<{ clocking_pair_id: string | null; clocking_type: string | null }>)
      .filter(a => a.clocking_pair_id).map(a => `${a.clocking_pair_id}|${a.clocking_type}`))
    if (rows.some(r => r.clocking_pair_id && aktivSet.has(`${r.clocking_pair_id}|${r.clocking_type}`))) {
      return { error: 'Zu diesem Stempel existiert bereits eine aktive Version — Wiederherstellen würde die Zeit doppelt zählen.' }
    }
  }

  const { error } = await admin
    .from('attendance_events')
    .update({ deleted_at: null })
    .in('timemoto_event_id', ids)
  if (error) return { error: error.message }

  // Protokoll: ein Eintrag pro Mitarbeiterin und Tag
  const byDay = new Map<string, { datum: string; emp: string; zeiten: string[] }>()
  for (const r of (rows ?? []) as Array<{ user_full_name: string | null; clocking_type: string | null; time_logged: string | null }>) {
    if (!r.time_logged) continue
    const datum = zurichDateOf(r.time_logged)
    const emp = r.user_full_name ?? '?'
    const key = `${emp}|${datum}`
    if (!byDay.has(key)) byDay.set(key, { datum, emp, zeiten: [] })
    byDay.get(key)!.zeiten.push(zurichTimeOf(r.time_logged))
  }
  for (const g of Array.from(byDay.values())) {
    await logZeitChange(admin, {
      datum: g.datum,
      emp: g.emp,
      text: `Einträge wiederhergestellt (${g.zeiten.join(', ')})`,
    })
  }

  revalidatePath('/admin/zeiterfassung/berichte')
  revalidatePath('/admin/zeiterfassung/kontrolle')
  revalidatePath('/employee/zeiterfassung')
  return { success: true }
}
