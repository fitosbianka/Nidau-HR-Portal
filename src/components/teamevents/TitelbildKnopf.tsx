'use client'

// Kleiner Knopf für die Organisatorin: Titelbild einer Kachel setzen oder
// entfernen. Das Bild wird im Browser auf 1600 px verkleinert.

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { titelbildHochladen, titelbildEntfernen } from '@/actions/teamevents'
import type { TeTitelbildZiel } from '@/lib/teamevents'

async function verkleinern(file: File): Promise<File | null> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d'); if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, w, h); bmp.close()
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.86))
    return blob ? new File([blob], 'titelbild.jpg', { type: 'image/jpeg' }) : null
  } catch { return null }
}

export default function TitelbildKnopf({ slug, ziel, vorhanden, className = '' }: { slug: string; ziel: TeTitelbildZiel; vorhanden: boolean; className?: string }) {
  const router = useRouter()
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function hochladen(file: File) {
    setBusy(true); setErr(null)
    try {
      const form = new FormData()
      form.set('datei', (await verkleinern(file)) ?? file)
      const r = await titelbildHochladen(slug, ziel, form)
      if ('error' in r && r.error) { setErr(r.error); return }
      router.refresh()
    } finally { setBusy(false) }
  }
  async function entfernen() {
    if (!confirm('Titelbild entfernen? Danach erscheint wieder die Illustration.')) return
    setBusy(true); setErr(null)
    try {
      const r = await titelbildEntfernen(slug, ziel)
      if ('error' in r && r.error) { setErr(r.error); return }
      router.refresh()
    } finally { setBusy(false) }
  }

  return (
    <span className={`inline-flex items-center gap-2 text-[11px] ${className}`}>
      <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="text-mint-ink hover:underline font-semibold">
        {busy ? 'Lädt…' : vorhanden ? 'Titelbild ändern' : 'Titelbild setzen'}
      </button>
      {vorhanden && !busy && <button type="button" onClick={entfernen} className="text-ink-4 hover:text-red-500">Entfernen</button>}
      {err && <span className="text-blush-ink">⚠ {err}</span>}
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) hochladen(f); e.target.value = '' }} />
    </span>
  )
}
