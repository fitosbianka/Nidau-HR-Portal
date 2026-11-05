'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveKontoMonthOverride, saveKontoBemerkungen, clearKontoMonthOverride, saveKontoFerienStart, clearKontoFerienStart } from '@/actions/konto'
import { openFileWindow, downloadBlob } from '@/lib/client-files'
import FerienPruefungKarte from '@/components/admin/FerienPruefungKarte'
import type { FerienPruefungPerson } from '@/lib/ferien-pensumwoche'

export type KontoMonth = {
  label: string
  empty?: boolean
  live?: boolean
  /** true = laufender Monat: Zwischenstand bis gestern (nur Admin-Ansicht),
   *  nicht editierbar und nicht in den offiziellen PDF-/CSV-Exporten */
  laufend?: boolean
  /** Stichtag des Zwischenstands, z. B. "20.09." */
  stand?: string
  month?: number
  editable?: boolean
  sollMin?: number | null
  istMin?: number | null
  saldoVorMin?: number | null
  kontoMin?: number | null
  ferien?: number | null
  restFerien?: number | null
  krank?: number | null
  unfall?: number | null
  /** true = mindestens ein Wert dieses Monats wurde manuell korrigiert */
  manuell?: boolean
  /** Gespeicherte manuelle Korrektur (Rohwerte; null/fehlend = Feld rechnet
   *  automatisch) — der Dialog fixiert beim Speichern nur geänderte Felder */
  ov?: { istMin?: number | null; ferien?: number | null; krank?: number | null; unfall?: number | null }
  /** Ferientage, die per Vereinbarung NICHT als Ferienbezug zählen, sondern
   *  als Minusstunden im Zeitkonto fehlen (siehe FERIEN_ALS_MINUSSTUNDEN) */
  ferienMinus?: { tage: number; min: number; grund: string }
  /** Herleitung des Solls: Werktage (Mo–Fr ohne Feiertage) × 8:30 × Pensum */
  sollBasis?: { werktage: number; pensum: number; von: string; bis: string }
  /** Herleitung des Ists: gestempelte Zeit + Gutschriften je Absenzart */
  istBasis?: { gestempelt: number; gutschrift: number; teile: string[]; manuell: boolean }
  /** Noch gespeicherte, aber nicht mehr angewendete manuelle Ist-Korrektur (Minuten) */
  istKorrekturIgnoriert?: number
}

export type KontoEmployee = {
  id: string
  name: string
  funktion: string
  pensumLabel: string
  /** Warnungen zur Rechenbasis (fehlendes Pensum/Eintrittsdatum im Profil …) — nur Admin-Ansicht */
  hinweise?: string[]
  bemerkungen: string | null
  /** Ferien-Startguthaben zu Beginn der automatisch berechneten Monate
   *  (manueller Wert, sonst Excel-Import, sonst null bei Neueintritten) */
  ferienStart: number | null
  ferienStartManuell: boolean
  months: KontoMonth[]
}

const MON_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

