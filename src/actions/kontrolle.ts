'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { KONTROLL_REGELN_KEY, KONTROLL_REGELN_DATE, hhmmToMin, type KontrollRegel } from '@/lib/kontrolle'
import { getZeitLogEntries, logZeitChange, zurichTimeOf, type ZeitLogEntry } from '@/lib/zeit-log'
import { getZeitKorrekturen } from '@/lib/korrekturen'
import { ZEITUMSTELLUNG_PRUEFUNG, zeitumstellungVerdacht, zurichTagesFenster } from '@/lib/zeitzone'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') throw new Error('Keine Berechtigung')
  return await createAdminClient()
}

/** Save the Kontroll-Regeln (replaces the whole list). Admin-only. */
export async function saveKontrollRegeln(regeln: KontrollRegel[]) {
  let admin
  try { admin = await requireAdmin() } catch { return { error: 'Keine Berechtigung.' } }

  const clean: KontrollRegel[] = []
  for (let i = 0; i < (regeln ?? []).length; i++) {
    const r = regeln[i]
    const name = (r.name ?? '').trim()
    if (!name) return { error: `Regel ${i + 1}: Name fehlt.` }
    if (name.length > 60) return { error: `Regel ${i + 1}: Name ist zu lang.` }
    for (const [feld, wert] of [['Start von', r.startVon], ['Start bis', r.startBis], ['Ende von', r.endeVon], ['Ende bis', r.endeBis]] as const) {
      if (wert && hhmmToMin(wert) == null) return { error: `Regel «${name}»: ${feld} ist keine gültige Zeit (HH:MM).` }
    }
    for (const [feld, wert] of [['Dauer von', r.dauerVonH], ['Dauer bis', r.dauerBisH]] as const) {
      if (wert != null && (typeof wert !== 'number' || wert < 0 || wert > 24)) {
        return { error: `Regel «${name}»: ${feld} muss zwischen 0 und 24 Stunden liegen.` }
      }
    }
    clean.push({
      id: (r.id ?? '').trim() || `regel-${Date.now()}-${i}`,
      name,
      aktiv: r.aktiv !== false,
      startVon: r.startVon || undefined,
      startBis: r.startBis || undefined,
      endeVon: r.endeVon || undefined,
      endeBis: r.endeBis || undefined,
      dauerVonH: r.dauerVonH ?? undefined,
      dauerBisH: r.dauerBisH ?? undefined,
      ohnePause: r.ohnePause === true,
    })
  }
  if (clean.length === 0) return { error: 'Mindestens eine Regel wird benötigt.' }

  const { error } = await admin.from('zeiterfassung_comments').upsert(
    {
      user_full_name: KONTROLL_REGELN_KEY,
      schedule_date: KONTROLL_REGELN_DATE,
      comment: JSON.stringify(clean),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }

  revalidatePath('/admin/zeiterfassung/kontrolle')
  revalidatePath('/admin/zeiterfassung/korrekturen/regeln')
  return { success: true }
}

/** Accept a shift recommendation: the day's LAST clock-out is set so the
 *  stamped day total is exactly 8:30 (earlier stamped blocks stay), and the
 *  shift name is written into the day note. Admin-only. */
export async function acceptShiftKorrektur(input: {
  outEventId: string
  clockInISO: string   // clock-in of the LAST stamped block
  vorherMin?: number   // stamped minutes of earlier blocks that day (0 = single block)
  fullName: string
  date: string        // YYYY-MM-DD
  shiftName: string
}) {
  let admin
  try { admin = await requireAdmin() } catch { return { error: 'Keine Berechtigung.' } }

  const { outEventId, clockInISO, fullName, date, shiftName } = input
  const vorherMin = Math.max(0, Math.round(input.vorherMin ?? 0))
  if (!outEventId || !clockInISO || !fullName || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !shiftName.trim()) {
    return { error: 'Ungültige Korrektur-Daten.' }
  }
  const inDate = new Date(clockInISO)
  if (isNaN(inDate.getTime())) return { error: 'Ungültige Einstempel-Zeit.' }
  const restMin = 510 - vorherMin
  if (restMin <= 0) return { error: 'Der Tag hat bereits mehr als 8:30 in früheren Blöcken — bitte von Hand anpassen.' }

  // Previous clock-out — for the change log
  const { data: prevOut } = await admin
    .from('attendance_events')
    .select('time_logged')
    .eq('timemoto_event_id', outEventId)
    .maybeSingle()

  // Last clock-out = last clock-in + remaining minutes → day total = 8:30
  const newOut = new Date(inDate.getTime() + restMin * 60000)
  const { error: updErr } = await admin
    .from('attendance_events')
    .update({ time_logged: newOut.toISOString() })
    .eq('timemoto_event_id', outEventId)
  if (updErr) return { error: updErr.message }

  const oldOutISO = (prevOut as { time_logged?: string } | null)?.time_logged
  await logZeitChange(admin, {
    datum: date,
    emp: fullName,
    text: `Ausstempeln ${oldOutISO ? zurichTimeOf(oldOutISO) : '?'} → ${zurichTimeOf(newOut.toISOString())} (${shiftName.trim()}, Tag auf 8:30 gesetzt)`,
  })

  // Day note: just the shift name — stating the shift implies the correction
  const note = shiftName.trim()
  const { data: existing } = await admin
    .from('zeiterfassung_comments')
    .select('comment')
    .eq('user_full_name', fullName)
    .eq('schedule_date', date)
    .maybeSingle()
  const old = ((existing as { comment?: string } | null)?.comment ?? '').trim()
  const text = old && !old.includes(note) ? `${old} · ${note}` : note
  const { error: cErr } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: fullName, schedule_date: date, comment: text, updated_at: new Date().toISOString() },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (cErr) return { error: cErr.message }

  revalidatePath('/admin/zeiterfassung/kontrolle')
  revalidatePath('/admin/zeiterfassung/berichte')
  revalidatePath('/employee/zeiterfassung')
  return { success: true }
}

