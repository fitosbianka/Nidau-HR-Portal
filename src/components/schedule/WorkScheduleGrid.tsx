'use client'

import React, { useState, useEffect, useTransition, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { upsertShift, publishMonth, unpublishMonth, releaseMonthToLeitende, unreleaseMonthFromLeitende, flagReviewDay, unflagReviewDay, flagTeamEventDay, unflagTeamEventDay, teameventRueckgaengig, upsertMonthPlanNote, planNotizEintrag, planMonatsnotizEintrag, planNotizEintragBearbeiten, monatsnotizUmwandeln, copyPreviousMonth, type NotizScope, applyStandardWeeks, copyScheduleDay, applyWeekValue, type TeVorschlag } from '@/actions/schedule'
import { mondayOf, sundayOf, isoWeekNumber, type MonthPlanNotes, type NoteVal, type NoteEntry, type PlanPeriodNote } from '@/lib/plan-notes'
import { zurichHeute } from '@/lib/zeitzone'
import { monatsnotizZerlegen, type UmwandlungItem } from '@/lib/notiz-umwandlung'
import { ferienWeight } from '@/lib/ferien'
import { feiertagName } from '@/lib/feiertage'
import PlanAenderungenModal from './PlanAenderungenModal'
import { PLAN_MONTH_NOTES as MONTH_NOTES, planRowVisible, planKurzname, PLAN_POSITION_RE, PLAN_SHIFT_RE } from '@/lib/plan-meta'
import { einsatzAnfrageHinzufuegen } from '@/actions/verfuegbarkeit'
import { istVerfuegbarkeitPerson, planPositionAnfragbar, positionText, tagKurz } from '@/lib/verfuegbarkeit'

interface Employee {
  id: string
  full_name: string
  job_title: string | null
  can_edit_schedule?: boolean
  abbreviation?: string | null
}

interface Entry {
  employee_id: string
  schedule_date: string
  entry: string
}

interface Props {
  employees: Employee[]
  entries: Entry[]
  year: number
  month: number      // 1–12
  canEdit: boolean
  isPublished: boolean
  /** Admin controls (publish, Leitende release) visible */
  isAdmin?: boolean
  /** Month draft released to the Leitenden (read + edit before publication) */
  leitendeReleased?: boolean
  reviewDays?: string[]   // YYYY-MM-DD dates flagged "manual planning needed"
  teamEventDays?: string[] // YYYY-MM-DD dates marked as Teamevent (brown column)
  /** Planning notes for this month (admin + Leitende only — pages pass them
   *  exclusively to plan editors; undefined hides all note UI entirely.
   *  adminOnly is filled only for admin viewers). */
  planNotes?: MonthPlanNotes
  /** Notizen zur Planung dürfen gezeigt werden: nur Admins und Leitende. Ohne
   *  diese Freigabe werden übergebene Notizen ignoriert (zweite Sperre neben
   *  dem Laden auf dem Server). */
  notizenErlaubt?: boolean
  /** Bekannte Kürzel des Teams (für das Umwandeln alter Monatsnotizen) */
  kuerzel?: string[]
  basePath: string
}

// ── Shift config (rooms 1–5) — pastel design system ──────────────────────────
const SHIFTS = {
  f: { label: 'Frühschicht',     short: 'Früh', cls: 'bg-blush-bg   text-blush-ink',   btn: 'bg-blush-bg   text-blush-ink   border-blush-ink/30' },
  t: { label: 'Mittelschicht',   short: 'Mittel', cls: 'bg-apricot-bg text-apricot-ink', btn: 'bg-apricot-bg text-apricot-ink border-apricot-ink/30' },
  s: { label: 'Spätschicht',     short: 'Spät', cls: 'bg-steel-bg   text-steel-ink',   btn: 'bg-steel-bg   text-steel-ink   border-steel-ink/30' },
  h: { label: 'Halbtagsschicht', short: 'Halb', cls: 'bg-mint-bg    text-mint-ink',    btn: 'bg-mint-bg    text-mint-ink    border-mint-ink/30' },
} as const
type ShiftKey = keyof typeof SHIFTS | 'none'

// ── Category groups ──────────────────────────────────────────────────────────
const GROUPS = [
  { key: 'ZAZ',      label: 'ZAZ',     match: (t: string | null) => t === 'ZAZ',                        badgeCls: 'bg-mint-bg    text-mint-ink',    rowEven: 'bg-white', rowOdd: 'bg-white', stickyEven: 'bg-white', stickyOdd: 'bg-white' },
  { key: 'DH_PA',    label: 'DH / PA', match: (t: string | null) => t === 'DH / PA' || t === 'DH' || t === 'PA', badgeCls: 'bg-steel-bg   text-steel-ink',   rowEven: 'bg-white', rowOdd: 'bg-white', stickyEven: 'bg-white', stickyOdd: 'bg-white' },
  { key: 'DA',       label: 'DA',      match: (t: string | null) => t === 'DA' || t === 'Leitende DA',   badgeCls: 'bg-apricot-bg text-apricot-ink', rowEven: 'bg-white', rowOdd: 'bg-white', stickyEven: 'bg-white', stickyOdd: 'bg-white' },
  { key: 'Lernende', label: 'Lernende',match: (t: string | null) => t === 'Lernende',                    badgeCls: 'bg-lilac-bg   text-lilac-ink',   rowEven: 'bg-white', rowOdd: 'bg-white', stickyEven: 'bg-white', stickyOdd: 'bg-white' },
  { key: 'Admin',    label: 'Admin',   match: (t: string | null) => t === 'Admin',                        badgeCls: 'bg-active     text-ink-2',       rowEven: 'bg-white', rowOdd: 'bg-white', stickyEven: 'bg-white', stickyOdd: 'bg-white' },
  { key: 'Andere',   label: 'Weitere', match: (t: string | null) => !['ZAZ','DH / PA','DH','PA','DA','Leitende DA','Lernende','Admin'].includes(t ?? ''), badgeCls: 'bg-edge-row text-ink-2', rowEven: 'bg-white', rowOdd: 'bg-white', stickyEven: 'bg-white', stickyOdd: 'bg-white' },
]

const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']

// Legacy: Dinusha once had a second "(DA)" plan row; her cell entries could
// hold two parts separated by '|' ("<row-1-part>|<row-2-part>"). The extra
// row was removed — only the first part of such stored entries is shown.
function firstPart(raw: string): string {
  return raw.includes('|') ? raw.split('|')[0] : raw
}

const DAY_SHORT   = ['So','Mo','Di','Mi','Do','Fr','Sa']

const KEINE_KUERZEL: string[] = []

/** Kürzel der Verfasserin einer Notiz, als kleiner Kreis. */
function Kuerzel({ by, geaendert }: { by: string | null; geaendert?: string | null }) {
  return (
    <span
      className={`flex-shrink-0 w-[22px] h-[22px] rounded-full border text-[9px] font-bold flex items-center justify-center ${by ? 'bg-lilac-bg border-lilac-ink/25 text-lilac-label' : 'bg-edge-row border-edge-ctl text-ink-4'}`}
      title={by ? `Notiert von ${by}${geaendert ? `, geändert von ${geaendert}` : ''}` : 'Ältere Notiz ohne Kürzel'}
    >{by ?? '–'}</span>
  )
}
/** «03.11. 14:12» (Zürcher Zeit) */
const fmtNotizZeit = (iso: string) => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }).replace(',', '')
}
const NAME_W = 176
const CELL_W = 34

