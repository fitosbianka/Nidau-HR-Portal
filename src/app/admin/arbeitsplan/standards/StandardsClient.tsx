'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveAllStandardWeeks } from '@/actions/schedule'
import type { StandardWeek } from '@/lib/plan-standards'

interface Props {
  employees: Array<{ id: string; full_name: string; job_title: string | null }>
  standards: Record<string, StandardWeek>
}

const WEEKDAYS = [
  { iso: '1', label: 'Mo' },
  { iso: '2', label: 'Di' },
  { iso: '3', label: 'Mi' },
  { iso: '4', label: 'Do' },
  { iso: '5', label: 'Fr' },
  { iso: '6', label: 'Sa' },
  { iso: '7', label: 'So' },
]

export default function StandardsClient({ employees, standards }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [weeks, setWeeks] = useState<Record<string, StandardWeek>>(() => {
    const init: Record<string, StandardWeek> = {}
    for (const e of employees) init[e.id] = { ...(standards[e.id] ?? {}) }
    return init
  })
  const [dirty,   setDirty]   = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState<string | null>(null)   // success message
  const [error,   setError]   = useState<string | null>(null)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  // Unsaved changes must not be lost by navigating away (that's exactly what
  // happened before the global save button existed): warn on tab close /
  // reload AND on in-app link clicks.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) { e.preventDefault(); e.returnValue = '' }
    }
    const onLinkClick = (e: MouseEvent) => {
      if (!dirtyRef.current) return
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]')
      if (!a) return
      if (!window.confirm('Die Standards sind noch nicht gespeichert. Seite trotzdem verlassen? Die Änderungen gehen dann verloren.')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', onLinkClick, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', onLinkClick, true)
    }
  }, [])

  function setCell(empId: string, iso: string, value: string) {
    setWeeks(prev => ({ ...prev, [empId]: { ...prev[empId], [iso]: value } }))
    setDirty(true)
    setSaved(null)
  }

  function saveAll() {
    setSaving(true)
    setError(null)
    setSaved(null)
    startTransition(async () => {
      try {
        const result = await saveAllStandardWeeks(weeks)
        if (result?.error) {
          setError(result.error)
        } else {
          setDirty(false)
          const n = (result as { filled?: number } | undefined)?.filled ?? 0
          setSaved(n > 0
            ? `Gespeichert — künftige Monate wurden angepasst (${n} Einträge).`
            : 'Gespeichert.')
          router.refresh()
        }
      } catch {
        setError('Netzwerkfehler — Änderung wurde nicht gespeichert. Bitte erneut versuchen.')
      }
      setSaving(false)
    })
  }

  return (
    <div className="card overflow-hidden">
      {/* ── Save bar ── */}
      <div className="px-5 py-3 border-b border-edge-soft bg-surface flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs">
          {dirty && !saving && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-apricot-bg text-apricot-ink font-bold text-[11px]">
              Nicht gespeicherte Änderungen
            </span>
          )}
          {saved && !dirty && (
            <span className="font-semibold text-mint-ink">✓ {saved}</span>
          )}
        </div>
        <button
          onClick={saveAll}
          disabled={saving || !dirty}
          className="btn-primary !px-5 whitespace-nowrap disabled:opacity-40"
        >{saving ? 'Speichert…' : 'Speichern'}</button>
      </div>

      {error && (
        <div className="mx-6 mt-4 p-3 bg-blush-bg border border-blush-ink/30 rounded-ctl text-sm text-blush-ink">
          ⚠ {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: 640 }}>
          <thead>
            <tr className="bg-surface border-b border-edge-ctl">
              <th className="text-left px-5 py-2.5 text-[10.5px] font-semibold tracking-[.12em] text-ink-4 uppercase">Mitarbeiter</th>
              {WEEKDAYS.map(w => (
                <th key={w.iso} className="px-1 py-2.5 text-center text-[10.5px] font-semibold tracking-wide text-ink-4 uppercase w-[64px]">
                  {w.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-edge-row">
            {employees.map(emp => (
              <tr key={emp.id} className="hover:bg-hovrow transition-colors">
                <td className="px-5 py-2">
                  <p className="text-[13px] font-semibold text-ink whitespace-nowrap">{emp.full_name}</p>
                  <p className="text-[10.5px] text-ink-4">{emp.job_title ?? '—'}</p>
                </td>
                {WEEKDAYS.map(w => (
                  <td key={w.iso} className="px-1 py-2 text-center">
                    <input
                      type="text"
                      value={weeks[emp.id]?.[w.iso] ?? ''}
                      maxLength={10}
                      onChange={e => setCell(emp.id, w.iso, e.target.value)}
                      placeholder="—"
                      className="w-[54px] px-1 py-1.5 text-center text-[12px] font-semibold text-ink border border-edge-ctl rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk placeholder:text-ink-5 tnum"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3.5 border-t border-edge-soft bg-surface">
        <p className="text-[11px] text-ink-4 leading-relaxed">
          Gleiche Codes wie im Arbeitsplan (z.B. <b className="text-ink-3">3f</b>, <b className="text-ink-3">5t</b>, <b className="text-ink-3">6</b>, <b className="text-ink-3">7</b>, <b className="text-ink-3">8</b>, <b className="text-ink-3">✓</b>, <b className="text-ink-3">%</b>, <b className="text-ink-3">HO</b>, <b className="text-ink-3">S</b>). Zwei Positionen mit / kombinieren, zum Beispiel <b className="text-ink-3">*/7s</b> (Joker, dann Spätsteri).
          Leere Felder: bei ZAZ und DH / PA ist ein leeres Feld ein <b className="text-ink-3">freier Tag</b> (kein % nötig, der Plan bleibt ruhig), bei der Assistenz bedeutet es «kein Standard» für diesen Wochentag.
          <br />
          Mit «Speichern» werden die Standards übernommen und automatisch auf alle künftigen Monate (ab nächstem Monat bis Ende nächstes Jahr) angewendet:
          leere Zellen werden gefüllt, Zellen mit dem bisherigen Standard folgen der neuen Regel — geplante Ferien und von Hand eingetragene Werte bleiben unverändert.
        </p>
      </div>
    </div>
  )
}
