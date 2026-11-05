'use client'

import { useState, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { upsertZeiterfassungComment } from '@/actions/zeiterfassung-comments'
import { ferienWeight } from '@/lib/ferien'
import { teamEventLabel } from '@/lib/team-events'
import { ZEITERFASSUNG_PINNED_TOP } from '@/lib/attendance-exclude'
import { openFileWindow, downloadBlob } from '@/lib/client-files'
import ZeitAenderungenModal from '@/components/zeiterfassung/ZeitAenderungenModal'
import ZeitumstellungKontrolleModal from '@/components/zeiterfassung/ZeitumstellungKontrolleModal'
import PapierkorbModal from '@/components/zeiterfassung/PapierkorbModal'
import { zurichZuIso } from '@/lib/zeitzone'

// Shared report machinery (same code the server-side bulk export uses)
import {
  type AttendanceEvent, type Shift, type EmployeeReport,
  KOMP_MIN, absenceCredit, ABSENCE_LABEL_OVERRIDES,
  toZurichTime, fmtDuration, fmtHours,
  pairEvents, groupByEmployee, buildDayGroups, absencesForEmployee, buildPdfReportData,
} from '@/lib/zeiterfassung-report'
import type { AnteilKarte } from '@/lib/ferien-anteil'

export type { AttendanceEvent }

/** Leeres Formular für «Eintrag hinzufügen» — beliebig viele Pausen. */
const leererAddForm = () => ({
  name: '', date: '', ein: '', aus: '',
  pausen: [] as Array<{ pause: string; zurueck: string }>,
})

// Monday (YYYY-MM-DD) of the week a date falls in — used to separate weeks.
function weekMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

function initials(name: string): string {
  return name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
}

/** Zürcher Wandzeit als UTC ISO, mit dem echten Offset des Tages (Sommer- oder Winterzeit) */
const buildISO = (zurichDate: string, hhMM: string): string => zurichZuIso(zurichDate, hhMM)

function toZurichHHMM(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich',
  })
}

/** Always-shown employees (e.g. Laura) get a report even with no clocked
 *  times in the period (their day list still shows planned absences). Only
 *  names present in the passed profiles are added, so the personal "Meine
 *  Zeiten" view stays scoped to its one employee. The whole list — tiles
 *  strip and report cards — is ordered alphabetically. */
function pinOnTop(list: EmployeeReport[], profileNames: string[]): EmployeeReport[] {
  for (const name of ZEITERFASSUNG_PINNED_TOP) {
    if (!list.some(r => r.fullName === name) && profileNames.includes(name)) {
      list.push({ fullName: name, shifts: [], totalMinutes: 0 })
    }
  }
  return list.sort((a, b) => a.fullName.localeCompare(b.fullName))
}

// ── Period helpers ────────────────────────────────────────────────────────────

type Period = 'week' | 'lastWeek' | 'month' | 'lastMonth'

