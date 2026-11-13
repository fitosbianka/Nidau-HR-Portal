import { ohneGaesteErgebnis } from '@/lib/gaeste'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ZEITERFASSUNG_EXCLUDED , isZeiterfassungPerson } from '@/lib/attendance-exclude'
import { round2 } from '@/lib/ferien'
import { makeNameCanonicalizer } from '@/lib/names'
import { pairEvents, buildDayGroups, absenceCredit, KOMP_MIN, type AttendanceEvent, type Shift } from '@/lib/zeiterfassung-report'
import { ferienMinusRegel } from '@/lib/ferien-minusstunden'
import { ladeFerienAnteile } from '@/lib/ferien-anteil-data'
import { anteilAus } from '@/lib/ferien-anteil'
import { pensumWocheGewichte, ferienPruefung, type FerienPruefungPerson } from '@/lib/ferien-pensumwoche'
import { getStandardWeeks } from '@/lib/plan-standards'
import { KONTO_HISTORY, KONTO_YEAR, LIVE_FROM_MONTH } from '@/data/arbeitszeit-konto-2026'
import type { KontoEmployee, KontoMonth } from '@/app/admin/zeiterfassung/konto/KontoClient'

// Feiertage (Kanton Bern) an Werktagen: gemeinsame Liste für alle Jahre
import { istFeiertag } from '@/lib/feiertage'

const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']

function zurichToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })
}
/** Working days (Mo–Fr minus holidays) in a month, optionally bounded by
 *  `notBefore`/`until` (YYYY-MM-DD) — e.g. an Eintrittsdatum mid-month. */
function workingDays(year: number, month: number, until?: string, notBefore?: string): number {
  const total = new Date(year, month, 0).getDate()
  let n = 0
  for (let d = 1; d <= total; d++) {
    const ds = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    if (until && ds > until) break
    if (notBefore && ds < notBefore) continue
    const dow = new Date(year, month - 1, d).getDay()
    if (dow !== 0 && dow !== 6 && !istFeiertag(ds)) n++
  }
  return n
}

