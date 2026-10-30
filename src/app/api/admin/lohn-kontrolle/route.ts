import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminSdk } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { LOHN_ABR_PREFIX } from '@/lib/lohn'
import { ohneGaesteErgebnis } from '@/lib/gaeste'
import { ladeExterne, istExternProfil } from '@/lib/externe'
import {
  bezugZumMonat, titelPruefen, beurteile, zaehle, monatLabel,
  type KontrolleDatei, type KontrollePerson, type KontrolleErgebnis,
} from '@/lib/lohn-pdf-kontrolle'

export const maxDuration = 60

// Kontrollansicht «Abgelegte PDFs <Monat>» (nur Admins): welche Lohn-
// Dateien liegen in welchem Dokumentenordner, und passt der Name im PDF
// (Titel, vom Portal gesetzt) zur Ordnerinhaberin.
export async function GET(req: NextRequest) {
  const serverClient = await createServerClient()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
  const { data: profile } = await serverClient.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })

  const monat = req.nextUrl.searchParams.get('monat') ?? ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monat)) return NextResponse.json({ error: 'Ungültiger Monat' }, { status: 400 })
  const jahr = parseInt(monat.slice(0, 4), 10), m = parseInt(monat.slice(5, 7), 10)
  const monatEnde = `${monat}-${String(new Date(jahr, m, 0).getDate()).padStart(2, '0')}`

  const admin = createAdminSdk(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  type Prof = { id: string; full_name: string; is_active: boolean; eintrittsdatum: string | null }
  type Dok = { id: string; employee_id: string; label: string; file_name: string; file_path: string; created_at: string; uploaded_by: string | null }
  const [{ data: profRows }, externeIds, { data: dokRows }, { data: abrRows }] = await Promise.all([
    admin.from('profiles').select('id, full_name, is_active, eintrittsdatum, job_title, role')
      .in('role', ['employee', 'admin']).order('full_name').then(ohneGaesteErgebnis),
    ladeExterne(admin),
    admin.from('documents').select('id, employee_id, label, file_name, file_path, created_at, uploaded_by').eq('category', 'lohn'),
    admin.from('zeiterfassung_comments').select('user_full_name')
      .like('user_full_name', `${LOHN_ABR_PREFIX.replace(/_/g, '\\_')}%`).eq('schedule_date', `${monat}-01`),
  ])
  const profile_ = (profRows ?? []) as Prof[]
  const nameById = new Map(profile_.map(p => [p.id, p.full_name]))
  const alleNamen = profile_.map(p => p.full_name)

  const gespeichert = new Set<string>()
  for (const r of (abrRows ?? []) as Array<{ user_full_name: string }>) {
    const rest = r.user_full_name.slice(LOHN_ABR_PREFIX.length)
    const sep = rest.lastIndexOf('_')
    if (sep > 0) gespeichert.add(rest.slice(0, sep))
  }

  // Dateien des Monats: Bezeichnung mit Monat oder passender Periode
  const kandidaten = ((dokRows ?? []) as Dok[])
    .map(d => ({ d, bezug: bezugZumMonat(d.label ?? '', monat) }))
    .filter((x): x is { d: Dok; bezug: 'monat' | 'periode' } => x.bezug !== null)

  // PDF-Titel lesen (vom Portal gesetzt), in kleinen Gruppen parallel
  const titel = new Map<string, string | null>()
  for (let i = 0; i < kandidaten.length; i += 5) {
    await Promise.all(kandidaten.slice(i, i + 5).map(async ({ d }) => {
      try {
        const { data, error } = await admin.storage.from('employee-documents').download(d.file_path)
        if (error || !data) { titel.set(d.id, null); return }
        const doc = await PDFDocument.load(new Uint8Array(await data.arrayBuffer()), { updateMetadata: false, ignoreEncryption: true })
        titel.set(d.id, doc.getTitle() ?? null)
      } catch {
        titel.set(d.id, null)
      }
    }))
  }

  const dateienJe = new Map<string, KontrolleDatei[]>()
  for (const { d, bezug } of kandidaten) {
    const inhaberin = nameById.get(d.employee_id) ?? ''
    const datei: KontrolleDatei = {
      id: d.id, label: d.label, fileName: d.file_name, createdAt: d.created_at,
      abgelegtVon: d.uploaded_by ? (nameById.get(d.uploaded_by) ?? null) : null,
      bezug, titel: titel.get(d.id) ?? null,
      pruefung: titelPruefen(titel.get(d.id), inhaberin, alleNamen),
    }
    dateienJe.set(d.employee_id, [...(dateienJe.get(d.employee_id) ?? []), datei])
  }

  const personen: KontrollePerson[] = profile_
    .map(p => {
      const extern = istExternProfil(p, externeIds)
      const faellig = p.is_active && !extern && !(p.eintrittsdatum && p.eintrittsdatum > monatEnde)
      const dateien = (dateienJe.get(p.id) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      return { profileId: p.id, name: p.full_name, aktiv: p.is_active, faellig, abrechnungGespeichert: gespeichert.has(p.id), dateien, urteil: beurteile(faellig, dateien) }
    })
    // Inaktive ohne Datei interessieren nicht
    .filter(p => p.faellig || p.dateien.length > 0 || p.abrechnungGespeichert)
    .sort((a, b) => a.name.localeCompare(b.name, 'de-CH'))

  const ergebnis: KontrolleErgebnis = { monat, label: monatLabel(monat), geprueftAm: new Date().toISOString(), personen, zaehler: zaehle(personen) }
  return NextResponse.json(ergebnis)
}
