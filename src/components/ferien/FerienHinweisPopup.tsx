'use client'

// Erklärfenster auf der Ferienplanung Seite für die Assistenz (DA, Leitende
// DA, Lernende), solange ihre Eingabephase offen ist: wie die Plätze
// zustande kommen, warum zuerst die offenen Wochen genommen werden sollen
// und was ein Ferienwunsch bedeutet. «Schliessen» blendet das Fenster für
// diese Browser Sitzung aus, «Nicht mehr anzeigen» dauerhaft für die Person
// (serverseitig gespeichert, gilt auf jedem Gerät).

import { useEffect, useState } from 'react'
import { ferienHinweisAusblenden } from '@/actions/ferien-hinweis'

const PUNKTE: Array<{ titel: string; text: string }> = [
  {
    titel: 'So entstehen die freien Plätze',
    text: 'Wie viele aus der Assistenz in einer Woche Ferien machen können, richtet sich nach den Ferien unserer Behandlerinnen und Behandler. Sind sie weg, braucht es weniger Assistenz in der Praxis, sind alle da, braucht es mehr. Darum sind die Plätze von Woche zu Woche verschieden.',
  },
  {
    titel: 'Am besten zuerst eine offene Woche wählen',
    text: 'In der Wochenliste unten siehst du, in welchen Wochen für dich noch Platz ist. Wenn du deine Ferien zuerst aus diesen Wochen aussuchst, hilfst du mit, dass immer genug und nie zu viele von uns in der Praxis sind.',
  },
  {
    titel: 'Ferienwunsch nur, wenn die Woche wirklich wichtig ist',
    text: 'Einen Ferienwunsch bitte nur für eine Woche eingeben, die dir wirklich wichtig ist.',
  },
  {
    titel: 'Ein Wunsch ist keine Zusage',
    text: 'Wir geben uns Mühe, die Ferienwünsche zu berücksichtigen, können es aber nicht garantieren. Eine angemeldete offene Woche ist der sichere Weg.',
  },
]

export default function FerienHinweisPopup({ planYear }: { planYear: number }) {
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const key = `ferien-hinweis-seite-${planYear}`

  useEffect(() => {
    try {
      if (!sessionStorage.getItem(key) && !localStorage.getItem(key)) setVisible(true)
    } catch { setVisible(true) }
  }, [key])

  function schliessen() {
    try { sessionStorage.setItem(key, '1') } catch { /* ignore */ }
    setVisible(false)
  }
  async function nieMehr() {
    setBusy(true)
    try {
      try { await ferienHinweisAusblenden('seite') } catch { /* der Browser merkt es sich trotzdem */ }
      try { localStorage.setItem(key, '1'); sessionStorage.setItem(key, '1') } catch { /* ignore */ }
      setVisible(false)
    } finally { setBusy(false) }
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="ferien-hinweis-titel">
      <div className="absolute inset-0 bg-ink/40" onClick={schliessen} />
      <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-lg overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-edge-soft">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-mint-bg flex items-center justify-center flex-shrink-0">
              <svg className="w-[22px] h-[22px] text-mint-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M19.07 4.93l-1.41 1.41" strokeLinecap="round" />
              </svg>
            </div>
            <div className="min-w-0">
              <h3 id="ferien-hinweis-titel" className="text-base font-bold text-ink">So funktioniert die Ferienplanung {planYear}</h3>
              <p className="text-[12.5px] text-ink-3 mt-1">Damit es für alle gut aufgeht, hier das Wichtigste in Kürze.</p>
            </div>
          </div>
        </div>
        <ol className="px-6 py-4 space-y-3.5">
          {PUNKTE.map((p, i) => (
            <li key={p.titel} className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-mint-bg text-mint-ink text-[11.5px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5 tnum">{i + 1}</span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink leading-snug">{p.titel}</p>
                <p className="text-[12.5px] text-ink-3 leading-relaxed mt-0.5">{p.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="px-6 pb-5 pt-1">
          <div className="flex gap-2">
            <button onClick={nieMehr} disabled={busy} className="btn-secondary flex-1" title="Dieser Hinweis erscheint für dich nie mehr, auf keinem Gerät">
              {busy ? 'Speichert…' : 'Nicht mehr anzeigen'}
            </button>
            <button onClick={schliessen} className="btn-primary flex-1" title="Schliessen, beim nächsten Besuch erscheint der Hinweis wieder">Schliessen</button>
          </div>
          <p className="text-[11px] text-ink-4 mt-2.5 text-center">Mit «Schliessen» erscheint der Hinweis beim nächsten Besuch wieder, mit «Nicht mehr anzeigen» nie mehr.</p>
        </div>
      </div>
    </div>
  )
}
