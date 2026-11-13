import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateBestelllistePdf } from '@/lib/pdf/hr-pdfs.mjs'
import { LEITENDE_TITLE } from '@/lib/leitende'
import {
  LISTE_PREFIX, FIRMEN_KEY, BESTELL_ANCHOR, FIRMEN_EMPFOHLEN,
  hatBestellZugang, itemsNachFirma, parseListeRow,
} from '@/lib/bestellungen'

// Bestellliste als PDF (Briefkopf, nach Firmen gruppiert, Abhak-Kästchen).
// GET ?id=<listeId> (&dl=1 → Download). Offene UND geschlossene Listen.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const { data: profRow } = await supabase
    .from('profiles').select('role, full_name, job_title').eq('id', user.id).single()
  const prof = profRow as { role: string; full_name: string; job_title: string | null } | null
  if (!hatBestellZugang(prof?.role, prof?.job_title, prof?.full_name, LEITENDE_TITLE)) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
  }

  const id = req.nextUrl.searchParams.get('id') ?? ''
  const dl = req.nextUrl.searchParams.get('dl') === '1'
  if (!/^[a-z0-9]{6,40}$/.test(id)) return NextResponse.json({ error: 'Ungültige Liste' }, { status: 400 })

  const admin = await createAdminClient()
  const [{ data: listeRow }, { data: firmenRow }] = await Promise.all([
    admin.from('zeiterfassung_comments')
      .select('user_full_name, comment')
      .eq('user_full_name', `${LISTE_PREFIX}${id}`)
      .maybeSingle(),
    admin.from('zeiterfassung_comments')
      .select('comment').eq('user_full_name', FIRMEN_KEY).eq('schedule_date', BESTELL_ANCHOR).maybeSingle(),
  ])
  if (!listeRow) return NextResponse.json({ error: 'Liste nicht gefunden' }, { status: 404 })
  const liste = parseListeRow(
    (listeRow as { user_full_name: string }).user_full_name,
    (listeRow as { comment: string }).comment,
  )
  if (!liste) return NextResponse.json({ error: 'Liste nicht lesbar' }, { status: 500 })

  let firmen = [...FIRMEN_EMPFOHLEN]
  if (firmenRow) { try { firmen = JSON.parse((firmenRow as { comment: string }).comment) as string[] } catch { /* Vorbelegung */ } }

  const fmtCH = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const gruppen = liste.typ === 'whatsapp'
    ? [{ firma: 'WhatsApp-Bestellung über Andrea Willen', items: liste.items }]
    : itemsNachFirma(liste.items, firmen).map(g => ({ firma: g.firma || 'Ohne Firma', items: g.items }))

  let bytes: Uint8Array
  try {
    bytes = await generateBestelllistePdf({
      titel: liste.typ === 'whatsapp' ? 'WhatsApp Bestellung' : 'Bestellliste',
      datumLabel: fmtCH(liste.geschlossenAm ?? liste.erstellt),
      statusLabel: liste.status === 'geschlossen'
        ? `Abgeschlossen am ${fmtCH(liste.geschlossenAm ?? liste.erstellt)}${liste.geschlossenVon ? ` von ${liste.geschlossenVon}` : ''}`
        : `Offen · begonnen am ${fmtCH(liste.erstellt)}`,
      createdLabel: `Erstellt am ${new Date().toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })}`,
      gruppen,
      hinweis: liste.status === 'offen' ? 'Entwurf — die Bestellliste ist noch nicht abgeschlossen.' : null,
    })
  } catch (err) {
    console.error('[bestellliste-pdf]', err)
    return NextResponse.json({ error: 'PDF-Erstellung fehlgeschlagen' }, { status: 500 })
  }

  const fname = `Bestellliste_${liste.geschlossenAm ?? liste.erstellt}.pdf`
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${dl ? 'attachment' : 'inline'}; filename="${fname}"`,
    },
  })
}
