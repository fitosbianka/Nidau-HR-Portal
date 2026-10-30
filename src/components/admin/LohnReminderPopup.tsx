'use client'

// Popup auf der Admin-Startseite ab dem 23. des Monats, solange noch
// Lohnabrechnungen des laufenden Monats fehlen (Auszahlung am 25.).
// Einmal pro Browser-Sitzung — beim nächsten Anmelden erscheint es
// wieder, bis alle Abrechnungen gespeichert sind.

import { useEffect, useState } from 'react'
import Link from 'next/link'

export default function LohnReminderPopup({
  monat, monatLabel, fehlende,
}: {
  monat: string          // YYYY-MM (Storage-Schlüssel)
  monatLabel: string     // z.B. «September 2026»
  fehlende: string[]
}) {
  const [visible, setVisible] = useState(false)
  const key = `lohn-reminder-${monat}`

  useEffect(() => {
    try {
      if (!sessionStorage.getItem(key)) setVisible(true)
    } catch {
      setVisible(true)
    }
  }, [key])

  function close() {
    try { sessionStorage.setItem(key, '1') } catch { /* ignore */ }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40" onClick={close} />
      <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="w-12 h-12 rounded-2xl bg-blush-bg flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-blush-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h3 className="text-base font-bold text-ink">Lohnabrechnungen {monatLabel}</h3>
          <p className="text-sm text-ink-3 mt-2 leading-relaxed">
            Die Löhne müssen am <span className="font-semibold text-ink-2">25.</span> ausbezahlt werden.
            Es {fehlende.length === 1 ? 'fehlt noch diese Abrechnung' : `fehlen noch ${fehlende.length} Abrechnungen`}:
          </p>
          <p className="text-sm font-semibold text-ink-2 mt-2 leading-relaxed">
            {fehlende.join(', ')}
          </p>
        </div>
        <div className="px-6 pb-6 flex gap-2">
          <button onClick={close} className="btn-secondary flex-1">Später</button>
          <Link href="/admin/lohn" onClick={close} className="btn-primary flex-1 text-center">Zur Lohnabrechnung</Link>
        </div>
      </div>
    </div>
  )
}
