import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ZEITERFASSUNG_EXCLUDED } from '@/lib/attendance-exclude'
import { timemotoZeitZuDate } from '@/lib/zeitzone'

// ════════════════════════════════════════════════════════════════════════
// ZEIT-SPERRE (seit 17.09.2026): Die Praxis verwaltet Zeiten NUR noch im
// Portal. Vom TimeMoto-Sync werden ausschliesslich NEUE physische Stempel
// übernommen. Einmal gespeicherte Einträge sind für den Sync unantastbar:
//   - attendance.deleted wird ignoriert (nur protokolliert)
//   - attendance.updated auf eine bestehende Zeile wird ignoriert
//     (kein Überschreiben von time_logged mehr)
//   - Nachträgliche TimeMoto-Bearbeitungen (neue Event-ID, gleiches Paar)
//     landen «vor-gelöscht» im Papierkorb statt bestehende zu ersetzen
//   - TimeMoto-Absenzen schreiben NICHT mehr in den Arbeitsplan
//   - Kein Abgleich/Ersetzen von Snapshot-Tagen mehr
// Änderungen an Zeiten macht nur noch der Admin im Portal (protokolliert).
// ════════════════════════════════════════════════════════════════════════

// Always acknowledge receipt — errors are logged but never returned as HTTP
// failures. This prevents TimeMoto from counting retries and disabling the
// webhook (new physical punches must keep flowing).
const OK = () => NextResponse.json({ received: true }, { status: 200 })

// TimeMoto sends timeLogged as local Zurich wall time without a UTC marker.
// DST-genau statt Monats-Heuristik, siehe timemotoZeitZuDate in
// src/lib/zeitzone.ts (dort mit Tests für die Umstellungstage).
const parseZurichTime = timemotoZeitZuDate

