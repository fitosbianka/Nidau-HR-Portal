'use client'

// Login-Fenster für die Bestell-Verantwortliche: alle heute fälligen
// Erinnerungen aus «Im Auge behalten». Es erscheint
//  · einmal pro Browser-Sitzung nach dem Anmelden (egal auf welcher Seite),
//  · und jedes Mal, wenn die Bestellseite geöffnet wird — ausser sie kommt
//    gerade über den Knopf dieses Fensters dorthin.
// Nur im Mitarbeiter-Layout und nur für BESTELLER_NAME eingebunden: Admins
// und die übrigen Berechtigten bekommen dieses Fenster nie.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { bestellHeute, datumCH } from '@/lib/bestellungen'
import type { FaelligeErinnerung } from '@/lib/bestellungen-data'

const LOGIN_KEY = 'bestell-erinnerung-login'
const SPRUNG_KEY = 'bestell-erinnerung-sprung'

export default function BestellErinnerungPopup({ faellig, href }: { faellig: FaelligeErinnerung[]; href: string }) {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  // nur auf einen Seitenwechsel reagieren — nicht auf jedes Nachladen der
  // Daten, sonst springt das Fenster beim Abhaken auf der Seite wieder auf
  const zuletzt = useRef<string | null>(null)

  useEffect(() => {
    if (zuletzt.current === pathname) return
    zuletzt.current = pathname
    if (faellig.length === 0) return
    try {
      const sprung = sessionStorage.getItem(SPRUNG_KEY)
      if (sprung) sessionStorage.removeItem(SPRUNG_KEY)
      if (pathname === href) {
        sessionStorage.setItem(LOGIN_KEY, '1')
        if (!sprung) setVisible(true)
        return
      }
      if (!sessionStorage.getItem(LOGIN_KEY)) setVisible(true)
    } catch {
      setVisible(true)
    }
  }, [pathname, href, faellig.length])

  useEffect(() => {
    if (faellig.length === 0) setVisible(false)
  }, [faellig.length])

  function close() {
    try { sessionStorage.setItem(LOGIN_KEY, '1') } catch { /* ignore */ }
    setVisible(false)
  }
  function springen() {
    try {
      sessionStorage.setItem(LOGIN_KEY, '1')
      sessionStorage.setItem(SPRUNG_KEY, '1')
    } catch { /* ignore */ }
    setVisible(false)
  }

  if (!visible || faellig.length === 0) return null
  const heute = bestellHeute()
  const n = faellig.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40" onClick={close} />
      <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-6 pt-6 pb-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-red-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9" />
            </svg>
          </div>
          <h3 className="text-base font-bold text-ink">Zeit zum Bestellen</h3>
          <p className="text-sm text-ink-3 mt-2 leading-relaxed">
            {n === 1 ? 'Ein Produkt' : `${n} Produkte`} aus «Im Auge behalten» {n === 1 ? 'ist' : 'sind'} zur Kontrolle fällig.
            Auf der Bestellseite {n === 1 ? 'steht es' : 'stehen sie'} rot markiert — dort kannst du
            {n === 1 ? ' es' : ' jedes'} auf die Bestellliste setzen oder überspringen.
          </p>
        </div>
        <ul className="mx-6 mb-4 border border-edge rounded-ctl divide-y divide-edge-row max-h-[40vh] overflow-auto">
          {faellig.map(f => (
            <li key={f.id} className="px-3.5 py-2.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-ink truncate">{f.name}</p>
                <p className="text-[11px] text-ink-4">
                  {f.firma}{f.artikelNr ? ` · Art.-Nr. ${f.artikelNr}` : ''}{f.menge ? ` · ${f.menge}` : ''}
                </p>
              </div>
              <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 whitespace-nowrap tnum">
                {f.naechste < heute ? `seit ${datumCH(f.naechste)}` : 'heute'}
              </span>
            </li>
          ))}
        </ul>
        <div className="px-6 pb-6 flex gap-2">
          <button onClick={close} className="btn-secondary flex-1">Später</button>
          <Link href={href} onClick={springen} className="btn-primary flex-1 text-center">Zur Bestellseite</Link>
        </div>
      </div>
    </div>
  )
}
