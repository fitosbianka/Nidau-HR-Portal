'use client'

// Erinnerungen der Admin-Startseite. Jede Zeile hat ein X: «Nur diesmal
// schliessen» versteckt sie für die laufende Browser-Sitzung (sessionStorage),
// «Nie mehr anzeigen» dauerhaft für alle Admins (Server, wieder einschaltbar
// unter «Ausgeblendete Erinnerungen» am Ende der Liste).

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { erinnerungAusblenden, erinnerungWiederAnzeigen } from '@/actions/erinnerungen'
import type { ErinnerungAus } from '@/lib/erinnerungen'

export type Reminder = {
  kind: 'plan-release' | 'plan-publish' | 'birthday-today' | 'birthday-soon' | 'lohn-faellig' | 'pfaendung-meldung'
  /** Eindeutig je Anlass, z.B. «pfaendung:<profileId>:2026-10» — für «nur diesmal schliessen» */
  id: string
  /** Dauerhaft ausblenden («nie mehr anzeigen»): Schlüssel und lesbare Beschriftung */
  dauerhaft: { key: string; label: string }
  text: string
  href?: string
}

const STYLES: Record<Reminder['kind'], { box: string; icon: string }> = {
  'plan-release':   { box: 'bg-apricot-bg border-apricot-ink/25 text-apricot-ink', icon: '📋' },
  'plan-publish':   { box: 'bg-blush-bg border-blush-ink/25 text-blush-ink',       icon: '📣' },
  'birthday-today': { box: 'bg-mint-bg border-mint-ink/25 text-mint-ink',          icon: '🎂' },
  'birthday-soon':  { box: 'bg-lilac-bg border-lilac-ink/25 text-lilac-ink',       icon: '🎈' },
  'lohn-faellig':   { box: 'bg-blush-bg border-blush-ink/25 text-blush-ink',       icon: '💰' },
  'pfaendung-meldung': { box: 'bg-steel-bg border-steel-ink/25 text-steel-ink',    icon: '📮' },
}

const SITZUNG_PREFIX = 'erinnerung-zu:'

export type UpcomingBirthday = { name: string; day: number; month: number; days: number }

