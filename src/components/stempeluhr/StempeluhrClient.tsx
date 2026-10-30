'use client'

// Grosse Stempel-Karte (zentriert): Live-Uhr, Status, vier XL-Knöpfe wie
// bei TimeMoto und die heutigen Stempel mit Tages-Zeitleiste. Die Detail-
// ansicht darunter liefert der BerichteClient (gleiche Ansicht wie die
// Zeiterfassungs-Seite) — hier passiert NUR das Stempeln.

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { stempeln } from '@/actions/stempeluhr'
import {
  fmtStempelZeit, fmtStunden, sessionsFor, statusFor, tagesStatistik, zurichDateOf,
  type Stempel, type StempelAktion,
} from '@/lib/stempeluhr'

const TAG_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const isoHeute = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })

/** Minuten seit Mitternacht (Zürich) — für die Tages-Zeitleiste. */
function minutenAmTag(iso: string): number {
  const [h, m] = fmtStempelZeit(iso).split(':').map(n => parseInt(n, 10))
  return h * 60 + m
}

export default function StempeluhrClient({ stempel }: { stempel: Stempel[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  // Live-Uhr: erst nach dem Mount ticken (verhindert Hydration-Sprünge)
  const [jetzt, setJetzt] = useState<Date | null>(null)
  useEffect(() => {
    setJetzt(new Date())
    const t = setInterval(() => setJetzt(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const heuteIso = isoHeute()
  const heutige = useMemo(() => stempel.filter(s => zurichDateOf(s.zeit) === heuteIso), [stempel, heuteIso])
  const status = statusFor(heutige)
  const sessionsHeute = useMemo(() => sessionsFor(heutige), [heutige])
  const nowMs = jetzt?.getTime() ?? Date.now()
  const statHeute = tagesStatistik(sessionsHeute, nowMs)
  const letzter = heutige[heutige.length - 1]
  const drin = status === 'eingestempelt'

  function tue(aktion: StempelAktion) {
    setMsg(null)
    startTransition(async () => {
      let r: { error?: string } | undefined
      try { r = await stempeln(aktion) } catch { r = { error: 'Netzwerkfehler — der Stempel wurde NICHT gespeichert. Bitte erneut drücken.' } }
      if (r?.error) setMsg(r.error)
      else router.refresh()
    })
  }

  const STATUS_UI = {
    draussen:      { label: 'Noch nicht eingestempelt', cls: 'bg-edge-row text-ink-3', dot: '#B5B0BC' },
    eingestempelt: { label: `Eingestempelt${letzter ? ` seit ${fmtStempelZeit(letzter.zeit)}` : ''}`, cls: 'bg-mint-bg text-mint-ink', dot: '#5F8F86' },
    pause:         { label: `In der Pause${letzter ? ` seit ${fmtStempelZeit(letzter.zeit)}` : ''}`, cls: 'bg-apricot-bg text-apricot-ink', dot: '#B08350' },
    fertig:        { label: `Ausgestempelt${letzter ? ` um ${fmtStempelZeit(letzter.zeit)}` : ''}`, cls: 'bg-steel-bg text-steel-ink', dot: '#4F6B8F' },
  } as const
  const ui = STATUS_UI[status]

  const datumLang = (() => {
    const d = new Date(`${heuteIso}T00:00:00`)
    return `${TAG_LANG[d.getDay()]}, ${d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
  })()

  // Tages-Zeitleiste 06:00–20:00
  const ZL_START = 6 * 60, ZL_ENDE = 20 * 60
  const zlPos = (min: number) => Math.min(100, Math.max(0, ((min - ZL_START) / (ZL_ENDE - ZL_START)) * 100))

  return (
    <div>
      <div className="card overflow-hidden">
        <div className="bg-surface px-6 pt-5 pb-5 border-b border-edge-soft text-center">
          <p className="text-[11.5px] font-semibold uppercase tracking-[.14em] text-ink-4">{datumLang}</p>
          <p className="text-[48px] leading-tight font-bold text-ink tnum mt-0.5" suppressHydrationWarning>
            {jetzt
              ? jetzt.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' })
              : '—:—'}
            <span className="text-[22px] text-ink-4 font-semibold align-baseline ml-2" suppressHydrationWarning>
              {jetzt ? jetzt.toLocaleTimeString('de-CH', { second: '2-digit', timeZone: 'Europe/Zurich' }).padStart(2, '0') : '—'}
            </span>
          </p>
          <span className={`inline-flex items-center gap-2 mt-2 text-[13px] font-semibold px-4 py-2 rounded-full ${ui.cls}`}>
            <span className="w-2 h-2 rounded-full" style={{ background: ui.dot }} />
            {ui.label}
          </span>
          {(statHeute.arbeit > 0 || drin) && (
            <p className="text-[13px] text-ink-2 mt-2.5 tnum">
              Heute gearbeitet: <span className="font-bold">{fmtStunden(statHeute.arbeit)}</span>
              {statHeute.pause > 0 && <span className="text-ink-4"> · Pause {fmtStunden(statHeute.pause)}</span>}
            </p>
          )}
        </div>

        <div className="px-6 py-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            {([
              { aktion: 'einstempeln' as const, label: 'Einstempeln', sub: 'Arbeitstag beginnen', symbol: '▶', cls: 'bg-mint-bg text-mint-ink', aktiviert: !drin && status !== 'pause' },
              { aktion: 'pause' as const, label: 'Pause', sub: 'kurz raus', symbol: '⏸', cls: 'bg-apricot-bg text-apricot-ink', aktiviert: drin },
              { aktion: 'zurueck' as const, label: 'Zurück', sub: 'aus der Pause', symbol: '↩', cls: 'bg-steel-bg text-steel-ink', aktiviert: status === 'pause' },
              { aktion: 'ausstempeln' as const, label: 'Ausstempeln', sub: 'Feierabend', symbol: '■', cls: 'bg-blush-bg text-blush-ink', aktiviert: drin },
            ]).map(k => (
              <button key={k.aktion} disabled={isPending || !k.aktiviert}
                onClick={() => tue(k.aktion)}
                className={`rounded-tile px-4 py-5 text-center font-bold text-[15px] border border-transparent transition-all ${k.cls}
                  ${k.aktiviert ? 'hover:-translate-y-0.5 hover:shadow-md cursor-pointer' : 'opacity-35'}`}>
                <span className="block text-[26px] mb-1.5">{k.symbol}</span>
                {k.label}
                <span className="block text-[10.5px] font-semibold opacity-70 mt-1">{k.sub}</span>
              </button>
            ))}
          </div>
          {msg && (
            <p className="mt-4 text-xs px-3.5 py-2.5 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {msg}</p>
          )}

          {sessionsHeute.length > 0 && (
            <div className="mt-6 pt-4 border-t border-edge-soft">
              <div className="flex items-center justify-between mb-1.5">
                <p className="eyebrow">Heutige Stempel</p>
                <p className="text-[10px] text-ink-4 tnum">06:00 – 20:00</p>
              </div>
              <div className="relative h-2.5 rounded-full bg-edge-row mb-3">
                {sessionsHeute.map((s, i) => {
                  const a = zlPos(minutenAmTag(s.von))
                  const b = s.bis ? zlPos(minutenAmTag(s.bis)) : zlPos(minutenAmTag(new Date(nowMs).toISOString()))
                  return (
                    <div key={i} className="absolute top-0 h-full rounded-full"
                      style={{ left: `${a}%`, width: `${Math.max(1, b - a)}%`, background: s.bis ? '#5F8F86' : '#8FBAB0' }}
                      title={`${fmtStempelZeit(s.von)} – ${s.bis ? fmtStempelZeit(s.bis) : 'läuft'}`} />
                  )
                })}
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {heutige.map(s => (
                  <span key={s.id} className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg tnum ${
                    s.typ === 'In' ? 'bg-mint-bg text-mint-ink' : s.aktion === 'pause' ? 'bg-apricot-bg text-apricot-ink' : 'bg-steel-bg text-steel-ink'
                  }`}>
                    {s.typ === 'In' ? '▶' : s.aktion === 'pause' ? '⏸' : '■'} {fmtStempelZeit(s.zeit)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
