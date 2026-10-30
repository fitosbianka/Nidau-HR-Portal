'use client'

import { useState, useTransition } from 'react'
import { updateHrDetails, addSalaryHistoryEntry, updateSalaryHistoryEntry, deleteSalaryHistoryEntry, applyEffectiveSalaryHistory } from '@/actions/employees'
import { formatDateOptional, formatCHF } from '@/lib/utils'
import { wirksamerEintrag, verlaufAbweichungen, zurichToday } from '@/lib/salary-sync'
import type { Profile, SalaryHistory } from '@/lib/supabase/types'
import type { BvgStand } from '@/lib/lohn-bvg'

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const monatLabel = (ym: string) => `${MONATE[parseInt(ym.slice(5, 7), 10) - 1] ?? ym} ${ym.slice(0, 4)}`
const fmtAm = (iso: string) => new Date(iso).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })

function bvgQuelleText(b: BvgStand): string {
  if (b.quelle === 'abrechnung') {
    const periode = b.letzteAbrechnung && b.letzteAbrechnung.monat === b.monat ? b.letzteAbrechnung.periode : b.monat ? monatLabel(b.monat) : ''
    return `übernommen aus der Lohnabrechnung ${periode}`.trim()
  }
  if (b.quelle === 'hr') return `im HR erfasst${b.am ? ` am ${fmtAm(b.am)}` : ''}`
  if (b.quelle === 'stammdaten') return `in den Lohn-Stammdaten erfasst${b.am ? ` am ${fmtAm(b.am)}` : ''}`
  return 'Vorschlag — noch nicht bestätigt'
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-ink-4 uppercase tracking-widest">{label}</p>
      <p className="text-sm text-ink mt-1">{value || '—'}</p>
    </div>
  )
}

interface Props {
  employee: Profile
  salaryHistory: SalaryHistory[]
  /** BVG-/Pensionskassen-Abzug — gleiche Quelle wie die Lohnabrechnung */
  bvg?: BvgStand | null
}

