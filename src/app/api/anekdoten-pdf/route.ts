import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getAnekdoten } from '@/lib/anekdoten'
import { generateAnekdotenPdf } from '@/lib/pdf/hr-pdfs.mjs'

// Alle Anekdoten fürs Teamevent als PDF (nur Admin). Der Header
// X-Anekdoten-Keys nennt die exportierten Einträge, damit die Seite nach
// dem Download genau diese entfernen kann.

export const dynamic = 'force-dynamic'

const fmtCH = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${parseInt(iso.slice(8, 10), 10)}.${parseInt(iso.slice(5, 7), 10)}.${iso.slice(0, 4)}` : iso)

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if ((prof as { role: string } | null)?.role !== 'admin') return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })

  const admin = await createAdminClient()
  const liste = await getAnekdoten(admin)
  if (liste.length === 0) return NextResponse.json({ error: 'Keine Anekdoten vorhanden' }, { status: 404 })

  const proPerson = new Map<string, typeof liste>()
  for (const a of liste) proPerson.set(a.ueber, [...(proPerson.get(a.ueber) ?? []), a])
  const gruppen = Array.from(proPerson.entries())
    .sort((a, b) => a[0].localeCompare(b[0], 'de-CH'))
    .map(([ueber, items]) => ({ ueber, items: [...items].sort((x, y) => x.am.localeCompare(y.am)).map(a => ({ text: a.text, von: a.von, am: fmtCH(a.am), sicht: a.sicht })) }))

  let bytes: Uint8Array
  try {
    bytes = await generateAnekdotenPdf({
      createdLabel: `Erstellt am ${new Date().toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })}`,
      anzahl: liste.length,
      gruppen,
    })
  } catch (err) {
    console.error('[anekdoten-pdf]', err)
    return NextResponse.json({ error: 'PDF-Erstellung fehlgeschlagen' }, { status: 500 })
  }
  const heute = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Anekdoten_Teamevent_${heute}.pdf"`,
      'X-Anekdoten-Keys': liste.map(a => a.key).join(','),
      'Cache-Control': 'no-store',
    },
  })
}