function parseHM(s: string): number | null {
  const m = s.trim().match(/^(\d{1,3}):([0-5]\d)$/)
  if (!m) return null
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

function fmtMin(min: number | null | undefined): string {
  if (min == null) return '–'
  const s = min < 0 ? '−' : ''
  const a = Math.abs(min)
  return `${s}${Math.floor(a / 60)}:${String(Math.round(a % 60)).padStart(2, '0')}`
}
function fmtSigned(min: number | null | undefined): string {
  if (min == null) return '–'
  return `${min >= 0 ? '+' : '−'}${fmtMin(Math.abs(min))} h`
}
function fmtDays(d: number | null | undefined): string {
  if (d == null) return '–'
  return Number.isInteger(d) ? String(d) : d.toFixed(2).replace(/0$/, '')
}
function initials(name: string) {
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

const COLS = ['Monat', 'Soll-Std.', 'Ist-Std.', 'Saldo Vormonat', 'Zeitkonto', 'Ferien (Tage)', 'Bleibende Ferien', 'Krankheitstage', 'Unfalltage']
const COL_TITLES: Record<string, string> = {
  'Soll-Std.': 'Werktage des Monats (Mo–Fr ohne Feiertage, ab Eintritt, laufender Monat bis gestern) × 8:30 × Pensum — die Herleitung steht beim Überfahren der Zahl',
  'Ist-Std.': 'Gestempelte Zeit plus Gutschriften (Ferien, Krank, Unfall, Teamevent, ÜK, Bezahlt frei, Weiterbildung) — die Zusammensetzung steht beim Überfahren der Zahl',
}
const fmtKurz = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`
function sollTitel(m: KontoMonth): string | undefined {
  const b = m.sollBasis
  if (!b) return undefined
  return `${b.werktage} Werktag${b.werktage !== 1 ? 'e' : ''} (${fmtKurz(b.von)} – ${fmtKurz(b.bis)}, Mo–Fr ohne Feiertage) × 8:30 × ${Math.round(b.pensum * 100)} % = ${fmtMin(m.sollMin)}`
}
function istTitel(m: KontoMonth): string | undefined {
  const b = m.istBasis
  if (!b) return undefined
  const teile = b.teile.length > 0 ? ` — ${b.teile.join(', ')}` : ''
  const basis = `Gestempelt ${fmtMin(b.gestempelt)}${b.gutschrift > 0 ? ` + Gutschriften ${fmtMin(b.gutschrift)}` : ''}${teile}`
  return b.manuell ? `${basis} · manuell korrigiert auf ${fmtMin(m.istMin)}` : basis
}
const GRID = 'grid grid-cols-[1.1fr_.8fr_.8fr_.95fr_.85fr_.75fr_.95fr_.95fr_.8fr] gap-x-2.5'

/** Derived key figures for one employee (last filled month etc.) */
function keyFigures(emp: KontoEmployee) {
  let lastKonto: number | null = null
  let lastRest: number | null = null
  let lastLabel: string | null = null
  let lastLaufend = false
  let lastStand: string | null = null
  // Zeitkonto-Saldo per Ende des letzten ABGESCHLOSSENEN Monats (ohne den
  // laufenden Zwischenstand) — der «Saldo Vormonat» auf den Personenkacheln
  let vormonatKonto: number | null = null
  let vormonatIdx = -1
  let firstIdx = -1, lastIdx = -1
  let krankSum = 0
  let unfallSum = 0
  emp.months.forEach((m, i) => {
    if (m.empty) return
    if (firstIdx === -1) firstIdx = i
    lastIdx = i
    if (m.kontoMin != null) lastKonto = m.kontoMin
    if (m.kontoMin != null && !m.laufend) { vormonatKonto = m.kontoMin; vormonatIdx = i }
    if (m.restFerien != null) lastRest = m.restFerien
    lastLabel = m.label
    lastLaufend = !!m.laufend
    lastStand = m.stand ?? null
    krankSum += m.krank ?? 0
    unfallSum += m.unfall ?? 0
  })
  return { lastKonto, lastRest, lastLabel, lastLaufend, lastStand, vormonatKonto, vormonatIdx, firstIdx, lastIdx, krankSum: Math.round(krankSum * 100) / 100, unfallSum: Math.round(unfallSum * 100) / 100 }
}

export default function KontoClient({ employees, year, readOnly = false, hideHeader = false, pruefung, pruefZeitraum }: { employees: KontoEmployee[]; year: number; readOnly?: boolean; hideHeader?: boolean; /** Prüfung Ferientage Teilzeit (nur Admin-Seite) */ pruefung?: FerienPruefungPerson[]; pruefZeitraum?: { von: string; bis: string } }) {
  const router = useRouter()
  const [selected, setSelected] = useState(0)
  const [savingFor, setSavingFor] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkProgress, setBulkProgress] = useState('')

  // Month-correction modal state
  const [editTarget, setEditTarget] = useState<{
    empId: string; empName: string; month: number; label: string; manuell: boolean; laufend: boolean; live: boolean
    /** Angezeigte Werte beim Öffnen — nur davon abweichende Eingaben werden fixiert */
    orig: { istMin: number | null; ferien: number | null; krank: number | null; unfall: number | null }
    /** Bereits gespeicherte Korrektur (bleibt für unveränderte Felder erhalten) */
    ov: { istMin?: number | null; ferien?: number | null; krank?: number | null; unfall?: number | null }
  } | null>(null)
  const [editVals, setEditVals] = useState({ ist: '', ferien: '', krank: '', unfall: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Bemerkungen modal state
  const [bemTarget, setBemTarget] = useState<{ empId: string; empName: string } | null>(null)
  const [bemText, setBemText] = useState('')
  const [bemSaving, setBemSaving] = useState(false)

  // Ferien-Startguthaben modal state
  const [startTarget, setStartTarget] = useState<{ empId: string; empName: string; manuell: boolean } | null>(null)
  const [startVal, setStartVal] = useState('')
  const [startSaving, setStartSaving] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const emp = employees[Math.min(selected, employees.length - 1)]
  const fig = emp ? keyFigures(emp) : null

  const openMonthEdit = (e: KontoEmployee, m: KontoMonth) => {
    setEditTarget({
      empId: e.id, empName: e.name, month: m.month!, label: m.label, manuell: !!m.manuell || m.istKorrekturIgnoriert != null, laufend: !!m.laufend, live: !!m.live,
      orig: { istMin: m.istMin ?? null, ferien: m.ferien ?? null, krank: m.krank ?? null, unfall: m.unfall ?? null },
      ov: m.ov ?? {},
    })
    setEditVals({
      ist:    m.istMin != null ? fmtMin(m.istMin).replace('−', '-') : '',
      ferien: m.ferien != null ? String(m.ferien) : '0',
      krank:  m.krank  != null ? String(m.krank)  : '0',
      unfall: m.unfall != null ? String(m.unfall) : '0',
    })
    setEditError(null)
  }

  const saveMonthEdit = async () => {
    if (!editTarget) return
    // Live-Monate: Ist kommt aus der Zeiterfassung und wird nicht fixiert
    const istMin = editTarget.live ? (editTarget.orig.istMin ?? 0) : parseHM(editVals.ist)
    if (istMin == null) { setEditError('Ist-Stunden bitte im Format Stunden:Minuten angeben, z. B. 135:01') ; return }
    const ferien = parseFloat(editVals.ferien.replace(',', '.'))
    const krank  = parseFloat(editVals.krank.replace(',', '.'))
    const unfall = parseFloat(editVals.unfall.replace(',', '.'))
    if (isNaN(ferien) || isNaN(krank) || isNaN(unfall) || ferien < 0 || krank < 0 || unfall < 0) { setEditError('Ferien, Krankheits- und Unfalltage müssen Zahlen sein'); return }
    // Nur GEÄNDERTE Felder werden fixiert; unveränderte behalten ihre
    // bestehende Korrektur oder bleiben automatisch (wichtig im laufenden
    // Monat: sonst würde ein Speichern die restlichen Tage einfrieren).
    const t = editTarget
    const vals = {
      istMin: t.live ? null : (istMin !== t.orig.istMin ? istMin : (t.ov.istMin ?? null)),
      ferien: ferien !== t.orig.ferien ? ferien : (t.ov.ferien ?? null),
      krank:  krank  !== t.orig.krank  ? krank  : (t.ov.krank  ?? null),
      unfall: unfall !== t.orig.unfall ? unfall : (t.ov.unfall ?? null),
    }
    const alleAuto = vals.istMin == null && vals.ferien == null && vals.krank == null && vals.unfall == null
    setEditSaving(true)
    setEditError(null)
    try {
      if (alleAuto) {
        // Nichts (mehr) fixiert — eine allfällige alte Korrektur entfernen
        if (t.manuell) {
          const res = await clearKontoMonthOverride(t.empId, year, t.month)
          if (res && 'error' in res && res.error) throw new Error(res.error)
        }
      } else {
        const res = await saveKontoMonthOverride(t.empId, year, t.month, vals)
        if (res && 'error' in res && res.error) throw new Error(res.error)
      }
      setEditTarget(null)
      router.refresh()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Fehler beim Speichern')
    } finally {
      setEditSaving(false)
    }
  }

  const resetMonthEdit = async () => {
    if (!editTarget) return
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await clearKontoMonthOverride(editTarget.empId, year, editTarget.month)
      if (res && 'error' in res && res.error) throw new Error(res.error)
      setEditTarget(null)
      router.refresh()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Fehler beim Zurücksetzen')
    } finally {
      setEditSaving(false)
    }
  }

  const saveFerienStart = async () => {
    if (!startTarget) return
    const tage = parseFloat(startVal.replace(',', '.'))
    if (isNaN(tage)) { setStartError('Bitte eine Zahl eingeben, z. B. 12.5'); return }
    setStartSaving(true)
    setStartError(null)
    try {
      const res = await saveKontoFerienStart(startTarget.empId, year, tage)
      if (res && 'error' in res && res.error) throw new Error(res.error)
      setStartTarget(null)
      router.refresh()
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Fehler beim Speichern')
    } finally {
      setStartSaving(false)
    }
  }

  const resetFerienStart = async () => {
    if (!startTarget) return
    setStartSaving(true)
    setStartError(null)
    try {
      const res = await clearKontoFerienStart(startTarget.empId, year)
      if (res && 'error' in res && res.error) throw new Error(res.error)
      setStartTarget(null)
      router.refresh()
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Fehler beim Zurücksetzen')
    } finally {
      setStartSaving(false)
    }
  }

  const saveBem = async () => {
    if (!bemTarget) return
    setBemSaving(true)
    try {
      await saveKontoBemerkungen(bemTarget.empId, year, bemText)
      setBemTarget(null)
      router.refresh()
    } finally {
      setBemSaving(false)
    }
  }

  const kontoPayload = (e: KontoEmployee) => ({
    employeeId:   e.id,
    employeeName: e.name,
    funktion:     e.funktion,
    pensumLabel:  e.pensumLabel,
    year,
    bemerkungen:  e.bemerkungen,
    // Der laufende Monat ist nur ein Zwischenstand — die offiziellen Exporte
    // enthalten ausschliesslich abgeschlossene Monate.
    rows: e.months.map(m => {
      const leer = m.empty || m.laufend
      return {
        label:      m.label,
        soll:       leer ? '' : fmtMin(m.sollMin).replace('−', '-'),
        ist:        leer ? '' : fmtMin(m.istMin).replace('−', '-'),
        saldoVor:   leer ? '' : fmtMin(m.saldoVorMin).replace('−', '-'),
        konto:      leer ? '' : fmtMin(m.kontoMin).replace('−', '-'),
        ferien:     leer ? '' : fmtDays(m.ferien),
        restFerien: leer ? '' : fmtDays(m.restFerien),
        krank:      leer ? '' : fmtDays(m.krank),
        unfall:     leer ? '' : fmtDays(m.unfall),
      }
    }),
  })

  const saveToDokumente = async (e: KontoEmployee, replace = false) => {
    setSavingFor(e.name)
    setSaveStatus(null)
    try {
      const res = await fetch('/api/admin/zeiterfassung/save-konto-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(replace ? { ...kontoPayload(e), replace: true } : kontoPayload(e)),
      })
      const json = await res.json()
      // Already exported for this year → ask, then replace the old file
      if (res.status === 409 && json.duplicate) {
        setSavingFor(null)
        if (confirm(`Für ${e.name} wurde «${json.label}» bereits in die Dokumente exportiert.\nSoll das bestehende Dokument ersetzt werden?`)) {
          await saveToDokumente(e, true)
        }
        return
      }
      if (!res.ok) throw new Error(json.error ?? 'Unbekannter Fehler')
      setSaveStatus({ type: 'success', message: `Gespeichert: ${json.label}` })
    } catch (err) {
      setSaveStatus({ type: 'error', message: err instanceof Error ? err.message : 'Fehler beim Speichern' })
    } finally {
      setSavingFor(null)
    }
  }

  /** Export EVERY employee's Konto into their own Dokumente folder — each
   *  request carries that employee's profile id, so the file always lands in
   *  the right folder; an earlier export for the year is replaced. */
  const saveAllToDokumente = async () => {
    if (!confirm(`Alle Arbeitszeit- und Ferienkonten ${year} als PDF in die Dokumente-Ordner der Mitarbeitenden exportieren?\nBereits exportierte Konten für ${year} werden ersetzt.`)) return
    setBulkSaving(true)
    setSaveStatus(null)
    let ok = 0
    const failed: string[] = []
    for (let i = 0; i < employees.length; i++) {
      const e = employees[i]
      setBulkProgress(`${i + 1}/${employees.length}: ${e.name.split(' ')[0]}…`)
      try {
        const res = await fetch('/api/admin/zeiterfassung/save-konto-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...kontoPayload(e), replace: true }),
        })
        if (!res.ok) throw new Error()
        ok++
      } catch {
        failed.push(e.name)
      }
    }
    setBulkProgress('')
    setBulkSaving(false)
    setSaveStatus(failed.length === 0
      ? { type: 'success', message: `Alle ${ok} Konten ${year} in die Mitarbeiter-Ordner exportiert.` }
      : { type: 'error', message: `${ok} Konten exportiert — fehlgeschlagen: ${failed.join(', ')}. Bitte für diese erneut versuchen.` })
  }

  // Same PDF as "In Dokumente speichern"
  const fetchKontoPdfBlob = async (): Promise<Blob> => {
    const res = await fetch('/api/admin/zeiterfassung/save-konto-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...kontoPayload(emp!), download: true }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      throw new Error(json?.error ?? 'PDF-Erstellung fehlgeschlagen')
    }
    return res.blob()
  }

  /** Open in a tab (for viewing/printing). The placeholder tab is opened
   *  BEFORE the await so the phone's popup blocker cannot swallow it. */
  const printPdf = async () => {
    if (!emp) return
    const fw = openFileWindow()
    setPrinting(true)
    setSaveStatus(null)
    try {
      const url = URL.createObjectURL(await fetchKontoPdfBlob())
      fw.show(url)
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      fw.cancel()
      setSaveStatus({ type: 'error', message: err instanceof Error ? err.message : 'Fehler beim PDF-Export' })
    } finally {
      setPrinting(false)
    }
  }

  /** Save the same PDF as a file — works on desktop and mobile. */
  const downloadPdf = async () => {
    if (!emp) return
    setDownloadingPdf(true)
    setSaveStatus(null)
    try {
      downloadBlob(await fetchKontoPdfBlob(), `Ferienkonto ${year} ${emp.name}.pdf`)
    } catch (err) {
      setSaveStatus({ type: 'error', message: err instanceof Error ? err.message : 'Fehler beim PDF-Export' })
    } finally {
      setDownloadingPdf(false)
    }
  }

  const downloadCsv = () => {
    if (!emp) return
    const lines = [COLS.join(';')]
    for (const m of emp.months) {
      lines.push(m.empty || m.laufend
        ? [m.label, '', '', '', '', '', '', '', ''].join(';')
        : [m.label,
           fmtMin(m.sollMin).replace('−', '-'), fmtMin(m.istMin).replace('−', '-'),
           fmtMin(m.saldoVorMin).replace('−', '-'), fmtMin(m.kontoMin).replace('−', '-'),
           fmtDays(m.ferien), fmtDays(m.restFerien), fmtDays(m.krank), fmtDays(m.unfall)].join(';'))
    }
    if (emp.bemerkungen) lines.push('', `Bemerkungen;${emp.bemerkungen.replace(/\r?\n/g, ' ')}`)
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `Arbeitszeit_Ferienkonto_${year}_${emp.name.replace(/[^A-Za-zÄÖÜäöü0-9]/g, '_')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (!emp || !fig) return null

  return (
    <>
      <style>{`
        @media print {
          @page { margin: 1.2cm 1.2cm; size: A4 landscape; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .no-print { display: none !important; }
          body { background: white !important; }
          .print-section { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div>
        {/* ── Header ── */}
        <div className="flex flex-wrap items-start justify-between gap-4 no-print">
          {!hideHeader ? (
            <div>
              <h1 className="page-title">Arbeitszeit- und Ferienkonto</h1>
              <p className="page-subtitle">Jahresübersicht der Arbeitszeit- und Ferienkonten aller Mitarbeitenden</p>
            </div>
          ) : <div />}
          <div className="flex items-center gap-2.5 flex-wrap justify-end">
            <button onClick={downloadCsv} className="btn-secondary">↓ CSV</button>
            <button onClick={downloadPdf} disabled={downloadingPdf || printing} className="btn-secondary">
              {downloadingPdf ? 'PDF wird erstellt…' : '↓ PDF herunterladen'}
            </button>
            <button onClick={printPdf} disabled={printing || downloadingPdf} className="btn-primary">
              {printing ? 'PDF wird erstellt…' : '⎙ PDF öffnen'}
            </button>
            {!readOnly && employees.length > 1 && (
              <button onClick={saveAllToDokumente} disabled={bulkSaving} className="btn-secondary disabled:opacity-50">
                {bulkSaving ? (bulkProgress || 'Exportiert…') : '↓ Alle Konten in Mitarbeiter-Ordner'}
              </button>
            )}
          </div>
        </div>

        {pruefung && pruefZeitraum && !readOnly && <FerienPruefungKarte liste={pruefung} von={pruefZeitraum.von} bis={pruefZeitraum.bis} />}

        {saveStatus && (
          <p className={`no-print mt-3 text-xs px-3 py-1.5 rounded-ctl inline-block ${saveStatus.type === 'success' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>
            {saveStatus.type === 'success' ? '✓ ' : '⚠ '}{saveStatus.message}
          </p>
        )}

        {/* ── Employee cards (selector — pointless with a single employee) ── */}
        {employees.length > 1 && (<>
        <div className="eyebrow mt-[26px] mb-2.5 no-print">{year} — ZEITSALDO VORMONAT</div>
        {/* Alle Personen auf einen Blick: eine Zeile pro Person mit dem
            Zeitkonto-Saldo per Ende des letzten abgeschlossenen Monats */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2 no-print">
          {employees.map((e, i) => {
            const f = keyFigures(e)
            const sel = i === selected
            const saldoNeg = (f.vormonatKonto ?? 0) < 0
            const vormonat = f.vormonatIdx >= 0 ? e.months[f.vormonatIdx].label : null
            return (
              <button
                key={e.id}
                onClick={() => setSelected(i)}
                aria-pressed={sel}
                title={vormonat ? `${e.name}: Zeitkonto-Saldo per Ende ${vormonat}` : `${e.name}: noch kein abgeschlossener Monat`}
                className={`min-w-0 rounded-tile border px-3 py-2 text-left transition-colors flex items-center gap-2.5 ${
                  sel ? 'bg-active border-edge-strong' : 'bg-white border-edge hover:border-edge-strong'
                }`}
              >
                <div className="avatar w-7 h-7 text-[10px] flex-shrink-0">{initials(e.name)}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold truncate">{e.name}</div>
                  <div className="text-[9.5px] text-ink-4 leading-none mt-0.5 truncate">
                    {f.vormonatIdx >= 0 ? `Ende ${MON_SHORT[f.vormonatIdx]}` : 'kein Abschluss'}
                  </div>
                </div>
                <div className={`text-[13px] font-bold tnum whitespace-nowrap ${saldoNeg ? 'text-[#A0524E]' : 'text-ink'}`}>
                  {fmtSigned(f.vormonatKonto)}
                </div>
              </button>
            )
          })}
        </div>
        </>)}

        {/* ── Detail card ── */}
        <div className="card mt-[22px] overflow-hidden print-section">

          {/* Header strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-[18px] bg-surface border-b border-edge-soft">
            <div className="flex items-center gap-3">
              <div className="avatar w-10 h-10 text-sm print:hidden">{initials(emp.name)}</div>
              <div>
                <div className="text-[15px] font-bold">{emp.name}</div>
                <div className="text-xs text-ink-3">{emp.funktion} · Pensum {emp.pensumLabel}</div>
                {!readOnly && (emp.hinweise ?? []).map(h => (
                  <div key={h} className="mt-1 text-[10.5px] text-apricot-ink bg-apricot-bg rounded px-1.5 py-0.5 max-w-[64ch]">⚠ {h}</div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 no-print">
              {!readOnly && (<>
              <button
                onClick={() => {
                  setStartTarget({ empId: emp.id, empName: emp.name, manuell: emp.ferienStartManuell })
                  setStartVal(emp.ferienStart != null ? String(emp.ferienStart) : '')
                  setStartError(null)
                }}
                className="btn-secondary !px-3 !py-1.5 !text-xs" title="Ferien-Startguthaben bearbeiten"
              >✎ Ferien-Start</button>
              <button
                onClick={() => { setBemTarget({ empId: emp.id, empName: emp.name }); setBemText(emp.bemerkungen ?? '') }}
                className="btn-secondary !px-3 !py-1.5 !text-xs" title="Bemerkungen bearbeiten"
              >✎ Bemerkungen</button>
              <button
                onClick={() => saveToDokumente(emp)} disabled={savingFor === emp.name}
                className="btn-secondary !px-3 !py-1.5 !text-xs"
              >{savingFor === emp.name ? 'Speichert…' : '↓ In Dokumente speichern'}</button>
              </>)}
              <div className="flex items-center gap-2 ml-2 text-[13px]">
                <button className="w-7 h-7 rounded-lg border border-edge-ctl bg-white text-ink-2 disabled:opacity-40 cursor-not-allowed" disabled title="Nur 2026 verfügbar">‹</button>
                <div className="font-bold tnum min-w-[44px] text-center">{year}</div>
                <button className="w-7 h-7 rounded-lg border border-edge-ctl bg-white text-ink-2 disabled:opacity-40 cursor-not-allowed" disabled title="Nur 2026 verfügbar">›</button>
              </div>
            </div>
          </div>

          {/* Stat tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 pt-5">
            <div className="bg-mint-bg rounded-tile px-[18px] py-4 text-center">
              <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-mint-mid">Zeitkonto-Saldo</div>
              <div className="text-[26px] font-bold mt-1 text-mint-ink tnum">{fmtSigned(fig.lastKonto)}</div>
              <div className="text-[10.5px] text-mint-sub mt-0.5">
                {fig.lastLabel ? (fig.lastLaufend ? `Zwischenstand ${fig.lastStand ?? ''}`.trim() : `Stand Ende ${fig.lastLabel}`) : '—'}
              </div>
            </div>
            <div className="bg-lilac-bg rounded-tile px-[18px] py-4 text-center">
              <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-lilac-label">Bleibende Ferien</div>
              <div className="text-[26px] font-bold mt-1 text-lilac-ink tnum">{fmtDays(fig.lastRest)}</div>
              <div className="text-[10.5px] text-lilac-sub mt-0.5">
                {fig.lastLaufend && fig.lastLabel ? `Tage · inkl. ${fig.lastLabel}` : 'Tage'}
              </div>
            </div>
            <div className="bg-apricot-bg rounded-tile px-[18px] py-4 text-center">
              <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-apricot-mid">Krankheitstage</div>
              <div className="text-[26px] font-bold mt-1 text-apricot-ink tnum">{fmtDays(fig.krankSum)}</div>
              <div className="text-[10.5px] text-apricot-sub mt-0.5">
                {fig.firstIdx >= 0 ? `${MON_SHORT[fig.firstIdx]} – ${MON_SHORT[fig.lastIdx]} ${year}` : String(year)}
              </div>
            </div>
            <div className="bg-[#F8E0CF] rounded-tile px-[18px] py-4 text-center">
              <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#BC8258]">Unfalltage</div>
              <div className="text-[26px] font-bold mt-1 text-[#A85E38] tnum">{fmtDays(fig.unfallSum)}</div>
              <div className="text-[10.5px] text-[#BC8258] mt-0.5">
                {fig.firstIdx >= 0 ? `${MON_SHORT[fig.firstIdx]} – ${MON_SHORT[fig.lastIdx]} ${year}` : String(year)}
              </div>
            </div>
          </div>

          {/* Month table */}
          <div className="px-6 pt-5 pb-2 overflow-x-auto">
            <div className="min-w-[720px]">
              <div className={`${GRID} px-2.5 pb-2 text-[10px] font-semibold uppercase tracking-[.1em] text-ink-4 border-b-[1.5px] border-edge-ctl`}>
                {COLS.map((c, i) => (
                  <div key={c} className={`${i === 0 ? '' : 'text-right'} ${COL_TITLES[c] ? 'cursor-help' : ''}`} title={COL_TITLES[c]}>{c}</div>
                ))}
              </div>
              {emp.months.map((m, i) => (
                <div
                  key={i}
                  className={`${GRID} group items-center p-2.5 text-[13px] tnum border-b border-edge-row hover:bg-hovrow ${m.empty ? 'text-ink-5' : ''}`}
                >
                  <div className="font-semibold flex items-center gap-1">
                    {m.label}
                    {m.laufend && (
                      <span
                        className="no-print text-[8.5px] font-semibold uppercase tracking-[.08em] text-mint-ink bg-mint-bg rounded px-1 py-px flex-shrink-0"
                        title={`Laufender Monat: Stunden bis ${m.stand ?? 'gestern'}, Ferien-/Krankheits-/Unfalltage für den ganzen Monat gemäss Arbeitsplan`}
                      >laufend</span>
                    )}
                    {m.manuell && !readOnly && (
                      <span className="no-print w-1.5 h-1.5 rounded-full bg-apricot-mid flex-shrink-0" title="Manuell korrigiert (Ferien-, Krankheits- oder Unfalltage)" />
                    )}
                    {m.istKorrekturIgnoriert != null && !readOnly && (
                      <span
                        className="no-print text-[8.5px] font-semibold uppercase tracking-[.08em] text-apricot-ink bg-apricot-bg rounded px-1 py-px flex-shrink-0 whitespace-nowrap"
                        title={`Eine alte manuelle Ist-Korrektur (${fmtMin(m.istKorrekturIgnoriert)}) ist noch gespeichert, wird aber nicht mehr verwendet — das Ist kommt aus der Zeiterfassung. Über den Stift → «Auf automatisch zurücksetzen» lässt sie sich entfernen.`}
                      >alte Ist-Korrektur</span>
                    )}
                    {m.ferienMinus && (
                      <span
                        className="text-[8.5px] font-semibold uppercase tracking-[.08em] text-[#4F6B62] bg-[#DCE5E2] rounded px-1 py-px flex-shrink-0 whitespace-nowrap"
                        title={`${m.ferienMinus.tage} Ferientag${m.ferienMinus.tage !== 1 ? 'e' : ''} ohne Ferienbezug: zählen als Minusstunden (−${fmtMin(m.ferienMinus.min)} im Zeitkonto, Restferien unverändert). ${m.ferienMinus.grund}`}
                      >{m.ferienMinus.tage} F → Minus</span>
                    )}
                    {m.editable && !readOnly && (
                      <button onClick={() => openMonthEdit(emp, m)}
                        className="no-print p-0.5 rounded text-ink-4 hover:text-ink-2 hover:bg-edge-row transition-colors"
                        title={`${m.label} korrigieren`}
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <div className={`text-right ${!m.empty && m.sollBasis ? 'cursor-help' : ''}`} title={m.empty ? undefined : sollTitel(m)}>{m.empty ? '–' : fmtMin(m.sollMin)}</div>
                  <div className={`text-right ${!m.empty && m.istBasis ? 'cursor-help' : ''}`} title={m.empty ? undefined : istTitel(m)}>{m.empty ? '–' : fmtMin(m.istMin)}</div>
                  <div className="text-right">{m.empty ? '–' : fmtMin(m.saldoVorMin)}</div>
                  <div className={`text-right font-bold ${m.empty ? '' : (m.kontoMin ?? 0) >= 0 ? 'text-mint-val' : 'text-[#A0524E]'}`}>
                    {m.empty ? '–' : fmtMin(m.kontoMin)}
                  </div>
                  <div className="text-right">{m.empty ? '–' : fmtDays(m.ferien)}</div>
                  <div className="text-right">{m.empty ? '–' : fmtDays(m.restFerien)}</div>
                  <div className="text-right">{m.empty ? '–' : fmtDays(m.krank)}</div>
                  <div className="text-right">{m.empty ? '–' : fmtDays(m.unfall)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Bemerkungen */}
          {emp.bemerkungen && (
            <div className="mx-6 mt-3.5 mb-6 bg-lilac-soft rounded-tile px-[18px] py-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-lilac-label">Bemerkungen</div>
              <div className="text-[13px] mt-1 whitespace-pre-wrap">{emp.bemerkungen}</div>
            </div>
          )}
          {!emp.bemerkungen && <div className="pb-4" />}
        </div>
      </div>

      {/* ── Month correction modal ── */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4 no-print">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">{editTarget.label} {year} korrigieren</h3>
                <p className="text-xs text-ink-4 mt-0.5">{editTarget.empName} — Saldo und Folgemonate werden automatisch neu berechnet</p>
              </div>
              <button onClick={() => setEditTarget(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4 flex-shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <p className="field-label">Ist-Stunden</p>
                <input value={editVals.ist} onChange={e => setEditVals(v => ({ ...v, ist: e.target.value }))}
                  placeholder="z. B. 135:01" className="input-field w-full disabled:opacity-60" disabled={editTarget.live} />
                {editTarget.live && (
                  <p className="text-[11px] text-ink-4 mt-1">
                    Kommt aus der Zeiterfassung (gestempelte Zeit + Gutschriften) und ist hier nicht änderbar —
                    fehlende oder falsche Stempel unter «Zeiterfassung» korrigieren, das Konto übernimmt sie sofort.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="field-label">Ferien (Tage)</p>
                  <input value={editVals.ferien} onChange={e => setEditVals(v => ({ ...v, ferien: e.target.value }))} className="input-field w-full" />
                </div>
                <div>
                  <p className="field-label">Krankheitstage</p>
                  <input value={editVals.krank} onChange={e => setEditVals(v => ({ ...v, krank: e.target.value }))} className="input-field w-full" />
                </div>
                <div>
                  <p className="field-label">Unfalltage</p>
                  <input value={editVals.unfall} onChange={e => setEditVals(v => ({ ...v, unfall: e.target.value }))} className="input-field w-full" />
                </div>
              </div>
              {editTarget.laufend && (
                <p className="text-xs px-3 py-2 rounded-ctl bg-mint-bg text-mint-ink">
                  Dieser Monat läuft noch: Nur Werte, die du hier <b>änderst</b>, werden
                  fixiert — unveränderte Felder rechnen automatisch weiter (neue Stempel
                  und Absenzen fliessen ein). «Auf automatisch zurücksetzen» hebt alle
                  Fixierungen wieder auf.
                </p>
              )}
              {editError && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink">⚠ {editError}</p>}
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2 flex-wrap">
              <button onClick={() => setEditTarget(null)} className="btn-secondary flex-1 min-w-[110px]">Abbrechen</button>
              {editTarget.manuell && (
                <button onClick={resetMonthEdit} disabled={editSaving} className="btn-secondary flex-1 min-w-[110px]"
                  title="Manuelle Korrektur entfernen — der Monat rechnet wieder automatisch aus Zeiterfassung und Arbeitsplan">
                  Auf automatisch zurücksetzen
                </button>
              )}
              <button onClick={saveMonthEdit} disabled={editSaving} className="btn-primary flex-1 min-w-[110px]">
                {editSaving ? 'Wird gespeichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Ferien-Startguthaben modal ── */}
      {startTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4 no-print">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">Ferien-Startguthaben</h3>
                <p className="text-xs text-ink-4 mt-0.5">{startTarget.empName} — Jahr {year}</p>
              </div>
              <button onClick={() => setStartTarget(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4 flex-shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <p className="field-label">Bleibende Ferien (Tage)</p>
                <input value={startVal} onChange={e => setStartVal(e.target.value)}
                  placeholder="z. B. 12.5" className="input-field w-full" />
              </div>
              <p className="text-xs text-ink-4">
                Startwert der Spalte «Bleibende Ferien» ab dem ersten automatisch
                berechneten Monat — jeder bezogene Ferientag zieht davon ab. Bei
                importierten Konten ersetzt er den Stand aus dem Excel, bei
                Neueintritten ohne Import setzt er das (anteilige) Jahresguthaben.
              </p>
              {startError && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink">⚠ {startError}</p>}
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2 flex-wrap">
              <button onClick={() => setStartTarget(null)} className="btn-secondary flex-1 min-w-[110px]">Abbrechen</button>
              {startTarget.manuell && (
                <button onClick={resetFerienStart} disabled={startSaving} className="btn-secondary flex-1 min-w-[110px]"
                  title="Manuellen Startwert entfernen — es gilt wieder der importierte Excel-Stand (bzw. leer bei Neueintritten)">
                  Auf automatisch zurücksetzen
                </button>
              )}
              <button onClick={saveFerienStart} disabled={startSaving} className="btn-primary flex-1 min-w-[110px]">
                {startSaving ? 'Wird gespeichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bemerkungen modal ── */}
      {bemTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4 no-print">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">Bemerkungen</h3>
                <p className="text-xs text-ink-4 mt-0.5">{bemTarget.empName} — Jahr {year}</p>
              </div>
              <button onClick={() => setBemTarget(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4 flex-shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4">
              <textarea value={bemText} onChange={e => setBemText(e.target.value)} rows={4}
                placeholder="z. B. 16 Überstunden für Februar ausbezahlt"
                className="input-field w-full resize-none" />
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={() => setBemTarget(null)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={saveBem} disabled={bemSaving} className="btn-primary flex-1">
                {bemSaving ? 'Wird gespeichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
