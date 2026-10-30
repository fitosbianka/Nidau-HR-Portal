import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { generateKontoPdf } from '@/lib/pdf/hr-pdfs.mjs'

interface KontoRow {
  label: string; soll: string; ist: string; saldoVor: string
  konto: string; ferien: string; restFerien: string; krank: string; unfall?: string
}
interface SaveKontoRequest {
  employeeId?:  string | null
  employeeName: string
  funktion:     string
  pensumLabel:  string
  year:         number
  bemerkungen:  string | null
  rows:         KontoRow[]
  /** true = return the PDF for viewing/printing instead of saving to Dokumente */
  download?:    boolean
  /** true = replace an existing document with the same label (bulk export) */
  replace?:     boolean
}

// One PDF per request; the margin covers cold starts and storage round trips.
export const maxDuration = 60

const MON_SHORT = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']

const clean = (s: string) => (s ?? '').trim()
const isVal = (s: string) => { const v = clean(s); return v !== '' && v !== '-' && v !== '–' && v !== '—' }

function toDesignData(body: SaveKontoRequest) {
  const rows = body.rows.map(r => {
    const empty = !isVal(r.soll) && !isVal(r.ist) && !isVal(r.konto)
    return {
      label: r.label,
      soll: r.soll, ist: r.ist, vor: r.saldoVor, konto: r.konto,
      ferien: r.ferien, rest: r.restFerien, krank: r.krank, unfall: r.unfall ?? '',
      empty,
    }
  })

  let lastKonto: string | null = null, lastRest: string | null = null
  let lastIdx = -1, firstIdx = -1
  let krankSum = 0
  let unfallSum = 0
  rows.forEach((r, i) => {
    if (!r.empty) {
      if (firstIdx === -1) firstIdx = i
      lastIdx = i
      if (isVal(r.konto)) lastKonto = clean(r.konto)
      if (isVal(r.rest)) lastRest = clean(r.rest)
      const k = parseFloat(clean(r.krank).replace(',', '.'))
      if (!isNaN(k)) krankSum += k
      const u = parseFloat(clean(r.unfall).replace(',', '.'))
      if (!isNaN(u)) unfallSum += u
    }
  })
  const lk = lastKonto as string | null   // (TS loses the closure assignment)
  const saldoDisplay = lk == null ? '–'
    : (lk.startsWith('-') ? `-${lk.slice(1)} h` : `+${lk} h`)

  return {
    employeeName: body.employeeName,
    funktion: body.funktion,
    pensumLabel: body.pensumLabel,
    year: body.year,
    createdLabel: `Erstellt am ${new Date().toLocaleDateString('de-CH')}`,
    stats: {
      saldoDisplay,
      saldoSub: lastIdx >= 0 ? `Stand Ende ${rows[lastIdx].label}` : '—',
      restDisplay: lastRest ?? '–',
      krankDisplay: String(Math.round(krankSum * 100) / 100),
      krankSub: firstIdx >= 0 && lastIdx >= 0 ? `${MON_SHORT[firstIdx]} – ${MON_SHORT[lastIdx]} ${body.year}` : String(body.year),
      unfallDisplay: String(Math.round(unfallSum * 100) / 100),
    },
    rows,
    bemerkungen: body.bemerkungen ?? null,
  }
}

export async function POST(req: NextRequest) {
  const serverClient = await createServerClient()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })

  const { data: profile } = await serverClient.from('profiles').select('role, job_title').eq('id', user.id).single()
  const prof = profile as { role: string; job_title: string | null } | null
  const isAdmin = prof?.role === 'admin'
  const isLeitende = prof?.job_title === 'Leitende DA'

  let body: SaveKontoRequest
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 })
  }

  // Admins: everything. Leitende: download any report. Other employees:
  // download only their OWN Konto (shown on their start page).
  const ownDownload = body.download === true && body.employeeId === user.id
  if (!isAdmin && !((isLeitende && body.download) || ownDownload)) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
  }
  if (!body.employeeName || !body.rows?.length) {
    return NextResponse.json({ error: 'Mitarbeiter und Daten erforderlich' }, { status: 400 })
  }

  // ── Download mode: render the v2 design and return it directly (no upload).
  if (body.download) {
    try {
      const bytes = await generateKontoPdf(toDesignData(body))
      const fname = `Ferienkonto_${body.year}_${body.employeeName.replace(/[^A-Za-z0-9äöüÄÖÜ]+/g, '_')}.pdf`
      return new NextResponse(Buffer.from(bytes), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${fname}"`,
        },
      })
    } catch (err) {
      console.error('[save-konto-pdf] PDF download error:', err)
      return NextResponse.json({ error: 'PDF-Erstellung fehlgeschlagen' }, { status: 500 })
    }
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  // Resolve by ID (authoritative), name only as fallback
  let empProfile: { id: string } | null = null
  if (body.employeeId) {
    const { data } = await admin.from('profiles').select('id').eq('id', body.employeeId).maybeSingle()
    empProfile = data ?? null
  }
  if (!empProfile) {
    const { data } = await admin.from('profiles').select('id').eq('full_name', body.employeeName).maybeSingle()
    empProfile = data ?? null
  }
  if (!empProfile?.id) {
    return NextResponse.json({ error: `Mitarbeiter "${body.employeeName}" nicht gefunden` }, { status: 404 })
  }

  const label = `Ferienkonto ${body.year}`
  // Earlier exports used this longer label — treated as the same document
  const legacyLabel = `Arbeitszeit- und Ferienkonto ${body.year}`

  // Same year already exported? Without `replace` the caller is asked first;
  // with it the old document(s) are removed (keeps folders duplicate-free).
  const { data: existingDocs } = await admin
    .from('documents')
    .select('id, file_path')
    .eq('employee_id', empProfile.id)
    .in('label', [label, legacyLabel])
  const old = (existingDocs ?? []) as Array<{ id: string; file_path: string | null }>
  if (old.length > 0) {
    if (!body.replace) {
      return NextResponse.json({ duplicate: true, label }, { status: 409 })
    }
    const paths = old.map(o => o.file_path).filter((x): x is string => !!x)
    if (paths.length > 0) await admin.storage.from('employee-documents').remove(paths)
    await admin.from('documents').delete().in('id', old.map(o => o.id))
  }

  let pdfBytes: Uint8Array
  try {
    pdfBytes = await generateKontoPdf(toDesignData(body))
  } catch (err) {
    console.error('[save-konto-pdf] PDF generation error:', err)
    return NextResponse.json({ error: 'PDF-Erstellung fehlgeschlagen' }, { status: 500 })
  }

  // File name = year + export type (the folder is already the employee's own)
  const fileName    = `Ferienkonto_${body.year}.pdf`
  const storagePath = `${empProfile.id}/${fileName}`

  const { error: uploadErr } = await admin.storage
    .from('employee-documents')
    .upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: true })
  if (uploadErr) return NextResponse.json({ error: `Upload-Fehler: ${uploadErr.message}` }, { status: 500 })

  const { error: dbErr } = await admin.from('documents').insert({
    employee_id: empProfile.id,
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