export async function loadKontoEmployees(
  supabase: SupabaseClient,
  /** releasedOnly: fill a completed month only once its Zeiterfassung
   *  exports are in the employee Dokumente folders (i.e. the admin has
   *  controlled and corrected the month). Used for the EMPLOYEE views —
   *  the admin page always sees completed months immediately, otherwise
   *  the month could never be controlled and exported. */
  opts?: {
    releasedOnly?: boolean
    /** laufenderMonat: also fill the CURRENT month as a running Zwischenstand
     *  (admin Konto page). Computed up to and including YESTERDAY, so the
     *  numbers stay stable during the day; marked `laufend` and left out of
     *  the official PDF/CSV exports. */
    laufenderMonat?: boolean
  },
): Promise<{ employees: KontoEmployee[]; year: number; pruefung: FerienPruefungPerson[]; pruefZeitraum: { von: string; bis: string } }> {
  const year = KONTO_YEAR
  const today = zurichToday()
  const currentMonth = parseInt(today.slice(5, 7), 10)
  // Stichtag des Zwischenstands: gestern (Zürich)
  const gesternDate = new Date(`${today}T12:00:00Z`)
  gesternDate.setUTCDate(gesternDate.getUTCDate() - 1)
  const gestern = gesternDate.toISOString().slice(0, 10)

  const [{ data: employees }, { data: sched }, { data: overrideRows }, { data: zeDocs }] = await Promise.all([
    supabase.from('profiles')
      .select('id, full_name, job_title, pensum, eintrittsdatum')
      .eq('role', 'employee').eq('is_active', true).order('full_name')
      .then(ohneGaesteErgebnis),
    // ALL absence codes the Zeiterfassung credits — same set as the
    // Berichte page, so Ist can never diverge between the two views
    supabase.from('work_schedule')
      .select('employee_id, schedule_date, entry')
      .gte('schedule_date', `${year}-01-01`).lte('schedule_date', `${year}-12-31`)
      .or('entry.in.(F,K,U,KO,TE,ÜK,UK,BF,UF,WB),entry.like.F:*'),
    // Admin corrections for the Excel-imported history months
    supabase.from('zeiterfassung_comments')
      .select('user_full_name, schedule_date, comment')
      .like('user_full_name', '\\_\\_konto%'),
    // Monthly Zeiterfassung exports — their existence marks a month as
    // controlled ("Zeiterfassung <Monat> <Jahr>" documents)
    opts?.releasedOnly
      ? supabase.from('documents').select('label').ilike('label', 'Zeiterfassung %')
      : Promise.resolve({ data: [] as Array<{ label: string }> }),
  ])

  // Ferienanteil pro Wochentag: ein glattes F zählt den Anteil des Tags
  // (Tage und Gutschrift), siehe src/lib/ferien-anteil.ts
  const anteile = await ladeFerienAnteile(supabase, (employees ?? []) as Array<{ id: string; full_name: string }>)
  // Standardwochen für die Prüfung (F an einem freien Tag laut Standardwoche)
  const standardwochen = await getStandardWeeks(supabase)
  const pruefung: FerienPruefungPerson[] = []

  // Newest controlled month: every live month up to it is shown; later
  // completed months stay empty until their export has run.
  let releasedMax: number | null = null
  if (opts?.releasedOnly) {
    releasedMax = 0
    const labels = new Set(((zeDocs ?? []) as Array<{ label: string }>).map(r => r.label))
    for (let m = 1; m <= 12; m++) {
      if (labels.has(`Zeiterfassung ${MONTH_NAMES[m - 1]} ${year}`)) releasedMax = m
    }
  }

  // Parse override rows: __konto__<id> → per-month values, __konto_bem__<id> →
  // Bemerkungen, __konto_start__<id> → manuelles Ferien-Startguthaben (Tage)
  const monthOverrides: Record<string, Record<number, { istMin?: number | null; ferien?: number | null; krank?: number | null; unfall?: number | null }>> = {}
  const bemOverrides: Record<string, string> = {}
  const startOverrides: Record<string, number> = {}
  for (const r of (overrideRows ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>) {
    if (r.user_full_name.startsWith('__konto_bem__')) {
      bemOverrides[r.user_full_name.slice('__konto_bem__'.length)] = r.comment
    } else if (r.user_full_name.startsWith('__konto_start__')) {
      const v = parseFloat(r.comment)
      if (Number.isFinite(v)) startOverrides[r.user_full_name.slice('__konto_start__'.length)] = v
    } else if (r.user_full_name.startsWith('__konto__')) {
      const empId = r.user_full_name.slice('__konto__'.length)
      const m = parseInt(r.schedule_date.slice(5, 7), 10)
      try { (monthOverrides[empId] ??= {})[m] = JSON.parse(r.comment) } catch { /* ignore bad rows */ }
    }
  }

  // Attendance for the live period, paginated. Absence placeholders are
  // stored soft-deleted by the webhook, so this query returns exactly the
  // shifts the Zeiterfassung → Berichte page shows.
  type Ev = { timemoto_event_id: string; user_full_name: string | null; clocking_type: string | null; time_logged: string | null; clocking_pair_id: string | null }
  const liveStart = `${year}-${String(LIVE_FROM_MONTH).padStart(2,'0')}-01`
  const events: Ev[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('attendance_events')
      .select('timemoto_event_id, user_full_name, clocking_type, time_logged, clocking_pair_id')
      .is('deleted_at', null)
      .gte('time_logged', `${liveStart}T00:00:00Z`)
      // zweiter Sortierschlüssel: stabile Seitengrenzen bei gleicher Zeit
      .order('time_logged', { ascending: true })
      .order('timemoto_event_id', { ascending: true })
      .range(from, from + 999)
    if (!data || data.length === 0) break
    events.push(...(data as unknown as Ev[]))
    if (data.length < 1000) break
  }

  // Shifts paired with the SAME shared code as the Zeiterfassung → Berichte
  // page and the export PDFs (src/lib/zeiterfassung-report.ts), with event
  // names unified to the profile spelling. The Ist column of a live month is
  // then computed from these shifts with the same credit rules — so it always
  // equals the month total shown in the Zeiterfassung, by construction.
  const canonical = makeNameCanonicalizer((employees ?? []).map(e => e.full_name))
  const allShifts = pairEvents(events.map(e => ({
    ...e,
    user_full_name: canonical(e.user_full_name),
    location_name: null,
  } as AttendanceEvent)))
  const shiftsByName = new Map<string, Shift[]>()
  for (const s of allShifts) {
    if (!shiftsByName.has(s.fullName)) shiftsByName.set(s.fullName, [])
    shiftsByName.get(s.fullName)!.push(s)
  }

  // Umfang: alle mit Altdaten plus alle Personen der Zeiterfassung (Funktionen aus src/config/praxis.ts)
  const emps = (employees ?? []).filter(e =>
    !ZEITERFASSUNG_EXCLUDED.has(e.full_name) &&
    (KONTO_HISTORY[e.full_name] || isZeiterfassungPerson(e))
  )

  const kontoEmployees: KontoEmployee[] = emps.map(emp => {
    const hist = KONTO_HISTORY[emp.full_name]
    const isHourly = hist ? hist.pensum === null : false
    // Pensum gemäss Excel-Historie, sonst gemäss Profil. Lernende sind in der
    // Praxis mit 80 % erfasst (4 Praxistage, der Schultag zählt weder als
    // Soll noch als Gutschrift) — das Profil-Pensum gilt also auch für sie.
    const istLernende = (emp.job_title ?? '').trim() === 'Lernende'
    const pensum = isHourly ? 0 : ((hist ? hist.pensum : (emp.pensum != null ? emp.pensum / 100 : 1)) ?? 0)
    const eintrittProfil = (emp as { eintrittsdatum?: string | null }).eintrittsdatum ?? null

    // Hinweise für die Admin-Ansicht: fehlende Profildaten machen das Soll
    // unbemerkt falsch — deshalb sichtbar ausweisen statt still annehmen.
    const hinweise: string[] = []
    if (!hist && !isHourly && emp.pensum == null) {
      hinweise.push(istLernende
        ? 'Im Profil ist kein Pensum hinterlegt — das Soll rechnet mit 100 %. Lernende werden in der Praxis mit 80 % geführt (Schultag ausgeklammert): Pensum unter «Personal» erfassen.'
        : 'Im Profil ist kein Pensum hinterlegt — das Soll rechnet mit 100 %. Pensum unter «Personal» erfassen.')
    }
    if (!hist && !eintrittProfil) {
      hinweise.push(`Im Profil fehlt das Eintrittsdatum — die Monate zählen ab ${MONTH_NAMES[LIVE_FROM_MONTH - 1]} ${year} (Start der Zeiterfassung).`)
    }
    if (istLernende && !hist && emp.pensum != null && emp.pensum >= 100) {
      hinweise.push('Lernende mit 100 % im Profil: Schultage werden nicht gutgeschrieben — in der Praxis gilt für Lernende 80 % (4 Praxistage). Pensum unter «Personal» prüfen.')
    }

    const mySched = (sched ?? []).filter(r => r.employee_id === emp.id)
    const myShifts = shiftsByName.get(emp.full_name) ?? []
    // Absenzen des Jahres dieser Person. Ganze F-Wochen bei Teilzeit zählen
    // nach Pensum (F:<Pensum> pro Tag), siehe src/lib/ferien-pensumwoche.ts
    const anteilRegel = anteilAus(anteile, emp.id)
    const alleAbsenzen: Record<string, string> = {}
    for (const r of mySched) alleAbsenzen[r.schedule_date] = r.entry
    const absenzen = pensumWocheGewichte(alleAbsenzen, isHourly ? 1 : pensum, anteilRegel)
    pruefung.push({
      id: emp.id, name: emp.full_name, pensumLabel: isHourly ? 'Stundenlohn' : `${Math.round(pensum * 100)}%`,
      wochen: isHourly ? [] : ferienPruefung({ absences: alleAbsenzen, faktor: pensum, regel: anteilRegel, standardwoche: standardwochen[emp.id] ?? null, from: liveStart, to: today }),
    })

    let saldo = 0
    let restFerien: number | null = null
    let restFerienInit = false
    const months: KontoMonth[] = []
    const myOverrides = monthOverrides[emp.id] ?? {}
    // Chain state across history months: base = as stored from the Excel,
    // final = after admin corrections were applied and re-chained.
    let prevBaseKonto: number | null = null
    let prevFinalKonto: number | null = null
    let ferienDelta = 0   // corrected − original Ferien days (shifts Bleibende Ferien)

    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0')
      const label = MONTH_NAMES[m - 1]

      if (hist && m < LIVE_FROM_MONTH) {
        const h = hist.months[m]
        if (!h) { months.push({ label, empty: true }); continue }
        // Saldo Vormonat comes from the Excel — its chain may be manually
        // broken there (e.g. paid-out overtime), which must be preserved.
        // A month whose stored Saldo equals the previous stored Zeitkonto is
        // "chained": corrections to earlier months flow through it. A month
        // with a manual break keeps its stored Saldo.
        const ov = myOverrides[m] ?? {}
        const ist    = ov.istMin ?? h.istMin
        const ferien = ov.ferien ?? h.ferien
        const krank  = ov.krank  ?? h.krank
        const unfall = ov.unfall ?? 0
        const isBreak = prevBaseKonto === null || Math.abs(h.saldoVorMin - prevBaseKonto) > 1
        const saldoVor: number = isBreak ? h.saldoVorMin : (prevFinalKonto ?? h.saldoVorMin)
        const konto: number = saldoVor + ist - h.sollMin
        ferienDelta += ferien - h.ferien
        months.push({
          label,
          sollMin: h.sollMin, istMin: ist,
          saldoVorMin: saldoVor, kontoMin: konto,
          ferien, restFerien: h.restFerien != null ? h.restFerien - ferienDelta : null, krank, unfall,
          month: m, editable: true,
          manuell: ov.istMin != null || ov.ferien != null || ov.krank != null || ov.unfall != null,
          ov: myOverrides[m],
        })
        prevBaseKonto = h.kontoMin
        prevFinalKonto = konto
        saldo = konto
        continue
      }

      // Only completed months are filled — the current month stays empty
      // until it is over, EXCEPT with `laufenderMonat` (admin view), where it
      // shows a running Zwischenstand up to and including yesterday.
      const laufend = !!opts?.laufenderMonat && m === currentMonth && today.slice(0, 4) === String(year)
      if (m > currentMonth || (m === currentMonth && !laufend) || (!hist && m < LIVE_FROM_MONTH)) {
        months.push({ label, empty: true })
        continue
      }

      // Employee views: a completed month appears only after the admin has
      // controlled it (Zeiterfassung exports in the Dokumente folders).
      if (releasedMax !== null && m > releasedMax) {
        months.push({ label, empty: true })
        continue
      }

      // Months before the Eintrittsdatum stay empty — the account starts
      // counting with the month the employee joins.
      const eintritt = (emp as { eintrittsdatum?: string | null }).eintrittsdatum ?? null
      if (eintritt && `${year}-${mm}` < eintritt.slice(0, 7)) {
        months.push({ label, empty: true })
        continue
      }

      // ── Live month (completed, or running Zwischenstand) ──
      // On the 1st of the month there is no completed day yet — stay empty.
      if (laufend && gestern < `${year}-${mm}-01`) {
        months.push({ label, empty: true })
        continue
      }
      if (!restFerienInit) {
        // Manuelles Startguthaben gilt absolut; sonst der importierte
        // Excel-Stand, verschoben um Korrekturen in den History-Monaten.
        const startOv = startOverrides[emp.id]
        restFerien = startOv != null
          ? startOv
          : hist?.ferienStand != null ? hist.ferienStand - ferienDelta : null
        restFerienInit = true
      }
      // If the Eintrittsdatum falls inside this month, Soll counts only from that day
      const notBefore = eintritt && eintritt.slice(0, 7) === `${year}-${mm}` ? eintritt : undefined
      // Running month: Soll, Ist and absences all end at yesterday — one
      // consistent Stichtag, so the Zwischenstand never flatters or lags.
      const wd = workingDays(year, m, laufend ? gestern : undefined, notBefore)

      // Ist = EXACTLY the month total of the Zeiterfassung: shifts + absence
      // credits from the shared report code (F weight×8:30 always, K/TE/ÜK
      // topped up to 8:30, Kompensation −8:30). One source of truth — the
      // two views can no longer diverge.
      const firstDay = `${year}-${mm}-01`
      const monthEnd = `${year}-${mm}-${String(new Date(year, m, 0).getDate()).padStart(2, '0')}`
      const lastDay  = laufend && gestern < monthEnd ? gestern : monthEnd
      const monthShifts = myShifts.filter(s => s.date >= firstDay && s.date <= lastDay)
      const monthAbsences: Record<string, string> = {}
      for (const [d, e] of Object.entries(absenzen)) {
        if (d >= firstDay && d <= lastDay) monthAbsences[d] = e
      }
      const dayGroups = buildDayGroups(monthShifts, monthAbsences, firstDay, lastDay, emp.full_name, anteile)
      const worked = monthShifts.reduce((s, x) => s + (x.durationMin ?? 0), 0)
      const creditSum = dayGroups.reduce((s, d) => s + absenceCredit(d.absence, d.dayTotal, d.fWeight ?? 1), 0)

      // Ferien-/Krankheits-/Unfalltage zählen im laufenden Monat über den
      // GANZEN Monat aus dem Arbeitsplan (der ist vorausgeplant) — die
      // Lohnabrechnung geht bis am 25. raus und braucht die Absenztage bis
      // Monatsende. Die STUNDEN (Ist/Soll/Zeitkonto) bleiben beim Stichtag
      // gestern: künftige Stempel gibt es nicht, künftige Absenz-Gutschriften
      // würden das Zeitkonto verfälschen.
      let tagesGroups = dayGroups
      if (laufend && lastDay < monthEnd) {
        const fullAbsences: Record<string, string> = {}
        for (const [d, e] of Object.entries(absenzen)) {
          if (d >= firstDay && d <= monthEnd) fullAbsences[d] = e
        }
        tagesGroups = buildDayGroups([], fullAbsences, firstDay, monthEnd, emp.full_name, anteile)
      }
      // Soll is ALWAYS working days × 8:30 × Pensum — nothing else. A
      // Kompensationstag charges the Zeitkonto automatically: it credits
      // nothing in Ist while the Soll still counts the day.
      const sollMin = isHourly ? 0 : Math.round(wd * 8.5 * 60 * pensum)

      // Manual admin corrections override the computed values; Zeitkonto,
      // Saldo Vormonat and Restferien of ALL following months re-chain
      // automatically from the corrected numbers below.
      const ov = myOverrides[m] ?? {}
      const fDays = ov.ferien ?? round2(tagesGroups.filter(d => d.absence === 'F').reduce((s, d) => s + (d.fWeight ?? 1), 0))
      const kDays = ov.krank ?? tagesGroups.filter(d => d.absence === 'K').length
      const uDays = ov.unfall ?? tagesGroups.filter(d => d.absence === 'U').length
      // Ferien als Minusstunden (Vereinbarung): nicht in `ferien`/Restferien,
      // keine Gutschrift in Ist — nur als Hinweis am Monat ausgewiesen
      const fmGroups = tagesGroups.filter(d => d.absence === 'FM')
      const fmTage = round2(fmGroups.reduce((s, d) => s + (d.fWeight ?? 1), 0))
      const fmMin  = fmGroups.reduce((s, d) => s + Math.round(KOMP_MIN * (d.fWeight ?? 1)), 0)
      const fmGrund = fmGroups.length > 0 ? ferienMinusRegel(emp.full_name, fmGroups[0].date)?.grund : undefined

      // Ist der Live-Monate kommt IMMER aus der Zeiterfassung (gleicher Code
      // wie die Berichte-Seite) — eine manuelle Ist-Korrektur wird hier nicht
      // mehr angewendet, sonst zeigen Zeitkonto und Zeiterfassung verschiedene
      // Stunden. Eine noch gespeicherte alte Korrektur wird ausgewiesen.
      const istMin = worked + (isHourly ? 0 : creditSum)
      const istKorrekturIgnoriert = ov.istMin != null ? ov.istMin : undefined
      const konto = isHourly ? null : istMin - sollMin + saldo
      const newRest: number | null = restFerien != null ? restFerien - fDays : null

      // Herleitung für die Anzeige: woraus Soll und Ist bestehen
      const fmtHM = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
      const CODE_LABEL: Record<string, string> = {
        F: 'Ferien', FM: 'Ferien ohne Gutschrift', K: 'Krank', U: 'Unfall', TE: 'Teamevent', 'ÜK': 'ÜK',
        BF: 'Bezahlt frei', UF: 'Unbez. Ferien', WB: 'Weiterbildung', KO: 'Kompensation',
      }
      const teile: string[] = []
      for (const code of Object.keys(CODE_LABEL)) {
        const gs = dayGroups.filter(d => d.absence === code)
        if (gs.length === 0) continue
        const min = gs.reduce((s, d) => s + absenceCredit(d.absence, d.dayTotal, d.fWeight ?? 1), 0)
        const tage = code === 'F' || code === 'FM' ? round2(gs.reduce((s, d) => s + (d.fWeight ?? 1), 0)) : gs.length
        teile.push(`${CODE_LABEL[code]} ${tage} Tag${tage !== 1 ? 'e' : ''}${min > 0 ? ` +${fmtHM(min)}` : ' (0:00)'}`)
      }

      months.push({
        label,
        sollMin: isHourly ? null : sollMin, istMin,
        saldoVorMin: isHourly ? null : saldo,
        kontoMin: konto,
        ferien: fDays, restFerien: newRest, krank: kDays, unfall: uDays,
        // Auch der laufende Monat ist editierbar. Der Dialog fixiert dabei
        // nur GEÄNDERTE Felder (Rest bleibt automatisch) — darum bekommt der
        // Client hier die rohen Override-Werte mit.
        live: true, month: m, editable: true,
        laufend: laufend || undefined,
        stand: laufend ? `${gestern.slice(8, 10)}.${gestern.slice(5, 7)}.` : undefined,
        manuell: ov.ferien != null || ov.krank != null || ov.unfall != null,
        ov: myOverrides[m],
        ferienMinus: fmTage > 0 ? { tage: fmTage, min: fmMin, grund: fmGrund ?? '' } : undefined,
        sollBasis: isHourly ? undefined : { werktage: wd, pensum, von: notBefore ?? firstDay, bis: lastDay },
        istBasis: { gestempelt: worked, gutschrift: isHourly ? 0 : creditSum, teile, manuell: false },
        istKorrekturIgnoriert,
      })
      if (konto != null) saldo = konto
      restFerien = newRest
    }

    return {
      id: emp.id,
      name: emp.full_name,
      funktion: hist?.funktion ?? emp.job_title ?? '',
      pensumLabel: isHourly ? 'Stundenlohn' : `${Math.round(pensum * 100)}%`,
      hinweise,
      bemerkungen: bemOverrides[emp.id] ?? hist?.bemerkungen ?? null,
      ferienStart: startOverrides[emp.id] ?? hist?.ferienStand ?? null,
      ferienStartManuell: startOverrides[emp.id] != null,
      months,
    }
  })

  return { employees: kontoEmployees, year, pruefung, pruefZeitraum: { von: liveStart, bis: today } }
}