/** Compact list of the next upcoming birthdays (admin dashboard only). */
export function UpcomingBirthdays({ items }: { items: UpcomingBirthday[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4 mb-2.5">Nächste Geburtstage</p>
      <div className="card divide-y divide-edge-row overflow-hidden">
        {items.map(b => (
          <div key={`${b.name}-${b.month}-${b.day}`} className="flex items-center gap-3 px-4 py-2.5">
            <span className="text-sm leading-none">🎂</span>
            <span className="text-[13px] font-semibold text-ink flex-1 min-w-0 truncate">{b.name}</span>
            <span className="text-[12.5px] text-ink-3 tnum">{b.day}.{b.month}.</span>
            <span className={`text-[11px] w-[86px] text-right ${b.days === 0 ? 'font-bold text-mint-ink' : 'text-ink-4'}`}>
              {b.days === 0 ? 'heute 🎉' : b.days === 1 ? 'morgen' : `in ${b.days} Tagen`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const fmtZeit = (iso: string) => iso
  ? `${new Date(iso).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })}, ${new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' })}`
  : ''

export default function DashboardReminders({ reminders, ausgeblendet = [] }: { reminders: Reminder[]; ausgeblendet?: ErinnerungAus[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // erst nach dem Mounten rendern, damit eine in dieser Sitzung geschlossene
  // Erinnerung nicht kurz aufblitzt
  const [bereit, setBereit] = useState(false)
  const [zu, setZu] = useState<Set<string>>(new Set())
  const [frage, setFrage] = useState<Reminder | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [listeOffen, setListeOffen] = useState(false)

  useEffect(() => {
    const s = new Set<string>()
    try {
      for (const r of reminders) if (sessionStorage.getItem(SITZUNG_PREFIX + r.id)) s.add(r.id)
    } catch { /* ohne Speicher einfach alles zeigen */ }
    setZu(s)
    setBereit(true)
  }, [reminders])

  function nurDiesmal(r: Reminder) {
    try { sessionStorage.setItem(SITZUNG_PREFIX + r.id, '1') } catch { /* ignore */ }
    setZu(prev => new Set(prev).add(r.id))
    setFrage(null)
  }

  function nieMehr(r: Reminder) {
    setFehler(null)
    startTransition(async () => {
      let res: { error?: string } | undefined
      try { res = await erinnerungAusblenden(r.dauerhaft.key, r.dauerhaft.label) as { error?: string } } catch { res = { error: 'Netzwerkfehler — bitte erneut versuchen.' } }
      if (res?.error) { setFehler(res.error); return }
      setZu(prev => new Set(prev).add(r.id))
      setFrage(null)
      router.refresh()
    })
  }

  function wiederAnzeigen(key: string) {
    setFehler(null)
    startTransition(async () => {
      let res: { error?: string } | undefined
      try { res = await erinnerungWiederAnzeigen(key) as { error?: string } } catch { res = { error: 'Netzwerkfehler — bitte erneut versuchen.' } }
      if (res?.error) { setFehler(res.error); return }
      router.refresh()
    })
  }

  if (!bereit) return null
  const sichtbar = reminders.filter(r => !zu.has(r.id))
  if (sichtbar.length === 0 && ausgeblendet.length === 0) return null

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4 mb-2.5">Erinnerungen</p>
      {sichtbar.length > 0 && (
        <div className="flex flex-col gap-2">
          {sichtbar.map(r => {
            const s = STYLES[r.kind]
            const inner = (
              <div className={`flex items-center gap-3 px-4 py-3 rounded-ctl border text-[13px] font-semibold h-full ${s.box} ${r.href ? 'hover:opacity-90 transition-opacity' : ''}`}>
                <span className="text-base leading-none">{s.icon}</span>
                <span className="flex-1">{r.text}</span>
                {r.href && (
                  <svg className="w-4 h-4 flex-shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </div>
            )
            return (
              <div key={r.id} className="flex items-stretch gap-1.5">
                {r.href ? <Link href={r.href} className="flex-1 min-w-0">{inner}</Link> : <div className="flex-1 min-w-0">{inner}</div>}
                <button onClick={() => { setFehler(null); setFrage(r) }}
                  className="flex-shrink-0 w-9 rounded-ctl border border-edge-ctl bg-white text-ink-4 hover:text-ink hover:bg-edge-row flex items-center justify-center"
                  title="Erinnerung schliessen" aria-label="Erinnerung schliessen">✕</button>
              </div>
            )
          })}
        </div>
      )}
      {ausgeblendet.length > 0 && (
        <div className={sichtbar.length > 0 ? 'mt-2' : ''}>
          <button onClick={() => setListeOffen(o => !o)} className="text-[11px] text-ink-4 hover:text-ink-2 px-1">
            {ausgeblendet.length === 1 ? '1 Erinnerung dauerhaft ausgeblendet' : `${ausgeblendet.length} Erinnerungen dauerhaft ausgeblendet`} · {listeOffen ? 'verbergen' : 'anzeigen'}
          </button>
          {listeOffen && (
            <div className="card divide-y divide-edge-row overflow-hidden mt-1.5">
              {ausgeblendet.map(a => (
                <div key={a.key} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] text-ink truncate">{a.label}</p>
                    {(a.am || a.von) && <p className="text-[10.5px] text-ink-4 tnum">ausgeblendet {fmtZeit(a.am)}{a.von ? ` · ${a.von}` : ''}</p>}
                  </div>
                  <button disabled={isPending} onClick={() => wiederAnzeigen(a.key)}
                    className="text-[11px] font-semibold px-2 py-1 rounded-md bg-edge-row text-ink-2 hover:text-ink disabled:opacity-40">Wieder anzeigen</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {fehler && !frage && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink inline-block mt-2">⚠ {fehler}</p>}

      {frage && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">Erinnerung schliessen</h3>
                <p className="text-xs text-ink-4 mt-0.5">Nur jetzt schliessen oder nie mehr anzeigen?</p>
              </div>
              <button onClick={() => setFrage(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4">✕</button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <p className="text-[12.5px] text-ink-2 px-3 py-2 rounded-ctl bg-edge-row">{frage.text}</p>
              <p className="text-[12px] text-ink-3 leading-relaxed">
                <span className="font-semibold text-ink-2">Nur diesmal schliessen</span> blendet sie bis zur nächsten Anmeldung aus.{' '}
                <span className="font-semibold text-ink-2">Nie mehr anzeigen</span> gilt dauerhaft und für alle Admins
                ({frage.dauerhaft.label}); unter «Ausgeblendete Erinnerungen» lässt sie sich wieder einschalten.
              </p>
              {fehler && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {fehler}</p>}
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex flex-wrap gap-2">
              <button onClick={() => setFrage(null)} className="btn-ghost">Abbrechen</button>
              <span className="flex-1" />
              <button disabled={isPending} onClick={() => nieMehr(frage)} className="btn-secondary !text-red-600">
                {isPending ? 'Wird gespeichert…' : 'Nie mehr anzeigen'}
              </button>
              <button disabled={isPending} onClick={() => nurDiesmal(frage)} className="btn-primary">Nur diesmal schliessen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