export async function POST(req: NextRequest) {
  // ── 1. Parse body ────────────────────────────────────────────────
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch (err) {
    console.error('[TimeMoto] Could not parse request body:', err)
    return OK()
  }

  const event = (payload?.event as string) ?? 'unknown'
  const data  = (payload?.data  as Record<string, unknown>) ?? {}

  // Ignore employees who are not tracked in Zeiterfassung (e.g. dentists/temps).
  const incomingName = (data?.userFullName as string) ?? ''
  if (ZEITERFASSUNG_EXCLUDED.has(incomingName)) {
    console.log('[TimeMoto] ignored (excluded employee):', incomingName)
    return OK()
  }

  console.log('[TimeMoto] received:', event, JSON.stringify(data))

  // ── 2. Ignore non-attendance events ──────────────────────────────
  if (!event.startsWith('attendance.')) {
    return OK()
  }

  // ── 3. ZEIT-SPERRE: Löschungen aus TimeMoto werden ignoriert ────
  if (event === 'attendance.deleted') {
    console.log('[TimeMoto] IGNORIERT (Zeit-Sperre): attendance.deleted', (payload?.id as string) ?? '?')
    return OK()
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    const timemotoEventId = (payload?.id          as string) ?? null
    const timemotoUserId  = (data?.userId         as string) ?? null
    const userFullName    = (data?.userFullName   as string) ?? null
    const clockingType    = (data?.clockingType   as string) ?? null
    const clockingPairId  = (data?.clockingPairId as string) ?? null
    const departmentName  = (data?.departmentName as string) ?? null
    const locationName    = (data?.locationName   as string) ?? null
    // Absence clockings are planning placeholders, not real shifts. They are
    // stored pre-deleted (raw record only) and — seit der Zeit-Sperre —
    // schreiben sie NICHT mehr in den Arbeitsplan.
    const absenceTypeName = (data?.absenceTypeName as string) ?? null
    const isAbsence       = !!absenceTypeName

    if (!timemotoEventId) {
      console.error('[TimeMoto] Missing event id — skipping insert')
      return OK()
    }

    // Safe date parsing — bad dates become null instead of crashing.
    // timeLogged is floored to the whole minute so the platform matches
    // TimeMoto's HH:MM display exactly (no seconds-level rounding drift).
    let timeLogged:   string | null = null
    let timeInserted: string | null = null
    try { const d = data?.timeLogged ? parseZurichTime(data.timeLogged as string) : null; if (d && !isNaN(d.getTime())) { d.setUTCSeconds(0, 0); timeLogged = d.toISOString() } } catch { /* ignore */ }
    try { const d = data?.timeInserted ? parseZurichTime(data.timeInserted as string) : null; if (d && !isNaN(d.getTime())) { timeInserted = d.toISOString() } } catch { /* ignore */ }

    // Ohne brauchbare Zeit ist ein Stempel wertlos — eine aktive Zeile mit
    // time_logged null wäre überall unsichtbar und nur verwirrend.
    if (!timeLogged) {
      console.error('[TimeMoto] IGNORIERT: kein gültiges timeLogged —', timemotoEventId, JSON.stringify(data?.timeLogged ?? null))
      return OK()
    }

    // ── 4. ZEIT-SPERRE: bestehende Zeile? Dann nichts anfassen. ────
    const { data: existing } = await supabase
      .from('attendance_events')
      .select('timemoto_event_id')
      .eq('timemoto_event_id', timemotoEventId)
      .maybeSingle()
    if (existing) {
      console.log('[TimeMoto] IGNORIERT (Zeit-Sperre): Eintrag existiert bereits —', timemotoEventId)
      return OK()
    }

    // Try to match a Supabase profile by timemoto_user_id
    // Falls back to full_name match for employees not yet linked
    let employeeId: string | null = null
    if (timemotoUserId) {
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('id, timemoto_user_id')
        .eq('timemoto_user_id', timemotoUserId)
        .maybeSingle()
      if (profileErr) console.warn('[TimeMoto] profile lookup error (non-fatal):', profileErr.message)
      employeeId = profile?.id ?? null

      if (!employeeId && userFullName) {
        const { data: profileByName, error: nameErr } = await supabase
          .from('profiles')
          .select('id, timemoto_user_id')
          .eq('full_name', userFullName)
          .maybeSingle()
        if (nameErr) console.warn('[TimeMoto] name lookup error (non-fatal):', nameErr.message)
        if (profileByName) {
          employeeId = profileByName.id
          if (!profileByName.timemoto_user_id) {
            const { error: updateErr } = await supabase
              .from('profiles')
              .update({ timemoto_user_id: timemotoUserId })
              .eq('id', profileByName.id)
            if (updateErr) console.warn('[TimeMoto] timemoto_user_id backfill error (non-fatal):', updateErr.message)
            else console.log('[TimeMoto] linked profile', userFullName, '→', timemotoUserId)
          }
        }
      }
    }

    // ── 5. Nachträgliche Bearbeitung? TimeMoto vergibt bei einer Bearbeitung
    // eine NEUE Event-ID zum gleichen (Paar, Typ). Seit der Zeit-Sperre
    // ersetzt das nichts mehr: Ist zu diesem Paar/Typ IRGENDEINE Version
    // bekannt — aktiv ODER gelöscht —, landet die neue Version «vor-gelöscht»
    // im Papierkorb. Auch gelöschte Geschwister zählen, sonst würde eine
    // TimeMoto-Bearbeitung eine vom Admin bewusst gelöschte Zeit als aktive
    // Zeile wiederbeleben. ──────────────────────────────────────────────────
    let editVersuch = false
    if (clockingPairId && clockingType && !isAbsence) {
      const { data: siblings, error: sibErr } = await supabase
        .from('attendance_events')
        .select('timemoto_event_id')
        .eq('clocking_pair_id', clockingPairId)
        .eq('clocking_type', clockingType)
        .limit(1)
      if (sibErr) {
        // Abfrage fehlgeschlagen: als frischen Stempel behandeln (aktiv).
        // Eine Bearbeitung kann so im schlimmsten Fall sichtbar doppelt
        // erscheinen und wird vom Admin gelöscht — ein still versteckter
        // physischer Stempel wäre das grössere Übel.
        console.error('[TimeMoto] Geschwister-Abfrage fehlgeschlagen (Eintrag wird aktiv gespeichert):', sibErr.message)
      }
      editVersuch = (siblings ?? []).length > 0
    }

    const { error } = await supabase
      .from('attendance_events')
      .upsert(
        {
          timemoto_event_id: timemotoEventId,
          timemoto_user_id:  timemotoUserId,
          employee_id:       employeeId,
          user_full_name:    userFullName,
          clocking_type:     clockingType,
          time_logged:       timeLogged,
          time_inserted:     timeInserted,
          clocking_pair_id:  clockingPairId,
          department_name:   departmentName,
          location_name:     locationName,
          raw_payload:       payload,
          deleted_at:        (isAbsence || editVersuch) ? new Date().toISOString() : null,
        },
        { onConflict: 'timemoto_event_id', ignoreDuplicates: true }
      )
    if (error) {
      console.error('[TimeMoto] insert error:', error.code, error.message, error.details)
      return NextResponse.json({
        received: true,
        db_error: { code: error.code, message: error.message, details: error.details },
      }, { status: 200 })
    }

    // Beobachtung (kein Eingriff): sollten durch parallele Zustellung doch
    // zwei aktive Versionen desselben Paars/Typs entstehen, im Log ausweisen —
    // das Duplikat ist im Bericht sichtbar und vom Admin löschbar.
    if (!editVersuch && !isAbsence && clockingPairId && clockingType) {
      const { count } = await supabase
        .from('attendance_events')
        .select('timemoto_event_id', { count: 'exact', head: true })
        .eq('clocking_pair_id', clockingPairId)
        .eq('clocking_type', clockingType)
        .is('deleted_at', null)
      if ((count ?? 0) > 1) console.warn('[TimeMoto] WARNUNG: mehrere aktive Versionen von', clockingPairId, clockingType)
    }

    console.log('[TimeMoto] saved OK:', timemotoEventId, '|', userFullName, '|', clockingType, '|', timeLogged,
      editVersuch ? '(Bearbeitungs-Versuch — im Papierkorb, Zeit-Sperre aktiv)' : isAbsence ? '(Absenz — nur Rohdaten)' : '')

  } catch (err) {
    console.error('[TimeMoto] unexpected error:', err instanceof Error ? err.message : String(err))
  }

  // Always return 200 — TimeMoto will never disable this webhook
  return OK()
}

// TimeMoto pings GET to verify the endpoint is reachable
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'HR Portal TimeMoto Webhook' })
}
