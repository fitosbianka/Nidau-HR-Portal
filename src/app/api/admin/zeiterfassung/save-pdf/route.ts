import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { generateZeiterfassungPdf } from '@/lib/pdf/hr-pdfs.mjs'
import { loadBerichteData } from '@/lib/berichte-data'
import { isZeiterfassungPerson } from '@/lib/attendance-exclude'
import { pairEvents, groupByEmployee, absencesForEmployee, buildPdfReportData, type AttendanceEvent } from '@/lib/zeiterfassung-report'

// Generous per-request budget — each request renders at most ONE PDF, but a
// cold start plus storage round trips should never hit the platform default.
export const maxDuration = 60

// ── Types matching what BerichteClient sends ──────────────────────────────────

type PdfShiftRow = { kind: 'shift'; clockIn: string; clockOut: string; duration: string; incomplete: boolean }
type PdfBreakRow = { kind: 'break'; label: string }
type PdfNoteRow  = { kind: 'note'; label: string; tone?: 'ferien' | 'fm' | 'krank' | 'unfall' | 'komp' | 'teamevent' | 'uek' | 'bf' | 'uf' | 'wb' }
type PdfRow      = PdfShiftRow | PdfBreakRow | PdfNoteRow

interface PdfDayGroup {
  dateDisplay:     string
  dayTotalDisplay: string | null
  absenceLabel?:   string | null
  absenceTone?:    'ferien' | 'fm' | 'krank' | 'unfall' | 'komp' | 'teamevent' | 'uek' | 'bf' | 'uf' | 'wb' | null
  comment?:        string | null
  rows:            PdfRow[]
}

interface PdfReport {
  employeeName: string
  totalDisplay: string
  totalNote?:   string | null
  dayGroups:    PdfDayGroup[]
}

interface SavePdfRequest {
  employeeId?:   string | null
  employeeName:  string
  dateFrom:      string
  dateTo:        string
  totalDisplay:  string
  totalNote?:    string | null
  dayGroups:     PdfDayGroup[]
  /** true = return the PDF for viewing/printing instead of saving to Dokumente */
  download?:     boolean
  /** download mode: several employees → one merged PDF (one section each) */
  reports?:      PdfReport[]
  /** true = a document for the same period exists and may be replaced */
  replace?:      boolean
  /** true = server-built export of ONE employee's report for the period into
   *  their own Dokumente folder (admin only). The client calls this once per
   *  employee — many small requests instead of one long one, so a serverless
   *  time limit can never cut the export off halfway. */
  bulk?:           boolean
  bulkEmployeeId?: string
}

// ── Period naming ─────────────────────────────────────────────────────────────

const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
const fmtCH = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`

function periodName(dateFrom?: string, dateTo?: string): string {
  if (dateFrom && dateTo) {
    const [y, m] = dateFrom.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    const isFullMonth =
      dateFrom.slice(8) === '01' &&
      dateTo.slice(0, 7) === dateFrom.slice(0, 7) &&
      Number(dateTo.slice(8)) === lastDay
    return isFullMonth ? `${MONTHS[m - 1]} ${y}` : `${fmtCH(dateFrom)} – ${fmtCH(dateTo)}`
  }
  if (dateFrom || dateTo) return `${dateFrom ? fmtCH(dateFrom) : '…'} – ${dateTo ? fmtCH(dateTo) : '…'}`
  return 'alle Einträge'
}

// ── Transform client payload → design-v2 generator input ─────────────────────

const tMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const durMin = (s: string) => { const m = s.match(/(\d+):(\d+)/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0 }
const fmtH = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`
const isTime = (s: string) => /^\d{1,2}:\d{2}$/.test(s)

