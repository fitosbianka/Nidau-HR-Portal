'use client'

// Login popup for the Ferienplanung, in two flavours:
//  · kind="eingabe" — the user's own phase is open and nothing is entered
//    yet: shown once per BROWSER SESSION until they enter something. Mit
//    «Nicht mehr anzeigen» stellt die Person ihn dauerhaft ab (serverseitig,
//    siehe ferien-hinweis.ts); auf der Zielseite selbst erscheint er nicht.
//  · kind="veroeffentlichung" — the planning was published: shown ONCE per
//    browser (localStorage), telling everyone the calendar with the already
//    accepted vacations is now visible and when the own entry window opens
//    (Starttag 06:00 bis Fristtag 23:55).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ferienHinweisAusblenden } from '@/actions/ferien-hinweis'

export default function FerienReminderPopup({
  planYear, href, kind = 'eingabe', zweiWochen = false, nieMehr = false,
}: {
  planYear: number
  href: string
  kind?: 'eingabe' | 'veroeffentlichung' | 'zweiwochen'
  /** Hinweis «noch keine zwei Wochen am Stück geplant» (Art. 329c OR) */
  zweiWochen?: boolean
  /** Knopf «Nicht mehr anzeigen» (Eingabe Hinweis): stellt den Hinweis dauerhaft ab */
  nieMehr?: boolean
}) {
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const pathname = usePathname()
  const key = kind === 'veroeffentlichung'
    ? `ferien-veroeffentlichung-${planYear}`
    : kind === 'zweiwochen' ? `ferien-zweiwochen-${planYear}` : `ferien-reminder-${planYear}`
  const ausKey = `ferien-reminder-aus-${planYear}`

  useEffect(() => {
    try {
      const store = kind === 'veroeffentlichung' ? localStorage : sessionStorage
      if (kind === 'eingabe' && localStorage.getItem(ausKey)) return
      // Auf der Ferienplanung selbst braucht es keinen Hinweis darauf: dort
      // erscheint das Erklärfenster; der Besuch zählt als gesehen
      if (pathname === href) { store.setItem(key, '1'); return }
      if (!store.getItem(key)) setVisible(true)
    } catch {
      setVisible(pathname !== href)
    }
  }, [key, kind, ausKey, pathname, href])

  function close() {
    try {
      const store = kind === 'veroeffentlichung' ? localStorage : sessionStorage
      store.setItem(key, '1')
    } catch { /* ignore */ }
    setVisible(false)
  }
  async function dauerhaftAus() {
    setBusy(true)
    try {
      try { await ferienHinweisAusblenden('login') } catch { /* der Browser merkt es sich trotzdem */ }
      try { localStorage.setItem(ausKey, '1'); sessionStorage.setItem(key, '1') } catch { /* ignore */ }
      setVisible(false)
    } finally { setBusy(false) }
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40" onClick={close} />
      <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="w-12 h-12 rounded-2xl bg-mint-bg flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-mint-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M19.07 4.93l-1.41 1.41" strokeLinecap="round" />
            </svg>
          </div>
          {kind === 'veroeffentlichung' ? (
            <>
              <h3 className="text-base font-bold text-ink">Ferienplanung {planYear} ist veröffentlicht</h3>
              <p className="text-sm text-ink-3 mt-2 leading-relaxed">
                Der Ferienkalender {planYear} ist jetzt für das ganze Team sichtbar — mit allen bereits
                eingetragenen und akzeptierten Ferien, damit du vorausplanen kannst. Die Wunsch-Eingabe
                öffnet für jede Gruppe am Starttag um 06:00 Uhr und schliesst am Fristtag um 23:55 Uhr:
                zuerst die Zahnärztinnen und Zahnärzte, danach DH / PA, zuletzt die DA.
              </p>
            </>
          ) : kind === 'zweiwochen' ? (
            <>
              <h3 className="text-base font-bold text-ink">Zwei Wochen am Stück</h3>
              <p className="text-sm text-ink-3 mt-2 leading-relaxed">
                Du hast für {planYear} noch keine zwei Ferienwochen am Stück geplant. Nach Gesetz müssen
                jedes Jahr mindestens zwei Ferienwochen zusammenhängen. Deine Eingabephase endet bald,
                bitte melde noch eine Doppelwoche an oder ergänze eine Woche neben einer bestehenden.
              </p>
            </>
          ) : (
            <>
              <h3 className="text-base font-bold text-ink">Ferienplanung {planYear}</h3>
              <p className="text-sm text-ink-3 mt-2 leading-relaxed">
                Es ist Zeit, die Ferien für {planYear} einzugeben. Wie gewohnt beginnen die Zahnärztinnen
                und Zahnärzte, danach folgen DH / PA und zuletzt die DA. Bitte melde deine Ferienwochen an.
                Auf der Ferienplanung erklärt dir ein kurzer Hinweis, wie die Wochen vergeben werden.
              </p>
              {zweiWochen && (
                <p className="text-sm text-ink-3 mt-2 leading-relaxed">
                  Du hast noch keine zwei Wochen am Stück geplant. Nach Gesetz müssen jedes Jahr mindestens
                  zwei Ferienwochen zusammenhängen.
                </p>
              )}
            </>
          )}
        </div>
        <div className="px-6 pb-6">
          <div className="flex gap-2">
            <button onClick={close} className="btn-secondary flex-1" title={kind === 'eingabe' ? 'Schliessen, beim nächsten Anmelden erscheint der Hinweis wieder' : undefined}>Schliessen</button>
            <Link href={href} onClick={close} className="btn-primary flex-1 text-center">
              {kind === 'veroeffentlichung' ? 'Kalender ansehen' : 'Zur Ferienplanung'}
            </Link>
          </div>
          {kind === 'eingabe' && nieMehr && (
            <button onClick={dauerhaftAus} disabled={busy} className="block mx-auto mt-3 text-[12px] text-ink-4 hover:text-ink underline underline-offset-2 disabled:opacity-50"
              title="Dieser Hinweis erscheint für dich nie mehr, auf keinem Gerät">
              {busy ? 'Speichert…' : 'Nicht mehr anzeigen'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
