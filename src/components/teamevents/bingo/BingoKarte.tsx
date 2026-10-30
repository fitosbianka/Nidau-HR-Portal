'use client'

// Die Bingokarte als 5 mal 5 Raster. Gross für die eigene Karte (Titel,
// Vorschau, Haken, antippbar), klein für die anderen Teams (nur Haken oder
// die Kartenrückseite mit dem Praxislogo).

import { BINGO_FREI_ID, type BingoAufgabe } from '@/lib/teamevent-bingo'

const Haken = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
)
const Stern = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6.2 6.7.8-5 4.6 1.3 6.7L12 17.5l-5.9 3.3 1.3-6.7-5-4.6 6.7-.8z" /></svg>
)

export function BingoKarte({ layout, aufgaben, hatFoto, vorschau, onFeld, gesperrt = false }: {
  layout: string[]
  aufgaben: Array<BingoAufgabe & { angepasst?: boolean }>
  hatFoto: (id: string) => boolean
  vorschau?: (id: string) => string | null
  onFeld?: (id: string) => void
  gesperrt?: boolean
}) {
  const byId = new Map(aufgaben.map(a => [a.id, a]))
  return (
    <div className="grid grid-cols-5 gap-1.5 sm:gap-2" role="grid" aria-label="Bingokarte">
      {layout.map((id, i) => {
        const a = byId.get(id)
        const frei = id === BINGO_FREI_ID
        const foto = hatFoto(id)
        const bild = vorschau?.(id) ?? null
        return (
          <button key={`${id}-${i}`} type="button" onClick={onFeld ? () => onFeld(id) : undefined} disabled={!onFeld}
            className={`relative aspect-square rounded-xl border text-left overflow-hidden transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-dusk/50 ${
              onFeld ? 'active:scale-[.98] hover:shadow-md' : ''
            } ${frei ? 'bg-mint-bg border-mint-mid/40' : foto ? 'bg-white border-mint-mid' : 'bg-surface border-edge-ctl'} ${gesperrt && !foto ? 'opacity-70' : ''}`}
            aria-label={`${a?.titel ?? id}${foto ? ', Foto vorhanden' : ''}`}>
            {bild && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bild} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
            )}
            {bild && <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent" />}
            {frei && !bild && <Stern className="absolute top-1 right-1 w-3.5 h-3.5 sm:w-4 sm:h-4 text-mint-mid" />}
            {foto && (
              <span className="absolute top-1 right-1 w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-mint-ink text-white flex items-center justify-center shadow">
                <Haken className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
              </span>
            )}
            <span className={`absolute inset-x-0 bottom-0 px-1 pb-1 sm:px-1.5 sm:pb-1.5 text-[8.5px] sm:text-[11px] leading-[1.1] font-semibold break-words ${bild ? 'text-white' : frei ? 'text-mint-ink' : foto ? 'text-ink' : 'text-ink-2'}`}>
              {a?.titel ?? id}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Kleine Karte eines anderen Teams: Haken oder Rückseite mit Logo. */
export function MiniKarte({ layout, haken, offen, vorschau }: {
  layout: string[]
  haken: Set<string>
  /** Nach dem Spiel: Felder sind antippbar */
  offen?: (id: string) => void
  vorschau?: (id: string) => string | null
}) {
  return (
    <div className="grid grid-cols-5 gap-[3px]">
      {layout.map((id, i) => {
        const frei = id === BINGO_FREI_ID
        const ok = haken.has(id)
        const bild = vorschau?.(id) ?? null
        const inhalt = bild ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bild} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        ) : ok ? (
          <span className="absolute inset-0 flex items-center justify-center bg-mint-bg text-mint-ink"><Haken className="w-3 h-3" /></span>
        ) : frei ? (
          <span className="absolute inset-0 flex items-center justify-center bg-mint-bg/60 text-mint-mid"><Stern className="w-2.5 h-2.5" /></span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/logo.png" alt="" className="absolute inset-0 w-full h-full object-contain p-[18%] opacity-50" />
        )
        const cls = `relative aspect-square rounded-[5px] overflow-hidden border ${ok || bild ? 'border-mint-mid/50' : 'border-edge-row bg-[#F3F1EE]'}`
        return offen ? (
          <button key={`${id}-${i}`} type="button" onClick={() => offen(id)} className={`${cls} hover:shadow`} aria-label={id}>{inhalt}</button>
        ) : (
          <div key={`${id}-${i}`} className={cls}>{inhalt}</div>
        )
      })}
    </div>
  )
}
