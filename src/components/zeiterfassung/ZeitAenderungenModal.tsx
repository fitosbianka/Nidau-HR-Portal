'use client'

// Admin popup listing every change made to the Zeiterfassung times
// (edits, added and deleted entries), by month. Only the admin can change
// times, so no author is shown.

import { useEffect, useState } from 'react'
import { getZeitAenderungen } from '@/actions/kontrolle'
import type { ZeitLogEntry } from '@/lib/zeit-log'

const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
const WD_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

function fmtDay(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = new Date(iso + 'T12:00:00Z')
  return `${WD_SHORT[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`
}

function zurichParts(at: string): { day: string; time: string } {
  const d = new Date(at)
  if (isNaN(d.getTime())) return { day: at, time: '' }
  return {
    day: d.toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' }),
    time: d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }),
  }
}

export default function ZeitAenderungenModal({
  onClose, initialEntries,
}: {
  onClose: () => void
  /** Skips fetching when set (previews/tests). */
  initialEntries?: ZeitLogEntry[]
}) {
  const nowZ = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Zurich' }))
  const [year, setYear]   = useState(nowZ.getFullYear())
  const [month, setMonth] = useState(nowZ.getMonth() + 1)
  const [entries, setEntries] = useState<ZeitLogEntry[] | null>(initialEntries ?? null)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (initialEntries) return
    let alive = true
    setEntries(null)
    setError(null)
    getZeitAenderungen(year, month)
      .then(res => {
        if (!alive) return
        if (res.entries) setEntries(res.entries)
        else setError(res.error ?? 'Protokoll konnte nicht geladen werden.')
      })
      .catch(() => { if (alive) setError('Netzwerkfehler — Protokoll konnte nicht geladen werden.') })
    return () => { alive = false }
  }, [year, month, initialEntries])

  const nav = (dir: -1 | 1) => {
    let m = month + dir
    let y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setMonth(m)
    setYear(y)
  }

  // Group by the (Zurich) calendar day the change was made on, newest first
  const groups: Array<{ day: string; items: Array<ZeitLogEntry & { time: string }> }> = []
  for (const e of entries ?? []) {
    const { day, time } = zurichParts(e.at)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push({ ...e, time })
    else groups.push({ day, items: [{ ...e, time }] })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-edge-soft flex items-center justify-between gap-3 flex-shrink-0">
          <h3 className="text-sm font-semibold text-ink-2">Änderungen an den Zeiten</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => nav(-1)}
              className="w-7 h-7 rounded-lg border border-edge-ctl bg-white text-ink-2 hover:bg-edge-row"
              title="Vorheriger Monat"
            >‹</button>
            <span className="text-xs font-bold text-ink w-[110px] text-center tnum">{MONTH_NAMES[month - 1]} {year}</span>
            <button
              onClick={() => nav(1)}
              className="w-7 h-7 rounded-lg border border-edge-ctl bg-white text-ink-2 hover:bg-edge-row"
              title="Nächster Monat"
            >›</button>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg hover:bg-edge-row text-ink-4 hover:text-ink-2 flex items-center justify-center text-lg leading-none ml-2"
              aria-label="Schliessen"
            >×</button>
          </div>
        </div>

        <div className="overflow-y-auto">
          {entries === null && !error && (
            <p className="px-6 py-8 text-center text-xs text-ink-4">Wird geladen…</p>
          )}
          {error && <p className="px-6 py-8 text-center text-xs text-blush-ink">{error}</p>}
          {entries !== null && entries.length === 0 && (
            <p className="px-6 py-8 text-center text-xs text-ink-4">
              Für {MONTH_NAMES[month - 1]} {year} sind keine Änderungen protokolliert.
            </p>
          )}

          {groups.map(g => (
            <div key={g.day}>
              <p className="px-6 pt-4 pb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-ink-4 border-b border-edge-soft bg-surface sticky top-0">
                {g.day}
              </p>
              <ul className="divide-y divide-edge-row">
                {g.items.map(e => {
                  return (
                    <li key={e.key} className="px-6 py-3">
                      <p className="text-[13px] text-ink-2 leading-snug">
                        <span className="font-semibold text-ink">{e.emp}</span>
                        {' · '}
                        <span className="tnum">{fmtDay(e.datum)}</span>
                        {': '}
                        <span className="tnum">{e.text}</span>
                      </p>
                      <p className="text-[11px] text-ink-4 mt-0.5 tnum">{e.time} Uhr</p>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>

        <p className="px-6 py-2.5 border-t border-edge-soft text-[10.5px] text-ink-4 flex-shrink-0">
          Protokolliert werden Änderungen an den Stempelzeiten (bearbeitet, hinzugefügt, gelöscht) — nach dem
        betroffenen Tag gefiltert. Aufgezeichnet seit dem 04.09.2026.
        </p>
      </div>
    </div>
  )
}
