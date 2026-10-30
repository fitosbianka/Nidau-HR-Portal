'use client'

// Vollbildansicht für Fotos mit Wischen (Handy), Pfeiltasten und Knöpfen
// (Computer). Der Link zum Originalbild wird erst beim Anzeigen geholt und
// je Foto gemerkt. Wird von Fotoalbum, Bingo Felddialog und Jury genutzt.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

type Basis = { id: string; mime: string }

export default function FotoVollbild<T extends Basis>({ liste, index, onIndex, laden, titel, untertitel, aktionen, fuss, onClose }: {
  liste: T[]
  index: number
  onIndex: (i: number) => void
  /** Signierter Link zum Original oder null bei Fehler */
  laden: (f: T) => Promise<string | null>
  titel: (f: T) => string
  untertitel?: (f: T) => string
  aktionen?: (f: T) => ReactNode
  /** Zeile unter dem Bild, z.B. die Beschreibung */
  fuss?: (f: T) => ReactNode
  onClose: () => void
}) {
  const [urls, setUrls] = useState<Record<string, string | null>>({})
  const [fehler, setFehler] = useState<string | null>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const foto = liste[index]
  const hatVor = index > 0
  const hatNach = index < liste.length - 1

  const hole = useCallback(async (f: T | undefined) => {
    if (!f || urls[f.id] !== undefined) return
    const u = await laden(f)
    setUrls(prev => ({ ...prev, [f.id]: u }))
  }, [laden, urls])

  useEffect(() => {
    setFehler(null)
    void hole(foto)
    // Nachbarn vorladen, damit das Wischen flüssig ist
    void hole(liste[index + 1]); void hole(liste[index - 1])
  }, [foto, index, liste, hole])

  const vor = useCallback(() => { if (hatVor) onIndex(index - 1) }, [hatVor, index, onIndex])
  const nach = useCallback(() => { if (hatNach) onIndex(index + 1) }, [hatNach, index, onIndex])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') vor()
      else if (e.key === 'ArrowRight') nach()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, vor, nach])

  if (!foto) return null
  const url = urls[foto.id]
  const zeigbar = /^image\//.test(foto.mime) && !/hei[cf]/i.test(foto.mime)

  return (
    <div className="fixed inset-0 z-[80] bg-black/90 flex flex-col select-none" role="dialog" aria-modal="true"
      onTouchStart={e => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY } }}
      onTouchEnd={e => {
        const s = touch.current; touch.current = null
        if (!s) return
        const t = e.changedTouches[0]
        const dx = t.clientX - s.x, dy = t.clientY - s.y
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? nach() : vor())
        else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) onClose()
      }}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white/90">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{titel(foto)}</p>
          <p className="text-[11px] text-white/60 tnum truncate">{untertitel?.(foto)}{liste.length > 1 ? `${untertitel ? ' · ' : ''}${index + 1} von ${liste.length}` : ''}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {aktionen?.(foto)}
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 text-sm" aria-label="Schliessen">✕</button>
        </div>
      </div>
      <div className="flex-1 min-h-0 relative flex items-center justify-center p-3" onClick={onClose}>
        {url === undefined ? (
          <p className="text-white/70 text-sm">Lädt</p>
        ) : url === null ? (
          <p className="text-white/80 text-sm px-6 text-center">{fehler ?? 'Das Foto konnte nicht geladen werden, bitte nochmals versuchen.'}</p>
        ) : zeigbar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} draggable={false} />
        ) : (
          <p className="text-white/80 text-sm px-6 text-center">Dieses Format kann der Browser nicht direkt anzeigen (z. B. HEIC). Bitte herunterladen.</p>
        )}
        {hatVor && (
          <button onClick={e => { e.stopPropagation(); vor() }} className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 hover:bg-white/30 text-white items-center justify-center" aria-label="Vorheriges Foto">‹</button>
        )}
        {hatNach && (
          <button onClick={e => { e.stopPropagation(); nach() }} className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 hover:bg-white/30 text-white items-center justify-center" aria-label="Nächstes Foto">›</button>
        )}
      </div>
      {fuss?.(foto)}
      {liste.length > 1 && <p className="sm:hidden text-center text-[11px] text-white/50 pb-3">Wischen für das nächste Foto, nach unten wischen zum Schliessen</p>}
    </div>
  )
}