function getPeriodRange(p: Period): { from: string; to: string } {
  const nowZ  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Zurich' }))
  const today = nowZ.toLocaleDateString('en-CA')
  if (p === 'week') {
    const dow    = nowZ.getDay() === 0 ? 7 : nowZ.getDay()
    const monday = new Date(nowZ); monday.setDate(nowZ.getDate() - (dow - 1))
    return { from: monday.toLocaleDateString('en-CA'), to: today }
  }
  if (p === 'lastWeek') {
    const dow    = nowZ.getDay() === 0 ? 7 : nowZ.getDay()
    const monday = new Date(nowZ); monday.setDate(nowZ.getDate() - (dow - 1) - 7)
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
    return { from: monday.toLocaleDateString('en-CA'), to: sunday.toLocaleDateString('en-CA') }
  }
  if (p === 'month') {
    const y = nowZ.getFullYear()
    const m = String(nowZ.getMonth() + 1).padStart(2, '0')
    return { from: `${y}-${m}-01`, to: today }
  }
  const first = new Date(nowZ.getFullYear(), nowZ.getMonth() - 1, 1)
  const last  = new Date(nowZ.getFullYear(), nowZ.getMonth(), 0)
  return { from: first.toLocaleDateString('en-CA'), to: last.toLocaleDateString('en-CA') }
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'week',      label: 'Diese Woche'   },
  { key: 'lastWeek',  label: 'Letzte Woche'  },
  { key: 'month',     label: 'Dieser Monat'  },
  { key: 'lastMonth', label: 'Letzter Monat' },
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function BerichteClient({ events, initialComments = {}, planAbsences = {}, profiles = [], anteile, readOnly = false, title = 'Zeiterfassung', subtitle = 'Zeiterfassungsberichte der Mitarbeitenden' }: { events: AttendanceEvent[]; initialComments?: Record<string, string>; planAbsences?: Record<string, string>; profiles?: Array<{ id: string; full_name: string }>; /** Ferienanteil pro Wochentag (glattes F zählt den Anteil des Tags) */ anteile?: AnteilKarte; readOnly?: boolean; title?: string; subtitle?: string }) {
  const router = useRouter()

  // absences (KO/F) for one employee (planAbsences is keyed by first name)
  const absencesFor = useCallback((fullName: string): Record<string, string> =>
    absencesForEmployee(planAbsences, fullName), [planAbsences])

  // Filter state — the page opens on the CURRENT month by default; clearing
  // the dates (or picking another period) shows more.
  const initialRange = getPeriodRange('month')
  const [dateFrom,     setDateFrom]     = useState(initialRange.from)
  const [dateTo,       setDateTo]       = useState(initialRange.to)
  const [activePeriod, setActivePeriod] = useState<Period | null>('month')
  const [empFilter,    setEmpFilter]    = useState('')

  // Clicking a tile in the monthly strip filters to that employee and jumps
  // to their report; clicking the selected tile again clears the filter.
  const reportsRef = useRef<HTMLDivElement>(null)
  const selectFromStrip = useCallback((name: string) => {
    if (empFilter === name) {
      setEmpFilter('')
      return
    }
    setEmpFilter(name)
    setTimeout(() => reportsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }, [empFilter])

  // Edit state
  const [editingPairId,  setEditingPairId]  = useState<string | null>(null)
  const [editTimes,      setEditTimes]      = useState({ inHHMM: '', outHHMM: '' })
  const [editError,      setEditError]      = useState<string | null>(null)
  const [saving,         setSaving]         = useState(false)
  const [deletingPairId, setDeletingPairId] = useState<string | null>(null)

  // Save-to-documents state
  const [savingDoc,  setSavingDoc]  = useState(false)
  const [printing,   setPrinting]   = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Change-log popup (admin only)
  const [showZeitLog, setShowZeitLog] = useState(false)
  const [showZeitumstellung, setShowZeitumstellung] = useState(false)
  const [showPapierkorb, setShowPapierkorb] = useState(false)

  // Add-entry state
  const [showAdd,   setShowAdd]   = useState(false)
  const [addForm,   setAddForm]   = useState(leererAddForm())
  const [addSaving, setAddSaving] = useState(false)
  const [addError,  setAddError]  = useState<string | null>(null)

  // Per-day comments: key = `${employeeName}||${YYYY-MM-DD}` (loaded from DB, incl. TimeMoto import)
  const [comments, setComments] = useState<Record<string, string>>(initialComments)

  // Persist a comment (employeeName, YYYY-MM-DD) on blur
  const saveComment = useCallback((fullName: string, date: string, value: string) => {
    upsertZeiterfassungComment(fullName, date, value)
  }, [])

  // ── Data ───────────────────────────────────────────────────────────────────
  const allShifts = useMemo(() => pairEvents(events), [events])

  const allEmployeeNames = useMemo(() => {
    const names = new Set(allShifts.map(s => s.fullName))
    for (const name of ZEITERFASSUNG_PINNED_TOP) {
      if (profiles.some(p => p.full_name === name)) names.add(name)
    }
    return Array.from(names).sort()
  }, [allShifts, profiles])

  // Names offered in the add-entry form: canonical profile names plus any
  // attendance-only names that couldn't be mapped to a profile.
  const addNameOptions = useMemo(() => {
    const names = profiles.map(p => p.full_name)
    const firsts = new Set(names.map(n => n.split(' ')[0]))
    const extra = allEmployeeNames.filter(n => !firsts.has(n.split(' ')[0]))
    return Array.from(new Set(names.concat(extra))).sort()
  }, [allEmployeeNames, profiles])

  // Resolve an employee's profile id from their (canonical) display name
  const employeeIdFor = useCallback((fullName: string): string | null => {
    const exact = profiles.find(p => p.full_name === fullName)
    if (exact) return exact.id
    const first = fullName.split(' ')[0]
    const byFirst = profiles.filter(p => p.full_name.split(' ')[0] === first)
    return byFirst.length === 1 ? byFirst[0].id : null
  }, [profiles])

  const submitAdd = async () => {
    if (!addForm.name || !addForm.date || !addForm.ein) {
      setAddError('Mitarbeiter, Datum und Einstempeln sind erforderlich')
      return
    }
    // Beliebig viele Pausen: jede braucht Pause- UND Zurück-Zeit; sobald
    // mindestens eine Pause erfasst ist, ist auch das Ausstempeln Pflicht.
    for (const pz of addForm.pausen) {
      if (!pz.pause || !pz.zurueck) {
        setAddError('Bitte bei jeder Pause beide Zeiten angeben (Pause und Zurück).')
        return
      }
    }
    if (addForm.pausen.length > 0 && !addForm.aus) {
      setAddError('Mit einer Pause braucht es auch eine Ausstempel-Zeit.')
      return
    }
    const folge = [addForm.ein, ...addForm.pausen.flatMap(pz => [pz.pause, pz.zurueck]), ...(addForm.aus ? [addForm.aus] : [])]
    for (let i = 1; i < folge.length; i++) {
      if (folge[i] <= folge[i - 1]) {
        setAddError('Die Zeiten müssen aufsteigend sein: Einstempeln < Pause < Zurück < … < Ausstempeln.')
        return
      }
    }
    setAddSaving(true)
    setAddError(null)
    try {
      // Blöcke bauen: Einstempeln→1. Pause, Zurück→nächste Pause, …,
      // letztes Zurück→Ausstempeln (ohne Pausen ein einzelner Block)
      const teile: Array<{ in: string; out: string | null }> = []
      let start = addForm.ein
      for (const pz of addForm.pausen) {
        teile.push({ in: start, out: pz.pause })
        start = pz.zurueck
      }
      teile.push({ in: start, out: addForm.aus || null })
      for (const t of teile) {
        const res = await fetch('/api/admin/attendance', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            userFullName: addForm.name,
            clockIn:      buildISO(addForm.date, t.in),
            clockOut:     t.out ? buildISO(addForm.date, t.out) : null,
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Unbekannter Fehler')
      }
      setShowAdd(false)
      setAddForm(leererAddForm())
      router.refresh()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Fehler beim Speichern')
    } finally {
      setAddSaving(false)
    }
  }

  // Monthly stats — always current month regardless of filter
  const monthlyStats = useMemo(() => {
    const nowZ   = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Zurich' }))
    const prefix = `${nowZ.getFullYear()}-${String(nowZ.getMonth() + 1).padStart(2, '0')}`
    return pinOnTop(groupByEmployee(allShifts.filter(s => s.date.startsWith(prefix))), profiles.map(p => p.full_name))
  }, [allShifts, profiles])

  const selectPeriod = useCallback((p: Period) => {
    const { from, to } = getPeriodRange(p)
    setActivePeriod(p)
    setDateFrom(from)
    setDateTo(to)
  }, [])

  const filtered = useMemo(() =>
    allShifts.filter(s => {
      if (dateFrom && s.date < dateFrom) return false
      if (dateTo   && s.date > dateTo)   return false
      return true
    }),
    [allShifts, dateFrom, dateTo],
  )

  const reports = useMemo(() => {
    const all = pinOnTop(groupByEmployee(filtered), profiles.map(p => p.full_name))
    return empFilter ? all.filter(r => r.fullName === empFilter) : all
  }, [filtered, empFilter, profiles])

  // Locate the shift being edited (search across all shifts for robustness)
  const editShift = useMemo(() => {
    if (!editingPairId) return null
    return allShifts.find(s => s.pairId === editingPairId) ?? null
  }, [editingPairId, allShifts])

  // ── Edit handlers ──────────────────────────────────────────────────────────
  const openEdit = (shift: Shift) => {
    setEditingPairId(shift.pairId)
    setEditError(null)
    setEditTimes({
      inHHMM:  shift.clockIn  ? toZurichHHMM(shift.clockIn)  : '',
      outHHMM: shift.clockOut ? toZurichHHMM(shift.clockOut) : '',
    })
  }

  const saveEdit = async () => {
    if (!editShift) return
    if (editTimes.inHHMM && editTimes.outHHMM && editTimes.outHHMM <= editTimes.inHHMM) {
      setEditError('Ausstempeln muss nach dem Einstempeln liegen.')
      return
    }
    setSaving(true)
    setEditError(null)
    try {
      const json = { 'Content-Type': 'application/json' }
      const requests: Promise<Response>[] = []
      // vorhandene Stempel: Zeit anpassen
      if (editShift.inEventId && editTimes.inHHMM) {
        requests.push(fetch('/api/admin/attendance', {
          method: 'PATCH', headers: json,
          body: JSON.stringify({ timemoto_event_id: editShift.inEventId, time_logged: buildISO(editShift.date, editTimes.inHHMM) }),
        }))
      }
      if (editShift.outEventId && editTimes.outHHMM) {
        requests.push(fetch('/api/admin/attendance', {
          method: 'PATCH', headers: json,
          body: JSON.stringify({ timemoto_event_id: editShift.outEventId, time_logged: buildISO(editShift.date, editTimes.outHHMM) }),
        }))
      }
      // offener Eintrag («Anwesend», Ausstempeln vergessen): den fehlenden
      // Stempel zum bestehenden ergänzen — der Tag muss nicht neu erfasst werden
      if (!editShift.outEventId && editShift.inEventId && editTimes.outHHMM) {
        requests.push(fetch('/api/admin/attendance', {
          method: 'PUT', headers: json,
          body: JSON.stringify({ timemoto_event_id: editShift.inEventId, time_logged: buildISO(editShift.date, editTimes.outHHMM) }),
        }))
      }
      if (!editShift.inEventId && editShift.outEventId && editTimes.inHHMM) {
        requests.push(fetch('/api/admin/attendance', {
          method: 'PUT', headers: json,
          body: JSON.stringify({ timemoto_event_id: editShift.outEventId, time_logged: buildISO(editShift.date, editTimes.inHHMM) }),
        }))
      }
      const antworten = await Promise.all(requests)
      const fehler = antworten.find(r => !r.ok)
      if (fehler) {
        const j = await fehler.json().catch(() => null) as { error?: string } | null
        setEditError(j?.error ?? 'Speichern fehlgeschlagen — bitte nochmals versuchen.')
        return
      }
      setEditingPairId(null)
      router.refresh()
    } catch {
      setEditError('Speichern fehlgeschlagen — bitte die Seite neu laden und nochmals versuchen.')
    } finally {
      setSaving(false)
    }
  }

  // Soft-delete a shift (both In and Out events) after confirmation
  const deleteShift = async (shift: Shift) => {
    const ids = [shift.inEventId, shift.outEventId].filter((id): id is string => !!id)
    if (ids.length === 0) return
    const ok = window.confirm(
      `Diesen Eintrag wirklich löschen?\n\n${shift.fullName}\n${shift.dateDisplay} · ${toZurichTime(shift.clockIn)} – ${shift.incomplete ? 'offen' : toZurichTime(shift.clockOut)}`
    )
    if (!ok) return
    setDeletingPairId(shift.pairId)
    try {
      const res = await fetch('/api/admin/attendance', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ timemoto_event_ids: ids }),
      })
      if (res.ok) router.refresh()
    } finally {
      setDeletingPairId(null)
    }
  }

  // ── Tages-Editor: alle Zeiten eines Tages in EINEM Dialog bearbeiten ──────
  // (Zeiten anpassen, Pausen hinzufügen/entfernen — damit lässt sich z.B.
  // ein «Ausstempeln» zu einer «Pause» machen, indem danach ein weiterer
  // Block ergänzt wird)
  type TagBlock = { von: string; bis: string; inId: string | null; outId: string | null; offen: boolean }
  const [tagEditor, setTagEditor] = useState<{
    name: string; date: string; dateDisplay: string
    bloecke: TagBlock[]; origLen: number; origIds: string[]
  } | null>(null)
  const [tagSaving, setTagSaving] = useState(false)
  const [tagError, setTagError]   = useState<string | null>(null)

  const openTagEditor = (name: string, date: string, dateDisplay: string, shifts: Shift[]) => {
    const bloecke: TagBlock[] = shifts.map(sh => ({
      von: sh.clockIn ? toZurichHHMM(sh.clockIn) : '',
      bis: sh.clockOut ? toZurichHHMM(sh.clockOut) : '',
      inId: sh.inEventId, outId: sh.outEventId, offen: sh.incomplete,
    }))
    const origIds = shifts.flatMap(sh => [sh.inEventId, sh.outEventId]).filter((x): x is string => !!x)
    setTagError(null)
    setTagEditor({ name, date, dateDisplay, bloecke, origLen: bloecke.length, origIds })
  }

  const tagSet = (i: number, feld: 'von' | 'bis', wert: string) =>
    setTagEditor(t => t ? { ...t, bloecke: t.bloecke.map((b, j) => (j === i ? { ...b, [feld]: wert } : b)) } : t)
  const tagPauseHinzu = () =>
    setTagEditor(t => t ? { ...t, bloecke: [...t.bloecke, { von: '', bis: '', inId: null, outId: null, offen: false }] } : t)
  const tagPauseEntfernen = (i: number) =>
    setTagEditor(t => {
      if (!t) return t
      const b = [...t.bloecke]
      b[i] = { ...b[i], bis: b[i + 1].bis, outId: b[i + 1].outId, offen: b[i + 1].offen }
      b.splice(i + 1, 1)
      return { ...t, bloecke: b }
    })

  const saveTagEditor = async () => {
    if (!tagEditor) return
    const { name, date, bloecke, origLen, origIds } = tagEditor
    // Validierung: alles ausgefüllt (ein offener letzter Block darf ohne
    // Ausstempeln bleiben) und streng aufsteigende Folge
    const folge: string[] = []
    const letzte = bloecke.length - 1
    for (let i = 0; i < bloecke.length; i++) {
      const b = bloecke[i]
      if (!b.von || (!b.bis && !(b.offen && i === letzte))) { setTagError('Bitte alle Zeiten ausfüllen.'); return }
      folge.push(b.von)
      if (b.bis) folge.push(b.bis)
    }
    for (let i = 1; i < folge.length; i++) {
      if (folge[i] <= folge[i - 1]) {
        setTagError('Die Zeiten müssen aufsteigend sein: Einstempeln < Pause < Zurück < Ausstempeln.')
        return
      }
    }
    setTagSaving(true)
    setTagError(null)
    try {
      // Struktur unverändert → nur die bestehenden Stempel anpassen (behält
      // die Herkunft, z.B. TimeMoto-Standort). Bei geänderter Struktur
      // (Pause ergänzt/entfernt, offener Block geschlossen) wandern die
      // alten Stempel des Tages WEICH in den Papierkorb und die neuen
      // Blöcke werden frisch angelegt — nichts geht verloren.
      const strukturGeaendert =
        bloecke.length !== origLen ||
        bloecke.some(b => !b.inId) ||
        bloecke.some(b => b.offen && !!b.bis)
      if (!strukturGeaendert) {
        const requests: Promise<Response>[] = []
        for (const b of bloecke) {
          if (b.inId) requests.push(fetch('/api/admin/attendance', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timemoto_event_id: b.inId, time_logged: buildISO(date, b.von) }),
          }))
          if (b.outId && b.bis) requests.push(fetch('/api/admin/attendance', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timemoto_event_id: b.outId, time_logged: buildISO(date, b.bis) }),
          }))
        }
        const res = await Promise.all(requests)
        if (res.some(r => !r.ok)) throw new Error('Speichern teilweise fehlgeschlagen — bitte Seite neu laden und prüfen.')
      } else {
        if (origIds.length > 0) {
          const del = await fetch('/api/admin/attendance', {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timemoto_event_ids: origIds }),
          })
          if (!del.ok) throw new Error('Die bisherigen Zeiten konnten nicht ersetzt werden.')
        }
        for (const b of bloecke) {
          const res = await fetch('/api/admin/attendance', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userFullName: name,
              clockIn: buildISO(date, b.von),
              clockOut: b.bis ? buildISO(date, b.bis) : null,
            }),
          })
          if (!res.ok) {
            const j = await res.json().catch(() => ({}))
            throw new Error((j as { error?: string }).error ?? 'Ein Eintrag konnte nicht gespeichert werden.')
          }
        }
      }
      setTagEditor(null)
      router.refresh()
    } catch (err) {
      setTagError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    } finally {
      setTagSaving(false)
    }
  }

  // ── PDF payload (shared by "In Dokumente speichern" and "PDF drucken") ─────
  const buildPdfReport = useCallback((report: EmployeeReport) =>
    buildPdfReportData(report, absencesFor(report.fullName), comments, dateFrom, dateTo, anteile),
  [absencesFor, comments, dateFrom, dateTo, anteile])

  // ── Save to documents ──────────────────────────────────────────────────────
  const saveToDokumente = async (replace = false) => {
    if (!empFilter || reports.length === 0) return
    setSavingDoc(true)
    setSaveStatus(null)
    try {
      const res = await fetch('/api/admin/zeiterfassung/save-pdf', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          employeeId: employeeIdFor(empFilter),
          dateFrom,
          dateTo,
          replace,
          ...buildPdfReport(reports[0]),
        }),
      })

      const json = await res.json()
      // Same period already in the documents → ask before replacing
      if (res.status === 409 && json.duplicate) {
        setSavingDoc(false)
        if (window.confirm(`Dieser Zeitraum wurde bereits exportiert («${json.label}»). Soll das bestehende Dokument durch das neue ersetzt werden?`)) {
          await saveToDokumente(true)
        }
        return
      }
      if (!res.ok) throw new Error(json.error ?? 'Unbekannter Fehler')
      setSaveStatus({ type: 'success', message: replace ? `Ersetzt: ${json.label}` : `Gespeichert: ${json.label}` })
    } catch (err) {
      setSaveStatus({ type: 'error', message: err instanceof Error ? err.message : 'Fehler beim Speichern' })
    } finally {
      setSavingDoc(false)
    }
  }

  // ── PDF: identical design to the saved documents ───────────────────────────
  const fetchPdfBlob = async (): Promise<Blob> => {
    const res = await fetch('/api/admin/zeiterfassung/save-pdf', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        download: true,
        dateFrom,
        dateTo,
        reports: reports.map(buildPdfReport),
      }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      throw new Error(json?.error ?? 'PDF-Erstellung fehlgeschlagen')
    }
    return res.blob()
  }

  // Clean file name: "Zeiterfassung September 2026" for a full month,
  // otherwise the date range — same naming as the saved documents.
  const pdfFileName = () => {
    if (dateFrom && dateTo) {
      const [y, m] = dateFrom.split('-').map(Number)
      const fullMonth = dateFrom.slice(8) === '01'
        && dateTo.slice(0, 7) === dateFrom.slice(0, 7)
        && Number(dateTo.slice(8)) === new Date(y, m, 0).getDate()
      if (fullMonth) {
        const name = new Date(y, m - 1, 1).toLocaleDateString('de-CH', { month: 'long' })
        return `Zeiterfassung ${name} ${y}.pdf`
      }
      return `Zeiterfassung ${dateFrom} bis ${dateTo}.pdf`
    }
    return 'Zeiterfassung.pdf'
  }

  /** Open in a tab (for viewing/printing). The placeholder tab is opened
   *  BEFORE the await so the phone's popup blocker cannot swallow it. */
  const printPdf = async () => {
    if (reports.length === 0) return
    const fw = openFileWindow()
    setPrinting(true)
    setSaveStatus(null)
    try {
      const url = URL.createObjectURL(await fetchPdfBlob())
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
    if (reports.length === 0) return
    setDownloadingPdf(true)
    setSaveStatus(null)
    try {
      downloadBlob(await fetchPdfBlob(), pdfFileName())
    } catch (err) {
      setSaveStatus({ type: 'error', message: err instanceof Error ? err.message : 'Fehler beim PDF-Export' })
    } finally {
      setDownloadingPdf(false)
    }
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const rows = [
      ['Mitarbeiter', 'Datum', 'Einstempeln', 'Ausstempeln', 'Arbeitszeit (h)', 'Standort'],
      ...filtered.map(s => [
        s.fullName, s.dateDisplay,
        toZurichTime(s.clockIn), toZurichTime(s.clockOut),
        s.durationMin != null ? (s.durationMin / 60).toFixed(2) : '',
        s.location ?? '',
      ]),
    ]
    const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = `zeiterfassung_${dateFrom || 'alle'}_${dateTo || 'bis_heute'}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const hasFilters  = !!(dateFrom || dateTo)
  const periodLabel = activePeriod ? PERIODS.find(p => p.key === activePeriod)?.label : null
  const monthLabel  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Zurich' }))
    .toLocaleDateString('de-CH', { month: 'long', year: 'numeric' })

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @media print {
          @page { margin: 1.2cm 1.5cm; size: A4 portrait; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between no-print">
          <div>
            <h1 className="page-title">{title}</h1>
            <p className="page-subtitle">
              {periodLabel
                ? `${periodLabel}${hasFilters ? ` · ${dateFrom} – ${dateTo}` : ''}`
                : subtitle}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 mt-1">
            <div className="flex flex-wrap items-center justify-end gap-2.5">
              {!readOnly && (
                <button
                  onClick={() => setShowZeitLog(true)}
                  className="p-2 rounded-ctl text-ink-4 hover:bg-edge-row hover:text-ink-2 transition-colors"
                  title="Änderungen an den Zeiten (Protokoll)"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              )}
              {!readOnly && (
                <button
                  onClick={() => setShowZeitumstellung(true)}
                  className="px-2.5 py-1.5 rounded-ctl border border-edge-ctl bg-white text-[11px] font-semibold text-ink-2 hover:bg-edge-row transition-colors"
                  title="Von Hand geänderte Zeiten zwischen der Zeitumstellung am 25.10. und der Korrektur am 29.10. prüfen"
                >
                  Kontrolle Zeitumstellung
                </button>
              )}
              {!readOnly && (
                <button
                  onClick={() => setShowPapierkorb(true)}
                  className="p-2 rounded-ctl text-ink-4 hover:bg-edge-row hover:text-ink-2 transition-colors"
                  title="Papierkorb — gelöschte Stempel-Einträge ansehen und wiederherstellen"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
              {!readOnly && (
                <button onClick={() => { setShowAdd(true); setAddError(null); setAddForm(f => ({ ...f, name: empFilter || f.name })) }}
                  className="btn-secondary"
                >＋ Eintrag hinzufügen</button>
              )}
              <button onClick={exportCSV} className="btn-secondary">↓ CSV</button>
              <button onClick={downloadPdf} disabled={downloadingPdf || printing} className="btn-secondary">
                {downloadingPdf ? 'PDF wird erstellt…' : '↓ PDF herunterladen'}
              </button>
              <button onClick={printPdf} disabled={printing || downloadingPdf} className="btn-primary">
                {printing ? 'PDF wird erstellt…' : '⎙ PDF öffnen'}
              </button>
              {empFilter && !readOnly && (
                <button onClick={() => saveToDokumente()} disabled={savingDoc} className="btn-secondary">
                  {savingDoc ? 'Speichert…' : '↓ In Dokumente speichern'}
                </button>
              )}
            </div>
            {saveStatus && (
              <p className={`text-xs px-3 py-1.5 rounded-ctl ${
                saveStatus.type === 'success'
                  ? 'bg-mint-bg text-mint-ink'
                  : 'bg-blush-bg text-blush-ink'
              }`}>
                {saveStatus.type === 'success' ? '✓ ' : '⚠ '}{saveStatus.message}
              </p>
            )}
          </div>
        </div>

        {/* Monthly hours strip — screen only */}
        <div className="no-print">
          <p className="eyebrow mb-2.5">
            {monthLabel.toUpperCase()} — ARBEITSSTUNDEN
          </p>
          <div className="overflow-x-auto pb-1.5">
            <div className="flex gap-3" style={{ minWidth: 'max-content' }}>
              {monthlyStats.length === 0
                ? <p className="text-xs text-ink-4 py-3">Keine Daten für diesen Monat.</p>
                : monthlyStats.map(emp => {
                  const selected = empFilter === emp.fullName
                  return (
                    <button
                      key={emp.fullName}
                      onClick={() => selectFromStrip(emp.fullName)}
                      title={selected
                        ? 'Filter aufheben'
                        : `Zeiterfassung von ${emp.fullName} anzeigen`}
                      className={`flex-shrink-0 w-[168px] rounded-tile p-3 px-3.5 flex items-center gap-2.5 text-left transition-all border ${
                        selected
                          ? 'bg-active border-dusk ring-1 ring-dusk'
                          : 'bg-white border-edge hover:border-edge-strong hover:shadow-sm'
                      }`}
                    >
                      <div className="avatar w-[34px] h-[34px] text-xs">
                        {initials(emp.fullName)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-semibold truncate">
                          {emp.fullName.split(' ')[0]}
                        </p>
                        <p className="text-[13px] font-bold text-mint-ink tnum">
                          {fmtHours(emp.totalMinutes)}
                        </p>
                      </div>
                    </button>
                  )
                })
              }
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="card px-6 py-[18px] no-print">
          <div className="flex flex-wrap items-end gap-[18px]">
            <div>
              <p className="field-label">Von</p>
              <input type="date" value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setActivePeriod(null) }}
                className="input-field w-36"
              />
            </div>
            <div>
              <p className="field-label">Bis</p>
              <input type="date" value={dateTo}
                onChange={e => { setDateTo(e.target.value); setActivePeriod(null) }}
                className="input-field w-36"
              />
            </div>
            <div>
              <p className="field-label">Schnellauswahl</p>
              <div className="flex flex-wrap gap-2">
                {PERIODS.map(({ key, label }) => (
                  <button key={key} onClick={() => selectPeriod(key)}
                    className={`px-3.5 py-2 rounded-full border text-[12.5px] font-semibold transition-colors ${
                      activePeriod === key
                        ? 'border-dusk bg-dusk text-[#FDFDFC]'
                        : 'border-edge-ctl bg-white text-ink hover:bg-edge-row'
                    }`}
                  >{label}</button>
                ))}
                {hasFilters && (
                  <button onClick={() => { setDateFrom(''); setDateTo(''); setActivePeriod(null) }}
                    className="px-2 py-2 text-xs text-ink-4 hover:text-ink-2 transition-colors"
                  >Zurücksetzen ×</button>
                )}
              </div>
            </div>
            <div className="ml-auto">
              <p className="field-label">Mitarbeiter</p>
              <select value={empFilter} onChange={e => setEmpFilter(e.target.value)}
                className="select-field min-w-[190px]"
              >
                <option value="">Alle Mitarbeitenden</option>
                {allEmployeeNames.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Per-employee sections */}
        <div ref={reportsRef} className="scroll-mt-4">
        {reports.length === 0 ? (
          <div className="card p-12 text-center">
            <p className="text-sm text-ink-4">Keine Einträge für den gewählten Zeitraum.</p>
          </div>
        ) : (
          <div className="space-y-[22px]">
            {reports.map(report => {
              const dayGroups   = buildDayGroups(report.shifts, absencesFor(report.fullName), dateFrom, dateTo, report.fullName, anteile)
              const kompDays    = dayGroups.filter(d => d.absence === 'KO' && d.dayTotal === 0).length
              const ferienMin   = dayGroups.filter(d => d.absence === 'F').reduce((s, d) => s + absenceCredit('F', d.dayTotal, d.fWeight ?? 1), 0)
              const krankMin    = dayGroups.filter(d => d.absence === 'K').reduce((s, d) => s + absenceCredit('K', d.dayTotal), 0)
              const unfallMin   = dayGroups.filter(d => d.absence === 'U').reduce((s, d) => s + absenceCredit('U', d.dayTotal), 0)
              const teMin       = dayGroups.filter(d => d.absence === 'TE').reduce((s, d) => s + absenceCredit('TE', d.dayTotal), 0)
              const uekMin      = dayGroups.filter(d => d.absence === 'ÜK').reduce((s, d) => s + absenceCredit('ÜK', d.dayTotal), 0)
              const bfMin       = dayGroups.filter(d => d.absence === 'BF').reduce((s, d) => s + absenceCredit('BF', d.dayTotal), 0)
              const ufMin       = dayGroups.filter(d => d.absence === 'UF').reduce((s, d) => s + absenceCredit('UF', d.dayTotal), 0)
              const wbMin       = dayGroups.filter(d => d.absence === 'WB').reduce((s, d) => s + absenceCredit('WB', d.dayTotal), 0)
              // Ferien als Minusstunden (Vereinbarung): kein Ferienbezug, keine Gutschrift
              const fmTage      = Math.round(dayGroups.filter(d => d.absence === 'FM').reduce((s, d) => s + (d.fWeight ?? 1), 0) * 100) / 100
              const fmMin       = dayGroups.filter(d => d.absence === 'FM').reduce((s, d) => s + Math.round(KOMP_MIN * (d.fWeight ?? 1)), 0)
              // Kompensation neither credits nor deducts: the day counts 0:00
              // and the Konto charges it via the full Soll of the month.
              const netTotal    = report.totalMinutes + ferienMin + krankMin + unfallMin + teMin + uekMin + bfMin + ufMin + wbMin
              // Arbeitstage statt Blöcke zählen: jede Pause teilt den Tag in
              // zwei In/Out-Blöcke — als «Schichten» gezählt wirkte die Zahl
              // aufgebläht (4 Einsätze mit Pausen ≠ 6 Schichten).
              const arbeitstage = new Set(report.shifts.filter(s => !s.incomplete).map(s => s.date)).size

              return (
                <div key={report.fullName} className="card overflow-hidden print-section">

                  {/* Employee header */}
                  <div className="px-6 py-[18px] bg-surface border-b border-edge-soft flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="avatar w-10 h-10 text-sm">
                        {initials(report.fullName)}
                      </div>
                      <div>
                        <h3 className="text-[15px] font-bold text-ink">{report.fullName}</h3>
                        <p className="text-xs text-ink-3">{arbeitstage} Arbeitstag{arbeitstage !== 1 ? 'e' : ''}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4">Total</p>
                      <p className="text-[19px] font-bold text-ink tnum">{fmtHours(netTotal)}</p>
                      {ferienMin > 0 && <p className="text-[11px] text-mint-mid tnum">inkl. +{fmtHours(ferienMin)} Ferien</p>}
                      {krankMin > 0 && <p className="text-[11px] text-apricot-mid tnum">inkl. +{fmtHours(krankMin)} Krank</p>}
                      {unfallMin > 0 && <p className="text-[11px] text-[#A85E38] tnum">inkl. +{fmtHours(unfallMin)} Unfall</p>}
                      {kompDays > 0 && <p className="text-[11px] text-steel-ink tnum">{kompDays} Kompensationstag{kompDays !== 1 ? 'e' : ''} (Bezug ab Zeitkonto)</p>}
                      {teMin > 0 && <p className="text-[11px] text-[#8A6A4F] tnum">inkl. +{fmtHours(teMin)} Teamevent</p>}
                      {uekMin > 0 && <p className="text-[11px] text-lilac-ink tnum">inkl. +{fmtHours(uekMin)} Überbetrieblicher Kurs</p>}
                      {bfMin > 0 && <p className="text-[11px] text-[#7E7433] tnum">inkl. +{fmtHours(bfMin)} Bezahlt frei</p>}
                      {ufMin > 0 && <p className="text-[11px] text-[#6E6749] tnum">inkl. +{fmtHours(ufMin)} Unbezahlte Ferien</p>}
                      {wbMin > 0 && <p className="text-[11px] text-lilac-ink tnum">inkl. +{fmtHours(wbMin)} Weiterbildung</p>}
                      {fmTage > 0 && (
                        <p className="text-[11px] text-[#4F6B62] tnum" title="Vereinbarung: Ferienkonto bereits im Minus — die Tage gehen nicht vom Ferienguthaben ab, sondern fehlen als Minusstunden im Zeitkonto (Ausgleich per Jahresende)">
                          {fmTage} Ferientag{fmTage !== 1 ? 'e' : ''} ohne Gutschrift · −{fmtHours(fmMin)} im Zeitkonto (kein Ferienbezug)
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Day-by-day sections */}
                  <div>
                    {dayGroups.map(({ date, dateDisplay, dayTotal, rows, absence, fWeight }, dgi) => {
                      const commentKey  = `${report.fullName}||${date}`
                      const commentText = comments[commentKey] ?? ''
                      const newWeek = dgi === 0 || weekMonday(dayGroups[dgi - 1].date) !== weekMonday(date)
                      const credited = dayTotal + absenceCredit(absence, dayTotal, fWeight ?? 1)
                      const dayTotalDisplay = credited < 0 ? `−${fmtHours(-credited)}` : fmtHours(credited)

                      return (
                        <div key={date}>

                          {newWeek && dgi > 0 && (
                            <div className="border-t-2 border-edge-ctl" />
                          )}

                          {/* Day bar */}
                          <div className="px-6 py-2.5 bg-lilac-soft flex items-center justify-between text-[12.5px]">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-ink">{dateDisplay}</p>
                              {!readOnly && rows.some(r => r.kind === 'shift') && (
                                <button
                                  onClick={() => openTagEditor(report.fullName, date, dateDisplay,
                                    rows.filter(r => r.kind === 'shift').map(r => (r as { kind: 'shift'; shift: Shift }).shift))}
                                  className="text-ink-5 hover:text-ink-2 transition-colors text-[13px]"
                                  title="Alle Zeiten dieses Tages zusammen bearbeiten (inkl. Pausen hinzufügen/entfernen)"
                                >✎</button>
                              )}
                            </div>
                            {absence === 'KO'
                              ? <p className="font-bold text-steel-ink tnum">{(() => {
                                  const ov = ABSENCE_LABEL_OVERRIDES[`${report.fullName}||${date}`]
                                  return dayTotal === 0
                                    ? `${dayTotalDisplay} · ${ov ?? 'Kompensation'}`
                                    : `${fmtHours(dayTotal)} (${ov ?? 'Kompensation geplant'})`
                                })()}</p>
                              : absence === 'F'
                              ? <p className="font-bold text-mint-ink tnum">{dayTotalDisplay} · Ferien{(fWeight ?? 1) !== 1 ? ` (${fWeight} Tag)` : ''}</p>
                              : absence === 'FM'
                              ? <p className="font-bold text-[#4F6B62] tnum" title="Ferien ohne Gutschrift — zählt als Minusstunden, kein Ferienbezug (Vereinbarung)">{dayTotalDisplay} · Ferien ohne Gutschrift{(fWeight ?? 1) !== 1 ? ` (${fWeight} Tag)` : ''} · Minusstunden</p>
                              : absence === 'K'
                              ? <p className="font-bold text-apricot-ink tnum">{dayTotalDisplay} · Krank</p>
                              : absence === 'U'
                              ? <p className="font-bold text-[#A85E38] tnum">{dayTotalDisplay} · Unfall</p>
                              : absence === 'TE'
                              ? <p className="font-bold text-[#8A6A4F] tnum">{dayTotalDisplay} · {teamEventLabel(date)}</p>
                              : absence === 'ÜK'
                              ? <p className="font-bold text-lilac-ink tnum">{dayTotalDisplay} · Überbetrieblicher Kurs</p>
                              : absence === 'BF'
                              ? <p className="font-bold text-[#7E7433] tnum">{dayTotalDisplay} · Bezahlt frei</p>
                              : absence === 'UF'
                              ? <p className="font-bold text-[#6E6749] tnum">{dayTotalDisplay} · Unbezahlte Ferien</p>
                              : absence === 'WB'
                              ? <p className="font-bold text-lilac-ink tnum">{dayTotalDisplay} · Weiterbildung</p>
                              : <p className="font-bold text-lilac-label tnum">{dayTotalDisplay}</p>}
                          </div>

                          {/* Entry rows for this day */}
                          <div className="px-6 pt-1.5 pb-4">
                            {rows.map((row, idx) => {

                              /* ── Break indicator ── */
                              if (row.kind === 'break') {
                                return (
                                  <div key={`break-${idx}`} className="flex items-center gap-3 py-1">
                                    <div className="flex-1 border-t border-dashed border-edge-ctl" />
                                    <span className="text-[10.5px] font-semibold text-lilac-label bg-lilac-bg rounded-full px-3 py-[3px] whitespace-nowrap">
                                      {row.breakMin !== null ? `${row.breakMin} min Pause` : 'Pause'}
                                    </span>
                                    <div className="flex-1 border-t border-dashed border-edge-ctl" />
                                  </div>
                                )
                              }

                              /* ── Shift row ── */
                              const shift     = row.shift
                              const isEditing = editingPairId === shift.pairId
                              // Position im Tag bestimmt die Beschriftung: die
                              // erste Zeit ist «Einstempeln», ein Out vor einer
                              // weiteren Schicht ist «Pause», das In danach
                              // «Zurück», das letzte Out «Ausstempeln».
                              const tagesShifts = rows.filter(r => r.kind === 'shift')
                              const pos = tagesShifts.findIndex(r => r.kind === 'shift' && r.shift.pairId === shift.pairId)
                              const inLabel  = pos <= 0 ? 'Einstempeln' : 'Zurück'
                              const outLabel = pos === tagesShifts.length - 1 ? 'Ausstempeln' : 'Pause'
                              return (
                                <div key={shift.pairId}
                                  className={`grid grid-cols-[90px_90px_90px_1fr_auto] gap-x-3.5 items-center py-[9px] px-2 -mx-2 rounded-lg text-[13.5px] tnum transition-colors ${isEditing ? 'bg-active' : 'hover:bg-hovrow'} group`}
                                >
                                  {/* Einstempeln / Zurück */}
                                  <div>
                                    <p className="text-[9px] font-semibold uppercase tracking-[.09em] text-ink-5 leading-none mb-1">{inLabel}</p>
                                    {isEditing ? (
                                      <input type="time" value={editTimes.inHHMM}
                                        onChange={e => setEditTimes(p => ({ ...p, inHHMM: e.target.value }))}
                                        className="input-field !py-1 w-full"
                                      />
                                    ) : (
                                      <div className="font-semibold whitespace-nowrap">{toZurichTime(shift.clockIn)}</div>
                                    )}
                                  </div>

                                  {/* Pause / Ausstempeln */}
                                  <div>
                                    {(!shift.incomplete || isEditing) && (
                                      <p className="text-[9px] font-semibold uppercase tracking-[.09em] text-ink-5 leading-none mb-1">{shift.incomplete ? 'Ausstempeln' : outLabel}</p>
                                    )}
                                    {isEditing ? (
                                      <input type="time" value={editTimes.outHHMM}
                                        onChange={e => setEditTimes(p => ({ ...p, outHHMM: e.target.value }))}
                                        className="input-field !py-1 w-full"
                                        placeholder={shift.incomplete ? 'leer = bleibt offen' : undefined}
                                        title={shift.incomplete ? 'Ausstempel-Zeit nachtragen — leer lassen, wenn der Eintrag offen bleiben soll' : undefined}
                                      />
                                    ) : shift.incomplete ? (
                                      <div className="inline-flex items-center gap-1.5 text-mint-ink text-xs font-semibold">
                                        <span className="w-1.5 h-1.5 rounded-full bg-mint-mid animate-pulse" />
                                        Anwesend
                                      </div>
                                    ) : (
                                      <div className="font-semibold whitespace-nowrap">{toZurichTime(shift.clockOut)}</div>
                                    )}
                                  </div>

                                  {/* Dauer */}
                                  <div className="font-bold text-mint-ink whitespace-nowrap">
                                    {shift.incomplete ? '—' : fmtDuration(shift.durationMin)}
                                  </div>

                                  {/* Standort */}
                                  <div className="text-[12.5px] text-ink-4 truncate">
                                    {shift.location ?? '—'}
                                  </div>

                                  {/* Actions */}
                                  {readOnly ? (
                                    <div />
                                  ) : isEditing ? (
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <button onClick={saveEdit} disabled={saving}
                                        className="btn-primary !px-2.5 !py-1 !text-xs"
                                      >{saving ? '…' : 'Speichern'}</button>
                                      <button onClick={() => { setEditingPairId(null); setEditError(null) }}
                                        className="btn-secondary !px-2.5 !py-1 !text-xs"
                                      >Abbrechen</button>
                                      {editError && <span className="basis-full text-[11px] text-blush-ink">⚠ {editError}</span>}
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-3.5 text-[13px] text-ink-5">
                                      <button onClick={() => { setAddForm({ ...leererAddForm(), name: shift.fullName, date: shift.date }); setAddError(null); setShowAdd(true) }}
                                        className="hover:text-ink-2 transition-colors" title="Eintrag für diesen Tag hinzufügen"
                                      >＋</button>
                                      <button onClick={() => openEdit(shift)}
                                        className="hover:text-ink-2 transition-colors" title="Bearbeiten"
                                      >✎</button>
                                      <button onClick={() => deleteShift(shift)}
                                        disabled={deletingPairId === shift.pairId}
                                        className="hover:text-[#B0654F] transition-colors disabled:opacity-40" title="Eintrag löschen"
                                      >{deletingPairId === shift.pairId ? '…' : '✕'}</button>
                                    </div>
                                  )}
                                </div>
                              )
                            })}

                            {/* Per-day comment */}
                            {readOnly ? (
                              commentText && (
                                <div className="w-full text-[13px] text-ink border border-edge-ctl rounded-ctl px-3.5 py-2.5 mt-1.5 bg-surface whitespace-pre-wrap">
                                  {commentText}
                                </div>
                              )
                            ) : (
                            <textarea
                              value={commentText}
                              onChange={e => setComments(prev => ({ ...prev, [commentKey]: e.target.value }))}
                              onBlur={e => saveComment(report.fullName, date, e.target.value)}
                              placeholder="Tagesnotiz…"
                              rows={commentText ? 2 : 1}
                              className={`w-full text-[13px] text-ink border border-edge-ctl rounded-ctl px-3.5 py-2.5 mt-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-dusk placeholder:text-ink-4 transition-all ${commentText ? 'bg-surface' : 'bg-white'}`}
                            />
                            )}
                          </div>

                        </div>
                      )
                    })}
                  </div>

                </div>
              )
            })}
          </div>
        )}
        </div>

      </div>

      {/* ── Add-entry modal ── */}
      {/* ── Tages-Editor: alle Zeiten eines Tages in einem Dialog ── */}
      {tagEditor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4 no-print">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">Tag bearbeiten — {tagEditor.dateDisplay}</h3>
                <p className="text-xs text-ink-4 mt-0.5">
                  {tagEditor.name} · Alle Zeiten des Tages zusammen anpassen. Mit «＋ Pause hinzufügen»
                  wird das bisherige Ausstempeln zur Pause.
                </p>
              </div>
              <button onClick={() => setTagEditor(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4 flex-shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-3.5 overflow-auto">
              <div>
                <p className="field-label">Einstempeln</p>
                <input type="time" value={tagEditor.bloecke[0]?.von ?? ''}
                  onChange={e => tagSet(0, 'von', e.target.value)} className="input-field w-full" />
              </div>
              {tagEditor.bloecke.slice(0, -1).map((b, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
                  <div>
                    <p className="field-label">Pause</p>
                    <input type="time" value={b.bis}
                      onChange={e => tagSet(i, 'bis', e.target.value)} className="input-field w-full" />
                  </div>
                  <div>
                    <p className="field-label">Zurück</p>
                    <input type="time" value={tagEditor.bloecke[i + 1]?.von ?? ''}
                      onChange={e => tagSet(i + 1, 'von', e.target.value)} className="input-field w-full" />
                  </div>
                  <button onClick={() => tagPauseEntfernen(i)} disabled={tagSaving}
                    className="text-ink-5 hover:text-red-500 px-1.5 pb-2.5" title="Diese Pause entfernen (Blöcke zusammenführen)">✕</button>
                </div>
              ))}
              <div>
                <p className="field-label">
                  Ausstempeln
                  {tagEditor.bloecke[tagEditor.bloecke.length - 1]?.offen && (
                    <span className="normal-case font-normal"> (leer lassen = bleibt offen/anwesend)</span>
                  )}
                </p>
                <input type="time" value={tagEditor.bloecke[tagEditor.bloecke.length - 1]?.bis ?? ''}
                  onChange={e => tagSet(tagEditor.bloecke.length - 1, 'bis', e.target.value)} className="input-field w-full" />
              </div>
              <button onClick={tagPauseHinzu}
                disabled={tagSaving || (tagEditor.bloecke[tagEditor.bloecke.length - 1]?.offen && !tagEditor.bloecke[tagEditor.bloecke.length - 1]?.bis)}
                className="btn-secondary !px-3 !py-1.5 !text-xs disabled:opacity-40"
                title="Eine weitere Pause anhängen — das bisherige Ausstempeln wird zur Pause">
                ＋ Pause hinzufügen
              </button>
              {tagError && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink">⚠ {tagError}</p>}
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={() => setTagEditor(null)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={saveTagEditor} disabled={tagSaving} className="btn-primary flex-1">
                {tagSaving ? 'Wird gespeichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4 no-print">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">Eintrag hinzufügen</h3>
                <p className="text-xs text-ink-4 mt-0.5">Manuellen Zeiterfassungs-Eintrag erstellen</p>
              </div>
              <button onClick={() => setShowAdd(false)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4 flex-shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <p className="field-label">Mitarbeiter</p>
                <select value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} className="select-field w-full">
                  <option value="">Bitte wählen…</option>
                  {addNameOptions.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <p className="field-label">Datum</p>
                <input type="date" value={addForm.date} onChange={e => setAddForm(f => ({ ...f, date: e.target.value }))} className="input-field w-full" />
              </div>
              <div>
                <p className="field-label">Einstempeln</p>
                <input type="time" value={addForm.ein} onChange={e => setAddForm(f => ({ ...f, ein: e.target.value }))} className="input-field w-full" />
              </div>
              {addForm.pausen.map((pz, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
                  <div>
                    <p className="field-label">Pause{addForm.pausen.length > 1 ? ` ${i + 1}` : ''}</p>
                    <input type="time" value={pz.pause}
                      onChange={e => setAddForm(f => ({ ...f, pausen: f.pausen.map((x, j) => (j === i ? { ...x, pause: e.target.value } : x)) }))}
                      className="input-field w-full" />
                  </div>
                  <div>
                    <p className="field-label">Zurück{addForm.pausen.length > 1 ? ` ${i + 1}` : ''}</p>
                    <input type="time" value={pz.zurueck}
                      onChange={e => setAddForm(f => ({ ...f, pausen: f.pausen.map((x, j) => (j === i ? { ...x, zurueck: e.target.value } : x)) }))}
                      className="input-field w-full" />
                  </div>
                  <button onClick={() => setAddForm(f => ({ ...f, pausen: f.pausen.filter((_, j) => j !== i) }))}
                    className="text-ink-5 hover:text-red-500 px-1.5 pb-2.5" title="Diese Pause entfernen">✕</button>
                </div>
              ))}
              <div>
                <p className="field-label">Ausstempeln <span className="normal-case font-normal">(leer = Tag bleibt offen)</span></p>
                <input type="time" value={addForm.aus} onChange={e => setAddForm(f => ({ ...f, aus: e.target.value }))} className="input-field w-full" />
              </div>
              <button onClick={() => setAddForm(f => ({ ...f, pausen: [...f.pausen, { pause: '', zurueck: '' }] }))}
                className="btn-secondary !px-3 !py-1.5 !text-xs" title="Eine weitere Pause mit Zurück ergänzen — beliebig viele möglich">
                ＋ Pause hinzufügen
              </button>
              <p className="text-[11px] text-ink-4 -mt-1">
                Jede Pause teilt den Tag in einen weiteren Eintrag — es sind beliebig viele
                Pausen pro Tag möglich (mehr als 4 Stempel).
              </p>
              {addError && (
                <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink">⚠ {addError}</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={() => setShowAdd(false)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={submitAdd} disabled={addSaving} className="btn-primary flex-1">
                {addSaving ? 'Wird gespeichert…' : 'Hinzufügen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Change log of the times (admin only) ── */}
      {showZeitLog && <ZeitAenderungenModal onClose={() => setShowZeitLog(false)} />}
      {showZeitumstellung && <ZeitumstellungKontrolleModal onClose={() => setShowZeitumstellung(false)} />}

      {/* ── Papierkorb: gelöschte Einträge wiederherstellen (admin only) ── */}
      {showPapierkorb && <PapierkorbModal onClose={() => setShowPapierkorb(false)} />}

    </>
  )
}