export default function HrSection({ employee, salaryHistory, bvg = null }: Props) {
  const [editing, setEditing]               = useState(false)
  const [addingHistory, setAddingHistory]   = useState(false)
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null)
  const [error, setError]                   = useState<string | null>(null)
  const [historyError, setHistoryError]     = useState<string | null>(null)
  const [editHistoryError, setEditHistoryError] = useState<string | null>(null)
  const [syncInfo, setSyncInfo]             = useState<string | null>(null)
  const [isPending, startTransition]        = useTransition()

  // Kontrolle: weicht der wirksame Verlaufs-Eintrag von den aktuellen
  // HR-Werten ab? (Einträge in der Zukunft zählen noch nicht.)
  const effEintrag = wirksamerEintrag(salaryHistory, zurichToday())
  const abweichungen = effEintrag ? verlaufAbweichungen(employee, effEintrag) : []

  const syncText = (r: { uebernommen?: boolean; zukunft?: boolean }) =>
    r.uebernommen
      ? '✓ Die aktuellen HR-Werte wurden vom Eintrag übernommen.'
      : r.zukunft
        ? 'Der Eintrag liegt in der Zukunft — die aktuellen HR-Werte bleiben bis zu seinem Datum unverändert.'
        : 'Der Eintrag ist nicht der neuste wirksame — die aktuellen HR-Werte bleiben unverändert.'

  function handleUpdateHr(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const result = await updateHrDetails(formData)
      if (result.error) { setError(result.error) } else { setEditing(false) }
    })
  }

  function handleAddHistory(formData: FormData) {
    setHistoryError(null)
    setSyncInfo(null)
    startTransition(async () => {
      const result = await addSalaryHistoryEntry(formData)
      if (result.error) { setHistoryError(result.error) }
      else { setAddingHistory(false); setSyncInfo(syncText(result)) }
    })
  }

  function handleUpdateHistory(formData: FormData) {
    setEditHistoryError(null)
    setSyncInfo(null)
    startTransition(async () => {
      const result = await updateSalaryHistoryEntry(formData)
      if (result.error) { setEditHistoryError(result.error) }
      else { setEditingHistoryId(null); setSyncInfo(syncText(result)) }
    })
  }

  function handleApplyHistory() {
    setSyncInfo(null)
    startTransition(async () => {
      const result = await applyEffectiveSalaryHistory(employee.id)
      if ('error' in result && result.error) { setHistoryError(result.error) }
      else { setSyncInfo('✓ Die aktuellen HR-Werte wurden vom Verlauf übernommen.') }
    })
  }

  function handleDeleteHistory(entryId: string) {
    if (!confirm('Diesen Eintrag wirklich löschen?')) return
    startTransition(async () => {
      const result = await deleteSalaryHistoryEntry(entryId, employee.id)
      if (result.error) setHistoryError(result.error)
    })
  }

  return (
    <div className="card p-6 space-y-6">
      {/* ── Current HR values ──────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-ink-2">HR</h2>
          {!editing && (
            <button onClick={() => setEditing(true)} className="btn-secondary text-xs py-1.5 px-3">
              Bearbeiten
            </button>
          )}
        </div>

        {editing ? (
          <form action={handleUpdateHr} className="space-y-4">
            <input type="hidden" name="id" value={employee.id} />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Pensum (%)</label>
                <input name="pensum" type="number" min="0" max="200"
                  defaultValue={employee.pensum ?? ''} className="input-field" placeholder="100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Eintrittsdatum</label>
                <input name="eintrittsdatum" type="date"
                  defaultValue={employee.eintrittsdatum ?? ''} className="input-field" />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">100% Bruttolohn (CHF)</label>
                <input name="bruttolohn_100" type="number" min="0" step="any"
                  defaultValue={employee.bruttolohn_100 ?? ''} className="input-field" placeholder="8500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Monatslohn (CHF)</label>
                <input name="monatslohn" type="number" min="0" step="any"
                  defaultValue={employee.monatslohn ?? ''} className="input-field" placeholder="6800" />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">BVG / Pensionskasse (CHF/Monat)</label>
                <input name="bvg" type="number" min="0" step="0.05"
                  defaultValue={bvg ? bvg.betrag : ''} className="input-field" placeholder="0.00" />
                <p className="text-[10px] text-ink-4 mt-1">
                  Gilt sofort als Vorbelegung der Lohnabrechnung; ein dort eingegebener Betrag wird hierher zurückgeschrieben.
                </p>
              </div>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => { setEditing(false); setError(null) }}
                className="btn-secondary flex-1 sm:flex-none sm:px-5">Abbrechen</button>
              <button type="submit" disabled={isPending}
                className="btn-primary flex-1 sm:flex-none sm:px-5">
                {isPending ? 'Speichern…' : 'Speichern'}
              </button>
            </div>
          </form>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-x-6 gap-y-4">
            <Field label="Pensum"          value={employee.pensum != null ? `${employee.pensum} %` : ''} />
            <Field label="Eintrittsdatum"  value={formatDateOptional(employee.eintrittsdatum)} />
            <Field label="100% Bruttolohn" value={formatCHF(employee.bruttolohn_100)} />
            <Field label="Monatslohn"      value={formatCHF(employee.monatslohn)} />
            <div>
              <p className="text-[10px] font-semibold text-ink-4 uppercase tracking-widest">BVG / Pensionskasse</p>
              <p className="text-sm text-ink mt-1">{bvg ? `${formatCHF(bvg.betrag)} / Monat` : '—'}</p>
              {bvg && <p className="text-[10.5px] text-ink-4 mt-0.5">{bvgQuelleText(bvg)}</p>}
              {bvg?.abweichung && bvg.letzteAbrechnung && (
                <p className="text-[10.5px] text-apricot-ink mt-1" title="Der gespeicherte BVG-Abzug stimmt nicht mit der letzten Lohnabrechnung überein. Der gespeicherte Wert gilt für neue Abrechnungen — hier oder in der nächsten Abrechnung angleichen.">
                  ⚠ Letzte Abrechnung ({bvg.letzteAbrechnung.periode}): {formatCHF(bvg.letzteAbrechnung.betrag)}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Salary / Pensum history ─────────────────────── */}
      <div className="border-t border-edge-soft pt-5">
        {abweichungen.length > 0 && effEintrag && (
          <div className="mb-4 p-3.5 rounded-xl bg-apricot-bg border border-apricot-ink/20 flex items-center gap-3 flex-wrap">
            <p className="text-xs text-apricot-ink flex-1 min-w-[220px]">
              ⚠ Die aktuellen HR-Werte weichen vom Verlaufs-Eintrag per{' '}
              <span className="font-semibold">{formatDateOptional(effEintrag.effective_date)}</span> ab:{' '}
              <span className="font-semibold">{abweichungen.join(', ')}</span>.
            </p>
            <button onClick={handleApplyHistory} disabled={isPending}
              className="btn-secondary text-xs py-1.5 px-3 flex-shrink-0">
              {isPending ? 'Übernimmt…' : 'Werte übernehmen'}
            </button>
          </div>
        )}
        {syncInfo && (
          <p className="mb-4 text-xs px-3.5 py-2.5 rounded-xl bg-mint-bg text-mint-ink">{syncInfo}</p>
        )}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-widest">
            Lohn- & Pensumsverlauf
          </h3>
          {!addingHistory && (
            <button onClick={() => setAddingHistory(true)}
              className="flex items-center gap-1 text-xs text-mint-ink hover:text-ink font-medium transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Eintrag hinzufügen
            </button>
          )}
        </div>

        {/* Add history form */}
        {addingHistory && (
          <form action={handleAddHistory} className="mb-4 p-4 bg-surface rounded-xl space-y-3 border border-edge-ctl">
            <input type="hidden" name="employee_id" value={employee.id} />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Datum *</label>
                <input name="effective_date" type="date" required className="input-field text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Pensum (%)</label>
                <input name="pensum" type="number" min="0" max="200" className="input-field text-sm" placeholder="100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">100% Bruttolohn</label>
                <input name="bruttolohn_100" type="number" min="0" step="any" className="input-field text-sm" placeholder="8500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Monatslohn</label>
                <input name="monatslohn" type="number" min="0" step="any" className="input-field text-sm" placeholder="6800" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1">Bemerkung</label>
              <input name="notes" type="text" className="input-field text-sm" placeholder="z.B. Lohnerhöhung ab 01.06.2026" />
            </div>
            {historyError && <p className="text-xs text-red-600">{historyError}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => { setAddingHistory(false); setHistoryError(null) }}
                className="btn-secondary text-xs py-1.5 px-4">Abbrechen</button>
              <button type="submit" disabled={isPending}
                className="btn-primary text-xs py-1.5 px-4">
                {isPending ? 'Speichern…' : 'Speichern'}
              </button>
            </div>
          </form>
        )}

        {/* History table */}
        {salaryHistory.length === 0 && !addingHistory ? (
          <p className="text-xs text-ink-4 py-2">Noch keine Einträge vorhanden.</p>
        ) : salaryHistory.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-edge-soft">
                  <th className="pb-2 text-left text-[10px] font-semibold text-ink-4 uppercase tracking-widest">Datum</th>
                  <th className="pb-2 text-right text-[10px] font-semibold text-ink-4 uppercase tracking-widest">Pensum</th>
                  <th className="pb-2 text-right text-[10px] font-semibold text-ink-4 uppercase tracking-widest">100% Bruttolohn</th>
                  <th className="pb-2 text-right text-[10px] font-semibold text-ink-4 uppercase tracking-widest">Monatslohn</th>
                  <th className="pb-2 text-left text-[10px] font-semibold text-ink-4 uppercase tracking-widest pl-4">Bemerkung</th>
                  <th className="pb-2 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-edge-row">
                {salaryHistory.map((entry) =>
                  editingHistoryId === entry.id ? (
                    /* ── Inline edit row ── */
                    <tr key={entry.id}>
                      <td colSpan={6} className="py-3">
                        <form action={handleUpdateHistory}
                          className="flex flex-wrap gap-2 items-end bg-brand-50/50 rounded-xl p-3 border border-brand-100">
                          <input type="hidden" name="entry_id"    value={entry.id} />
                          <input type="hidden" name="employee_id" value={employee.id} />
                          <div>
                            <label className="block text-[10px] font-medium text-ink-3 mb-1">Datum</label>
                            <input name="effective_date" type="date" required
                              defaultValue={entry.effective_date}
                              className="input-field text-sm w-36" />
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium text-ink-3 mb-1">Pensum (%)</label>
                            <input name="pensum" type="number" min="0" max="200"
                              defaultValue={entry.pensum ?? ''}
                              className="input-field text-sm w-24" placeholder="100" />
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium text-ink-3 mb-1">100% Bruttolohn</label>
                            <input name="bruttolohn_100" type="number" min="0" step="any"
                              defaultValue={entry.bruttolohn_100 ?? ''}
                              className="input-field text-sm w-32" placeholder="8500" />
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium text-ink-3 mb-1">Monatslohn</label>
                            <input name="monatslohn" type="number" min="0" step="any"
                              defaultValue={entry.monatslohn ?? ''}
                              className="input-field text-sm w-32" placeholder="6800" />
                          </div>
                          <div className="flex-1 min-w-[140px]">
                            <label className="block text-[10px] font-medium text-ink-3 mb-1">Bemerkung</label>
                            <input name="notes" type="text"
                              defaultValue={entry.notes ?? ''}
                              className="input-field text-sm w-full" placeholder="Bemerkung" />
                          </div>
                          {editHistoryError && (
                            <p className="w-full text-xs text-red-600">{editHistoryError}</p>
                          )}
                          <div className="flex gap-2 items-end pb-0.5">
                            <button type="button"
                              onClick={() => { setEditingHistoryId(null); setEditHistoryError(null) }}
                              className="btn-secondary text-xs py-1.5 px-3">Abbrechen</button>
                            <button type="submit" disabled={isPending}
                              className="btn-primary text-xs py-1.5 px-3">
                              {isPending ? 'Speichern…' : 'Speichern'}
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    /* ── Normal read row ── */
                    <tr key={entry.id} className="group">
                      <td className="py-2.5 text-ink-2 font-medium" suppressHydrationWarning>
                        {formatDateOptional(entry.effective_date)}
                      </td>
                      <td className="py-2.5 text-right text-ink-2">
                        {entry.pensum != null ? `${entry.pensum} %` : '—'}
                      </td>
                      <td className="py-2.5 text-right text-ink-2">{formatCHF(entry.bruttolohn_100)}</td>
                      <td className="py-2.5 text-right text-ink-2">{formatCHF(entry.monatslohn)}</td>
                      <td className="py-2.5 text-ink-4 text-xs pl-4">{entry.notes ?? '—'}</td>
                      <td className="py-2.5 text-right">
                        <div className="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                          <button
                            onClick={() => { setEditingHistoryId(entry.id); setEditHistoryError(null) }}
                            disabled={isPending}
                            className="p-1 text-ink-5 hover:text-brand-500 transition-colors rounded"
                            title="Bearbeiten"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round"
                                d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteHistory(entry.id)}
                            disabled={isPending}
                            className="p-1 text-ink-5 hover:text-red-500 transition-colors rounded"
                            title="Löschen"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round"
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  )
}