function toDesignData(body: PdfReport & { dateFrom: string; dateTo: string }) {
  let worked = 0
  const toneDays: Record<string, number> = { ferien: 0, fm: 0, krank: 0, unfall: 0, komp: 0, teamevent: 0, uek: 0, bf: 0, uf: 0, wb: 0 }
  const toneMin: Record<string, number> = { ferien: 0, fm: 0, krank: 0, unfall: 0, komp: 0, teamevent: 0, uek: 0, bf: 0, uf: 0, wb: 0 }

  const days = body.dayGroups.map(dg => {
    const [dayName, dateNum] = dg.dateDisplay.includes(', ')
      ? dg.dateDisplay.split(', ')
      : ['', dg.dateDisplay]
    const shifts = dg.rows.filter((r): r is PdfShiftRow => r.kind === 'shift')
    const stints = shifts
      .filter(s => isTime(s.clockIn))
      .map(s => {
        const startMin = tMin(s.clockIn)
        const complete = isTime(s.clockOut)
        const endMin = complete ? tMin(s.clockOut) : startMin + 30
        if (complete) worked += durMin(s.duration)
        return {
          startMin, endMin,
          label: complete ? `${s.clockIn} – ${s.clockOut}` : `${s.clockIn} · Anwesend`,
          shortLabel: complete ? `${s.clockIn} – ${s.clockOut}` : s.clockIn,
        }
      })
    // pauses: break rows sit between two shift rows
    const pauses: Array<{ centerMin: number; label: string }> = []
    for (let i = 0; i < dg.rows.length; i++) {
      const r = dg.rows[i]
      if (r.kind !== 'break') continue
      const prev = dg.rows.slice(0, i).reverse().find((x): x is PdfShiftRow => x.kind === 'shift')
      const next = dg.rows.slice(i + 1).find((x): x is PdfShiftRow => x.kind === 'shift')
      if (prev && next && isTime(prev.clockOut) && isTime(next.clockIn)) {
        pauses.push({ centerMin: (tMin(prev.clockOut) + tMin(next.clockIn)) / 2, label: r.label })
      }
    }
    const tone = dg.absenceTone ?? null
    if (tone) {
      const w = (() => { const m = (dg.absenceLabel ?? '').match(/\((\d*\.?\d+) Tag\)/); return m ? parseFloat(m[1]) : 1 })()
      toneDays[tone] = Math.round((toneDays[tone] + (tone === 'ferien' || tone === 'fm' ? w : 1)) * 100) / 100
      const noteRow = dg.rows.find((r): r is PdfNoteRow => r.kind === 'note')
      // FM (Ferien als Minusstunden) schreibt nichts gut
      const credit = tone === 'fm' ? 0 : noteRow ? durMin(noteRow.label) : 510
      toneMin[tone] += (tone === 'krank' || tone === 'unfall') && stints.length > 0 ? Math.max(0, 510 - stints.reduce((s, x) => s + (x.endMin - x.startMin), 0)) : credit
    }
    const absence = tone && stints.length === 0
      ? {
          tone,
          startMin: 480, endMin: 990,
          label: tone === 'krank' ? 'Krankheitstag · +8:30 h'
               : tone === 'unfall' ? 'Unfalltag · +8:30 h'
               : tone === 'komp' ? (dg.absenceLabel ?? 'Kompensation')
               : tone === 'teamevent' ? `${dg.absenceLabel ?? 'Teamevent'} · +${dg.dayTotalDisplay ?? '8:30 h'}`
               : tone === 'uek' ? `Überbetrieblicher Kurs · +${dg.dayTotalDisplay ?? '8:30 h'}`
               : tone === 'bf' ? `Bezahlt frei · +${dg.dayTotalDisplay ?? '8:30 h'}`
               : tone === 'uf' ? `Unbezahlte Ferien · +${dg.dayTotalDisplay ?? '8:30 h'}`
               : tone === 'wb' ? `Weiterbildung · +${dg.dayTotalDisplay ?? '8:30 h'}`
               : tone === 'fm' ? `Ferien ohne Gutschrift${dg.absenceLabel?.includes('(') ? ` ${dg.absenceLabel.slice(dg.absenceLabel.indexOf('('))}` : ''}`
               : `Ferientag${dg.absenceLabel?.includes('(') ? ` ${dg.absenceLabel.slice(dg.absenceLabel.indexOf('('))}` : ''} · +${dg.dayTotalDisplay ?? '8:30 h'}`,
        }
      : null
    return {
      dateNum, dayName, stints, pauses, absence,
      totalDisplay: dg.dayTotalDisplay ?? '',
      totalTone: tone,
      note: dg.comment || null,
    }
  })

  const tage = (n: number) => `${n} Tag${n !== 1 ? 'e' : ''}`
  const chips: Array<{ value: string; label: string; tone: string }> = []
  if (toneMin.ferien > 0) chips.push({ value: `+${fmtH(toneMin.ferien)}`, label: `Ferien (${tage(toneDays.ferien)})`, tone: 'ferien' })
  if (toneMin.krank > 0) chips.push({ value: `+${fmtH(toneMin.krank)}`, label: `Krankheit (${tage(toneDays.krank)})`, tone: 'krank' })
  if (toneMin.unfall > 0) chips.push({ value: `+${fmtH(toneMin.unfall)}`, label: `Unfall (${tage(toneDays.unfall)})`, tone: 'unfall' })
  if (toneDays.komp > 0) chips.push({ value: tage(toneDays.komp), label: 'Kompensation', tone: 'komp' })
  if (toneMin.teamevent > 0) chips.push({ value: `+${fmtH(toneMin.teamevent)}`, label: `Teamevent (${toneDays.teamevent} Tag${toneDays.teamevent !== 1 ? 'e' : ''})`, tone: 'teamevent' })
  if (toneMin.uek > 0) chips.push({ value: `+${fmtH(toneMin.uek)}`, label: `Überbetrieblicher Kurs (${toneDays.uek} Tag${toneDays.uek !== 1 ? 'e' : ''})`, tone: 'uek' })
  if (toneMin.bf > 0) chips.push({ value: `+${fmtH(toneMin.bf)}`, label: `Bezahlt frei (${toneDays.bf} Tag${toneDays.bf !== 1 ? 'e' : ''})`, tone: 'bf' })
  if (toneMin.uf > 0) chips.push({ value: `+${fmtH(toneMin.uf)}`, label: `Unbezahlte Ferien (${toneDays.uf} Tag${toneDays.uf !== 1 ? 'e' : ''})`, tone: 'uf' })
  if (toneMin.wb > 0) chips.push({ value: `+${fmtH(toneMin.wb)}`, label: `Weiterbildung (${toneDays.wb} Tag${toneDays.wb !== 1 ? 'e' : ''})`, tone: 'wb' })
  if (toneDays.fm > 0) chips.push({ value: tage(toneDays.fm), label: 'Ferien ohne Gutschrift', tone: 'fm' })

  return {
    employeeName: body.employeeName,
    periodLabel: periodName(body.dateFrom, body.dateTo),
    createdLabel: `Erstellt am ${new Date().toLocaleDateString('de-CH')}`,
    summary: {
      totalDisplay: body.totalDisplay,
      workedDisplay: fmtH(worked),
      chips,
      daysLabel: `${days.length} erfasste Tage`,
    },
    days,
    totalNote: body.totalNote ?? null,
    totalDisplay: body.totalDisplay,
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Verify admin
  const serverClient = await createServerClient()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })

  const { data: profile } = await serverClient
    .from('profiles')
    .select('role, job_title, full_name')
    .eq('id', user.id)
    .single()
  const prof = profile as { role: string; job_title: string | null; full_name: string | null } | null
  const isAdmin = prof?.role === 'admin'
  const isLeitende = prof?.job_title === 'Leitende DA'

  // 2. Parse body
  let body: SavePdfRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 })
  }

  // Leitende may only render/download reports — never write to Dokumente.
  // Regular employees may download too, but only their OWN report
  // (the personal "Meine Zeiten" page).
  if (!isAdmin && !body.download) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
  }
  if (!isAdmin && !isLeitende) {
    const ownFirst = (prof?.full_name ?? '').split(' ')[0]
    const names = body.reports?.length
      ? body.reports.map(r => r.employeeName)
      : [body.employeeName]
    const foreign = names.some(n => !ownFirst || (n ?? '').split(' ')[0] !== ownFirst)
    if (foreign) {
      return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
    }
  }

  // ── Bulk mode: build and save ONE employee's report for the period into
  //    their own Dokumente folder. The Kontrolle page calls this once per
  //    employee, so every request stays far below the serverless time limit
  //    (the earlier all-in-one variant was cut off mid-export). The report is
  //    built server-side with the same shared code as the Berichte page from
  //    period-bounded queries, and the document is keyed by the employee's
  //    profile id — no name guessing, so files can never end up in the wrong
  //    folder. An existing document with the same period label is replaced
  //    (running the export twice creates no duplicates).
  if (body.bulk) {
    if (!isAdmin) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.dateFrom ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(body.dateTo ?? '')) {
      return NextResponse.json({ error: 'Ungültiger Zeitraum' }, { status: 400 })
    }
    if (!body.bulkEmployeeId) {
      return NextResponse.json({ error: 'Mitarbeiter-ID erforderlich' }, { status: 400 })
    }
    const bulkAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const data = await loadBerichteData(bulkAdmin, { dateFrom: body.dateFrom, dateTo: body.dateTo })
    const p = data.profiles.find(pr => pr.id === body.bulkEmployeeId)
    if (!p) return NextResponse.json({ error: 'Mitarbeiterin nicht gefunden' }, { status: 404 })

    const bulkPeriod = periodName(body.dateFrom, body.dateTo)
    const bulkLabel  = `Zeiterfassung ${bulkPeriod}`
    if (!isZeiterfassungPerson(p)) {
      return NextResponse.json({ success: true, label: bulkLabel, result: { name: p.full_name, status: 'übersprungen', grund: 'ohne Zeiterfassung' } })
    }

    const shifts = pairEvents(data.events as AttendanceEvent[])
      .filter(s => s.date >= body.dateFrom && s.date <= body.dateTo && s.fullName === p.full_name)
    const report = groupByEmployee(shifts)[0] ?? { fullName: p.full_name, shifts: [], totalMinutes: 0 }
    const absences = absencesForEmployee(data.planAbsences, p.full_name)
    const hasAbsence = Object.keys(absences).some(d => d >= body.dateFrom && d <= body.dateTo)
    if (report.shifts.length === 0 && !hasAbsence) {
      return NextResponse.json({ success: true, label: bulkLabel, result: { name: p.full_name, status: 'übersprungen', grund: 'keine Zeiten in diesem Monat' } })
    }

    try {
      const payload = buildPdfReportData(report, absences, data.initialComments, body.dateFrom, body.dateTo)
      const bytes = await generateZeiterfassungPdf(toDesignData({ ...payload, dateFrom: body.dateFrom, dateTo: body.dateTo }))

      // replace any existing export for the same period
      const { data: existingDocs } = await bulkAdmin
        .from('documents')
        .select('id, file_path')
        .eq('employee_id', p.id)
        .eq('label', bulkLabel)
      const old = (existingDocs ?? []) as Array<{ id: string; file_path: string | null }>
      if (old.length > 0) {
        const paths = old.map(o => o.file_path).filter((x): x is string => !!x)
        if (paths.length > 0) await bulkAdmin.storage.from('employee-documents').remove(paths)
        await bulkAdmin.from('documents').delete().in('id', old.map(o => o.id))
      }

      // File name = month + export type (folder is already the employee's own)
      const fileName    = `Zeiterfassung_${bulkPeriod.replace(/[^A-Za-z0-9äöüÄÖÜ]+/g, '_')}.pdf`
      const storagePath = `${p.id}/${fileName}`
      const { error: upErr } = await bulkAdmin.storage
        .from('employee-documents')
        .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: true })
      if (upErr) throw new Error(upErr.message)
      const { error: dbErr } = await bulkAdmin.from('documents').insert({
        employee_id: p.id,
        file_name:   fileName,
        label:       bulkLabel,
        file_path:   storagePath,
        file_type:   'pdf',
        category:    'zeiterfassung',
        uploaded_by: user.id,
      })
      if (dbErr) {
        await bulkAdmin.storage.from('employee-documents').remove([storagePath])
        throw new Error(dbErr.message)
      }
      return NextResponse.json({ success: true, label: bulkLabel, result: { name: p.full_name, status: 'exportiert' } })
    } catch (err) {
      console.error('[save-pdf bulk]', p.full_name, err)
      return NextResponse.json({ success: true, label: bulkLabel, result: { name: p.full_name, status: 'übersprungen', grund: 'Fehler beim Erstellen/Speichern' } })
    }
  }

  // ── Download mode: render the v2 design and return it directly (no upload).
  //    Several employees are merged into one PDF, one section per person.
  if (body.download) {
    const list: PdfReport[] = body.reports?.length
      ? body.reports
      : [{ employeeName: body.employeeName, totalDisplay: body.totalDisplay, totalNote: body.totalNote, dayGroups: body.dayGroups }]
    if (!list.length || list.some(r => !r.employeeName || !r.dayGroups?.length)) {
      return NextResponse.json({ error: 'Keine Daten für den PDF-Export' }, { status: 400 })
    }
    try {
      const parts = await Promise.all(list.map(r =>
        generateZeiterfassungPdf(toDesignData({ ...r, dateFrom: body.dateFrom, dateTo: body.dateTo }))
      ))
      let bytes: Uint8Array
      if (parts.length === 1) {
        bytes = parts[0]
      } else {
        const merged = await PDFDocument.create()
        for (const part of parts) {
          const doc = await PDFDocument.load(part)
          const pages = await merged.copyPages(doc, doc.getPageIndices())
          pages.forEach(p => merged.addPage(p))
        }
        bytes = await merged.save()
      }
      const fname = `Zeiterfassung_${periodName(body.dateFrom, body.dateTo).replace(/[^A-Za-z0-9]+/g, '_')}.pdf`
      return new NextResponse(Buffer.from(bytes), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${fname}"`,
        },
      })
    } catch (err) {
      console.error('[save-pdf] PDF download error:', err)
      return NextResponse.json({ error: 'PDF-Erstellung fehlgeschlagen' }, { status: 500 })
    }
  }

  if (!body.employeeName || !body.dayGroups?.length) {
    return NextResponse.json({ error: 'Mitarbeiter und Daten erforderlich' }, { status: 400 })
  }

  // 3. Resolve employee — by ID (authoritative), name only as fallback
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  let employeeProfileId: string | null = null
  if (body.employeeId) {
    const { data: byId } = await admin.from('profiles').select('id').eq('id', body.employeeId).maybeSingle()
    employeeProfileId = byId?.id ?? null
  }
  if (!employeeProfileId && body.employeeName) {
    const { data: byName } = await admin.from('profiles').select('id').eq('full_name', body.employeeName).maybeSingle()
    employeeProfileId = byName?.id ?? null
    if (!employeeProfileId) {
      const { data: byFirst } = await admin.from('profiles').select('id')
        .ilike('full_name', `${body.employeeName.split(' ')[0]}%`).limit(2)
      if (byFirst?.length === 1) employeeProfileId = byFirst[0].id
    }
  }
  if (!employeeProfileId) {
    return NextResponse.json({ error: `Mitarbeiter "${body.employeeName}" nicht gefunden` }, { status: 404 })
  }

  // 3b. Same period already exported? Ask before replacing; on replace the
  //     old document(s) with this label are removed (record + stored file).
  const periodStr = periodName(body.dateFrom, body.dateTo)
  const label     = `Zeiterfassung ${periodStr}`
  const { data: existingDocs } = await admin
    .from('documents')
    .select('id, file_path')
    .eq('employee_id', employeeProfileId)
    .eq('label', label)
  const existing = (existingDocs ?? []) as Array<{ id: string; file_path: string | null }>
  if (existing.length > 0) {
    if (!body.replace) {
      return NextResponse.json({ duplicate: true, label }, { status: 409 })
    }
    const paths = existing.map(e => e.file_path).filter((p): p is string => !!p)
    if (paths.length > 0) await admin.storage.from('employee-documents').remove(paths)
    await admin.from('documents').delete().in('id', existing.map(e => e.id))
  }

  // 4. Generate PDF (design v2)
  let pdfBytes: Uint8Array
  try {
    pdfBytes = await generateZeiterfassungPdf(toDesignData(body))
  } catch (err) {
    console.error('[save-pdf] PDF generation error:', err)
    return NextResponse.json({ error: 'PDF-Erstellung fehlgeschlagen' }, { status: 500 })
  }

  // 5. Upload to Storage — file name = period + export type (the folder is
  //    already the employee's own, keyed by their profile id)
  const fileName    = `Zeiterfassung_${periodStr.replace(/[^A-Za-z0-9äöüÄÖÜ]+/g, '_')}.pdf`
  const storagePath = `${employeeProfileId}/${fileName}`

  const { error: uploadErr } = await admin.storage
    .from('employee-documents')
    .upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: true })

  if (uploadErr) {
    return NextResponse.json({ error: `Upload-Fehler: ${uploadErr.message}` }, { status: 500 })
  }

  // 6. Create document record
  const { error: dbErr } = await admin
    .from('documents')
    .insert({
      employee_id: employeeProfileId,
      file_name:   fileName,
      label,
      file_path:   storagePath,
      file_type:   'pdf',
      category:    'zeiterfassung',
      uploaded_by: user.id,
    })

  if (dbErr) {
    await admin.storage.from('employee-documents').remove([storagePath])
    return NextResponse.json({ error: `Datenbankfehler: ${dbErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true, label })
}
