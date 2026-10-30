'use client'

// Admin "Kontrolle Vormonat": all stamped days of the previous month, with
// shift recommendations where the times match a Kontroll-Regel. Accepting a
// recommendation sets the day to exactly 8:30 and notes the shift name.

import { useState, useTransition } from 'react'
import { PLAN_SHIFT_RE } from '@/lib/plan-meta'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { acceptShiftKorrektur } from '@/actions/kontrolle'
import { upsertZeiterfassungComment } from '@/actions/zeiterfassung-comments'
import { zurichZuIso } from '@/lib/zeitzone'

export type KontrollSpan = {
  inId: string | null
  outId: string
  inHHMM: string
  outHHMM: string
}

export type KontrollDay = {
  date: string          // YYYY-MM-DD
  plan: string | null   // Arbeitsplan entry of that day (e.g. "3f", "6", "F")
  zeiten: string        // display, e.g. "07:57 – 12:14 · 13:00 – 17:01"
  totalMin: number
  pausen: number
  incomplete: boolean
  note: string | null
  korrigiert: boolean   // day was already controlled (note carries the marker)
  empfehlung: { shiftName: string; outEventId: string; clockInISO: string; vorherMin: number } | null
  spans: KontrollSpan[]
}

export type KontrollEmployee = {
  name: string
  days: KontrollDay[]
  findings: number
}

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  return `${WD[d.getUTCDay()]}, ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`
}
function fmtH(min: number): string {
  const neg = min < 0
  const v = Math.abs(min)
  return `${neg ? '−' : ''}${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')} h`
}
// Arbeitsplan chip: shift codes are translated and STRONGLY colored by
// position (white text on saturated red/orange/blue/green), so
// Früh/Mittel/Spät is unmistakable next to the times.
const SHIFT_NAMES: Record<string, string> = { f: 'Frühschicht', t: 'Mittelschicht', s: 'Spätschicht', h: 'Halbtagsschicht' }
const SHIFT_CLS: Record<string, string> = {
  f: 'bg-[#D96C81] text-white',   // Frühschicht — rot/rosa
  t: 'bg-[#D9964E] text-white',   // Mittelschicht — orange
  s: 'bg-[#5C7FB8] text-white',   // Spätschicht — blau
  h: 'bg-[#4F9B8C] text-white',   // Halbtagsschicht — grün
}
function planChip(plan: string | null): { text: string; cls: string } {
  if (!plan) return { text: 'Plan: —', cls: 'bg-white border border-edge-ctl text-ink-4' }
  const m = plan.match(PLAN_SHIFT_RE)
  if (m) {
    const k = m[2].toLowerCase()
    return { text: `Plan: ${plan} · ${SHIFT_NAMES[k]}`, cls: SHIFT_CLS[k] }
  }
  const v = plan.toUpperCase()
  if (v === 'F' || v === 'FERIEN' || /^F:\d*\.?\d+$/.test(v))
    return { text: `Plan: ${plan} · Ferien`, cls: 'bg-[#4F9B8C] text-white' }
  if (v === 'K' || v === 'KRANK')  return { text: `Plan: ${plan} · Krank`, cls: 'bg-[#D96C81] text-white' }
  if (v === 'U' || v === 'UNFALL') return { text: `Plan: U · Unfall`, cls: 'bg-[#C97A4A] text-white' }
  if (v === 'KO')                  return { text: `Plan: ${plan} · Kompensation`, cls: 'bg-[#5C7FB8] text-white' }
  if (v === 'TE')                  return { text: `Plan: ${plan} · Teamevent`, cls: 'bg-[#9C7A55] text-white' }
  if (v === 'ÜK' || v === 'UK')    return { text: `Plan: ÜK · Überbetrieblicher Kurs`, cls: 'bg-[#8578A8] text-white' }
  if (v === 'BF')                  return { text: `Plan: BF · Bezahlt frei`, cls: 'bg-[#9B9250] text-white' }
  if (v === 'UF')                  return { text: `Plan: UF · Unbezahlte Ferien`, cls: 'bg-[#8A8268] text-white' }
  if (v === 'ND')                  return { text: `Plan: ND · Notfalldienst`, cls: 'bg-[#B5613F] text-white' }
  if (v === 'HO')                  return { text: `Plan: ${plan} · Home Office`, cls: 'bg-[#8578A8] text-white' }
  if (v === 'S' || v === 'SCHULE') return { text: `Plan: ${plan} · Schule`, cls: 'bg-[#8578A8] text-white' }
  if (v === 'WB')                  return { text: `Plan: ${plan} · Weiterbildung`, cls: 'bg-[#8578A8] text-white' }
  if (v === '6' || v === '9')      return { text: `Plan: ${plan} · Empfang`, cls: 'bg-[#7A8B9C] text-white' }
  if (v === '7')                   return { text: `Plan: 7 · Steri`, cls: 'bg-[#7A8B9C] text-white' }
  if (v === '8')                   return { text: `Plan: 8 · Tagesleitung`, cls: 'bg-[#7A8B9C] text-white' }
  if (v === '✓' || v === 'ANWESEND') return { text: `Plan: ✓ Anwesend`, cls: 'bg-edge-row text-ink-2' }
  if (v === '%' || v === 'FREI')   return { text: `Plan: ${plan} · Frei`, cls: 'bg-white border border-edge-ctl text-ink-4' }
  return { text: `Plan: ${plan}`, cls: 'bg-edge-row text-ink-2' }
}