/** Count Mon–Fri working days in a given month (no public-holiday adjustment). */
function countWorkingDays(year: number, month: number): number {
  const total = new Date(year, month, 0).getDate()
  let count = 0
  for (let d = 1; d <= total; d++) {
    const dow = new Date(year, month - 1, d).getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return count
}

function dateStr(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
}
function getInitials(name: string, abbreviation?: string | null) {
  if (abbreviation && abbreviation.trim()) return abbreviation.trim().toUpperCase().slice(0, 2)
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
}

function parseCell(value: string): { display: string; cls: string } {
  if (!value) return { display: '', cls: '' }

  // Room/code + shift letter, e.g. 3f, 7h, PAt, HOh, 6/8t, */7s → colored by shift
  const sm = value.match(PLAN_SHIFT_RE)
  if (sm) {
    const k = sm[2].toLowerCase() as keyof typeof SHIFTS
    return { display: sm[1], cls: SHIFTS[k].cls }
  }

  const v = value.trim().toUpperCase()
  if (v === '✓' || v === 'ANWESEND')         return { display: '✓', cls: '' }
  if (v === '6'  || v === '7'  || v === '8' ||
      v === '10' || v === '*')               return { display: value, cls: '' }
  if (v === 'HO' || v === 'S' || v === 'SCHULE')
                                             return { display: value, cls: 'bg-lilac-bg   text-lilac-ink' }
  if (v === 'F'  || v === 'FERIEN')          return { display: value, cls: 'bg-mint-bg    text-mint-ink' }
  if (/^F:\d*\.?\d+$/.test(v))               return { display: 'F',   cls: 'bg-mint-bg    text-mint-ink' }
  if (v === '%'  || v === 'FREI')            return { display: value, cls: 'text-ink-4' }
  if (v === 'K'  || v === 'KRANK')           return { display: value, cls: 'bg-blush-bg   text-blush-ink' }
  if (v === 'U'  || v === 'UNFALL')          return { display: 'U',   cls: 'bg-[#F8E0CF] text-[#A85E38]' }
  if (v === 'WB' || v === 'WEITERBILDUNG')   return { display: value, cls: 'bg-lilac-bg   text-lilac-ink' }
  if (v === 'ÜK' || v === 'UK')              return { display: 'ÜK',  cls: 'bg-lilac-bg   text-lilac-ink' }
  if (v === 'KO' || v === 'KOMPENSATION')    return { display: value, cls: 'bg-steel-bg   text-steel-ink' }
  if (v === 'TE' || v === 'TEAMEVENT')       return { display: 'TE',  cls: 'bg-[#EADAC8] text-[#7E5F44]' }
  if (v === 'BF')                            return { display: 'BF',  cls: 'bg-[#EFEBCF] text-[#7E7433]' }
  if (v === 'UF')                            return { display: 'UF',  cls: 'bg-[#E3E0D5] text-[#6E6749]' }
  if (v === 'ND' || v === 'NOTFALLDIENST')   return { display: 'ND',  cls: 'bg-[#F8DCD2] text-[#A6492F]' }

  return { display: value, cls: '' }
}

export default function WorkScheduleGrid({
  employees, entries, year, month, canEdit, isPublished, isAdmin = false, leitendeReleased = false, reviewDays = [], teamEventDays = [], planNotes: planNotesProp, basePath, notizenErlaubt = false, kuerzel = KEINE_KUERZEL,
}: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  // Cell-level saves are optimistic (overrides state below), so the full
  // server re-render can wait until a burst of edits pauses instead of
  // re-running the page's queries after every single click.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      router.refresh()
    }, 1200)
  }, [router])
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current) }, [])

  // A server action can reject outright on a network hiccup; surface that as
  // a normal save error instead of failing silently inside the transition.
  async function safe<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
    try {
      return await fn()
    } catch {
      return { error: 'Netzwerkfehler — Änderung wurde nicht gespeichert. Bitte erneut versuchen.' }
    }
  }

  // ── Day markers: red (manual planning) and brown (Teamevent) columns ──
  const [reviewOverrides, setReviewOverrides] = useState<Record<string, boolean>>({})
  const [teOverrides,     setTeOverrides]     = useState<Record<string, boolean>>({})
  const isReviewDay = (ds: string) =>
    reviewOverrides[ds] ?? reviewDays.includes(ds)
  const isTeamEventDay = (ds: string) =>
    teOverrides[ds] ?? teamEventDays.includes(ds)

  // Header click cycles: none → red → brown (Teamevent) → none
  function cycleDayMarker(ds: string) {
    if (!canEdit) return
    const rev = isReviewDay(ds)
    const te  = isTeamEventDay(ds)
    if (!rev && !te) {
      setReviewOverrides(prev => ({ ...prev, [ds]: true }))
      startTransition(async () => {
        const result = await safe(() => flagReviewDay(ds))
        if (result?.error) setSaveError(result.error)
        else scheduleRefresh()
      })
    } else if (rev) {
      setReviewOverrides(prev => ({ ...prev, [ds]: false }))
      const makeTE = confirm('Diesen Tag als Teamevent markieren (braun)?\nBestehende Einträge (ausser Ferien) werden durch «TE» ersetzt — sie zählen in der Zeiterfassung wie ein Arbeitstag (8:30).')
      if (makeTE) {
        setTeOverrides(prev => ({ ...prev, [ds]: true }))
        const day = parseInt(ds.slice(8), 10)
        setOverrides(prev => {
          const next = { ...prev }
          for (const emp of visibleEmployees) {
            const v = getValue(emp.id, day)
            if (v && ferienWeight(v) == null) next[`${emp.id}_${ds}`] = 'TE'
          }
          return next
        })
      }
      startTransition(async () => {
        const cleared = await safe(() => unflagReviewDay(ds))
        if (cleared?.error) { setSaveError(cleared.error); return }
        if (makeTE) {
          const result = await safe(() => flagTeamEventDay(ds, true))
          if (result?.error) { setSaveError(result.error); return }
        }
        scheduleRefresh()
      })
    } else {
      // Teamevent-Tag: Dialog mit Vorschau öffnen — entweder die ersetzten
      // Einträge wiederherstellen oder nur die Markierung entfernen
      startTransition(async () => {
        const result = await safe(() => teameventRueckgaengig(ds, false))
        const err = (result as { error?: string } | undefined)?.error
        if (err || !result || !('vorschlaege' in result)) {
          setSaveError(err ?? 'Vorschau fehlgeschlagen — bitte nochmals versuchen.')
          return
        }
        setTeRestore({ ds, vorschlaege: (result as { vorschlaege: TeVorschlag[] }).vorschlaege })
      })
    }
  }

  // ── Edit state ──
  const [editingKey,   setEditingKey]   = useState<string | null>(null)
  const [editingEmpId, setEditingEmpId] = useState('')
  const [editingDay,   setEditingDay]   = useState(0)
  const [editValue,    setEditValue]    = useState('')
  const [editShift,    setEditShift]    = useState<ShiftKey>('none')
  const [editCellRect, setEditCellRect] = useState<DOMRect | null>(null)
  const [overrides,    setOverrides]    = useState<Record<string, string>>({})
  const [saveError,    setSaveError]    = useState<string | null>(null)
  const [infoMsg,      setInfoMsg]      = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Browse mode: selected cell after the editor closes (Excel-like) ──
  const [selCell, setSelCell] = useState<{ empId: string; day: number } | null>(null)
  useEffect(() => { setSelCell(null) }, [year, month])

  // ── Teamevent rückgängig: Dialog mit Vorschau der Wiederherstellung ──
  const [teRestore, setTeRestore] = useState<{ ds: string; vorschlaege: TeVorschlag[] } | null>(null)
  const [teRestoreBusy, setTeRestoreBusy] = useState(false)

  // ── Immer aktuell: der Plan bleibt bei vielen tagelang offen (App auf
  // Handy/Dock). Beim Zurückkehren zur App und alle 4 Minuten werden die
  // Einträge still neu vom Server geholt, damit Änderungen am
  // veröffentlichten Plan (z.B. Tausch nach Krankmeldung) bei ALLEN
  // erscheinen — ohne manuelles Neuladen. Während man selber gerade eine
  // Zelle bearbeitet, wird nicht aktualisiert.
  const autoRefreshRef = useRef(false)
  autoRefreshRef.current = !!editingKey
  useEffect(() => {
    const still = () => {
      if (document.visibilityState === 'visible' && !autoRefreshRef.current) router.refresh()
    }
    const onVis = () => { if (document.visibilityState === 'visible') still() }
    document.addEventListener('visibilitychange', onVis)
    const intervall = setInterval(still, 4 * 60_000)
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(intervall) }
  }, [router])

  // ── Planning notes (admin + Leitende) ──
  const EMPTY_NOTE: NoteVal = { text: '', by: null, to: null, eintraege: [] }
  // Notizen nur mit Freigabe (Admins, Leitende); sonst verhält sich die Ansicht wie ohne Notizen
  const planNotes = notizenErlaubt ? planNotesProp : undefined
  const [sharedNote,  setSharedNote]  = useState<NoteVal>(planNotes?.shared ?? EMPTY_NOTE)
  const [adminNote,   setAdminNote]   = useState<NoteVal>(planNotes?.adminOnly ?? EMPTY_NOTE)
  const [dayNotes,    setDayNotes]    = useState(planNotes?.dayNotes ?? [])
  const [weekNotes,   setWeekNotes]   = useState(planNotes?.weekNotes ?? [])
  const [questions,   setQuestions]   = useState(planNotes?.questions ?? [])
  // Which month-note slot is being edited, and the shared textarea draft
  const [monthEditing, setMonthEditing] = useState<'shared' | 'admin' | null>(null)
  const [monthDraft,   setMonthDraft]   = useState('')
  // Day/week note form: a new entry for a day/week/question (editing an
  // existing entry happens in the dialog `bearbeiten`)
  type PeriodScope = 'day' | 'week' | 'question'
  type PeriodForm = {
    scope: PeriodScope
    date: string          // for scope 'day' / 'question' (YYYY-MM-DD)
    dateTo: string        // optional range end ('' = single day)
    weekIdx: number       // for scope 'week' (index into `weeks`)
    weekIdxTo: number     // optional range end week (same index = single week)
    text: string
    /** vom Band oder von der Liste aus geöffnet: Tag und Zeitraum stehen fest */
    fix?: boolean
  }
  const [periodForm, setPeriodForm] = useState<PeriodForm | null>(null)
  const [noteSaving, setNoteSaving] = useState(false)
  const [showNoteMenu, setShowNoteMenu] = useState(false)
  // Monatsnotiz (Admin + Leitende) als Einträge: neuer Eintrag (index null) oder einer wird geändert
  const [monatsForm, setMonatsForm] = useState<{ text: string } | null>(null)
  // Dialog «Notiz bearbeiten»: Tag, Zeitraum, Woche oder Monat, Kürzel und Text eines bestehenden Eintrags
  type Bearbeiten = {
    von: { scope: NotizScope; anchor: string | null; index: number }
    scope: NotizScope
    date: string
    dateTo: string
    weekIdx: number
    weekIdxTo: number
    by: string
    text: string
    at: string | null
  }
  const [bearbeiten, setBearbeiten] = useState<Bearbeiten | null>(null)
  const [bearbBusy, setBearbBusy] = useState(false)
  const [bearbErr, setBearbErr] = useState<string | null>(null)
  // Vorschau «Monatsnotiz in Tagesnotizen umwandeln» (Admin)
  const [umwandlung, setUmwandlung] = useState<UmwandlungItem[] | null>(null)
  const [umwandlungBusy, setUmwandlungBusy] = useState(false)
  const [umwandlungErr, setUmwandlungErr] = useState<string | null>(null)

  useEffect(() => {
    setSharedNote(planNotes?.shared ?? EMPTY_NOTE)
    setAdminNote(planNotes?.adminOnly ?? EMPTY_NOTE)
    setDayNotes(planNotes?.dayNotes ?? [])
    setWeekNotes(planNotes?.weekNotes ?? [])
    setQuestions(planNotes?.questions ?? [])
    setMonthEditing(null)
    setPeriodForm(null)
    setMonatsForm(null)
    setBearbeiten(null)
    setUmwandlung(null)
    setShowNoteMenu(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planNotes, year, month])

  function saveMonatsEintrag() {
    if (!monatsForm) return
    const text = monatsForm.text.trim()
    if (!text) return
    setNoteSaving(true)
    setSaveError(null)
    startTransition(async () => {
      const r = await safe(() => planMonatsnotizEintrag(year, month, { index: null, text }))
      if ('error' in r) {
        setSaveError(r.error ?? 'Speichern fehlgeschlagen.')
      } else {
        setSharedNote(r.note)
        setMonatsForm(null)
        router.refresh()
      }
      setNoteSaving(false)
    })
  }
  function umwandlungOeffnen() {
    setShowNoteMenu(false); setPeriodForm(null); setMonatsForm(null); setUmwandlungErr(null)
    const items = sharedNote.eintraege.flatMap(e =>
      monatsnotizZerlegen(e.text, year, month, kuerzel).map(i => ({ ...i, by: i.by ?? e.by })))
    setUmwandlung(items)
  }
  function umwandlungAnwenden() {
    if (!umwandlung) return
    const items = umwandlung.filter(i => i.text.trim())
    if (items.length === 0) { setUmwandlungErr('Keine Einträge.'); return }
    setUmwandlungBusy(true); setUmwandlungErr(null)
    startTransition(async () => {
      const r = await safe(() => monatsnotizUmwandeln(year, month, items.map(i => ({ scope: i.scope, anchor: i.anchor, to: i.to, by: i.by, text: i.text.trim() }))))
      if ('error' in r) setUmwandlungErr(r.error ?? 'Umwandeln fehlgeschlagen.')
      else { setUmwandlung(null); setInfoMsg(`${r.anzahl} Einträge umgewandelt. Die bisherige Monatsnotiz ist als Sicherung abgelegt.`); router.refresh() }
      setUmwandlungBusy(false)
    })
  }

  function saveMonthNote() {
    if (!monthEditing) return
    const slot  = monthEditing
    const value = monthDraft.trim()
    setNoteSaving(true)
    setSaveError(null)
    startTransition(async () => {
      const result = await safe(() => upsertMonthPlanNote(year, month, value, slot === 'admin'))
      if (result?.error) {
        setSaveError(result.error)
      } else {
        const neu = (prev: NoteVal): NoteVal => ({ text: value, by: prev.by, to: null, eintraege: value ? [{ text: value, by: prev.by, at: null, geaendert: null }] : [] })
        if (slot === 'admin') setAdminNote(neu)
        else setSharedNote(neu)
        setMonthEditing(null)
        router.refresh()
      }
      setNoteSaving(false)
    })
  }

  function savePeriodNote(deleteIt = false) {
    if (!periodForm) return
    const form   = periodForm
    const anchor = form.scope === 'week' ? weekAnchor(form.weekIdx) : form.date
    const text   = deleteIt ? '' : form.text.trim()
    if (!anchor || (!deleteIt && !text)) return
    const liste = form.scope === 'week' ? weekNotes : form.scope === 'question' ? questions : dayNotes
    const vorhanden = liste.find(n => n.anchor === anchor)
    if (!vorhanden && form.scope !== 'week' && !anchor.startsWith(`${year}-${String(month).padStart(2, '0')}`)) {
      setSaveError('Das Datum muss im angezeigten Monat liegen.')
      return
    }
    // Optional range end (to), only when the day/week has no notes yet
    let toArg: string | null = null
    if (!vorhanden) {
      if (form.scope === 'week') {
        if (form.weekIdxTo > form.weekIdx) toArg = weekAnchor(form.weekIdxTo)
      } else if (form.dateTo && form.dateTo !== form.date) {
        if (form.dateTo < form.date) {
          setSaveError('Das Bis-Datum liegt vor dem Von-Datum.')
          return
        }
        toArg = form.dateTo
      }
    }
    setNoteSaving(true)
    setSaveError(null)
    startTransition(async () => {
      const r = await safe(() => planNotizEintrag(form.scope, anchor, year, month, { index: null, text, to: toArg }))
      if ('error' in r) {
        setSaveError(r.error ?? 'Speichern fehlgeschlagen.')
      } else {
        const neu: PlanPeriodNote = { anchor: r.anchor, note: r.note, by: r.by, to: r.to, eintraege: r.eintraege }
        const update = (prev: PlanPeriodNote[]): PlanPeriodNote[] => {
          const rest = prev.filter(n => n.anchor !== r.anchor)
          return (neu.eintraege.length ? [...rest, neu] : rest).sort((x, y) => x.anchor.localeCompare(y.anchor))
        }
        if (form.scope === 'day') setDayNotes(update)
        else if (form.scope === 'week') setWeekNotes(update)
        else setQuestions(update)
        setPeriodForm(null)
        router.refresh()
      }
      setNoteSaving(false)
    })
  }

  // ── Options / publish state ──
  const [showOptions,       setShowOptions]       = useState(false)
  const [showChangeLog,     setShowChangeLog]     = useState(false)
  const [publishedState,    setPublishedState]    = useState(isPublished)
  const [publishing,        setPublishing]        = useState(false)
  const [releasedState,     setReleasedState]     = useState(leitendeReleased)
  const [releasing,         setReleasing]         = useState(false)
  // Month navigation reuses this client component, so the fresh per-month
  // status from the server must replace the previous month's local state —
  // otherwise October's «Veröffentlicht» appears to stick to every month.
  useEffect(() => { setPublishedState(isPublished) }, [isPublished, year, month])
  useEffect(() => { setReleasedState(leitendeReleased) }, [leitendeReleased, year, month])

  // ── Responsive layout ──
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  // ── View mode: whole month fitted to screen width, or a single week ──
  const daysInMonth = new Date(year, month, 0).getDate()
  const [view, setView] = useState<'month' | number>('month')
  const gridWrapRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(0)
  useEffect(() => {
    const el = gridWrapRef.current
    if (!el) return
    const update = () => setContainerW(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [employees.length])

  // Calendar weeks (Mo–So) of the month, labelled with their ISO week number
  const weeks = useMemo(() => {
    const list: { start: number; end: number; wn: number }[] = []
    for (let d = 1; d <= daysInMonth; ) {
      const dow = new Date(year, month - 1, d).getDay()
      const end = Math.min(daysInMonth, d + (dow === 0 ? 0 : 7 - dow))
      list.push({ start: d, end, wn: isoWeekNumber(dateStr(year, month, d)) })
      d = end + 1
    }
    return list
  }, [year, month, daysInMonth])

  const detailCellW = isMobile ? 26 : CELL_W
  const detailNameW = isMobile ? 36 : NAME_W
  // If the full-size grid already fits the container, no fitting (and no toggle) is needed.
  const tableFits = containerW === 0 || containerW >= detailNameW + daysInMonth * detailCellW

  // On SMALL screens (phones, portrait tablets — viewport below 1024px) the
  // full month grid is cramped, so the plan opens in the CURRENT week's view
  // by default («Ganzer Monat» stays one tap away). Computers and laptops
  // always land on the whole month, even when the grid needs the fitted
  // view. Applied once per visit, only while the shown month is today's.
  const autoWeekDone = useRef(false)
  useEffect(() => {
    if (autoWeekDone.current || containerW === 0) return
    autoWeekDone.current = true
    if (tableFits) return
    if (window.innerWidth >= 1024) return
    const nowZ = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Zurich' }))
    if (nowZ.getFullYear() !== year || nowZ.getMonth() + 1 !== month) return
    const today = nowZ.getDate()
    const idx = weeks.findIndex(w => today >= w.start && today <= w.end)
    if (idx >= 0) setView(idx)
  }, [containerW, tableFits, year, month, weeks])
  const selectedWeek = typeof view === 'number' && view < weeks.length && !tableFits ? view : null
  const weekView = selectedWeek !== null ? weeks[selectedWeek] : null
  const fitActive = !tableFits && !weekView

  const days = weekView
    ? Array.from({ length: weekView.end - weekView.start + 1 }, (_, i) => weekView.start + i)
    : Array.from({ length: daysInMonth }, (_, i) => i + 1)

  const fitNameW  = isMobile ? 24 : 110
  const weekNameW = isMobile ? 110 : NAME_W
  const cellW = weekView
    ? Math.max(30, Math.floor((containerW - weekNameW) / days.length))
    : fitActive
      ? Math.min(detailCellW, Math.max(8, Math.floor((containerW - fitNameW) / daysInMonth)))
      : detailCellW
  const nameW = weekView ? weekNameW : fitActive ? fitNameW : detailNameW

  // In the week view even mobile gets full-size cells, names and weekday labels
  const mobileCompact = isMobile && !weekView

  // Font/row metrics shrink with the fitted cell width
  const dayNumPx    = fitActive ? (cellW >= 18 ? 10 : cellW >= 12 ? 8 : 6.5) : (mobileCompact ? 9 : 11)
  const entryPx     = fitActive ? (cellW >= 18 ? 9  : cellW >= 12 ? 7.5 : 6) : (mobileCompact ? 8 : 9.5)
  const rowH        = fitActive ? (isMobile ? 24 : 26) : (mobileCompact ? 28 : 30)
  const showWeekday = weekView ? true : !isMobile && (!fitActive || cellW >= 13)

  // ── Day/week note bands (rendered above the day headers) ──
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`
  function weekAnchor(weekIdx: number): string {
    const w = weeks[weekIdx]
    return w ? mondayOf(dateStr(year, month, w.start)) : ''
  }
  function weekIdxForAnchor(anchor: string): number {
    const idx = weeks.findIndex(w => mondayOf(dateStr(year, month, w.start)) === anchor)
    return idx >= 0 ? idx : 0
  }
  // Day-of-month offset of a date (may be ≤ 0 / > daysInMonth for other months)
  function offsetInMonth(ds: string): number {
    const d  = new Date(ds + 'T12:00:00Z')
    const ms = new Date(`${monthPrefix}-01T12:00:00Z`)
    return Math.round((d.getTime() - ms.getTime()) / 86400000) + 1
  }
  // Day-of-month span a date range covers in this month
  function rangeInMonth(fromDs: string, toDs: string): { start: number; end: number } | null {
    const start = Math.max(1, offsetInMonth(fromDs))
    const end   = Math.min(daysInMonth, offsetInMonth(toDs))
    return start <= end ? { start, end } : null
  }
  // Which week (index into `weeks`) a date belongs to, clamped to this month
  function weekIdxForDate(ds: string): number {
    if (ds < `${monthPrefix}-01`) return 0
    if (!ds.startsWith(monthPrefix)) return weeks.length - 1
    const day = parseInt(ds.slice(8), 10)
    const idx = weeks.findIndex(w => day >= w.start && day <= w.end)
    return idx >= 0 ? idx : 0
  }

  type NoteBand = { start: number; end: number; note: string; by: string | null; anchor: string; to: string | null; scope: 'day' | 'week' }
  const firstVisible = days[0]
  const lastVisible  = days[days.length - 1]
  function clipToVisible(start: number, end: number) {
    const s = Math.max(start, firstVisible)
    const e = Math.min(end, lastVisible)
    return s <= e ? { s, e } : null
  }
  const weekBands: NoteBand[] = !planNotes ? [] : weekNotes.flatMap(n => {
    const r = rangeInMonth(n.anchor, n.to ?? sundayOf(n.anchor))
    const c = r && clipToVisible(r.start, r.end)
    return c ? [{ start: c.s, end: c.e, note: n.note, by: n.by, anchor: n.anchor, to: n.to, scope: 'week' as const }] : []
  }).sort((a, b) => a.start - b.start)
  const dayBands: NoteBand[] = !planNotes ? [] : dayNotes.flatMap(n => {
    const r = rangeInMonth(n.anchor, n.to ?? n.anchor)
    const c = r && clipToVisible(r.start, r.end)
    return c ? [{ start: c.s, end: c.e, note: n.note, by: n.by, anchor: n.anchor, to: n.to, scope: 'day' as const }] : []
  }).sort((a, b) => a.start - b.start)

  /** Eigene Notiz zu einem Tag, einer Woche oder einem fraglichen Termin
   *  anfügen (auch vom Band über dem Plan aus): Anker und Zeitraum sind
   *  gegeben, der Text ist neu. */
  function openPeriodEdit(n: { scope: PeriodScope; anchor: string; to?: string | null }) {
    if (!canEdit) return
    setShowNoteMenu(false)
    setMonthEditing(null)
    const wi = n.scope === 'week' ? weekIdxForAnchor(n.anchor) : 0
    setPeriodForm({
      scope:     n.scope,
      date:      n.scope !== 'week' ? n.anchor : dateStr(year, month, 1),
      dateTo:    n.scope !== 'week' ? (n.to ?? '') : '',
      weekIdx:   wi,
      weekIdxTo: n.scope === 'week' ? (n.to ? weekIdxForDate(n.to) : wi) : 0,
      text:      '',
      fix:       true,
    })
  }
  /** Einen bestehenden Eintrag im Dialog bearbeiten (Tag, Kürzel, Text) oder löschen. */
  function openEintragEdit(g: { scope: PeriodScope; anchor: string; to: string | null; eintraege: NoteEntry[] }, index: number) {
    if (!canEdit) return
    const e = g.eintraege[index]
    if (!e) return
    setShowNoteMenu(false); setMonthEditing(null); setPeriodForm(null); setMonatsForm(null); setBearbErr(null)
    const wi = g.scope === 'week' ? weekIdxForAnchor(g.anchor) : 0
    setBearbeiten({
      von: { scope: g.scope, anchor: g.anchor, index },
      scope: g.scope,
      date: g.scope !== 'week' ? g.anchor : '',
      dateTo: g.scope !== 'week' ? (g.to ?? '') : '',
      weekIdx: wi,
      weekIdxTo: g.scope === 'week' && g.to ? weekIdxForDate(g.to) : wi,
      by: e.by ?? '',
      text: e.text,
      at: e.at,
    })
  }
  function openMonatsEintragEdit(index: number) {
    if (!canEdit) return
    const e = sharedNote.eintraege[index]
    if (!e) return
    setShowNoteMenu(false); setMonthEditing(null); setPeriodForm(null); setMonatsForm(null); setBearbErr(null)
    const heute = zurichHeute()
    setBearbeiten({
      von: { scope: 'month', anchor: null, index },
      scope: 'month',
      date: heute.startsWith(`${year}-${String(month).padStart(2, '0')}`) ? heute : '',
      dateTo: '', weekIdx: 0, weekIdxTo: 0,
      by: e.by ?? '', text: e.text, at: e.at,
    })
  }
  /** Geänderte Zeilen aus dem Server in die Listen übernehmen (Quelle und Ziel). */
  function zeilenUebernehmen(zeilen: Array<{ scope: NotizScope; anchor: string; note: string; by: string | null; to: string | null; eintraege: NoteEntry[] }>) {
    for (const z of zeilen) {
      if (z.scope === 'month') { setSharedNote({ text: z.note, by: z.by, to: null, eintraege: z.eintraege }); continue }
      const update = (prev: PlanPeriodNote[]): PlanPeriodNote[] => {
        const rest = prev.filter(n => n.anchor !== z.anchor)
        return (z.eintraege.length ? [...rest, { anchor: z.anchor, note: z.note, by: z.by, to: z.to, eintraege: z.eintraege }] : rest)
          .sort((a, b) => a.anchor.localeCompare(b.anchor))
      }
      if (z.scope === 'day') setDayNotes(update)
      else if (z.scope === 'week') setWeekNotes(update)
      else setQuestions(update)
    }
  }
  function bearbeitenSpeichern() {
    if (!bearbeiten) return
    const b = bearbeiten
    const text = b.text.trim()
    if (!text) { setBearbErr('Bitte einen Text eingeben, zum Entfernen «Löschen» verwenden.'); return }
    let anchor: string | null = null
    let to: string | null = null
    if (b.scope === 'week') {
      anchor = weekAnchor(b.weekIdx)
      if (b.weekIdxTo > b.weekIdx) to = weekAnchor(b.weekIdxTo)
    } else if (b.scope !== 'month') {
      if (!b.date) { setBearbErr('Bitte einen Tag wählen.'); return }
      anchor = b.date
      if (b.dateTo && b.dateTo > b.date) to = b.dateTo
    }
    setBearbBusy(true); setBearbErr(null)
    startTransition(async () => {
      const r = await safe(() => planNotizEintragBearbeiten(year, month, b.von, { scope: b.scope, anchor, to, by: b.by.trim() || null, text }))
      if ('error' in r) setBearbErr(r.error ?? 'Speichern fehlgeschlagen.')
      else { zeilenUebernehmen(r.zeilen); setBearbeiten(null); router.refresh() }
      setBearbBusy(false)
    })
  }
  function bearbeitenLoeschen() {
    if (!bearbeiten) return
    const b = bearbeiten
    if (!confirm('Diesen Eintrag löschen?')) return
    setBearbBusy(true); setBearbErr(null)
    const quelle = b.von.scope
    startTransition(async () => {
      if (quelle === 'month') {
        const r = await safe(() => planMonatsnotizEintrag(year, month, { index: b.von.index, text: '' }))
        if ('error' in r) { setBearbErr(r.error ?? 'Löschen fehlgeschlagen.'); setBearbBusy(false); return }
        setSharedNote(r.note)
      } else {
        const r = await safe(() => planNotizEintrag(quelle, b.von.anchor ?? '', year, month, { index: b.von.index, text: '' }))
        if ('error' in r) { setBearbErr(r.error ?? 'Löschen fehlgeschlagen.'); setBearbBusy(false); return }
        zeilenUebernehmen([{ scope: quelle, anchor: r.anchor, note: r.note, by: r.by, to: r.to, eintraege: r.eintraege }])
      }
      setBearbeiten(null)
      router.refresh()
      setBearbBusy(false)
    })
  }
  /** Neue Notiz über das Menü: Tag vorbelegt mit heute, wenn heute im Monat liegt. */
  function neueNotiz(scope: PeriodScope) {
    setShowNoteMenu(false)
    setMonthEditing(null)
    const heute = zurichHeute()
    setPeriodForm({ scope, date: heute.startsWith(`${year}-${String(month).padStart(2, '0')}`) ? heute : '', dateTo: '', weekIdx: 0, weekIdxTo: 0, text: '' })
  }
  // Alle Notizen des Monats als Liste, nach Datum: Wochen, Tage, fragliche Termine
  type NotizGruppe = PlanPeriodNote & { scope: PeriodScope }
  const NOTIZ_ORDNUNG: Record<PeriodScope, number> = { week: 0, day: 1, question: 2 }
  const notizGruppen: NotizGruppe[] = !planNotes ? [] : [
    ...weekNotes.map(n => ({ ...n, scope: 'week' as const })),
    ...dayNotes.map(n => ({ ...n, scope: 'day' as const })),
    ...questions.map(n => ({ ...n, scope: 'question' as const })),
  ].sort((a, b) => a.anchor.localeCompare(b.anchor) || NOTIZ_ORDNUNG[a.scope] - NOTIZ_ORDNUNG[b.scope])
  /** «Mo 03.11.», «3.–5.11.», «KW 46 · 9.–15.11.» */
  function gruppenLabel(n: { scope: PeriodScope; anchor: string; to: string | null }): string {
    if (n.scope === 'week') return `KW ${isoWeekNumber(n.anchor)} · ${periodLabel(n)}`
    if (n.to) return periodLabel(n)
    const d = new Date(`${n.anchor}T12:00:00`)
    return `${DAY_SHORT[d.getDay()]} ${n.anchor.slice(8, 10)}.${n.anchor.slice(5, 7)}.`
  }

  // "12.8." / "12.–15.8." for day notes & questions, "3.–16.8." for week notes
  function periodLabel(n: { scope: PeriodScope; anchor: string; to?: string | null }): string {
    const to = n.to ?? null
    if (n.scope !== 'week') {
      const d1 = parseInt(n.anchor.slice(8), 10)
      const m1 = parseInt(n.anchor.slice(5, 7), 10)
      if (!to) return `${d1}.${m1}.`
      const d2 = parseInt(to.slice(8), 10)
      const m2 = parseInt(to.slice(5, 7), 10)
      return m1 === m2 ? `${d1}.–${d2}.${m1}.` : `${d1}.${m1}. – ${d2}.${m2}.`
    }
    const r = rangeInMonth(n.anchor, to ?? sundayOf(n.anchor))
    return r ? `${r.start}.–${r.end}.${month}.` : ''
  }

  function bandCells(bands: NoteBand[]) {
    const cells: React.ReactNode[] = []
    let i = 0
    while (i < days.length) {
      const d = days[i]
      const band = bands.find(b => b.start === d)
      if (band) {
        const span = band.end - d + 1
        cells.push(
          <td key={`b${d}`} colSpan={span} className="p-0 align-middle">
            <div
              title={`${periodLabel(band)} ${band.note}${band.by ? ` · ${band.by}` : ''}`}
              onClick={canEdit ? () => openPeriodEdit(band) : undefined}
              className={`rounded-full bg-lilac-bg border border-lilac-ink/25 text-lilac-ink font-semibold px-1.5 flex items-center overflow-hidden whitespace-nowrap ${
                canEdit ? 'cursor-pointer hover:border-lilac-ink/60' : ''
              }`}
              style={{ height: fitActive ? 13 : 16, fontSize: fitActive ? 8 : 9.5, margin: '2px 1px' }}
            >{band.note}{band.by ? ` · ${band.by}` : ''}</div>
          </td>
        )
        i += span
      } else {
        cells.push(<td key={`e${d}`} className="p-0" />)
        i++
      }
    }
    return cells
  }

  // ── Soll-Zeit ──
  const workingDays = countWorkingDays(year, month)
  const soll100     = workingDays * 8.5
  const PENSUM_STEPS = [100, 90, 80, 70, 60, 50, 40, 30, 20]

  function fmtHM(decHours: number): string {
    const h = Math.floor(decHours)
    const m = Math.round((decHours - h) * 60)
    return `${h}:${String(m).padStart(2, '0')}`
  }

  // ── Base map ──
  const baseMap: Record<string, string> = {}
  entries.forEach(e => { baseMap[`${e.employee_id}_${e.schedule_date}`] = e.entry })

  const getValue = useCallback((empId: string, day: number) => {
    const key = `${empId}_${dateStr(year, month, day)}`
    return firstPart(overrides[key] ?? baseMap[key] ?? '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides, entries, year, month])

  const todayStr = dateStr(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate())

  // ── Navigation ──
  function navMonth(delta: number) {
    let mo = month + delta, y = year
    if (mo > 12) { mo = 1;  y++ }
    if (mo < 1)  { mo = 12; y-- }
    router.push(`${basePath}?m=${y}-${String(mo).padStart(2,'0')}`)
  }

  const planPdfUrl = `/api/arbeitsplan-pdf?m=${year}-${String(month).padStart(2, '0')}`

  // ── Cell editing ──
  // `preset` replaces the cell's value in the input (browse mode: type to edit)
  function startEdit(empId: string, day: number, cell: HTMLElement, preset?: string) {
    if (!canEdit) return
    const key = `${empId}_${dateStr(year, month, day)}`
    if (editingKey === key) return

    const rawVal = getValue(empId, day)
    const sm = rawVal.match(PLAN_SHIFT_RE)

    setEditingKey(key)
    setEditingEmpId(empId)
    setEditingDay(day)
    setEditCellRect(cell.getBoundingClientRect())
    setEditValue(preset !== undefined ? preset : (sm ? sm[1] : rawVal))
    setEditShift(preset !== undefined ? 'none' : sm ? sm[2].toLowerCase() as ShiftKey : 'none')

    setTimeout(() => {
      inputRef.current?.focus()
      if (preset === undefined) inputRef.current?.select()
    }, 0)
  }

  function commitEdit() {
    if (!editingKey) return
    const ds      = dateStr(year, month, editingDay)
    const key     = `${editingEmpId}_${ds}`
    const trimmed = editValue.trim()
    const isRoom  = PLAN_POSITION_RE.test(trimmed)
    const encoded = isRoom && editShift !== 'none' ? `${trimmed}${editShift}` : trimmed
    const current = getValue(editingEmpId, editingDay)
    const unchanged = encoded === current

    // Protect planned vacations (from the Ferienplanung) from silent overwrites
    if (!unchanged && ferienWeight(current) != null && ferienWeight(encoded) == null) {
      if (!confirm('Dieser Tag ist als Ferien geplant (Ferienplanung). Wirklich überschreiben?')) {
        setSelCell({ empId: editingEmpId, day: editingDay })
        setEditingKey(null)
        setEditCellRect(null)
        setEditShift('none')
        return
      }
    }

    setSelCell({ empId: editingEmpId, day: editingDay })
    setEditingKey(null)
    setEditCellRect(null)
    setEditShift('none')
    if (unchanged) return

    setOverrides(prev => ({ ...prev, [key]: encoded }))
    setSaveError(null)

    const empId = editingEmpId
    startTransition(async () => {
      const result = await safe(() => upsertShift(empId, ds, encoded))
      if (result?.error) {
        setSaveError(result.error)
      } else {
        scheduleRefresh()
      }
    })
  }

  /** Excel-style keyboard navigation: commit the current cell and open the
   *  editor on the neighbouring cell (dRow = employee rows, dCol = days).
   *  Returns false when the move would leave the grid. */
  function moveEdit(dRow: number, dCol: number): boolean {
    if (!editingKey) return false
    const flat   = groups.flatMap(g => g.emps)
    const rowIdx = flat.findIndex(e => e.id === editingEmpId)
    const colIdx = days.indexOf(editingDay)
    if (rowIdx < 0 || colIdx < 0) return false
    const nr = rowIdx + dRow
    const nc = colIdx + dCol
    if (nr < 0 || nr >= flat.length || nc < 0 || nc >= days.length) return false
    const empId = flat[nr].id
    const day   = days[nc]
    commitEdit()
    setTimeout(() => {
      const cell = document.querySelector<HTMLElement>(`[data-cell="${empId}_${day}"]`)
      if (cell) {
        cell.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        startEdit(empId, day, cell)
      }
    }, 0)
    return true
  }

  function cancelEdit() {
    if (editingKey) setSelCell({ empId: editingEmpId, day: editingDay })
    setEditingKey(null)
    setEditCellRect(null)
    setEditShift('none')
  }

  // Commit a specific value immediately (used by quick-pick buttons like ✓)
  function commitWithValue(val: string) {
    if (!editingKey) return
    const current = getValue(editingEmpId, editingDay)
    if (ferienWeight(current) != null && ferienWeight(val) == null && val !== current) {
      if (!confirm('Dieser Tag ist als Ferien geplant (Ferienplanung). Wirklich überschreiben?')) return
    }
    const ds  = dateStr(year, month, editingDay)
    const key = `${editingEmpId}_${ds}`
    setSelCell({ empId: editingEmpId, day: editingDay })
    setOverrides(prev => ({ ...prev, [key]: val }))
    setEditingKey(null)
    setEditCellRect(null)
    setEditShift('none')
    setSaveError(null)
    const empId = editingEmpId
    startTransition(async () => {
      const result = await safe(() => upsertShift(empId, ds, val))
      if (result?.error) setSaveError(result.error)
      else scheduleRefresh()
    })
  }

  // ── Bulk planning actions (Vormonat, Standardwochen, Tag kopieren) ──
  const [bulkBusy,   setBulkBusy]   = useState(false)
  const [copyDayDlg, setCopyDayDlg] = useState<{ from: number; to: number } | null>(null)

  function runBulk(
    fn: () => Promise<{ error?: string; filled?: number } | undefined>,
    doneMsg: (filled: number) => string,
  ) {
    setBulkBusy(true)
    setSaveError(null)
    setInfoMsg(null)
    startTransition(async () => {
      const res = await safe(fn)
      if (res?.error) setSaveError(res.error)
      else {
        setInfoMsg(doneMsg((res as { filled?: number } | undefined)?.filled ?? 0))
        router.refresh()
      }
      setBulkBusy(false)
    })
  }

  function handleCopyPrev() {
    setShowOptions(false)
    if (!confirm(`${MONTH_NAMES[month - 1]} mit dem Muster des Vormonats füllen?\nBestehende Einträge werden überschrieben — nur geplante Ferien bleiben. Ferien/Krank des Vormonats werden nicht kopiert.`)) return
    runBulk(() => copyPreviousMonth(year, month), n => `${n} Zellen aus dem Vormonat übernommen.`)
  }

  function handleApplyStandards() {
    setShowOptions(false)
    if (!confirm('Leere Zellen mit den Standardwochen der Mitarbeitenden füllen?\nBestehende Einträge bleiben unverändert.')) return
    runBulk(() => applyStandardWeeks(year, month), n => `${n} Zellen aus Standardwochen gefüllt.`)
  }

  function handleCopyDay() {
    if (!copyDayDlg) return
    const { from, to } = copyDayDlg
    setCopyDayDlg(null)
    runBulk(() => copyScheduleDay(year, month, from, to), n => `Tag ${from}. auf Tag ${to}. kopiert (${n} Einträge).`)
  }

  // Einsatz anfragen (Personen mit Verfügbarkeitsliste, z.B. Emese): der Wert
  // der Zelle wird gespeichert und zugleich als Anfrage unter «Einsätze, an
  // denen wir … brauchen» eingetragen (Liste unter dem Plan), damit niemand
  // Tag und Position von Hand abschreiben muss.
  const editingEmp = employees.find(e => e.id === editingEmpId)
  const anfrageWert = (() => { const t = editValue.trim(); return PLAN_POSITION_RE.test(t) && editShift !== 'none' ? `${t}${editShift}` : t })()
  const anfragePerson = !!editingEmp && istVerfuegbarkeitPerson(editingEmp.full_name)
  const anfrageMoeglich = anfragePerson && planPositionAnfragbar(anfrageWert)
  function handleEinsatzAnfragen() {
    if (!editingKey || !anfrageMoeglich) return
    const empId = editingEmpId
    const ds = dateStr(year, month, editingDay)
    const position = anfrageWert
    commitEdit()
    setSaveError(null)
    startTransition(async () => {
      const r = await safe(() => einsatzAnfrageHinzufuegen(empId, year, month, { datum: ds, position, zeit: '' }))
      if (r && 'error' in r && r.error) setSaveError(r.error)
      else {
        setInfoMsg(`Einsatz angefragt: ${tagKurz(ds)}, ${positionText(position)}. Die Anfrage steht unten bei der Verfügbarkeit.`)
        router.refresh()
      }
    })
  }

  // Popup button: apply the current value to Mo–Fr of the edited day's week
  function handleApplyWeek() {
    if (!editingKey) return
    const trimmed = editValue.trim()
    const isRoom  = PLAN_POSITION_RE.test(trimmed)
    const encoded = isRoom && editShift !== 'none' ? `${trimmed}${editShift}` : trimmed
    if (!encoded) return
    const empId = editingEmpId
    const ds    = dateStr(year, month, editingDay)
    setSelCell({ empId, day: editingDay })
    setEditingKey(null)
    setEditCellRect(null)
    setEditShift('none')

    const monday = mondayOf(ds)
    const newOv: Record<string, string> = {}
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday + 'T12:00:00Z')
      d.setUTCDate(d.getUTCDate() + i)
      const t = d.toISOString().slice(0, 10)
      if (!t.startsWith(`${year}-${String(month).padStart(2, '0')}`)) continue
      if (ferienWeight(getValue(empId, parseInt(t.slice(8), 10))) != null) continue
      newOv[`${empId}_${t}`] = encoded
    }
    setOverrides(prev => ({ ...prev, ...newOv }))
    setSaveError(null)
    startTransition(async () => {
      const res = await safe(() => applyWeekValue(empId, ds, encoded))
      if (res?.error) setSaveError(res.error)
      else scheduleRefresh()
    })
  }

  // ── Leitende release toggle ──
  async function handleReleaseToggle() {
    setReleasing(true)
    setShowOptions(false)
    if (releasedState) {
      const r = await safe(() => unreleaseMonthFromLeitende(year, month))
      if (r?.error) setSaveError(r.error)
      else setReleasedState(false)
    } else {
      const r = await safe(() => releaseMonthToLeitende(year, month))
      if (r?.error) setSaveError(r.error)
      else setReleasedState(true)
    }
    setReleasing(false)
  }

  // ── Publish / unpublish ──
  async function handlePublishToggle() {
    setPublishing(true)
    setShowOptions(false)
    if (publishedState) {
      const r = await safe(() => unpublishMonth(year, month))
      if (r?.error) setSaveError(r.error)
      else setPublishedState(false)
    } else {
      const r = await safe(() => publishMonth(year, month))
      if (r?.error) setSaveError(r.error)
      else setPublishedState(true)
    }
    setPublishing(false)
  }

  // ── Groups ──
  // Leavers disappear from their departure month on, late starters
  // (e.g. externe Ferienvertretung) appear only from their first month.
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const visibleEmployees = employees.filter(e => planRowVisible(e.full_name, monthKey))
  const groups = GROUPS
    .map(g => ({ ...g, emps: visibleEmployees.filter(e => g.match(e.job_title)) }))
    .filter(g => g.emps.length > 0)

  const totalCols = days.length + 1

  // ── Browse mode: document-level keys act on the selected cell ──
  const browseRef = useRef({
    canEdit,
    editing: false,
    selCell: null as { empId: string; day: number } | null,
    flat: [] as Employee[],
    days: [] as number[],
  })
  browseRef.current = { canEdit, editing: !!editingKey, selCell, flat: groups.flatMap(g => g.emps), days }
  const openCellRef = useRef<(empId: string, day: number, preset?: string) => void>(() => {})
  openCellRef.current = (empId, day, preset) => {
    const cell = document.querySelector<HTMLElement>(`[data-cell="${empId}_${day}"]`)
    if (cell) {
      cell.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      startEdit(empId, day, cell, preset)
    }
  }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e as KeyboardEvent & { __planEditorHandled?: boolean }).__planEditorHandled) return
      const st = browseRef.current
      if (!st.canEdit || st.editing || !st.selCell) return
      const ae = document.activeElement as HTMLElement | null
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return
      const sel = st.selCell
      const ri  = st.flat.findIndex(x => x.id === sel.empId)
      const ci  = st.days.indexOf(sel.day)
      if (ri < 0 || ci < 0) return
      const moveSel = (dr: number, dc: number) => {
        const nr = Math.min(st.flat.length - 1, Math.max(0, ri + dr))
        const nc = Math.min(st.days.length - 1, Math.max(0, ci + dc))
        const empId = st.flat[nr].id
        const day   = st.days[nc]
        setSelCell({ empId, day })
        document.querySelector(`[data-cell="${empId}_${day}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
      if      (e.key === 'ArrowRight') { e.preventDefault(); moveSel(0, 1) }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); moveSel(0, -1) }
      else if (e.key === 'ArrowDown')  { e.preventDefault(); moveSel(1, 0) }
      else if (e.key === 'ArrowUp')    { e.preventDefault(); moveSel(-1, 0) }
      else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); openCellRef.current(sel.empId, sel.day) }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); openCellRef.current(sel.empId, sel.day, '') }
      else if (e.key === 'Escape') setSelCell(null)
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        openCellRef.current(sel.empId, sel.day, e.key)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // ── Besetzungs-Check (coverage per day) — shown to plan editors only ──
  type Coverage = { status: 'ok' | 'warn' | 'bad' | 'none'; problems: string[] }
  function coverageFor(day: number): Coverage {
    const vals = visibleEmployees.map(e => ({ e, v: getValue(e.id, day) }))
    // digits in F:0.5 are weights, not rooms
    const numsOf = (v: string): number[] =>
      !v || ferienWeight(v) != null ? [] : (v.match(/\d+/g) ?? []).map(Number)
    const hasWork = vals.some(({ v }) => v && (numsOf(v).length > 0 || v.trim() === '✓'))
    if (!hasWork) return { status: 'none', problems: [] }

    const problems: string[] = []
    for (const { e, v } of vals) {
      if (e.job_title !== 'ZAZ') continue
      for (const r of numsOf(v).filter(n => n >= 1 && n <= 5)) {
        const assisted = vals.some(({ e: o, v: ov }) => o.job_title !== 'ZAZ' && numsOf(ov).includes(r))
        if (!assisted) problems.push(`Zimmer ${r} (${e.full_name.split(' ')[0]}) ohne Assistenz`)
      }
    }
    const all = vals.flatMap(({ v }) => numsOf(v))
    if (!all.includes(7)) problems.push('Kein Steri (7)')
    if (!all.includes(6) && !all.includes(9)) problems.push('Kein Empfang (6/9)')
    const hardOk = problems.length === 0
    if (!all.includes(8)) problems.push('Keine Tagesleitung (8)')
    if (problems.length === 0) return { status: 'ok', problems: [] }
    return { status: hardOk ? 'warn' : 'bad', problems }
  }

  // ── Floating popup position ──
  const POPUP_W = 160
  const POPUP_H = 134
  let popupTop  = 0
  let popupLeft = 0
  if (editCellRect && typeof window !== 'undefined') {
    const vpW = window.innerWidth
    const vpH = window.innerHeight
    // On mobile: centre the popup
    if (vpW < 640) {
      popupTop  = Math.max(60, (vpH - POPUP_H) / 2 - 40)
      popupLeft = (vpW - POPUP_W) / 2
    } else {
      popupTop  = vpH - editCellRect.bottom > POPUP_H + 8
        ? editCellRect.bottom + 4
        : editCellRect.top - POPUP_H - 4
      popupLeft = Math.max(8, Math.min(
        editCellRect.left + (cellW - POPUP_W) / 2,
        vpW - POPUP_W - 8,
      ))
    }
  }

  return (
    <div className="flex flex-col">

      {/* ── Save error toast ── */}
      {saveError && (
        <div className="flex items-center gap-2 mx-4 mt-3 px-3 py-2 bg-blush-bg border border-blush-ink/30 rounded-ctl text-xs text-blush-ink">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span>{saveError}</span>
          <button onClick={() => setSaveError(null)} className="ml-auto opacity-60 hover:opacity-100">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Info toast (bulk action results) ── */}
      {infoMsg && (
        <div className="flex items-center gap-2 mx-4 mt-3 px-3 py-2 bg-mint-bg border border-mint-ink/30 rounded-ctl text-xs text-mint-ink">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          <span>{infoMsg}</span>
          <button onClick={() => setInfoMsg(null)} className="ml-auto opacity-60 hover:opacity-100">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Month navigation ── */}
      <div className="px-6 py-4 border-b border-edge-soft bg-white z-10 sm:sticky sm:top-0">
        <div className="flex items-center justify-center gap-[18px]">
          <button
            onClick={() => navMonth(-1)}
            className="w-[30px] h-[30px] rounded-ctl border border-edge-ctl bg-white text-ink-2 hover:bg-edge-row transition-colors"
            title="Vorheriger Monat"
          >‹</button>

          <div className="text-center">
            <p className="text-base font-bold text-ink">{MONTH_NAMES[month - 1]} {year}</p>
            <p className="text-[11.5px] text-ink-3 mt-0.5 tnum">
              {weekView
                ? `Woche ${weeks[selectedWeek ?? 0].wn} · ${weekView.start}.${month}. – ${weekView.end}.${month}.`
                : `${daysInMonth} Tage · ${workingDays} Arbeitstage`}
              {' · '}
              {isAdmin ? (
                // Both audiences separately: Leitende see a month once it is
                // freigegeben OR veröffentlicht, the team only once published.
                <>
                  <span className={`font-semibold ${releasedState || publishedState ? 'text-steel-ink' : 'text-ink-4'}`}>
                    Leitende: {releasedState || publishedState ? 'freigegeben' : 'noch nicht'}
                  </span>
                  {' · '}
                  <span className={`font-semibold ${publishedState ? 'text-mint-ink' : 'text-ink-4'}`}>
                    Team: {publishedState ? 'veröffentlicht' : 'Entwurf'}
                  </span>
                </>
              ) : (
                <span className={`font-semibold ${publishedState ? 'text-mint-ink' : releasedState ? 'text-steel-ink' : 'text-mint-mid'}`}>
                  {publishedState ? 'Veröffentlicht' : releasedState ? 'Für Leitende freigegeben' : 'Entwurf'}
                </span>
              )}
            </p>
          </div>

          <button
            onClick={() => navMonth(1)}
            className="w-[30px] h-[30px] rounded-ctl border border-edge-ctl bg-white text-ink-2 hover:bg-edge-row transition-colors"
            title="Nächster Monat"
          >›</button>

          {/* Plan as a real PDF file: open (view/print) and download.
              Plain same-origin links — reliable on desktop AND phone. */}
          <button
            onClick={() => { const w = window.open(planPdfUrl, '_blank'); if (!w) window.location.assign(planPdfUrl) }}
            className="p-2 rounded-ctl text-ink-4 hover:bg-edge-row hover:text-ink-2 transition-colors"
            title="Plan als PDF öffnen"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </button>
          <button
            onClick={() => window.location.assign(`${planPdfUrl}&dl=1`)}
            className="p-2 rounded-ctl text-ink-4 hover:bg-edge-row hover:text-ink-2 transition-colors"
            title="Plan als PDF herunterladen"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
          </button>

          {isAdmin && (
            <button
              onClick={() => setShowChangeLog(true)}
              className="p-2 rounded-ctl text-ink-4 hover:bg-edge-row hover:text-ink-2 transition-colors"
              title="Änderungen dieses Monats (Protokoll)"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          )}

          {canEdit && (
            <div className="relative">
              <button
                onClick={() => setShowOptions(v => !v)}
                className={`p-2 rounded-ctl transition-colors ${
                  showOptions ? 'bg-active text-ink' : 'text-ink-4 hover:bg-edge-row hover:text-ink-2'
                }`}
                title="Optionen"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>

              {showOptions && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setShowOptions(false)} />
                  <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-xl shadow-lg border border-edge-soft py-1.5 z-30">

                    {isAdmin && (<>
                    {/* Publish / unpublish */}
                    <button
                      onClick={handlePublishToggle}
                      disabled={publishing}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-hovrow transition-colors text-left disabled:opacity-50"
                    >
                      {publishedState ? (
                        <>
                          <svg className="w-4 h-4 text-ink-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                          </svg>
                          <span className="text-ink-2">{publishing ? 'Wird zurückgezogen…' : 'Veröffentlichung aufheben'}</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4 text-mint-ink flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                          </svg>
                          <span className="text-ink-2 font-medium">{publishing ? 'Wird veröffentlicht…' : `${MONTH_NAMES[month - 1]} veröffentlichen`}</span>
                        </>
                      )}
                    </button>

                    <div className="my-1 border-t border-edge-soft" />

                    {/* Leitende release (read + edit for Leitende DA before publication) */}
                    <button
                      onClick={handleReleaseToggle}
                      disabled={releasing}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-hovrow transition-colors text-left disabled:opacity-50"
                    >
                      <svg className={`w-4 h-4 flex-shrink-0 ${releasedState ? 'text-ink-4' : 'text-steel-ink'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 20.904a17.933 17.933 0 01-7.499-1.786z" />
                      </svg>
                      <span className="text-ink-2">
                        {releasing
                          ? 'Wird gespeichert…'
                          : releasedState
                            ? 'Freigabe für Leitende zurückziehen'
                            : 'Für Leitende freigeben'}
                      </span>
                    </button>

                    <div className="my-1 border-t border-edge-soft" />
                    </>)}

                    {/* Planning helpers */}
                    <button
                      onClick={handleCopyPrev}
                      disabled={bulkBusy}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-ink-2 hover:bg-hovrow transition-colors text-left disabled:opacity-50"
                    >
                      <svg className="w-4 h-4 text-ink-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
                      </svg>
                      {bulkBusy ? 'Wird ausgeführt…' : 'Vormonat übernehmen'}
                    </button>
                    <button
                      onClick={handleApplyStandards}
                      disabled={bulkBusy}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-ink-2 hover:bg-hovrow transition-colors text-left disabled:opacity-50"
                    >
                      <svg className="w-4 h-4 text-ink-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                      </svg>
                      Standardwochen anwenden
                    </button>
                    <button
                      onClick={() => { setShowOptions(false); setCopyDayDlg({ from: 1, to: 2 }) }}
                      disabled={bulkBusy}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-ink-2 hover:bg-hovrow transition-colors text-left disabled:opacity-50"
                    >
                      <svg className="w-4 h-4 text-ink-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5A3.375 3.375 0 006.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0015 2.25h-1.5a2.251 2.251 0 00-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 00-9-9z" />
                      </svg>
                      Tag kopieren…
                    </button>
                    {isAdmin && (
                      <a
                        href="/admin/arbeitsplan/standards"
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-ink-2 hover:bg-hovrow transition-colors text-left"
                      >
                        <svg className="w-4 h-4 text-ink-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round"
                            d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 20.904a17.933 17.933 0 01-7.499-1.786z" />
                        </svg>
                        Mitarbeiter-Standards…
                      </a>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Soll-Zeiten inline under the title */}
        <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-0.5 px-2 text-[10.5px] tnum leading-relaxed">
          {PENSUM_STEPS.map(p => (
            <span key={p} className="whitespace-nowrap text-ink-3">
              <span className="font-bold">{p}%</span>{' '}
              <span className="text-ink-2 font-semibold">{fmtHM(soll100 * p / 100)}</span>
            </span>
          ))}
        </div>

        {/* Whole-month / single-week toggle — only when the grid overflows the screen */}
        {!tableFits && (
          <div className="flex justify-center mt-3">
            <div className="inline-flex flex-wrap items-center justify-center gap-0.5 rounded-2xl bg-edge-row p-[3px]">
              <button
                onClick={() => setView('month')}
                className={`flex flex-col items-center px-3 py-1 rounded-xl text-[11px] font-semibold transition-colors ${
                  !weekView ? 'bg-white text-ink shadow-sm' : 'text-ink-3 hover:text-ink'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                  </svg>
                  Ganzer Monat
                </span>
                <span className="text-[9px] font-medium opacity-70 tnum">1.{month}. – {daysInMonth}.{month}.</span>
              </button>
              {weeks.map((w, i) => (
                <button
                  key={i}
                  onClick={() => setView(i)}
                  className={`flex flex-col items-center px-3 py-1 rounded-xl text-[11px] font-semibold transition-colors tnum ${
                    selectedWeek === i ? 'bg-white text-ink shadow-sm' : 'text-ink-3 hover:text-ink'
                  }`}
                >
                  <span>Woche {w.wn}</span>
                  <span className="text-[9px] font-medium opacity-70">{w.start}.{month}. – {w.end}.{month}.</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Planning notes (visible to plan editors only) ── */}
      {planNotes && (
        <div className="px-4 sm:px-6 py-3 border-b border-edge-soft bg-lilac-soft">
          <div className="max-w-2xl mx-auto space-y-2">

            {/* Header + add menu */}
            <div className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-lilac-label flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
              </svg>
              <span className="text-[10px] font-bold uppercase tracking-[.12em] text-lilac-label">
                Notizen zur Planung
              </span>
              {canEdit && !monthEditing && !periodForm && !monatsForm && (
                <div className="ml-auto relative">
                  <button
                    onClick={() => setShowNoteMenu(v => !v)}
                    className="text-[11px] font-semibold text-lilac-label hover:text-lilac-ink transition-colors"
                  >+ Notiz</button>
                  {showNoteMenu && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setShowNoteMenu(false)} />
                      <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-xl shadow-lg border border-edge-soft py-1 z-30">
                        <button
                          onClick={() => neueNotiz('day')}
                          className="w-full px-4 py-2 text-left text-[12.5px] text-ink-2 hover:bg-hovrow transition-colors"
                        >Notiz zu einem Tag</button>
                        <button
                          onClick={() => neueNotiz('week')}
                          className="w-full px-4 py-2 text-left text-[12.5px] text-ink-2 hover:bg-hovrow transition-colors"
                        >Notiz zu einer Woche</button>
                        <button
                          onClick={() => neueNotiz('question')}
                          className="w-full px-4 py-2 text-left text-[12.5px] text-ink-2 hover:bg-hovrow transition-colors"
                        >Fraglicher Termin</button>
                        <div className="my-1 border-t border-edge-soft" />
                        <button
                          onClick={() => { setShowNoteMenu(false); setPeriodForm(null); setMonthEditing(null); setMonatsForm({ text: '' }) }}
                          className="w-full px-4 py-2 text-left text-[12.5px] text-ink-2 hover:bg-hovrow transition-colors"
                        >Monatsnotiz{isAdmin ? ' — Admin + Leitende' : ''}</button>
                        {isAdmin && (
                          <button
                            onClick={() => { setShowNoteMenu(false); setPeriodForm(null); setMonthDraft(adminNote.text); setMonthEditing('admin') }}
                            className="w-full px-4 py-2 text-left text-[12.5px] text-ink-2 hover:bg-hovrow transition-colors flex items-center gap-1.5"
                          >
                            <svg className="w-3 h-3 text-ink-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                            </svg>
                            Monatsnotiz — nur Admin
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Monatsnotiz (Admin + Leitende): Einträge mit Kürzel */}
            {(sharedNote.eintraege.length > 0 || monatsForm) && (
              <div className="bg-white border border-lilac-ink/20 rounded-ctl px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-[10px] font-bold uppercase tracking-[.1em] text-lilac-label">Monatsnotiz{isAdmin ? ' · Admin + Leitende' : ''}</p>
                  <span className="flex-1" />
                  {isAdmin && canEdit && !monatsForm && sharedNote.eintraege.length > 0 && (
                    <button onClick={umwandlungOeffnen} className="text-[11px] font-semibold text-apricot-ink hover:underline"
                      title="Die Zeilen dieser Monatsnotiz den Tagen zuordnen, mit Kürzel vom Zeilenende; du prüfst die Vorschau, bevor gespeichert wird">
                      In Tagesnotizen umwandeln
                    </button>
                  )}
                  {canEdit && !monatsForm && (
                    <button onClick={() => { setPeriodForm(null); setMonthEditing(null); setMonatsForm({ text: '' }) }}
                      className="text-[11px] font-semibold text-lilac-label hover:text-lilac-ink" title="Eigene Notiz zum Monat anfügen">+ Notiz</button>
                  )}
                </div>
                {sharedNote.eintraege.length > 0 && (
                  <ul className="space-y-1">
                    {sharedNote.eintraege.map((e, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Kuerzel by={e.by} geaendert={e.geaendert} />
                        <span className="flex-1 min-w-0 text-[12.5px] text-ink-2 whitespace-pre-wrap leading-snug pt-[2px]">{e.text}</span>
                        {e.at && <span className="text-[9.5px] text-ink-4 tnum whitespace-nowrap pt-[4px]" title={`Notiert am ${fmtNotizZeit(e.at)}`}>{fmtNotizZeit(e.at)}</span>}
                        {canEdit && (
                          <button onClick={() => openMonatsEintragEdit(i)}
                            className="flex-shrink-0 text-lilac-label hover:text-lilac-ink transition-colors pt-[3px]" title="Diesen Eintrag bearbeiten: Tag, Kürzel, Text" aria-label="Eintrag bearbeiten">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                            </svg>
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {monatsForm && (
                  <div className="mt-2 space-y-2">
                    <p className="text-[11.5px] text-ink-3">Notiz zum Monat anfügen · sichtbar für Admin und Leitende</p>
                    <textarea
                      value={monatsForm.text}
                      maxLength={1000}
                      rows={2}
                      autoFocus
                      onChange={e => setMonatsForm(f => f && { ...f, text: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveMonatsEintrag() } }}
                      placeholder="z.B. Steri Schulung im Dezember, Termin folgt"
                      className="input-field w-full !py-1.5 !text-[12.5px] resize-y"
                    />
                    <p className="text-[10.5px] text-ink-4">Dein Kürzel und die Zeit kommen automatisch dazu. Für einen bestimmten Tag besser «+ Notiz» oben und den Tag wählen.</p>
                    <div className="flex flex-wrap items-center gap-2 justify-end">
                      <button onClick={() => setMonatsForm(null)} disabled={noteSaving} className="btn-secondary !px-3 !py-1 !text-xs">Abbrechen</button>
                      <button onClick={() => saveMonatsEintrag()} disabled={noteSaving || !monatsForm.text.trim()} className="btn-primary !px-3 !py-1 !text-xs">
                        {noteSaving ? 'Wird gespeichert…' : 'Hinzufügen'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Admin-only month note */}
            {isAdmin && monthEditing !== 'admin' && adminNote.text && (
              <div className="flex items-start gap-2">
                <p className="flex-1 min-w-0 text-[12.5px] text-ink-2 whitespace-pre-wrap leading-relaxed">{adminNote.text}</p>
                <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-[2px] rounded-full bg-white border border-lilac-ink/25 text-[9px] font-bold text-lilac-label uppercase tracking-wide">
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                  Nur Admin
                </span>
                <button
                  onClick={() => { setMonthDraft(adminNote.text); setMonthEditing('admin'); setPeriodForm(null) }}
                  className="flex-shrink-0 text-lilac-label hover:text-lilac-ink transition-colors" title="Bearbeiten"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                  </svg>
                </button>
              </div>
            )}

            {/* Month note editor */}
            {monthEditing && (
              <div>
                <p className="text-[10.5px] font-semibold text-ink-4 mb-1 flex items-center gap-1">
                  {monthEditing === 'admin' ? (
                    <>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                      </svg>
                      Nur für Sie als Admin sichtbar
                    </>
                  ) : 'Sichtbar für Admin und Leitende'}
                </p>
                <textarea
                  value={monthDraft}
                  onChange={e => setMonthDraft(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  autoFocus
                  placeholder="z.B. Melinda nur vormittags · Steri-Schulung am 12."
                  className="w-full text-[12.5px] text-ink border border-edge-ctl rounded-ctl px-3 py-2 resize-y bg-white focus:outline-none focus:ring-1 focus:ring-dusk placeholder:text-ink-4"
                />
                <div className="flex gap-2 mt-1.5 justify-end">
                  <button onClick={() => setMonthEditing(null)} disabled={noteSaving}
                    className="btn-secondary !px-3 !py-1 !text-xs"
                  >Abbrechen</button>
                  <button onClick={saveMonthNote} disabled={noteSaving}
                    className="btn-primary !px-3 !py-1 !text-xs"
                  >{noteSaving ? 'Wird gespeichert…' : 'Speichern'}</button>
                </div>
              </div>
            )}

            {/* Notizen nach Tag und Woche, jeder Eintrag mit Kürzel und Zeit */}
            {notizGruppen.length > 0 && (
              <div className="bg-white border border-lilac-ink/20 rounded-ctl divide-y divide-lilac-ink/10 overflow-hidden">
                {notizGruppen.map(g => (
                  <div key={`${g.scope}-${g.anchor}`} className={`flex gap-3 px-3 py-2 ${g.scope === 'question' ? 'bg-apricot-bg/40' : ''}`}>
                    <div className="w-[104px] flex-shrink-0">
                      <p className={`text-[11.5px] font-bold tnum leading-tight ${g.scope === 'question' ? 'text-apricot-ink' : 'text-lilac-label'}`}>
                        {g.scope === 'question' ? '? ' : ''}{gruppenLabel(g)}
                      </p>
                      {(g.scope !== 'day' || g.to) && (
                        <p className="text-[9.5px] text-ink-4 mt-0.5">{g.scope === 'week' ? 'Woche' : g.scope === 'question' ? 'fraglicher Termin' : 'Zeitraum'}</p>
                      )}
                    </div>
                    <ul className="flex-1 min-w-0 space-y-1">
                      {g.eintraege.map((e, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Kuerzel by={e.by} geaendert={e.geaendert} />
                          <span className="flex-1 min-w-0 text-[12.5px] text-ink-2 whitespace-pre-wrap leading-snug pt-[2px]">{e.text}</span>
                          {e.at && <span className="text-[9.5px] text-ink-4 tnum whitespace-nowrap pt-[4px]" title={`Notiert am ${fmtNotizZeit(e.at)}`}>{fmtNotizZeit(e.at)}</span>}
                          {canEdit && (
                            <button onClick={() => openEintragEdit(g, i)} className="flex-shrink-0 text-lilac-label hover:text-lilac-ink transition-colors pt-[3px]" title="Diesen Eintrag bearbeiten: Tag, Kürzel, Text" aria-label="Eintrag bearbeiten">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                              </svg>
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {canEdit && (
                      <button onClick={() => openPeriodEdit(g)} className="flex-shrink-0 self-start text-[11px] font-semibold text-lilac-label hover:text-lilac-ink whitespace-nowrap pt-[2px]" title="Eigene Notiz zu diesem Tag anfügen">+ Notiz</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Notiz anfügen oder Eintrag ändern */}
            {periodForm && (() => {
              const anker = periodForm.scope === 'week' ? weekAnchor(periodForm.weekIdx) : periodForm.date
              const listeFuer = (scope: PeriodScope) => scope === 'week' ? weekNotes : scope === 'question' ? questions : dayNotes
              const bestehend = anker ? listeFuer(periodForm.scope).find(n => n.anchor === anker) ?? null : null
              const anzahl = (scope: PeriodScope, a: string) => listeFuer(scope).find(n => n.anchor === a)?.eintraege.length ?? 0
              const tagOption = (ds: string) => {
                const n = anzahl(periodForm.scope, ds)
                return `${DAY_SHORT[new Date(`${ds}T12:00:00`).getDay()]} ${ds.slice(8, 10)}.${ds.slice(5, 7)}.${n ? ` · ${n} Notiz${n === 1 ? '' : 'en'}` : ''}`
              }
              const tageDesMonats = Array.from({ length: daysInMonth }, (_, i) => dateStr(year, month, i + 1))
              const fest = !!periodForm.fix
              return (
                <div className="bg-white border border-edge-ctl rounded-ctl p-3 space-y-2.5">
                  {fest ? (
                    <p className="text-[11.5px] text-ink-3">
                      Notiz anfügen ·{' '}
                      <span className="font-semibold text-ink">{gruppenLabel({ scope: periodForm.scope, anchor: anker, to: bestehend?.to ?? null })}</span>
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="inline-flex rounded-full bg-edge-row p-[2px]">
                        {(['day', 'week', 'question'] as const).map(sc => (
                          <button
                            key={sc}
                            onClick={() => setPeriodForm(f => f && { ...f, scope: sc })}
                            className={`px-2.5 py-[3px] rounded-full text-[11px] font-semibold transition-colors ${
                              periodForm.scope === sc ? 'bg-white text-ink shadow-sm' : 'text-ink-3'
                            }`}
                          >{sc === 'day' ? 'Tag' : sc === 'week' ? 'Woche' : 'Fraglich ?'}</button>
                        ))}
                      </div>
                      {periodForm.scope !== 'week' ? (
                        <>
                          <select
                            value={periodForm.date}
                            onChange={e => setPeriodForm(f => f && { ...f, date: e.target.value, dateTo: f.dateTo && f.dateTo <= e.target.value ? '' : f.dateTo })}
                            className="select-field !py-1 !text-xs"
                            title="Für welchen Tag"
                          >
                            <option value="">Tag wählen…</option>
                            {tageDesMonats.map(ds => <option key={ds} value={ds}>{tagOption(ds)}</option>)}
                          </select>
                          <span className="text-[11px] text-ink-4">bis</span>
                          <select
                            value={bestehend ? '' : periodForm.dateTo}
                            onChange={e => setPeriodForm(f => f && { ...f, dateTo: e.target.value })}
                            disabled={!periodForm.date || !!bestehend}
                            className="select-field !py-1 !text-xs disabled:opacity-50"
                            title={bestehend ? 'Dieser Tag hat schon Notizen, deine kommt dazu' : 'Bis (nur für einen Zeitraum)'}
                          >
                            <option value="">nur dieser Tag</option>
                            {tageDesMonats.filter(ds => periodForm.date && ds > periodForm.date).map(ds => <option key={ds} value={ds}>{tagOption(ds)}</option>)}
                          </select>
                        </>
                      ) : (
                        <>
                          <select
                            value={periodForm.weekIdx}
                            onChange={e => {
                              const v = Number(e.target.value)
                              setPeriodForm(f => f && { ...f, weekIdx: v, weekIdxTo: Math.max(v, f.weekIdxTo) })
                            }}
                            className="select-field !py-1 !text-xs"
                          >
                            {weeks.map((w, i) => (
                              <option key={i} value={i}>Woche {w.wn} ({w.start}.–{w.end}.{month}.)</option>
                            ))}
                          </select>
                          <span className="text-[11px] text-ink-4">bis</span>
                          <select
                            value={periodForm.weekIdxTo}
                            onChange={e => setPeriodForm(f => f && { ...f, weekIdxTo: Number(e.target.value) })}
                            className="select-field !py-1 !text-xs"
                          >
                            {weeks.map((w, i) => i >= periodForm.weekIdx && (
                              <option key={i} value={i}>Woche {w.wn} ({w.start}.–{w.end}.{month}.)</option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                  )}
                  {bestehend && bestehend.eintraege.length > 0 && (
                    <div className="rounded-ctl bg-lilac-soft px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-lilac-label mb-1">Schon notiert, deine Notiz kommt dazu</p>
                      <ul className="space-y-1">
                        {bestehend.eintraege.map((e, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <Kuerzel by={e.by} geaendert={e.geaendert} />
                            <span className="text-[12px] text-ink-2 whitespace-pre-wrap leading-snug pt-[2px]">{e.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <textarea
                    value={periodForm.text}
                    maxLength={500}
                    rows={2}
                    autoFocus
                    onChange={e => setPeriodForm(f => f && { ...f, text: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); savePeriodNote() } }}
                    placeholder={periodForm.scope === 'question' ? 'z.B. Zorana Fortbildung, noch unbestätigt?' : 'z.B. Melinda nur vormittags'}
                    className="input-field w-full !py-1.5 !text-[12.5px] resize-y"
                  />
                  <p className="text-[10.5px] text-ink-4">Dein Kürzel und die Zeit kommen automatisch dazu. Enter speichert, Shift + Enter macht eine neue Zeile.</p>
                  <div className="flex flex-wrap items-center gap-2 justify-end">
                    <button onClick={() => setPeriodForm(null)} disabled={noteSaving}
                      className="btn-secondary !px-3 !py-1 !text-xs"
                    >Abbrechen</button>
                    <button
                      onClick={() => savePeriodNote()}
                      disabled={noteSaving || !periodForm.text.trim() || (!fest && periodForm.scope !== 'week' && !periodForm.date)}
                      className="btn-primary !px-3 !py-1 !text-xs"
                    >{noteSaving ? 'Wird gespeichert…' : 'Hinzufügen'}</button>
                  </div>
                </div>
              )
            })()}

            {/* Dialog: bestehenden Eintrag bearbeiten (Tag, Zeitraum, Woche oder Monat, Kürzel, Text) */}
            {bearbeiten && (() => {
              const b = bearbeiten
              const tageDesMonats = Array.from({ length: daysInMonth }, (_, k) => dateStr(year, month, k + 1))
              const tagLabel = (ds: string) => `${DAY_SHORT[new Date(`${ds}T12:00:00`).getDay()]} ${ds.slice(8, 10)}.${ds.slice(5, 7)}.`
              const zielListe = b.scope === 'week' ? weekNotes : b.scope === 'question' ? questions : b.scope === 'day' ? dayNotes : []
              const zielAnker = b.scope === 'week' ? weekAnchor(b.weekIdx) : b.scope === 'month' ? null : b.date
              const zielAndere = zielAnker ? (zielListe.find(n => n.anchor === zielAnker)?.eintraege.length ?? 0) - (b.von.scope === b.scope && b.von.anchor === zielAnker ? 1 : 0) : 0
              return (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
                  <div className="absolute inset-0 bg-ink/40" onClick={() => !bearbBusy && setBearbeiten(null)} />
                  <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-edge-soft bg-surface">
                      <h3 className="text-sm font-bold text-ink">Notiz bearbeiten</h3>
                      <p className="text-xs text-ink-4 mt-0.5">
                        Tag, Kürzel und Text anpassen. Wählst du einen anderen Tag, wandert die Notiz dorthin.{b.at ? ` Notiert am ${fmtNotizZeit(b.at)}.` : ''}
                      </p>
                    </div>
                    <div className="px-6 py-4 space-y-3.5">
                      <div>
                        <p className="field-label">Gilt für</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="inline-flex rounded-full bg-edge-row p-[2px]">
                            {(['day', 'week', 'question', 'month'] as const).map(sc => (
                              <button key={sc} onClick={() => setBearbeiten(x => x && { ...x, scope: sc })}
                                className={`px-2.5 py-[3px] rounded-full text-[11px] font-semibold transition-colors ${b.scope === sc ? 'bg-white text-ink shadow-sm' : 'text-ink-3'}`}>
                                {sc === 'day' ? 'Tag' : sc === 'week' ? 'Woche' : sc === 'question' ? 'Fraglich ?' : 'Monat'}
                              </button>
                            ))}
                          </div>
                          {(b.scope === 'day' || b.scope === 'question') && (
                            <>
                              <select value={b.date} onChange={e => setBearbeiten(x => x && { ...x, date: e.target.value, dateTo: x.dateTo && x.dateTo <= e.target.value ? '' : x.dateTo })} className="select-field !py-1 !text-xs" title="Für welchen Tag">
                                <option value="">Tag wählen…</option>
                                {tageDesMonats.map(ds => <option key={ds} value={ds}>{tagLabel(ds)}</option>)}
                              </select>
                              <span className="text-[11px] text-ink-4">bis</span>
                              <select value={b.dateTo} disabled={!b.date || zielAndere > 0} onChange={e => setBearbeiten(x => x && { ...x, dateTo: e.target.value })} className="select-field !py-1 !text-xs disabled:opacity-50"
                                title={zielAndere > 0 ? 'Dieser Tag hat weitere Notizen, der Zeitraum gilt für alle gemeinsam' : 'Bis (nur für einen Zeitraum)'}>
                                <option value="">nur dieser Tag</option>
                                {tageDesMonats.filter(ds => b.date && ds > b.date).map(ds => <option key={ds} value={ds}>{tagLabel(ds)}</option>)}
                              </select>
                            </>
                          )}
                          {b.scope === 'week' && (
                            <>
                              <select value={b.weekIdx} onChange={e => { const v = Number(e.target.value); setBearbeiten(x => x && { ...x, weekIdx: v, weekIdxTo: Math.max(v, x.weekIdxTo) }) }} className="select-field !py-1 !text-xs">
                                {weeks.map((w, i) => <option key={i} value={i}>Woche {w.wn} ({w.start}.–{w.end}.{month}.)</option>)}
                              </select>
                              <span className="text-[11px] text-ink-4">bis</span>
                              <select value={b.weekIdxTo} disabled={zielAndere > 0} onChange={e => setBearbeiten(x => x && { ...x, weekIdxTo: Number(e.target.value) })} className="select-field !py-1 !text-xs disabled:opacity-50">
                                {weeks.map((w, i) => i >= b.weekIdx && <option key={i} value={i}>Woche {w.wn} ({w.start}.–{w.end}.{month}.)</option>)}
                              </select>
                            </>
                          )}
                          {b.scope === 'month' && <span className="text-[11px] text-ink-4">ganzer Monat, ohne bestimmten Tag</span>}
                        </div>
                      </div>
                      <div className="grid grid-cols-[110px_1fr] gap-3">
                        <div>
                          <p className="field-label">Kürzel</p>
                          <input value={b.by} maxLength={5} list="notiz-kuerzel" onChange={e => setBearbeiten(x => x && { ...x, by: e.target.value.toUpperCase() })}
                            placeholder="z.B. BF" className="input-field w-full !py-1.5 !text-sm uppercase" title="Wer hat die Notiz geschrieben" />
                          <datalist id="notiz-kuerzel">{kuerzel.map(k => <option key={k} value={k} />)}</datalist>
                        </div>
                        <div>
                          <p className="field-label">Text</p>
                          <textarea value={b.text} maxLength={1000} rows={3} autoFocus onChange={e => setBearbeiten(x => x && { ...x, text: e.target.value })}
                            className="input-field w-full !py-1.5 !text-[12.5px] resize-y" />
                        </div>
                      </div>
                      {bearbErr && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {bearbErr}</p>}
                    </div>
                    <div className="px-6 py-4 border-t border-edge-soft bg-surface flex items-center gap-2">
                      <button onClick={bearbeitenLoeschen} disabled={bearbBusy} className="btn-secondary !px-3 !py-1.5 !text-xs !text-blush-ink mr-auto">Löschen</button>
                      <button onClick={() => setBearbeiten(null)} disabled={bearbBusy} className="btn-secondary !px-3 !py-1.5 !text-xs">Abbrechen</button>
                      <button onClick={bearbeitenSpeichern} disabled={bearbBusy} className="btn-primary !px-3 !py-1.5 !text-xs">{bearbBusy ? 'Wird gespeichert…' : 'Speichern'}</button>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Vorschau: Monatsnotiz in Notizen pro Tag umwandeln (Admin) */}
            {umwandlung && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
                <div className="absolute inset-0 bg-ink/40" onClick={() => !umwandlungBusy && setUmwandlung(null)} />
                <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
                  <div className="px-6 py-4 border-b border-edge-soft bg-surface">
                    <h3 className="text-sm font-bold text-ink">Monatsnotiz in Notizen pro Tag umwandeln</h3>
                    <p className="text-xs text-ink-4 mt-0.5">
                      Jede Zeile wird ein Eintrag mit Kürzel. Tag und Kürzel sind aus dem Text erkannt, bitte prüfen und bei Bedarf anpassen.
                      Zeilen ohne Tag bleiben in der Monatsnotiz. Die bisherige Monatsnotiz wird als Sicherung behalten, es geht nichts verloren.
                    </p>
                  </div>
                  <div className="px-6 py-3 overflow-y-auto">
                    <div className="grid grid-cols-[minmax(150px,170px)_minmax(120px,150px)_72px_1fr] gap-x-2 gap-y-1.5 items-center">
                      <p className="field-label">Tag oder Woche</p><p className="field-label">bis</p><p className="field-label">Kürzel</p><p className="field-label">Text</p>
                      {umwandlung.map((it, i) => {
                        const setItem = (patch: Partial<UmwandlungItem>) => setUmwandlung(l => l && l.map((x, j) => j === i ? { ...x, ...patch } : x))
                        const wert = it.scope === 'month' ? '' : it.scope === 'week' ? `w:${it.anchor}` : (it.anchor ?? '')
                        return (
                          <React.Fragment key={i}>
                            <select value={wert} className="select-field !py-1 !text-xs"
                              onChange={e => {
                                const v = e.target.value
                                if (!v) setItem({ scope: 'month', anchor: null, to: null })
                                else if (v.startsWith('w:')) setItem({ scope: 'week', anchor: v.slice(2), to: null })
                                else setItem({ scope: 'day', anchor: v, to: it.to && it.to > v ? it.to : null })
                              }}>
                              <option value="">Monat, ohne Tag</option>
                              {Array.from({ length: daysInMonth }, (_, k) => dateStr(year, month, k + 1)).map(ds => (
                                <option key={ds} value={ds}>{DAY_SHORT[new Date(`${ds}T12:00:00`).getDay()]} {ds.slice(8, 10)}.{ds.slice(5, 7)}.</option>
                              ))}
                              {weeks.map((w, k) => <option key={`w${k}`} value={`w:${weekAnchor(k)}`}>Woche {w.wn} ({w.start}.–{w.end}.{month}.)</option>)}
                            </select>
                            <select value={it.scope === 'day' ? (it.to ?? '') : ''} disabled={it.scope !== 'day'} className="select-field !py-1 !text-xs disabled:opacity-40"
                              onChange={e => setItem({ to: e.target.value || null })}>
                              <option value="">nur dieser Tag</option>
                              {it.scope === 'day' && it.anchor && Array.from({ length: daysInMonth }, (_, k) => dateStr(year, month, k + 1)).filter(ds => ds > it.anchor!).map(ds => (
                                <option key={ds} value={ds}>{DAY_SHORT[new Date(`${ds}T12:00:00`).getDay()]} {ds.slice(8, 10)}.{ds.slice(5, 7)}.</option>
                              ))}
                            </select>
                            <input value={it.by ?? ''} maxLength={5} placeholder="–" onChange={e => setItem({ by: e.target.value.toUpperCase() || null })}
                              className="input-field !py-1 !text-xs uppercase text-center" title="Kürzel der Person, die die Zeile geschrieben hat" />
                            <input value={it.text} maxLength={1000} onChange={e => setItem({ text: e.target.value })} className="input-field !py-1 !text-xs w-full" />
                          </React.Fragment>
                        )
                      })}
                    </div>
                    {umwandlungErr && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink inline-block mt-3">⚠ {umwandlungErr}</p>}
                  </div>
                  <div className="px-6 py-4 border-t border-edge-soft bg-surface flex items-center gap-2">
                    <p className="text-[11px] text-ink-4 mr-auto tnum">{umwandlung.filter(i => i.scope !== 'month').length} mit Tag oder Woche · {umwandlung.filter(i => i.scope === 'month').length} bleiben im Monat</p>
                    <button onClick={() => setUmwandlung(null)} disabled={umwandlungBusy} className="btn-secondary !px-3 !py-1.5 !text-xs">Abbrechen</button>
                    <button onClick={umwandlungAnwenden} disabled={umwandlungBusy} className="btn-primary !px-3 !py-1.5 !text-xs">{umwandlungBusy ? 'Wird umgewandelt…' : 'Umwandeln'}</button>
                  </div>
                </div>
              </div>
            )}

            {/* Empty hint */}
            {canEdit && !monthEditing && !periodForm && !sharedNote.text && !(isAdmin && adminNote.text) && dayNotes.length === 0 && weekNotes.length === 0 && questions.length === 0 && (
              <p className="text-[11.5px] text-ink-4">
                Noch keine Notizen für {MONTH_NAMES[month - 1]}. Über «+ Notiz» zu einem Tag festhalten, was bei der Planung zu beachten ist; dein Kürzel kommt automatisch dazu.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Month note (e.g. Betriebsferien) ── */}
      {MONTH_NOTES[`${year}-${String(month).padStart(2,'0')}`] && (
        <div className="px-4 py-2 border-b border-edge-soft bg-apricot-bg text-center">
          <p className="text-xs font-semibold text-apricot-ink">
            {MONTH_NOTES[`${year}-${String(month).padStart(2,'0')}`]}
          </p>
        </div>
      )}

      {/* ── Grid ── */}
      {employees.length === 0 ? (
        <div className="px-6 py-16 text-center text-sm text-ink-4">
          Noch keine aktiven Mitarbeitenden vorhanden.
        </div>
      ) : (
        <div
          ref={gridWrapRef}
          className="overflow-x-auto"
          style={{ WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain' } as React.CSSProperties}
        >
          <table
            className="border-collapse"
            style={
              fitActive || weekView
                ? { tableLayout: 'fixed', width: '100%' }
                : { tableLayout: 'fixed', width: `${nameW + days.length * cellW}px` }
            }
          >
            <colgroup>
              <col style={{ width: nameW }} />
              {days.map(d => <col key={d} style={{ width: cellW }} />)}
            </colgroup>
            <thead>
              {weekBands.length > 0 && (
                <tr>
                  <th className="sticky left-0 z-20 bg-white p-0 border-r border-edge-ctl" style={{ width: nameW, minWidth: nameW }} />
                  {bandCells(weekBands)}
                </tr>
              )}
              {dayBands.length > 0 && (
                <tr>
                  <th className="sticky left-0 z-20 bg-white p-0 border-r border-edge-ctl" style={{ width: nameW, minWidth: nameW }} />
                  {bandCells(dayBands)}
                </tr>
              )}
              {/* Feiertage: Name senkrecht über der Spalte, die Spalte selbst braun wie ein Teamevent */}
              {days.some(day => feiertagName(dateStr(year, month, day))) && (
                <tr>
                  <th className="sticky left-0 z-20 bg-white p-0 border-r border-edge-ctl" style={{ width: nameW, minWidth: nameW }} />
                  {days.map(day => {
                    const name = feiertagName(dateStr(year, month, day))
                    return (
                      <th key={day} className="p-0 align-bottom bg-white" style={{ width: cellW, minWidth: cellW }}>
                        {name && (
                          <div className="flex items-end justify-center" style={{ height: fitActive ? 56 : 68 }} title={`Feiertag: ${name}`}>
                            <span className="text-[#7E5F44] font-semibold whitespace-nowrap leading-none" style={{ fontSize: fitActive ? 8 : 9.5, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{name}</span>
                          </div>
                        )}
                      </th>
                    )
                  })}
                </tr>
              )}
              <tr className="bg-white">
                <th
                  className="sticky left-0 z-20 bg-white border-b-[1.5px] border-r border-edge-ctl py-2 text-left text-[10.5px] font-semibold tracking-[.12em] text-ink-4 uppercase"
                  style={{ width: nameW, minWidth: nameW, padding: mobileCompact ? '0' : '8px' }}
                >
                  {!mobileCompact && 'Mitarbeiter'}
                </th>
                {days.map(day => {
                  const dow    = new Date(year, month - 1, day).getDay()
                  const isSat  = dow === 6
                  const isSun  = dow === 0
                  const isWE   = isSat || isSun
                  const ds     = dateStr(year, month, day)
                  const isToday = ds === todayStr
                  const review  = isReviewDay(ds)
                  const teamEvent = isTeamEventDay(ds)
                  const feiertag = feiertagName(ds)
                  return (
                    <th
                      key={day}
                      style={{ width: cellW, minWidth: cellW, padding: fitActive ? 0 : '0 1px' }}
                      onClick={canEdit ? () => cycleDayMarker(ds) : undefined}
                      title={feiertag ? `Feiertag: ${feiertag}` : canEdit ? 'Klicken: rot (manuelle Planung) → braun (Teamevent) → keine Markierung' : undefined}
                      className={[
                        'border-b-[1.5px] border-edge-ctl py-1.5 text-center',
                        canEdit ? 'cursor-pointer' : '',
                        isWE    ? 'bg-mint-head'     : 'bg-white',
                        isToday ? (fitActive ? '!bg-mint-mid' : '!bg-mint-bg') : '',
                        teamEvent || feiertag ? '!bg-[#E5D3BC]' : '',
                        review  ? '!bg-red-300'      : '',
                      ].join(' ')}
                    >
                      <div style={{ fontSize: dayNumPx }} className={`font-bold leading-none tnum ${
                        review ? 'text-red-900' : teamEvent || feiertag ? 'text-[#7E5F44]' : isToday && fitActive ? 'text-white' : isWE || isToday ? 'text-mint-mid' : 'text-ink'
                      }`}>{day}</div>
                      {showWeekday && (
                        <div style={{ fontSize: fitActive ? 7 : 8.5 }} className={`leading-tight mt-0.5 ${
                          review ? 'text-red-700' : teamEvent || feiertag ? 'text-[#9B7B5C]' : 'text-ink-4'
                        }`}>{DAY_SHORT[dow]}</div>
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>

            <tbody>
              {groups.map(group => (
                <React.Fragment key={group.key}>
                  <tr>
                    <td colSpan={totalCols} className={fitActive ? 'px-1 pt-1.5 pb-0.5 bg-white' : 'px-1 pt-2.5 pb-1 bg-white'}>
                      <span className={`sticky left-1 inline-flex items-center rounded-md font-bold uppercase tracking-[.1em] ${
                        fitActive ? 'px-1.5 py-[2px] text-[8px]' : 'px-2.5 py-[3px] text-[10px]'
                      } ${group.badgeCls}`}>
                        {group.label}
                      </span>
                    </td>
                  </tr>

                  {group.emps.map((emp, empIdx) => (
                    <tr key={emp.id} className={empIdx % 2 === 0 ? group.rowEven : group.rowOdd}>
                      <td
                        className={`sticky left-0 z-10 border-b border-r border-edge-row ${
                          empIdx % 2 === 0 ? group.stickyEven : group.stickyOdd
                        }`}
                        style={{ width: nameW, minWidth: nameW, padding: mobileCompact ? '3px 2px' : '4px 8px 4px 2px' }}
                      >
                        {mobileCompact ? (
                          fitActive ? (
                            <div className="flex items-center justify-center">
                              <span className="text-ink-2 text-[7px] font-bold leading-none">{getInitials(emp.full_name, emp.abbreviation)}</span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center">
                              <div className="w-6 h-6 rounded-full bg-dune flex items-center justify-center flex-shrink-0">
                                <span className="text-ink-2 text-[7px] font-bold leading-none">{getInitials(emp.full_name, emp.abbreviation)}</span>
                              </div>
                            </div>
                          )
                        ) : (
                          <div className="flex items-center gap-2 min-w-0">
                            {!isMobile && (
                              <div className="w-[22px] h-[22px] rounded-full bg-dune flex items-center justify-center flex-shrink-0">
                                <span className="text-ink-2 text-[8.5px] font-bold">{getInitials(emp.full_name, emp.abbreviation)}</span>
                              </div>
                            )}
                            <p className="text-[11.5px] font-semibold text-ink truncate leading-tight" title={emp.full_name}>
                              {planKurzname(emp.full_name)}
                            </p>
                          </div>
                        )}
                      </td>

                      {days.map(day => {
                        const dow    = new Date(year, month - 1, day).getDay()
                        const isSat  = dow === 6
                        const isSun  = dow === 0
                        const isWE   = isSat || isSun
                        const ds     = dateStr(year, month, day)
                        const key    = `${emp.id}_${ds}`
                        const parsed = parseCell(getValue(emp.id, day))
                        const isEditing = editingKey === key
                        const isToday   = ds === todayStr

                        const review = isReviewDay(ds)
                        const teamEvent = isTeamEventDay(ds) || !!feiertagName(ds)
                        return (
                          <td
                            key={day}
                            data-cell={`${emp.id}_${day}`}
                            onClick={canEdit ? (e) => startEdit(emp.id, day, e.currentTarget) : undefined}
                            style={{ width: cellW, minWidth: cellW, height: rowH }}
                            className={[
                              'border-b border-edge-row p-0',
                              isWE ? 'bg-mint-col' : '',
                              isToday && !isWE ? 'bg-mint-col/60' : '',
                              teamEvent ? '!bg-[#F4EBDF]' : '',
                              review ? '!bg-red-100' : '',
                            ].join(' ')}
                          >
                            <div
                              className={[
                                'w-full h-full flex items-center justify-center select-none transition-all',
                                fitActive ? `overflow-hidden ${parsed.cls || 'text-ink-2'}` : 'p-[3px]',
                                canEdit ? 'cursor-pointer hover:ring-[1.5px] hover:ring-edge-strong hover:ring-inset' : '',
                                isEditing ? 'ring-[1.5px] ring-dusk-night ring-inset' : '',
                                !isEditing && selCell && selCell.empId === emp.id && selCell.day === day
                                  ? 'ring-[1.5px] ring-dusk ring-inset' : '',
                              ].join(' ')}
                            >
                              {parsed.display && (
                                fitActive ? (
                                  <span
                                    className="font-bold tnum whitespace-nowrap leading-none"
                                    style={{ fontSize: entryPx }}
                                  >{parsed.display}</span>
                                ) : (
                                  <span
                                    className={[
                                      'inline-flex items-center justify-center rounded-[5px] font-bold tnum truncate',
                                      mobileCompact ? 'text-[8px] min-w-[15px] h-[15px]' : 'text-[9.5px] min-w-[19px] h-[19px] px-0.5',
                                      parsed.cls || 'text-ink-2',
                                    ].join(' ')}
                                    style={{ maxWidth: `${cellW - 2}px` }}
                                  >{parsed.display}</span>
                                )
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>

            {/* ── Besetzungs-Check — plan editors only, never on the PDF ── */}
            {planNotes && (
              <tfoot>
                <tr>
                  <td
                    className="sticky left-0 z-10 bg-white border-t-[1.5px] border-r border-edge-ctl px-1 py-1 text-right align-middle"
                    style={{ width: nameW, minWidth: nameW }}
                  >
                    {!mobileCompact && (
                      <span className="text-[8.5px] font-bold uppercase tracking-[.08em] text-ink-4">Besetzung</span>
                    )}
                  </td>
                  {days.map(day => {
                    const cov = coverageFor(day)
                    const dot  = fitActive ? 11 : 16
                    const font = fitActive ? 7 : 9.5
                    return (
                      <td
                        key={day}
                        title={cov.problems.length > 0 ? cov.problems.join(' · ') : cov.status === 'ok' ? 'Besetzung ok' : undefined}
                        className="border-t-[1.5px] border-edge-ctl text-center py-1 align-middle"
                      >
                        {cov.status !== 'none' && (
                          <span
                            className={`inline-flex items-center justify-center rounded-full font-bold ${
                              cov.status === 'ok'
                                ? 'bg-mint-bg text-mint-ink'
                                : cov.status === 'warn'
                                  ? 'bg-apricot-bg text-apricot-ink'
                                  : 'bg-red-100 text-red-700'
                            }`}
                            style={{ width: dot, height: dot, fontSize: font }}
                          >{cov.status === 'ok' ? '✓' : '!'}</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* ── Änderungsprotokoll (admin only) ── */}
      {showChangeLog && (
        <PlanAenderungenModal
          year={year}
          month={month}
          monthLabel={`${MONTH_NAMES[month - 1]} ${year}`}
          onClose={() => setShowChangeLog(false)}
        />
      )}

      {/* ── Teamevent rückgängig: Vorschau + Wiederherstellen ── */}
      {teRestore && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">Teamevent am {teRestore.ds.slice(8, 10)}.{teRestore.ds.slice(5, 7)}. entfernen</h3>
                <p className="text-xs text-ink-4 mt-0.5">
                  {teRestore.vorschlaege.some(v => v.vorschlag != null)
                    ? 'So werden die «TE»-Einträge wiederhergestellt:'
                    : 'Keine «TE»-Einträge zum Wiederherstellen an diesem Tag.'}
                </p>
              </div>
              <button onClick={() => setTeRestore(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4 flex-shrink-0">✕</button>
            </div>
            {teRestore.vorschlaege.length > 0 && (
              <div className="px-6 py-3 overflow-auto">
                {teRestore.vorschlaege.map(v => (
                  <div key={v.employeeId} className="flex items-center gap-3 py-1.5 border-b border-edge-row last:border-b-0 text-[12px]">
                    <span className="font-semibold text-ink flex-1 truncate">{v.emp}</span>
                    {v.vorschlag != null ? (
                      <>
                        <span className="tnum text-ink-2">TE → <span className="font-bold text-ink">{v.vorschlag}</span></span>
                        <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-full ${v.quelle === 'protokoll' ? 'bg-mint-bg text-mint-ink' : 'bg-steel-bg text-steel-ink'}`}>
                          {v.quelle === 'protokoll' ? 'Protokoll' : 'Standardwoche'}
                        </span>
                      </>
                    ) : (
                      <span className="text-[11px] text-ink-4">bleibt «TE» — kein früherer Wert gefunden</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => {
                  const ds = teRestore.ds
                  setTeRestoreBusy(true)
                  startTransition(async () => {
                    const result = await safe(() => teameventRueckgaengig(ds, true))
                    setTeRestoreBusy(false)
                    const err = (result as { error?: string } | undefined)?.error
                    if (err) { setSaveError(err); return }
                    setTeRestore(null)
                    setTeOverrides(prev => ({ ...prev, [ds]: false }))
                    setOverrides(prev => {
                      const next = { ...prev }
                      for (const k of Object.keys(next)) if (k.endsWith(`_${ds}`)) delete next[k]
                      return next
                    })
                    const n = (result as { wiederhergestellt?: number })?.wiederhergestellt ?? 0
                    setInfoMsg(`Teamevent entfernt — ${n} ${n === 1 ? 'Eintrag' : 'Einträge'} wiederhergestellt.`)
                    scheduleRefresh()
                  })
                }}
                disabled={teRestoreBusy || !teRestore.vorschlaege.some(v => v.vorschlag != null)}
                className="btn-primary flex-1 disabled:opacity-50"
              >
                {teRestoreBusy ? 'Wird wiederhergestellt…' : 'Einträge wiederherstellen'}
              </button>
              <button
                onClick={() => {
                  const ds = teRestore.ds
                  setTeRestore(null)
                  setTeOverrides(prev => ({ ...prev, [ds]: false }))
                  startTransition(async () => {
                    const result = await safe(() => unflagTeamEventDay(ds))
                    if (result?.error) setSaveError(result.error)
                    else scheduleRefresh()
                  })
                }}
                disabled={teRestoreBusy}
                className="btn-secondary flex-1 disabled:opacity-50"
              >
                Nur Markierung entfernen («TE» bleibt)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tag-kopieren dialog ── */}
      {copyDayDlg && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-sm shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">Tag kopieren</h3>
                <p className="text-xs text-ink-4 mt-0.5">Der Ziel-Tag wird zur exakten Kopie des Quell-Tags.</p>
              </div>
              <button onClick={() => setCopyDayDlg(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4 flex-shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 grid grid-cols-2 gap-3">
              <div>
                <p className="field-label">Von Tag</p>
                <select
                  value={copyDayDlg.from}
                  onChange={e => setCopyDayDlg(d => d && { ...d, from: Number(e.target.value) })}
                  className="select-field w-full"
                >
                  {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>{d}. ({DAY_SHORT[new Date(year, month - 1, d).getDay()]})</option>
                  ))}
                </select>
              </div>
              <div>
                <p className="field-label">Auf Tag</p>
                <select
                  value={copyDayDlg.to}
                  onChange={e => setCopyDayDlg(d => d && { ...d, to: Number(e.target.value) })}
                  className="select-field w-full"
                >
                  {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>{d}. ({DAY_SHORT[new Date(year, month - 1, d).getDay()]})</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={() => setCopyDayDlg(null)} className="btn-secondary flex-1">Abbrechen</button>
              <button
                onClick={handleCopyDay}
                disabled={bulkBusy || copyDayDlg.from === copyDayDlg.to}
                className="btn-primary flex-1"
              >{bulkBusy ? 'Wird kopiert…' : 'Kopieren'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Legend ── */}
      <div className="px-4 pt-3 pb-1 border-t border-edge-soft bg-white mt-2">
        <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 items-center justify-center">
          {[
            { code: '✓',  label: 'Anwesend',         cls: 'bg-white text-ink-2' },
            { code: '6',  label: 'Empfang',          cls: 'bg-white text-ink-2' },
            { code: '7',  label: 'Steri',            cls: 'bg-white text-ink-2' },
            { code: '8',  label: 'Tagesleitende',    cls: 'bg-white text-ink-2' },
            { code: 'HO', label: 'Home Office',      cls: 'bg-lilac-bg text-lilac-ink' },
            { code: '*',  label: 'Joker / Aufträge', cls: 'bg-white text-ink-2' },
            { code: 'S',  label: 'Schule',           cls: 'bg-lilac-bg text-lilac-ink' },
            { code: 'F',  label: 'Ferien',           cls: 'bg-mint-bg text-mint-ink' },
            { code: '%',  label: 'Frei',             cls: 'bg-white text-ink-4' },
            { code: 'K',  label: 'Krank',            cls: 'bg-blush-bg text-blush-ink' },
            { code: 'U',  label: 'Unfall',           cls: 'bg-[#F8E0CF] text-[#A85E38]' },
            { code: 'WB', label: 'Weiterbildung',    cls: 'bg-lilac-bg text-lilac-ink' },
            { code: 'ÜK', label: 'Überbetrieblicher Kurs', cls: 'bg-lilac-bg text-lilac-ink' },
            { code: 'KO', label: 'Kompensation',     cls: 'bg-steel-bg text-steel-ink' },
            { code: 'TE', label: 'Teamevent',        cls: 'bg-[#EADAC8] text-[#7E5F44]' },
            { code: 'BF', label: 'Bezahlt frei',     cls: 'bg-[#EFEBCF] text-[#7E7433]' },
            { code: 'UF', label: 'Unbezahlte Ferien', cls: 'bg-[#E3E0D5] text-[#6E6749]' },
            { code: 'ND', label: 'Notfalldienst', cls: 'bg-[#F8DCD2] text-[#A6492F]' },
          ].map(item => (
            <span key={item.code} className="flex items-center gap-[5px] flex-shrink-0">
              <span className={`min-w-[17px] h-[17px] px-0.5 rounded-[5px] border border-edge flex items-center justify-center text-[8.5px] font-bold ${item.cls}`}>{item.code}</span>
              <span className="text-[10.5px] text-ink-2">{item.label}</span>
            </span>
          ))}

          <span className="w-px h-4 bg-edge-ctl mx-0.5 flex-shrink-0" />

          {(Object.entries(SHIFTS) as [keyof typeof SHIFTS, typeof SHIFTS[keyof typeof SHIFTS]][]).map(([k, cfg]) => (
            <span key={k} className="flex items-center gap-[5px] flex-shrink-0">
              <span className={`w-[17px] h-[17px] rounded-[5px] border border-edge flex-shrink-0 ${cfg.cls}`} />
              <span className="text-[10.5px] text-ink-2">{cfg.label}</span>
            </span>
          ))}
          <span className="w-px h-4 bg-edge-ctl mx-0.5 flex-shrink-0" />
          <span className="text-[10.5px] text-ink-4 flex-shrink-0" title="Zwei Positionen in einer Schicht: erste Position, dann die zweite, zum Beispiel Joker bis die Steri geht, danach Spätsteri">Zwei Positionen mit / kombinieren, zum Beispiel */7 Spätschicht = Joker, dann Spätsteri</span>
        </div>
      </div>

      {/* ── Working-hours reference ── */}
      <div className="px-4 pt-2 pb-3.5 bg-white">
        <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center text-[10px] text-ink-4 leading-[1.7]">
          {[
            { label: 'Assistenz',       time: '7:45–12:00 (flexibel) 13:00–17:15' },
            { label: 'Steri',           time: '8:00–12:15 13:00–17:15' },
            { label: 'Empfang',         time: '7:45–12:15 13:15–17:15' },
            { label: 'Frühschicht',     time: '06:30–13:30' },
            { label: 'Halbtagsschicht', time: '6:45 / 7:45–12:15' },
            { label: 'Mittelschicht',   time: '6:45–16:15' },
            { label: 'Spätschicht',     time: '12:00–20:15' },
          ].map((item, i, arr) => (
            <span key={item.label} className="flex-shrink-0 tnum">
              <b className="text-ink-3 font-semibold">{item.label}</b>{' '}{item.time}{i < arr.length - 1 ? ' ·' : ''}
            </span>
          ))}
        </div>
      </div>

      {/* ── Floating edit popup ── */}
      {editingKey && editCellRect && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => commitEdit()} onTouchStart={() => commitEdit()} />
          <div
            className="fixed z-50 bg-white border-[1.5px] border-dusk-night rounded-tile shadow-xl p-2"
            style={{ top: popupTop, left: popupLeft, width: POPUP_W }}
            onMouseDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={e => {
                // Mark the native event so the document-level browse handler
                // ignores it — React's delegated listeners live on `document`
                // in the App Router, so stopPropagation alone cannot help.
                ;(e.nativeEvent as KeyboardEvent & { __planEditorHandled?: boolean }).__planEditorHandled = true
                e.stopPropagation()
                if      (e.key === 'Enter')      { e.preventDefault(); if (!moveEdit(1, 0)) commitEdit() }
                else if (e.key === 'Escape')     cancelEdit()
                else if (e.key === 'ArrowRight') { e.preventDefault(); moveEdit(0, 1) }
                else if (e.key === 'ArrowLeft')  { e.preventDefault(); moveEdit(0, -1) }
                else if (e.key === 'ArrowDown')  { e.preventDefault(); moveEdit(1, 0) }
                else if (e.key === 'ArrowUp')    { e.preventDefault(); moveEdit(-1, 0) }
                else if (e.key === 'Tab')        { e.preventDefault(); moveEdit(0, e.shiftKey ? -1 : 1) }
              }}
              className="w-full px-2 py-1.5 text-sm text-center border border-edge-ctl rounded-ctl outline-none focus:border-dusk bg-white"
              placeholder="Wert"
            />
            <div className="flex gap-1 mt-1.5">
              <button
                onMouseDown={e => e.preventDefault()}
                onClick={() => setEditShift('none')}
                className={`flex-1 py-1 text-[10px] font-semibold rounded-md border transition-all ${
                  editShift === 'none'
                    ? 'bg-active text-ink border-edge-strong ring-1 ring-edge-strong'
                    : 'bg-white text-ink-4 border-edge-ctl hover:bg-edge-row'
                }`}
              >—</button>
              {(Object.entries(SHIFTS) as [keyof typeof SHIFTS, typeof SHIFTS[keyof typeof SHIFTS]][]).map(([k, cfg]) => (
                <button
                  key={k}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => setEditShift(k)}
                  className={`flex-1 py-1 text-[10px] font-bold rounded-md border transition-all ${cfg.btn} ${
                    editShift === k ? 'ring-1 ring-dusk-night opacity-100' : 'opacity-60 hover:opacity-90'
                  }`}
                  title={cfg.label}
                >{cfg.short}</button>
              ))}
            </div>
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => commitWithValue('✓')}
              className="w-full mt-1.5 py-1 text-[11px] font-bold rounded-md border bg-mint-bg text-mint-ink border-mint-ink/30 hover:opacity-80 transition-all"
              title="Anwesend"
            >✓ Anwesend</button>
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={handleApplyWeek}
              disabled={!editValue.trim()}
              className="w-full mt-1 py-1 text-[10.5px] font-semibold rounded-md border bg-steel-bg text-steel-ink border-steel-ink/30 hover:opacity-80 transition-all disabled:opacity-40"
              title="Diesen Wert auf Montag–Freitag dieser Woche übernehmen (geplante Ferien bleiben)"
            >Mo–Fr übernehmen</button>
            {isAdmin && anfragePerson && (
              <button
                onMouseDown={e => e.preventDefault()}
                onClick={handleEinsatzAnfragen}
                disabled={!anfrageMoeglich}
                className="w-full mt-1 py-1 text-[10.5px] font-semibold rounded-md border bg-apricot-bg text-apricot-ink border-apricot-ink/30 hover:opacity-80 transition-all disabled:opacity-40"
                title={anfrageMoeglich
                  ? `Zelle speichern und diesen Tag mit «${positionText(anfrageWert)}» bei «Einsätze, an denen wir ${editingEmp!.full_name.split(' ')[0]} brauchen» anfragen`
                  : 'Zuerst eine Position eintragen (z.B. 3f, 6, 7 oder ✓)'}
              >Als Einsatz anfragen</button>
            )}
          </div>
        </>
      )}

    </div>
  )
}
