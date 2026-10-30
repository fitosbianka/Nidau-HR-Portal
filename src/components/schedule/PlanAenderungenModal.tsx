'use client'

// Admin-only popup listing the change log of the shown plan month:
// who changed what and when, with the exact old → new value.

import { useEffect, useState } from 'react'
import { getPlanAenderungen } from '@/actions/schedule'
import type { PlanLogEntry } from '@/lib/plan-log'

const KIND_CHIP: Record<PlanLogEntry['kind'], { label: string; cls: string }> = {
  zelle:  { label: 'Plan',       cls: 'bg-mint-bg    text-mint-ink' },
  notiz:  { label: 'Notiz',      cls: 'bg-lilac-bg   text-lilac-ink' },
  marker: { label: 'Markierung', cls: 'bg-apricot-bg text-apricot-ink' },
  aktion: { label: 'Aktion',     cls: 'bg-steel-bg   text-steel-ink' },
  status: { label: 'Status',     cls: 'bg-edge-row   text-ink-2' },
}

const WD_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

/** Affected plan day, short: "Mi 3.9." */
function fmtPlanDay(iso: string): string {
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

function Val({ v }: { v: string }) {
  return v === '' ? (
    <span className="italic text-ink-4">leer</span>
  ) : (
    <span className="font-semibold text-ink tnum">«{v}»</span>
  )
}

function Description({ e }: { e: PlanLogEntry }) {
  if (e.kind === 'zelle') {
    return (
      <>
        <span className="font-semibold text-ink">{e.emp ?? '?'}</span>
        {' · '}
        <span className="tnum">{fmtPlanDay(e.datum)}</span>
        {': '}
        <Val v={e.old ?? ''} />
        <span className="text-ink-4"> → </span>
        <Val v={e.neu ?? ''} />
      </>
    )
  }
  if (e.kind === 'notiz') {
    const old = e.old ?? ''
    const neu = e.neu ?? ''
    const label = <>{e.text ?? 'Notiz'} (<span className="tnum">{fmtPlanDay(e.datum)}</span>)</>
    if (old === '') return <>{label} erstellt: <Val v={neu} /></>
    if (neu === '') return <>{label} gelöscht (war: <Val v={old} />)</>
    return <>{label} geändert: <Val v={old} /><span className="text-ink-4"> → </span><Val v={neu} /></>
  }
  // marker / aktion / status
  return (
    <>
      {e.text ?? ''}
      {e.kind === 'marker' && <> · <span className="tnum">{fmtPlanDay(e.datum)}</span></>}
    </>
  )
}

export default function PlanAenderungenModal({
  year, month, monthLabel, onClose, initialEntries,
}: {
  year: number
  month: number
  monthLabel: string
  onClose: () => void
  /** Skips fetching when set (previews/tests). */
  initialEntries?: PlanLogEntry[]
}) {
  const [entries, setEntries] = useState<PlanLogEntry[] | null>(initialEntries ?? null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initialEntries) return
    let alive = true
    getPlanAenderungen(year, month)
      .then(res => {
        if (!alive) return
        if (res.entries) setEntries(res.entries)
        else setError(res.error ?? 'Protokoll konnte nicht geladen werden.')
      })
      .catch(() => { if (alive) setError('Netzwerkfehler — Protokoll konnte nicht geladen werden.') })
    return () => { alive = false }
  }, [year, month, initialEntries])

  // Group by the (Zurich) calendar day the change was made on, newest first
  const groups: Array<{ day: string; items: Array<PlanLogEntry & { time: string }> }> = []
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
        <div className="px-6 py-4 border-b border-edge-soft flex items-center justify-between flex-shrink-0">
          <h3 className="text-sm font-semibold text-ink-2">Änderungen — {monthLabel}</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-edge-row text-ink-4 hover:text-ink-2 flex items-center justify-center text-lg leading-none"
            aria-label="Schliessen"
          >×</button>
        </div>

        <div className="overflow-y-auto">
          {entries === null && !error && (
            <p className="px-6 py-8 text-center text-xs text-ink-4">Wird geladen…</p>
          )}
          {error && (
            <p className="px-6 py-8 text-center text-xs text-blush-ink">{error}</p>
          )}
          {entries !== null && entries.length === 0 && (
            <p className="px-6 py-8 text-center text-xs text-ink-4">
              Für diesen Monat sind noch keine Änderungen protokolliert.
            </p>
          )}

          {groups.map(g => (
            <div key={g.day}>
              <p className="px-6 pt-4 pb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-ink-4 border-b border-edge-soft bg-surface sticky top-0">
                {g.day}
              </p>
              <ul className="divide-y divide-edge-row">
                {g.items.map(e => (
                  <li key={e.key} className="px-6 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[13px] text-ink-2 leading-snug"><Description e={e} /></p>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap flex-shrink-0 mt-0.5 ${KIND_CHIP[e.kind].cls}`}>
                        {KIND_CHIP[e.kind].label}
                      </span>
                    </div>
                    <p className="text-[11px] text-ink-4 mt-0.5 tnum">
                      {e.time} Uhr · {e.by}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="px-6 py-2.5 border-t border-edge-soft text-[10.5px] text-ink-4 flex-shrink-0">
          Protokolliert werden Änderungen am Plan seit dem 29.08.2026 — frühere Bearbeitungen sind nicht erfasst.
        </p>
      </div>
    </div>
  )
}
