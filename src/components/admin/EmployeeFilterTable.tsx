'use client'

import { istVerwaltungsFunktion } from '@/lib/funktionen'
import { useState } from 'react'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { istExtern } from '@/lib/externe'

type Employee = {
  id: string
  full_name: string
  email: string
  job_title: string | null
  is_active: boolean
  last_login: string | null
  created_at: string
  birthday: string | null
  eintrittsdatum: string | null
  extern?: boolean
}

/** Full years between a YYYY-MM-DD date and today (Zurich). Negative = future. */
function yearsSince(dateStr: string | null): number | null {
  if (!dateStr) return null
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })
  const [y, m, d] = dateStr.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  if (dateStr > today) return -1
  let yrs = ty - y
  if (tm < m || (tm === m && td < d)) yrs--
  return yrs
}

function fmtCH(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}.${m}.${y}`
}

const FILTERS = ['Alle', 'ZAZ', 'DH', 'PA', 'DA', 'Lernende', 'Verwaltung'] as const
type Filter = (typeof FILTERS)[number]

/** Passt die Funktion einer Person zum Filter? DA umfasst die Leitende DA,
 *  Verwaltung die Funktionen Admin und HR & Finanzen. */
function passtFilter(f: Filter, jobTitle: string | null | undefined): boolean {
  const t = (jobTitle ?? '').trim()
  if (f === 'Alle') return true
  if (f === 'DA') return t === 'DA' || t === 'Leitende DA'
  if (f === 'DH') return t === 'DH' || t === 'DH / PA'
  if (f === 'Verwaltung') return istVerwaltungsFunktion(t)
  return t === f
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).map((n) => n[0]).join('').toUpperCase().slice(0, 2) || '?'
}

export default function EmployeeFilterTable({
  employees,
  countMap,
}: {
  employees: Employee[]
  countMap: Record<string, number>
}) {
  const [filter, setFilter] = useState<Filter>('Alle')

  const filtered = employees.filter((e) => passtFilter(filter, e.job_title))

  return (
    <div className="card overflow-hidden">
      <div className="px-6 py-4 border-b border-edge-soft flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-sm font-semibold text-ink-2">Aktive Mitarbeitende</h2>

        {/* Filter tabs */}
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                filter === f
                  ? 'bg-accent-300 text-white shadow-sm'
                  : 'text-ink-3 hover:bg-accent-50 hover:text-ink-2'
              }`}
            >
              {f === 'Alle'
                ? `Alle (${employees.length})`
                : `${f} (${employees.filter((e) => passtFilter(f, e.job_title)).length})`}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="text-ink-3 text-sm">Keine Mitarbeitenden in dieser Kategorie.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-edge-soft bg-surface/60">
                <th className="px-6 py-3 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider">
                  Mitarbeiter
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider hidden sm:table-cell">
                  Kategorie
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider hidden sm:table-cell">
                  Alter
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider hidden sm:table-cell">
                  Dienstjahre
                </th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">
                  Dok.
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider hidden md:table-cell">
                  Letzter Login
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge-row">
              {filtered.map((employee) => (
                <tr key={employee.id} className="hover:bg-hovrow transition-colors group">
                  <td className="px-6 py-4">
                    <Link href={`/admin/employees/${employee.id}`} className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-accent-300 flex items-center justify-center flex-shrink-0 shadow-sm">
                        <span className="text-white text-xs font-bold">
                          {getInitials(employee.full_name)}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-ink group-hover:text-accent-600 transition-colors">
                          {employee.full_name}
                        </p>
                        <p className="text-xs text-ink-4">{employee.email}</p>
                      </div>
                    </Link>
                  </td>
                  <td className="px-6 py-4 hidden sm:table-cell">
                    {employee.job_title ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-accent-100 text-accent-600">
                        {employee.job_title}
                      </span>
                    ) : (
                      <span className="text-sm text-ink-5">—</span>
                    )}
                    {(employee.extern || istExtern(employee.full_name)) && (
                      <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-steel-bg text-steel-ink"
                        title="Selbständig, kein Anstellungsverhältnis — zählt nicht als Angestellte/r">
                        Extern
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 hidden sm:table-cell">
                    {employee.birthday ? (
                      <div>
                        <p className="text-sm font-semibold text-ink-2 tabular-nums">{yearsSince(employee.birthday)}</p>
                        <p className="text-[11px] text-ink-4">{fmtCH(employee.birthday)}</p>
                      </div>
                    ) : (
                      <span className="text-sm text-ink-5">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 hidden sm:table-cell">
                    {employee.eintrittsdatum ? (
                      (yearsSince(employee.eintrittsdatum) ?? 0) < 0 ? (
                        <div>
                          <p className="text-sm font-semibold text-apricot-mid">ab {fmtCH(employee.eintrittsdatum)}</p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm font-semibold text-ink-2 tabular-nums">
                            {yearsSince(employee.eintrittsdatum)} {yearsSince(employee.eintrittsdatum) === 1 ? 'Jahr' : 'Jahre'}
                          </p>
                          <p className="text-[11px] text-ink-4">seit {fmtCH(employee.eintrittsdatum)}</p>
                        </div>
                      )
                    ) : (
                      <span className="text-sm text-ink-5">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-full bg-edge-row text-xs font-semibold text-ink-2">
                      {countMap[employee.id] ?? 0}
                    </span>
                  </td>
                  <td className="px-6 py-4 hidden md:table-cell">
                    <span className="text-sm text-ink-3">
                      {employee.last_login ? formatDate(employee.last_login) : '—'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`badge ${employee.is_active ? 'badge-green' : 'badge-gray'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${employee.is_active ? 'bg-mint-mid' : 'bg-ink-4'}`} />
                      {employee.is_active ? 'Aktiv' : 'Inaktiv'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