/** Zürcher Wandzeit als UTC ISO, mit dem echten Offset des Tages (Sommer- oder Winterzeit) */
const buildISO = (zurichDate: string, hhMM: string): string => zurichZuIso(zurichDate, hhMM)

type EditState = {
  emp: string
  date: string
  spans: Array<KontrollSpan & { newIn: string; newOut: string }>
  note: string
  origNote: string
}

export default function KontrolleClient({ monthLabel, employees, exportFrom, exportTo, exportEmployees }: { monthLabel: string; employees: KontrollEmployee[]; exportFrom?: string; exportTo?: string; exportEmployees?: Array<{ id: string; name: string }> }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busyKey, setBusyKey]   = useState<string | null>(null)
  const [doneKeys, setDoneKeys] = useState<Record<string, string>>({})   // key → shiftName
  const [error, setError]       = useState<string | null>(null)
  const [nurEmpfehlungen, setNurEmpfehlungen] = useState(false)
  const [empFilter, setEmpFilter] = useState('')
  const [edit, setEdit]         = useState<EditState | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState('')
  const [exportResult, setExportResult] = useState<{ label: string; results: Array<{ name: string; status: string; grund?: string }> } | null>(null)
  const [editedKeys, setEditedKeys] = useState<Record<string, string>>({})  // key → new display

  const totalFindings = employees.reduce((s, e) => s + e.findings, 0)

  const accept = (emp: KontrollEmployee, day: KontrollDay) => {
    if (!day.empfehlung) return
    const key = `${emp.name}||${day.date}`
    setBusyKey(key)
    setError(null)
    startTransition(async () => {
      try {
        const res = await acceptShiftKorrektur({
          outEventId: day.empfehlung!.outEventId,
          clockInISO: day.empfehlung!.clockInISO,
          vorherMin:  day.empfehlung!.vorherMin,
          fullName:   emp.name,
          date:       day.date,
          shiftName:  day.empfehlung!.shiftName,
        })
        if (res?.error) setError(res.error)
        else {
          setDoneKeys(prev => ({ ...prev, [key]: day.empfehlung!.shiftName }))
          router.refresh()
        }
      } catch {
        setError('Netzwerkfehler — Änderung wurde nicht gespeichert. Bitte erneut versuchen.')
      }
      setBusyKey(null)
    })
  }

  /** Control done: export every employee's Zeiterfassung of this month as a
   *  PDF into their own Dokumente folder — one request PER employee, so a
   *  server time limit can never cut the export off halfway and the progress
   *  is visible. Server-built, matched by profile id; existing exports for
   *  the period are replaced. */
  const exportAll = async () => {
    if (!exportFrom || !exportTo || !exportEmployees?.length) return
    if (!confirm(`Kontrolle abgeschlossen?\nDie Zeiterfassungen für ${monthLabel} werden für alle ${exportEmployees.length} Mitarbeitenden als PDF in ihre eigenen Dokumente-Ordner exportiert. Bereits exportierte Dateien für diesen Monat werden ersetzt.`)) return
    setExporting(true)
    setError(null)
    setExportResult(null)
    let label = `Zeiterfassung ${monthLabel}`
    const results: Array<{ name: string; status: string; grund?: string }> = []
    for (let i = 0; i < exportEmployees.length; i++) {
      const e = exportEmployees[i]
      setExportProgress(`${i + 1}/${exportEmployees.length}: ${e.name.split(' ')[0]}…`)
      try {
        const res = await fetch('/api/admin/zeiterfassung/save-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bulk: true, bulkEmployeeId: e.id, dateFrom: exportFrom, dateTo: exportTo }),
        })
        const json = await res.json()
        if (!res.ok || !json.result) throw new Error(json.error ?? 'Export fehlgeschlagen')
        if (json.label) label = json.label
        results.push(json.result)
      } catch {
        results.push({ name: e.name, status: 'übersprungen', grund: 'Fehler — bitte Knopf erneut drücken' })
      }
    }
    results.sort((a, b) => a.name.localeCompare(b.name))
    const failed = results.filter(r => r.grund && r.grund.startsWith('Fehler'))
    if (failed.length > 0) {
      setError(`${failed.length} Export(e) fehlgeschlagen (${failed.map(f => f.name.split(' ')[0]).join(', ')}). Knopf erneut drücken — bereits exportierte Dateien werden dabei einfach ersetzt.`)
    }
    setExportResult({ label, results })
    setExportProgress('')
    setExporting(false)
  }

  const openEdit = (emp: KontrollEmployee, day: KontrollDay) => {
    setEdit({
      emp: emp.name,
      date: day.date,
      spans: day.spans.map(sp => ({ ...sp, newIn: sp.inHHMM, newOut: sp.outHHMM })),
      note: day.note ?? '',
      origNote: day.note ?? '',
    })
  }

  /** Delete one stamped block (soft-delete via the attendance API, which
   *  logs the change and refreshes all Zeiterfassung views). */
  const deleteSpan = (i: number) => {
    if (!edit) return
    const sp = edit.spans[i]
    if (!confirm(`Diesen Eintrag (${sp.inHHMM} – ${sp.outHHMM}) wirklich löschen?\nEr verschwindet aus der Zeiterfassung (auch bei der Mitarbeiterin).`)) return
    setEditSaving(true)
    setError(null)
    startTransition(async () => {
      try {
        const ids = [sp.inId, sp.outId].filter((x): x is string => !!x)
        const res = await fetch('/api/admin/attendance', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timemoto_event_ids: ids }),
        })
        if (!res.ok) throw new Error('delete failed')
        const rest = edit.spans.filter((_, idx) => idx !== i)
        setEditedKeys(prev => ({
          ...prev,
          [`${edit.emp}||${edit.date}`]: rest.map(s => `${s.newIn} – ${s.newOut}`).join(' · ') || 'keine Zeiten',
        }))
        setEdit(prev => {
          if (!prev) return prev
          const spans = prev.spans.filter((_, idx) => idx !== i)
          return spans.length === 0 ? null : { ...prev, spans }
        })
        router.refresh()
      } catch {
        setError('Löschen fehlgeschlagen. Bitte erneut versuchen.')
      }
      setEditSaving(false)
    })
  }

  const saveEdit = () => {
    if (!edit) return
    for (const sp of edit.spans) {
      if (!/^\d{2}:\d{2}$/.test(sp.newIn) || !/^\d{2}:\d{2}$/.test(sp.newOut)) {
        setError('Bitte gültige Zeiten (HH:MM) eingeben.')
        return
      }
      if (sp.newOut <= sp.newIn) {
        setError('Ausstempeln muss nach dem Einstempeln liegen.')
        return
      }
    }
    setEditSaving(true)
    setError(null)
    startTransition(async () => {
      try {
        const requests: Promise<Response>[] = []
        for (const sp of edit.spans) {
          if (sp.inId && sp.newIn !== sp.inHHMM) {
            requests.push(fetch('/api/admin/attendance', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ timemoto_event_id: sp.inId, time_logged: buildISO(edit.date, sp.newIn) }),
            }))
          }
          if (sp.newOut !== sp.outHHMM) {
            requests.push(fetch('/api/admin/attendance', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ timemoto_event_id: sp.outId, time_logged: buildISO(edit.date, sp.newOut) }),
            }))
          }
        }
        const results = await Promise.all(requests)
        if (results.some(r => !r.ok)) throw new Error('save failed')
        if (edit.note.trim() !== edit.origNote.trim()) {
          const res = await upsertZeiterfassungComment(edit.emp, edit.date, edit.note)
          if (res && 'error' in res && res.error) throw new Error('save failed')
        }
        setEditedKeys(prev => ({
          ...prev,
          [`${edit.emp}||${edit.date}`]: edit.spans.map(sp => `${sp.newIn} – ${sp.newOut}`).join(' · '),
        }))
        setEdit(null)
        router.refresh()
      } catch {
        setError('Speichern fehlgeschlagen. Bitte erneut versuchen.')
      }
      setEditSaving(false)
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Kontrolle — {monthLabel}</h1>
          <p className="page-subtitle">
            Alle Zeiterfassungen des Vormonats. Tage, deren Zeiten einer Schicht entsprechen, bekommen eine
            Korrektur-Empfehlung auf 8:30. Die Regeln dazu:{' '}
            <Link href="/admin/zeiterfassung/korrekturen/regeln" className="font-semibold text-mint-ink underline decoration-mint-mid underline-offset-2">Kontroll-Regeln</Link>
          </p>
        </div>
        <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold mt-1 ${totalFindings > 0 ? 'bg-apricot-bg text-apricot-ink' : 'bg-mint-bg text-mint-ink'}`}>
          {totalFindings > 0 ? `${totalFindings} Empfehlung${totalFindings !== 1 ? 'en' : ''}` : 'Keine Auffälligkeiten'}
        </span>
      </div>

      {error && (
        <div className="p-3 bg-blush-bg border border-blush-ink/30 rounded-ctl text-sm text-blush-ink">⚠ {error}</div>
      )}

      <div className="flex items-center gap-5 flex-wrap">
        <select
          value={empFilter}
          onChange={e => setEmpFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-edge-ctl rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk"
        >
          <option value="">Alle Mitarbeitenden</option>
          {employees.map(e => (
            <option key={e.name} value={e.name}>{e.name}</option>
          ))}
        </select>
        <label className="inline-flex items-center gap-2 text-xs text-ink-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={nurEmpfehlungen}
            onChange={e => setNurEmpfehlungen(e.target.checked)}
            className="rounded border-edge-ctl"
          />
          Nur Tage mit Empfehlung anzeigen
        </label>
      </div>

      {employees.length === 0 && (
        <div className="card p-12 text-center">
          <p className="text-sm text-ink-4">Keine Zeiterfassungen im Vormonat gefunden.</p>
        </div>
      )}

      {employees.filter(emp => !empFilter || emp.name === empFilter).map(emp => {
        const days = nurEmpfehlungen
          ? emp.days.filter(d => d.empfehlung || d.korrigiert || doneKeys[`${emp.name}||${d.date}`])
          : emp.days
        if (days.length === 0) return null
        return (
          <div key={emp.name} className="card overflow-hidden">
            <div className="px-5 py-3 bg-surface border-b border-edge-soft flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-ink">{emp.name}</p>
              {emp.findings > 0 ? (
                <span className="inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-apricot-bg text-apricot-ink">
                  {emp.findings} Empfehlung{emp.findings !== 1 ? 'en' : ''}
                </span>
              ) : (
                <span className="text-[11px] text-ink-4">alles unauffällig</span>
              )}
            </div>
            <ul className="divide-y divide-edge-row">
              {days.map(day => {
                const key = `${emp.name}||${day.date}`
                const done = doneKeys[key]
                return (
                  <li key={day.date} className={`px-5 py-2.5 ${day.empfehlung && !done ? 'bg-apricot-bg/30' : ''}`}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-[12.5px] font-semibold text-ink w-[72px] tnum flex-shrink-0">{fmtDate(day.date)}</span>
                      <span className="text-[12.5px] text-ink-2 tnum">{editedKeys[key] ?? day.zeiten}</span>
                      <span className="text-[12.5px] font-bold text-ink tnum">{done ? '8:30 h' : editedKeys[key] ? '' : fmtH(day.totalMin)}</span>
                      {(() => { const p = planChip(day.plan); return (
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-bold whitespace-nowrap tnum ${p.cls}`}>{p.text}</span>
                      ) })()}
                      {day.pausen > 0 && <span className="text-[10.5px] text-ink-4">{day.pausen} Pause{day.pausen !== 1 ? 'n' : ''}</span>}
                      {day.incomplete && <span className="text-[10.5px] font-semibold text-blush-ink">unvollständig gestempelt</span>}

                      <span className="ml-auto flex items-center gap-2">
                        {done || day.korrigiert ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-mint-bg text-mint-ink whitespace-nowrap">
                            ✓ Korrigiert{done ? ` (${done})` : ''}
                          </span>
                        ) : day.empfehlung ? (
                          <>
                            <span className="inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-apricot-bg text-apricot-ink whitespace-nowrap">
                              Empfehlung: {day.empfehlung.shiftName}
                            </span>
                            <button
                              onClick={() => accept(emp, day)}
                              disabled={busyKey === key}
                              className="btn-primary !px-3 !py-1 !text-[11px] whitespace-nowrap disabled:opacity-50"
                            >{busyKey === key ? 'Speichert…' : 'Übernehmen (8:30)'}</button>
                          </>
                        ) : null}
                        {editedKeys[key] && !done && (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-mint-bg text-mint-ink whitespace-nowrap">
                            ✓ Angepasst
                          </span>
                        )}
                        {day.spans.length > 0 && (
                          <button
                            onClick={() => openEdit(emp, day)}
                            className="w-7 h-7 rounded-lg hover:bg-edge-row text-ink-4 hover:text-ink-2 flex items-center justify-center flex-shrink-0"
                            title="Zeiten von Hand anpassen (Schicht nicht erkannt / Sonderfall)"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                            </svg>
                          </button>
                        )}
                      </span>
                    </div>
                    {(day.note || done) && (
                      <p className="text-[11px] text-ink-4 mt-1 pl-[84px]">
                        {done
                          ? `Notiz: ${day.note ? `${day.note} · ` : ''}${done}`
                          : `Notiz: ${day.note}`}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}

      {/* ── Control done: bulk export into the employee folders ── */}
      {exportFrom && exportTo && (exportEmployees?.length ?? 0) > 0 && (
        <div className="card px-6 py-5 space-y-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-bold text-ink">Kontrolle abgeschlossen</p>
              <p className="text-xs text-ink-3 mt-0.5 max-w-[64ch]">
                Exportiert die Zeiterfassung für {monthLabel} als PDF in den Dokumente-Ordner
                jeder Mitarbeiterin. Jede Datei wird über das Profil der Person zugeordnet und
                landet garantiert im richtigen Ordner; ein früherer Export für diesen Monat wird ersetzt.
              </p>
            </div>
            <button
              onClick={exportAll}
              disabled={exporting}
              className="btn-primary whitespace-nowrap disabled:opacity-50"
            >{exporting ? (exportProgress || 'Exportiert…') : 'Zeiterfassungen in Mitarbeiter-Ordner exportieren'}</button>
          </div>
          {exportResult && (
            <div className="border-t border-edge-soft pt-3">
              <p className="text-xs font-semibold text-mint-ink mb-2">
                ✓ «{exportResult.label}» exportiert ({exportResult.results.filter(r => r.status === 'exportiert').length} Mitarbeitende)
              </p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                {exportResult.results.map(r => (
                  <li key={r.name} className="text-[11.5px] flex items-center gap-1.5">
                    {r.status === 'exportiert'
                      ? <span className="text-mint-ink font-bold">✓</span>
                      : <span className="text-ink-4">–</span>}
                    <span className="text-ink-2">{r.name}</span>
                    {r.grund && <span className="text-ink-4">({r.grund})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-ink-4 leading-relaxed max-w-[72ch]">
        Der «Plan»-Chip zeigt den Arbeitsplan-Eintrag des Tages (immer aktuell, inklusive aller
        Änderungen von Admin und Leitenden) — so lässt sich die Empfehlung direkt mit der geplanten
        Schicht vergleichen. Ein Tag wird markiert, sobald EINE Bedingung einer Regel zutrifft (Start
        im Fenster, Ende im Fenster oder Dauer im Bereich). Mit «Übernehmen» wird die letzte Ausstempel-Zeit des Tages so
        gesetzt, dass insgesamt genau 8:30 gestempelt sind, und der Grund steht als Tagesnotiz in der
        Zeiterfassung. Bereits kontrollierte Tage bleiben mit «✓ Korrigiert» in der Liste. Über das
        Stift-Symbol lassen sich die Zeiten eines Tages auch von Hand anpassen, wenn keine Schicht
        erkannt wurde.
      </p>

      {/* ── Manual edit dialog (shift not recognized / special case) ── */}
      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/30" onClick={() => !editSaving && setEdit(null)} />
          <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-edge-soft bg-surface">
              <h3 className="text-sm font-bold text-ink">Zeiten anpassen</h3>
              <p className="text-xs text-ink-4 mt-0.5">{edit.emp} · {fmtDate(edit.date)}</p>
            </div>
            <div className="px-6 py-4 space-y-3">
              {edit.spans.map((sp, i) => (
                <div key={sp.outId} className="flex items-center gap-2">
                  {edit.spans.length > 1 && <span className="text-[11px] text-ink-4 w-5">{i + 1}.</span>}
                  <div className="flex-1">
                    <p className="field-label">Einstempeln</p>
                    <input
                      type="time"
                      value={sp.newIn}
                      disabled={!sp.inId}
                      onChange={e => setEdit(prev => prev && ({ ...prev, spans: prev.spans.map((s, idx) => idx === i ? { ...s, newIn: e.target.value } : s) }))}
                      className="w-full px-2.5 py-2 text-sm tnum border border-edge-ctl rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk disabled:opacity-50"
                    />
                  </div>
                  <div className="flex-1">
                    <p className="field-label">Ausstempeln</p>
                    <input
                      type="time"
                      value={sp.newOut}
                      onChange={e => setEdit(prev => prev && ({ ...prev, spans: prev.spans.map((s, idx) => idx === i ? { ...s, newOut: e.target.value } : s) }))}
                      className="w-full px-2.5 py-2 text-sm tnum border border-edge-ctl rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk"
                    />
                  </div>
                  <button
                    onClick={() => deleteSpan(i)}
                    disabled={editSaving}
                    className="w-8 h-8 mt-5 rounded-lg border border-edge-ctl bg-white text-ink-4 hover:text-red-500 hover:bg-edge-row flex items-center justify-center flex-shrink-0"
                    title="Diesen Eintrag löschen"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              <div>
                <p className="field-label">Tagesnotiz (Grund der Anpassung)</p>
                <input
                  type="text"
                  value={edit.note}
                  onChange={e => setEdit(prev => prev && ({ ...prev, note: e.target.value }))}
                  placeholder="z.B. Sondereinsatz, Stempeluhr defekt …"
                  className="w-full px-2.5 py-2 text-sm border border-edge-ctl rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk placeholder:text-ink-5"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={() => setEdit(null)} disabled={editSaving} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={saveEdit} disabled={editSaving} className="btn-primary flex-1">
                {editSaving ? 'Speichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
