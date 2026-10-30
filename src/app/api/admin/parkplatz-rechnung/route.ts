import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateParkplatzRechnungPdf } from '@/lib/pdf/hr-pdfs.mjs'
import { fmtChf } from '@/lib/parkplatz'

export const maxDuration = 60

const fmtCH = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

// Jahresrechnung for a parking space — admin only. Returns the PDF inline
// (`dl: true` → attachment). With bezahltAm set, the same document carries
// the payment confirmation line (Zahlungsbestätigung).
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
  }

  let body: { jahr?: number; name?: string; adresse?: string; monatsbetrag?: number; bezahltAm?: string | null; dl?: boolean }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 })
  }
  const jahr = Number(body.jahr)
  const monatsbetrag = Number(body.monatsbetrag)
  if (!body.name?.trim() || !(jahr >= 2020 && jahr <= 2099) || !(monatsbetrag > 0)) {
    return NextResponse.json({ error: 'Name, Jahr und Betrag erforderlich' }, { status: 400 })
  }
  if (body.bezahltAm && !/^\d{4}-\d{2}-\d{2}$/.test(body.bezahltAm)) {
    return NextResponse.json({ error: 'Ungültiges Zahlungsdatum' }, { status: 400 })
  }

  try {
    const bytes = await generateParkplatzRechnungPdf({
      jahr,
      empfName: body.name.trim(),
      adresse: body.adresse ?? '',
      monatsbetragFmt: fmtChf(monatsbetrag),
      jahresbetragFmt: fmtChf(monatsbetrag * 12),
      erstelltAm: new Date().toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' }),
      bezahltAm: body.bezahltAm ? fmtCH(body.bezahltAm) : null,
    })
    const safe = body.name.trim().replace(/[^A-Za-z0-9äöüÄÖÜ]+/g, '_')
    const fname = `Rechnung_Parkplatz_${jahr}_${safe}.pdf`
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${body.dl ? 'attachment' : 'inline'}; filename="${fname}"`,
      },
    })
  } catch (err) {
    console.error('[parkplatz-rechnung]', err)
    return NextResponse.json({ error: 'PDF-Erstellung fehlgeschlagen' }, { status: 500 })
  }
}