/** Change log of the Zeiterfassung for one month (admin popup, no author). */
export async function getZeitAenderungen(year: number, month: number): Promise<{ entries?: ZeitLogEntry[]; error?: string }> {
  try {
    const admin = await requireAdmin()
    const entries = await getZeitLogEntries(admin, year, month)
    return { entries }
  } catch {
    return { error: 'Keine Berechtigung.' }
  }
}

// ── Kontrolle nach der Zeitumstellung vom 25.10.2026 ────────────────────────

export type ZeitumstellungFall = {
  emp: string
  datum: string
  /** Protokollierte Handänderungen im Prüffenster (Text, Zeitpunkt) */
  aenderungen: Array<{ text: string; at: string }>
  /** Korrekturmeldungen der Person für diesen Tag (gewünschte Zeit, Bemerkung, erledigt am) */
  meldungen: Array<{ zeit: string; text: string; done: string | null }>
  /** Aktuelle Stempel der Person an diesem Tag */
  stempel: Array<{ id: string; typ: 'In' | 'Out'; iso: string; zeit: string }>
  /** Nach dem Prüffenster wurde dieser Tag nochmals geändert (vermutlich schon korrigiert) */
  nachher: Array<{ text: string; at: string }>
}

const vornameVon = (n: string) => (n.trim().split(/\s+/)[0] ?? '').toLowerCase()

/** Alle Tage ab dem 25.10.2026 mit Handänderungen oder erledigten
 *  Korrekturmeldungen zwischen der Zeitumstellung und der Korrektur im
 *  Portal, mit den aktuellen Stempeln. Admin. */
export async function zeitumstellungKontrolle(): Promise<{ faelle?: ZeitumstellungFall[]; error?: string }> {
  let admin
  try { admin = await requireAdmin() } catch { return { error: 'Keine Berechtigung.' } }
  const [logOkt, logNov, korrekturen] = await Promise.all([getZeitLogEntries(admin, 2026, 10), getZeitLogEntries(admin, 2026, 11), getZeitKorrekturen(admin)])
  const logs = [...logOkt, ...logNov]
  const { datumAb, gespeichertBis } = ZEITUMSTELLUNG_PRUEFUNG
  const schluessel = (emp: string, datum: string) => `${vornameVon(emp)}|${datum}`
  const faelle = new Map<string, ZeitumstellungFall>()
  const fallFuer = (emp: string, datum: string) => {
    const k = schluessel(emp, datum)
    let f = faelle.get(k)
    if (!f) { f = { emp, datum, aenderungen: [], meldungen: [], stempel: [], nachher: [] }; faelle.set(k, f) }
    return f
  }
  for (const e of logs) if (zeitumstellungVerdacht(e.datum, e.at)) fallFuer(e.emp, e.datum).aenderungen.push({ text: e.text, at: e.at })
  // Korrekturmeldungen für Tage ab dem 25.10., im Prüffenster erledigt oder zu einem Fall gehörend
  for (const k of korrekturen) {
    if (k.datum < datumAb) continue
    const imFenster = !!k.done && k.done >= datumAb && k.done <= gespeichertBis.slice(0, 10)
    if (imFenster || faelle.has(schluessel(k.name, k.datum))) fallFuer(k.name, k.datum).meldungen.push({ zeit: k.zeit, text: k.text, done: k.done })
  }
  for (const e of logs) {
    const f = faelle.get(schluessel(e.emp, e.datum))
    if (f && e.at >= gespeichertBis) f.nachher.push({ text: e.text, at: e.at })
  }
  await Promise.all(Array.from(faelle.values()).map(async f => {
    const { start, ende } = zurichTagesFenster(f.datum)
    const { data } = await admin
      .from('attendance_events')
      .select('timemoto_event_id, clocking_type, time_logged')
      .ilike('user_full_name', `${vornameVon(f.emp)}%`)
      .is('deleted_at', null)
      .gte('time_logged', start)
      .lt('time_logged', ende)
      .order('time_logged', { ascending: true })
    f.stempel = ((data ?? []) as Array<{ timemoto_event_id: string; clocking_type: string; time_logged: string | null }>)
      .filter(r => r.time_logged && (r.clocking_type === 'In' || r.clocking_type === 'Out'))
      .map(r => ({ id: r.timemoto_event_id, typ: r.clocking_type as 'In' | 'Out', iso: r.time_logged!, zeit: zurichTimeOf(r.time_logged!) }))
    f.aenderungen.sort((a, b) => a.at.localeCompare(b.at))
  }))
  return { faelle: Array.from(faelle.values()).sort((a, b) => a.datum.localeCompare(b.datum) || a.emp.localeCompare(b.emp)) }
}
