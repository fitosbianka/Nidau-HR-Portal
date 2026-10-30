'use client'

import { useEffect } from 'react'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Admin error:', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mb-4">
        <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-ink mb-2">Ein Fehler ist aufgetreten</h2>
      <p className="text-sm text-ink-3 mb-6 max-w-sm">
        Die Seite konnte nicht geladen werden. Meist hilft «Seite neu laden» —
        besteht der Fehler weiter, bitte den Fehlercode unten weitergeben.
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        <button onClick={() => window.location.reload()} className="btn-primary">
          Seite neu laden
        </button>
        <button onClick={reset} className="btn-secondary">
          Erneut versuchen
        </button>
      </div>
      {error.digest && (
        <p className="mt-5 text-[11px] text-ink-4 tnum select-all">Fehlercode: {error.digest}</p>
      )}
    </div>
  )
}
