// Upload eines Bingofotos vom Handy: verkleinern und komprimieren (etwa
// 2000 Pixel lange Seite, gute JPEG Qualität), Vorschaubild erzeugen, über
// signierte Links direkt in den Speicher laden und registrieren. Jeder
// Schritt meldet einen klaren Fehler, damit die Oberfläche «Nochmals
// versuchen» anbieten kann.

import { createClient } from '@/lib/supabase/client'
import { bingoUploadVorbereiten, bingoFotoRegistrieren } from '@/actions/teamevent-bingo'
import { TE_BUCKET } from '@/lib/teamevents'

/** Bild im Browser verkleinern (JPEG); null, wenn der Browser das Format
 *  nicht dekodieren kann (z. B. HEIC in Chrome). */
export async function verkleinern(file: Blob, maxPx: number, qualitaet: number): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
    const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    return await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', qualitaet))
  } catch {
    return null
  }
}

export type UploadErgebnis = { ok: true } | { ok: false; fehler: string }

export async function bingoHochladen(slug: string, aufgabeId: string, file: File, teamId?: string, onFortschritt?: (schritt: string) => void): Promise<UploadErgebnis> {
  try {
    onFortschritt?.('Foto wird vorbereitet')
    const klein = await verkleinern(file, 2000, 0.85)
    const orig: Blob = klein ?? file
    const mime = klein ? 'image/jpeg' : (file.type || 'image/jpeg')
    const thumb = klein ? await verkleinern(klein, 480, 0.8) : null
    const prep = await bingoUploadVorbereiten(slug, aufgabeId, orig.size, teamId)
    if ('error' in prep && prep.error) return { ok: false, fehler: prep.error }
    const p = prep as { id: string; datum: string; team: string; orig: { path: string; token: string }; thumb: { path: string; token: string } | null }
    const supabase = createClient()
    onFortschritt?.('Foto wird hochgeladen')
    const { error: e1 } = await supabase.storage.from(TE_BUCKET).uploadToSignedUrl(p.orig.path, p.orig.token, orig, { contentType: mime, upsert: true })
    if (e1) return { ok: false, fehler: `Upload fehlgeschlagen, bitte nochmals versuchen (${e1.message}).` }
    let thumbOk = false
    if (thumb && p.thumb) {
      const { error: e2 } = await supabase.storage.from(TE_BUCKET).uploadToSignedUrl(p.thumb.path, p.thumb.token, thumb, { contentType: 'image/jpeg', upsert: true })
      thumbOk = !e2
    }
    onFortschritt?.('Foto wird gespeichert')
    const r = await bingoFotoRegistrieren({ slug, id: p.id, aufgabeId, teamId: p.team, datum: p.datum, mime, bytes: orig.size, thumb: thumbOk })
    if ('error' in r && r.error) return { ok: false, fehler: r.error }
    return { ok: true }
  } catch (err) {
    const m = err instanceof Error ? err.message : ''
    return { ok: false, fehler: /fetch|network|load failed/i.test(m) ? 'Keine Verbindung, bitte nochmals versuchen.' : `Upload fehlgeschlagen, bitte nochmals versuchen${m ? ` (${m})` : ''}.` }
  }
}
