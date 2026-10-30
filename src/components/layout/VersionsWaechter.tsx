'use client'

// Erkennt, wenn im Browser ein VERALTETER Seitenstand läuft (typisch: das
// Portal liegt als App im Dock/auf dem Homescreen und war offen, während
// ein Update deployt wurde). Ein alter Stand kann keine Server-Navigation
// mehr ausführen — Monatswechsel, Speichern usw. laufen dann still ins
// Leere. Der Wächter vergleicht die einkompilierte Build-Kennung mit
// /api/version:
//  · Beim Zurückkehren zur App nach längerer Pause (> 3 Minuten weg) wird
//    bei einer neuen Version direkt neu geladen — dort geht nie Arbeit
//    verloren.
//  · Mitten in der Arbeit erscheint stattdessen nur ein Hinweis-Balken
//    mit «Neu laden» — die Seite wird einem nie unter den Händen
//    weggerissen.

import { useEffect, useState } from 'react'

const MEIN_BUILD = process.env.NEXT_PUBLIC_PORTAL_BUILD ?? ''

export default function VersionsWaechter() {
  const [veraltet, setVeraltet] = useState(false)

  useEffect(() => {
    if (!MEIN_BUILD) return
    let beendet = false
    let zuletztVersteckt = 0

    // Schleifenschutz: automatisch neu laden höchstens einmal alle
    // 10 Minuten — sollte je eine Dauerabweichung auftreten, gibt es nur
    // den Hinweis-Balken, nie eine endlose Neulade-Schleife.
    function reloadErlaubt(): boolean {
      try {
        const zuletzt = Number(sessionStorage.getItem('portal-build-reload') ?? '0')
        if (Date.now() - zuletzt < 10 * 60_000) return false
        sessionStorage.setItem('portal-build-reload', String(Date.now()))
        return true
      } catch {
        return false
      }
    }

    async function pruefen(darfNeuLaden: boolean) {
      try {
        const r = await fetch('/api/version', { cache: 'no-store' })
        if (!r.ok) return
        const j = (await r.json()) as { build?: string }
        if (beendet || !j.build || j.build === MEIN_BUILD) return
        if (darfNeuLaden && reloadErlaubt()) window.location.reload()
        else setVeraltet(true)
      } catch { /* offline o.ä. — beim nächsten Mal wieder versuchen */ }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        zuletztVersteckt = Date.now()
        return
      }
      const langeWeg = zuletztVersteckt > 0 && Date.now() - zuletztVersteckt > 3 * 60_000
      pruefen(langeWeg)
    }
    document.addEventListener('visibilitychange', onVisibility)
    const intervall = setInterval(() => {
      if (document.visibilityState === 'visible') pruefen(false)
    }, 5 * 60_000)
    pruefen(false)

    return () => {
      beendet = true
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(intervall)
    }
  }, [])

  if (!veraltet) return null
  return (
    <div className="fixed top-0 inset-x-0 z-[100] px-3 pt-2 print:hidden pointer-events-none">
      <div className="mx-auto max-w-xl rounded-ctl bg-dusk-night text-white shadow-lg px-4 py-2.5 flex items-center gap-3 pointer-events-auto">
        <p className="text-xs flex-1 leading-snug">
          Das Portal wurde aktualisiert — bitte kurz neu laden, sonst reagieren einzelne Knöpfe nicht mehr.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="text-xs font-bold bg-white text-ink rounded-lg px-3 py-1.5 shrink-0 hover:bg-paper"
        >
          Neu laden
        </button>
      </div>
    </div>
  )
}
