import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { TE_BUCKET, hatTeameventZugang, istOrganisatorin } from '@/lib/teamevents'
import { AUSWEIS_ANCHOR, ausweisKey } from '@/lib/ausweise'
import { parseAusweisGeheim, bildPfad, entschluesselBytes, istVerschluesselt } from '@/lib/teamevent-geheim'

// Ausweisbild ausliefern: GET ?p=<profileId>&id=<bildId>(&dl=1). Prüft die
// angemeldete Person (Eigentümerin oder Organisatorin), lädt das
// verschlüsselte Objekt mit dem Service Role Client, entschlüsselt es und
// liefert es ohne Zwischenspeicherung aus. Es gibt keine signierten Links.

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Nicht angemeldet', { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (!hatTeameventZugang(p?.role, p?.full_name)) return new NextResponse('Keine Berechtigung', { status: 403 })

  const profileId = req.nextUrl.searchParams.get('p') ?? ''
  const bildId = req.nextUrl.searchParams.get('id') ?? ''
  const download = req.nextUrl.searchParams.get('dl') === '1'
  if (!/^[0-9a-f-]{8,64}$/i.test(profileId) || !/^[a-z0-9]{8,20}$/.test(bildId)) return new NextResponse('Ungültig', { status: 400 })
  if (!(istOrganisatorin(p?.full_name) || user.id === profileId)) return new NextResponse('Keine Berechtigung', { status: 403 })

  const admin = await createAdminClient()
  const { data: row } = await admin.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', ausweisKey(profileId)).eq('schedule_date', AUSWEIS_ANCHOR).maybeSingle()
  const a = parseAusweisGeheim(profileId, (row as { comment: string } | null)?.comment)
  const b = a.bilder.find(x => x.id === bildId)
  if (!b) return new NextResponse('Nicht gefunden', { status: 404 })

  const { data: blob, error } = await admin.storage.from(TE_BUCKET).download(bildPfad(profileId, b))
  if (error || !blob) return new NextResponse('Nicht gefunden', { status: 404 })
  let bytes: Uint8Array = new Uint8Array(await blob.arrayBuffer())
  if (b.enc || istVerschluesselt(bytes)) {
    try { bytes = new Uint8Array(entschluesselBytes(bytes)) } catch { return new NextResponse('Bild kann nicht entschlüsselt werden', { status: 500 }) }
  }
  const mime = /^image\/[a-z0-9.+-]+$/i.test(b.mime) ? b.mime : 'application/octet-stream'
  const dateiname = b.name.replace(/[^A-Za-z0-9._-]+/g, '_') || 'ausweis'
  const body = new Uint8Array(bytes).buffer as ArrayBuffer
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${dateiname}"`,
    },
  })
}
