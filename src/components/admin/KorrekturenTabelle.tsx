'use client'

import { Fragment, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteZeitKorrektur } from '@/actions/korrekturen'
import type { ZeitKorrektur } from '@/lib/korrekturen'

function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const [y, m, d] = iso.split('-')
  return `${parseInt(d, 10)}.${parseInt(m, 10)}.${y}`
}

function initials(name: string): string {
  return name.split(' ').filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?'
}

/** Resolved Zeiterfassung corrections grouped per employee — employees with
 *  the most corrections first, so patterns stand out. */
export default function KorrekturenTabelle({ erledigte, offene }: { erledigte: ZeitKorrektur[]; offene: number }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function remove(k: ZeitKorrektur) {
    if (!confirm(`Meldung von ${k.name} (${fmtDate(k.datum)}) endgültig löschen?\nSie verschwindet auch in der Liste der Mitarbeiterin.`)) return
    setBusyKey(k.key)
    setError(null)
    startTransition(async () => {
      let res: { error?: string } | undefined
      try {
        res = await deleteZeitKorrektur(k.key)
      } catch {
        res = { error: 'Netzwerkfehler — bitte erneut versuchen.' }
      }
      if (res?.error) setError(res.error)
      else router.refresh()
      setBusyKey(null)
    })
  }

  const groups = new Map<string, ZeitKorrektur[]>()
  for (const k of erledigte) {
    const list = groups.get(k.name) ?? []
    list.push(k)
    groups.set(k.name, list)
  }
  const sorted = Array.from(groups.entries()).sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  )

  return (
    <div className="space-y-4">
      {offene > 0 && (
        <p className="text-xs px-4 py-2.5 rounded-ctl bg-apricot-bg text-apricot-ink inline-block">
          {offene} offene {offene === 1 ? 'Meldung liegt' : 'Meldungen liegen'} noch auf dem Dashboard.
        </p>
      )}
      {error && (
        <p className="text-xs px-4 py-2.5 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {error}</p>
      )}

      {sorted.length === 0 ? (
        <div className="card px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink-2">Noch keine korrigierten Meldungen</p>
          <p className="text-xs text-ink-4 mt-1">
            Sobald Sie eine Meldung auf dem Dashboard mit «Korrigiert» markieren, erscheint sie hier.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-edge-soft bg-surface">
                  {['Tag', 'Korrekte Zeit', 'Bemerkung', 'Gemeldet am', 'Korrigiert am', ''].map((h, i) => (
                    <th key={i} className="px-6 py-3 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(([name, list]) => (
                  <Fragment key={name}>
                    <tr className="bg-edge-row/60 border-b border-edge-soft">
                      <td colSpan={6} className="px-6 py-2.5">
                        <span className="flex items-center gap-2.5">
                          <span className="avatar w-7 h-7 text-[10px]">{initials(name)}</span>
                          <span className="text-sm font-bold text-ink">{name}</span>
                          <span className="badge badge-teal">
                            {list.length} {list.length === 1 ? 'Korrektur' : 'Korrekturen'}
                          </span>
                        </span>
                      </td>
                    </tr>
                    {list.map(k => (
                      <tr key={k.key} className="border-b border-edge-row hover:bg-hovrow">
                        <td className="px-6 py-3 text-sm font-semibold text-ink tnum whitespace-nowrap">{fmtDate(k.datum)}</td>
                        <td className="px-6 py-3 text-sm text-ink-2 tnum whitespace-nowrap">{k.zeit}</td>
                        <td className="px-6 py-3 text-xs text-ink-3">{k.text || '—'}</td>
                        <td className="px-6 py-3 text-xs text-ink-3 tnum whitespace-nowrap">{fmtDate(k.am)}</td>
                        <td className="px-6 py-3 text-xs text-mint-ink font-semibold tnum whitespace-nowrap">✓ {k.done ? fmtDate(k.done) : '—'}</td>
                        <td className="px-6 py-3 text-right">
                          <button
                            onClick={() => remove(k)}
                            disabled={busyKey === k.key}
                            className="p-1.5 rounded-lg border border-edge-ctl bg-white text-ink-4 hover:text-red-500 hover:bg-edge-row transition-colors"
                            title="Meldung endgültig löschen (z. B. Test-Eintrag)"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
