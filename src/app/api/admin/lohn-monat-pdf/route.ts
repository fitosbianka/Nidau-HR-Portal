import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminSdk } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { PDFDocument } from 'pdf-lib'
import { buildLohnPdf, type LohnPdfProfil } from '@/lib/lohn-pdf-build'
import { LOHN_SAETZE_2026, parseLohnSaetze, parseLohnStamm, parseLohnAbrechnungen, type LohnAbrechnung } from '@/lib/lohn'

export const maxDuration = 60

const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']

// POST /api/admin/lohn-monat-pdf
// Body: { monat: 'YYYY-MM', mode?: 'inline' | 'download' }
// Baut EIN PDF mit allen GESPEICHERTEN Abrechnungen des Monats
// (eine Seite pro Abrechnung, alphabetisch nach Name) — zum Drucken
// oder Herunterladen in einem Zug. Jedes Einzel-PDF wird mit derselben
// Logik erzeugt wie der Einzel-Export (buildLohnPdf).
export async function POST(req: NextRequest) {
  const serverClient = await createServerClient()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
  const { data: profile } = await serverClient.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
  }

  let body: { monat?: string; mode?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 })
  }
  const monat = body.monat ?? ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monat)) {
    return NextResponse.json({ error: 'Ungültiger Monat' }, { status: 400 })
  }

  const admin = createAdminSdk(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: rows } = await admin
    .from('zeiterfassung_comments')
    .select('user_full_name, schedule_date, comment')
    .like('user_full_name', '\\_\\_lohn%')
  const lohnRows = (rows ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>
  const saetzeByJahr = parseLohnSaetze(lohnRows)
  const stammById = parseLohnStamm(lohnRows)
  const abrById = parseLohnAbrechnungen(lohnRows)

  const items: Array<{ profileId: string; abr: LohnAbrechnung }> = []
  for (const [profileId, list] of Object.entries(abrById)) {
    for (const abr of list) if (abr.monat === monat) items.push({ profileId, abr })
  }
  if (items.length === 0) {
    return NextResponse.json({ error: 'In diesem Monat sind keine Abrechnungen gespeichert.' }, { status: 404 })
  }

  const ids = Array.from(new Set(items.map(i => i.profileId)))
  const { data: profRows } = await admin
    .from('profiles')
    .select('id, full_name, address, ahv_nummer, pensum, job_title')
    .in('id', ids)
  const profById = new Map(((profRows ?? []) as LohnPdfProfil[]).map(p => [p.id, p]))
  items.sort((a, b) =>
    (profById.get(a.profileId)?.full_name ?? '').localeCompare(profById.get(b.profileId)?.full_name ?? ''))

  const jahr = parseInt(monat.slice(0, 4), 10)
  const saetze = saetzeByJahr[jahr] ?? { ...LOHN_SAETZE_2026, jahr }

  try {
    const merged = await PDFDocument.create()
    for (const { profileId, abr } of items) {
      const e = profById.get(profileId)
      if (!e) continue
      const bytes = await buildLohnPdf(e, { ...abr, qstTarif: stammById[profileId]?.qstTarif ?? null }, saetze)
      const src = await PDFDocument.load(bytes)
      const pages = await merged.copyPages(src, src.getPageIndices())
      for (const p of pages) merged.addPage(p)
    }
    const out = await merged.save()
    const fileName = `Lohnabrechnungen_${MONTH_NAMES[parseInt(monat.slice(5, 7), 10) - 1]}_${jahr}.pdf`
    return new NextResponse(Buffer.from(out), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${body.mode === 'download' ? 'attachment' : 'inline'}; filename="${fileName}"`,
      },
    })
  } catch (err) {
    console.error('[lohn-monat-pdf]', err)
    return NextResponse.json({ error: 'PDF-Erstellung fehlgeschlagen' }, { status: 500 })
  }
}
