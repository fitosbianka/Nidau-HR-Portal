'use client'

import type { ZeitKorrektur } from '@/lib/korrekturen'

export function fmtKDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const [y, m, d] = iso.split('-')
  return `${parseInt(d, 10)}.${parseInt(m, 10)}.${y}`
}

export function StatusChip({ done }: { done: string | null }) {
  return done ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-mint-bg text-mint-ink whitespace-nowrap">
      ✓ Korrigiert {fmtKDate(done)}
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-apricot-bg text-apricot-ink whitespace-nowrap">
      Offen
    </span>
  )
}

/** Modal listing correction requests with all details. */
export function KorrekturModal({
  title, items, showName, onClose,
}: {
  title: string
  items: ZeitKorrektur[]
  showName?: boolean
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-edge-soft flex items-center justify-between flex-shrink-0">
          <h3 className="text-sm font-semibold text-ink-2">{title}</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-edge-row text-ink-4 hover:text-ink-2 flex items-center justify-center text-lg leading-none"
            aria-label="Schliessen"
          >×</button>
        </div>
        <div className="overflow-y-auto">
          <ul className="divide-y divide-edge-row">
            {items.map(k => (
              <li key={k.key} className="px-6 py-3.5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-sm font-semibold text-ink">
                    {showName && <>{k.name} · </>}
                    <span className="tnum">{fmtKDate(k.datum)}</span>
                  </p>
                  <StatusChip done={k.done} />
                </div>
                <p className="text-xs text-ink-3 mt-1">
                  Korrekte Zeit: <span className="font-semibold text-ink-2 tnum">{k.zeit}</span>
                  {k.text && <> · {k.text}</>}
                </p>
                <p className="text-[11px] text-ink-4 mt-0.5">gemeldet am {fmtKDate(k.am)}</p>
              </li>
            ))}
          </ul>
          {items.length === 0 && (
            <p className="px-6 py-8 text-center text-xs text-ink-4">Keine Meldungen vorhanden.</p>
          )}
        </div>
      </div>
    </div>
  )
}
