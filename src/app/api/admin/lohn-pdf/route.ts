import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminSdk } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { buildLohnPdf } from '@/lib/lohn-pdf-build'
import {
  LOHN_SAETZE_KEY, LOHN_SAETZE_2026, LOHN_ABR_PREFIX,
  type LohnAbrechnung, type LohnSaetze,
} from '@/lib/lohn'

export const maxDuration = 60

type LohnPdfRequest = {
  employeeId: string
  abr: Pick<LohnAbrechnung, 'titel' | 'periode' | 'monat' | 'lines' | 'zulagen' | 'nach' | 'ahv' | 'alv' | 'nbu' | 'ktg' | 'pkAbzug' | 'qstSatz' | 'deckelMonate' | 'manuell'> & { qstTarif?: string | null }
  /** inline = im Tab öffnen, download = herunterladen, ablegen = in den Lohn-Ordner der Mitarbeiterin */
  mode: 'inline' | 'download' | 'ablegen'
  /** ablegen: ID der GESPEICHERTEN Abrechnung — Pflicht. Das PDF wird
   *  serverseitig aus der gespeicherten Zeile __lohn_abr__<employeeId>_<abrId>
   *  erzeugt; der Schlüssel bindet Inhalt und Mitarbeiterin untrennbar
   *  aneinander, damit nie ein Lohn-PDF im falschen Ordner landen kann. */
  abrId?: string
  /** ablegen: bestehendes Dokument mit gleichem Label ersetzen */
  replace?: boolean
}

export async function POST(req: NextRequest) {
  const serverClient = await createServerClient()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
  const { data: profile } = await serverClient.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
  }

  let body: LohnPdfRequest
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 })
  }
  if (!body.employeeId || !body.abr?.titel || !body.abr?.periode || !Array.isArray(body.abr.lines)) {
    return NextResponse.json({ error: 'Unvollständige Angaben' }, { status: 400 })
  }

  const admin = createAdminSdk(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const [{ data: emp }, { data: saetzeRow }] = await Promise.all([
    admin.from('profiles')
      .select('id, full_name, address, ahv_nummer, pensum, job_title')
      .eq('id', body.employeeId).maybeSingle(),
    admin.from('zeiterfassung_comments')
      .select('comment')
      .eq('user_full_name', LOHN_SAETZE_KEY)
      .eq('schedule_date', `${body.abr.monat.slice(0, 4)}-01-01`)
      .maybeSingle(),
  ])
  const e = emp as { id: string; full_name: string; address: string | null; ahv_nummer: string | null; pensum: number | null; job_title: string | null } | null
  if (!e) return NextResponse.json({ error: 'Mitarbeiterin nicht gefunden' }, { status: 404 })

  // ── Ablegen: NUR aus der gespeicherten Abrechnung dieser Mitarbeiterin ──
  // Der Speicherschlüssel enthält die Profil-ID; derselbe Wert bestimmt
  // unten Ordnerpfad, Dokumenteintrag und die Personalien auf dem PDF.
  let abrData = body.abr
  if (body.mode === 'ablegen') {
    if (!body.abrId || !/^[a-z0-9]{6,20}$/.test(body.abrId)) {
      return NextResponse.json({ error: 'Zum Ablegen bitte die Abrechnung zuerst speichern.' }, { status: 400 })
    }
    const { data: savedRow } = await admin.from('zeiterfassung_comments')
      .select('schedule_date, comment')
      .eq('user_full_name', `${LOHN_ABR_PREFIX}${e.id}_${body.abrId}`)
      .maybeSingle()
    if (!savedRow) {
      return NextResponse.json({ error: 'Gespeicherte Abrechnung für diese Mitarbeiterin nicht gefunden.' }, { status: 404 })
    }
    try {
      const stored = JSON.parse((savedRow as { comment: string }).comment) as LohnAbrechnung
      abrData = { ...stored, monat: (savedRow as { schedule_date: string }).schedule_date.slice(0, 7), qstTarif: body.abr.qstTarif ?? null }
    } catch {
      return NextResponse.json({ error: 'Gespeicherte Abrechnung ist beschädigt.' }, { status: 500 })
    }
  }

  let saetze: LohnSaetze = LOHN_SAETZE_2026
  if (saetzeRow?.comment) {
    try { saetze = { ...LOHN_SAETZE_2026, ...(JSON.parse(saetzeRow.comment) as LohnSaetze) } } catch { /* default */ }
  }

  let bytes: Uint8Array
  try {
    bytes = await buildLohnPdf(e, abrData, saetze)
  } catch (err) {
    console.error('[lohn-pdf]', err)
    return NextResponse.json({ error: 'PDF-Erstellung fehlgeschlagen' }, { status: 500 })
  }

  const safePeriode = abrData.periode.replace(/[^A-Za-z0-9äöüÄÖÜ]+/g, '_')
  const fileName = `${abrData.titel.replace(/[^A-Za-z0-9äöüÄÖÜ]+/g, '_')}_${safePeriode}.pdf`

  if (body.mode !== 'ablegen') {
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${body.mode === 'download' ? 'attachment' : 'inline'}; filename="${fileName}"`,
      },
    })
  }

  // ── In den Lohn-Ordner der Mitarbeiterin ablegen (Ersetzen nach Label) ──
  const label = `${abrData.titel} ${abrData.periode}`
  const { data: existingDocs } = await admin
    .from('documents')
    .select('id, file_path')
    .eq('employee_id', e.id)
    .eq('label', label)
  const old = (existingDocs ?? []) as Array<{ id: string; file_path: string | null }>
  if (old.length > 0) {
    if (!body.replace) return NextResponse.json({ duplicate: true, label }, { status: 409 })
    const paths = old.map(o => o.file_path).filter((x): x is string => !!x)
    if (paths.length > 0) await admin.storage.from('employee-documents').remove(paths)
    await admin.from('documents').delete().in('id', old.map(o => o.id))
  }

  const storagePath = `${e.id}/${fileName}`
  const { error: uploadErr } = await admin.storage
    .from('employee-documents')
    .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: true })
  if (uploadErr) return NextResponse.json({ error: `Upload-Fehler: ${uploadErr.message}` }, { status: 500 })

  const { error: dbErr } = await admin.from('documents').insert({
    employee_id: e.id,
    file_name: fileName,
    label,
    file_path: storagePath,
    file_type: 'pdf',
    category: 'lohn',
    uploaded_by: user.id,
  })
  if (dbErr) {
    await admin.storage.from('employee-documents').remove([storagePath])
    return NextResponse.json({ error: `Datenbankfehler: ${dbErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true, label })
}
