'use client'

// Shared Ferien calendar: whole-year view (KW columns) plus per-month views
// (one column per weekday), selected via month boxes like the Arbeitsplan.
// Used by the Admin und Ferien Editorin Ferienplanung (editable days, totals column) and
// by the employee Ferienplanung (read-only, no totals).

import React, { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addVacation, removeVacation } from '@/actions/vacations'
import { weekdaysBetween, wunschArtLabel, type FerienWunsch, type WunschArt } from '@/lib/ferien-wuensche'
import { ferienWeight, round2, isoKw, kwBereich } from '@/lib/ferien'
import { istFerienAlsMinusstunden } from '@/lib/ferien-minusstunden'
import { vertretungDetails, tageText } from '@/lib/ferien-vertretung'
import { FARBEN, FARBEN_HINWEIS, FARBEN_HINWEIS_2, FARBEN_REIHENFOLGE, montagVon, wunschTageListe, ferientageZaehlen, type WochenFarbe, type FerienTag } from '@/lib/ferien-wochen'
import { anteilAus, ferienGewicht, type AnteilKarte } from '@/lib/ferien-anteil'

/** Hexfarbe mit Deckkraft (sehr heller Hauch in der Wochenspalte). */
const hexAlpha = (hex: string, a: number) => `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${a})`

type Emp = { id: string; full_name: string; job_title: string | null; schedule_order: number | null; pensum?: number | null }
type Vac = { employee_id: string; schedule_date: string; entry: string }

const GROUPS = [
  { key: 'ZAZ',      label: 'ZAZ',      match: (t: string | null) => t === 'ZAZ',                                badgeCls: 'bg-mint-bg    text-mint-ink' },
  { key: 'DH_PA',    label: 'DH / PA',  match: (t: string | null) => t === 'DH / PA' || t === 'DH' || t === 'PA', badgeCls: 'bg-steel-bg   text-steel-ink' },
  { key: 'DA',       label: 'DA',       match: (t: string | null) => t === 'DA' || t === 'Leitende DA',           badgeCls: 'bg-apricot-bg text-apricot-ink' },
  { key: 'Lernende', label: 'Lernende', match: (t: string | null) => t === 'Lernende',                            badgeCls: 'bg-lilac-bg   text-lilac-ink' },
  { key: 'Andere',   label: 'Weitere',  match: (t: string | null) => !['ZAZ','DH / PA','DH','PA','DA','Leitende DA','Lernende'].includes(t ?? ''), badgeCls: 'bg-edge-row text-ink-2' },
]

const MON_SHORT = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']
const MON_LONG  = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
const DOW_SHORT = ['Mo','Di','Mi','Do','Fr']

const TRACK_BG = '#F4F2F0'
// Akzeptierte Tage: volle Farbe je Art (F Ferien / UF unbezahlt / WB
// Weiterbildung / ND Notfalldienst); offene Wünsche: Schraffur in der Farbe
// ihrer Art.
type AcceptCode = 'F' | 'UF' | 'WB' | 'ND'
type CellState = AcceptCode | `w:${WunschArt}` | null
const ACCEPT_FILL: Record<AcceptCode, string> = { F: '#BBD8D0', UF: '#CFCABA', WB: '#CDC5E2', ND: '#F0B4A2' }
const WISH_FILL: Record<WunschArt, string> = {
  ferien:        'repeating-linear-gradient(135deg, #E9AE62 0px, #E9AE62 3px, #F7DFBC 3px, #F7DFBC 6px)',
  unbezahlt:     'repeating-linear-gradient(135deg, #ADA68C 0px, #ADA68C 3px, #E6E2D3 3px, #E6E2D3 6px)',
  weiterbildung: 'repeating-linear-gradient(135deg, #A99BD1 0px, #A99BD1 3px, #E7E2F4 3px, #E7E2F4 6px)',
}
const ACCEPT_LABEL: Record<AcceptCode, string> = { F: 'Ferien', UF: 'Unbezahlte Ferien', WB: 'Weiterbildung', ND: 'Notfalldienst' }
// Tage mit Ferienvertretung (ZAZ): dunkelgrüner Balken am unteren Rand der
// Zelle — so ist die Vertretung schon in der Jahresansicht erkennbar
const VERTRETUNG_BALKEN = '#2F6F62'
const vertretungStyle = (hoehe: number): React.CSSProperties => ({ boxShadow: `inset 0 -${hoehe}px 0 0 ${VERTRETUNG_BALKEN}` })
function cellFill(s: CellState): { background: string } | undefined {
  if (!s) return undefined
  if (s.startsWith('w:')) return { background: WISH_FILL[s.slice(2) as WunschArt] }
  return { background: ACCEPT_FILL[s as AcceptCode] }
}
function cellLabel(s: CellState): string {
  if (!s) return ''
  if (s.startsWith('w:')) return `Wunsch: ${wunschArtLabel(s.slice(2) as WunschArt)} (offen)`
  return ACCEPT_LABEL[s as AcceptCode]
}

type Week = { kw: number; days: string[] }

function buildWeeks(planYear: number): Week[] {
  const jan4 = new Date(`${planYear}-01-04T00:00:00`)
  const start = new Date(jan4)
  start.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7))
  const weeks: Week[] = []
  const d = new Date(start)
  let kw = 1
  while (d.getFullYear() <= planYear) {
    const days: string[] = []
    for (let i = 0; i < 5; i++) {
      const day = new Date(d)
      day.setDate(d.getDate() + i)
      days.push(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`)
    }
    if (days[0].slice(0, 4) > String(planYear)) break
    weeks.push({ kw, days })
    d.setDate(d.getDate() + 7)
    kw++
  }
  return weeks
}

function fmtShort(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' })
}
function fmtD(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function initials(name: string) {
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

export default function FerienKalender({
  employees, vacations, wishes, planYear, showTotals = true, canEditDays = false, pdfExport = false, vertretungen, wochenFarben, farbLegende = false, einsaetze, anteile,
}: {
  employees: Emp[]
  /** Ferienanteil pro Wochentag (nach Profil-ID): ein glattes F zählt den Anteil des Tags */
  anteile?: AnteilKarte
  vacations: Vac[]
  wishes: FerienWunsch[]
  planYear: number
  /** Wochenfarbe je Montag (Ferienplanung 2027): schmaler Balken im Kopf und heller Hauch in der Spalte */
  wochenFarben?: Record<string, WochenFarbe>
  /** Legende der vier Wochenfarben unter dem Kalender */
  farbLegende?: boolean
  showTotals?: boolean
  canEditDays?: boolean
  /** Ferienvertretungen der ZAZ (`${employeeId}|${date}` → Name) — nur
   *  Admin und Ferien Editorin erhalten diese Daten; fehlt die Prop, zeigt die Info-Karte
   *  keine Vertretung. */
  vertretungen?: Record<string, string>
  /** Feste Vertretungseinsätze mit Uhrzeit (nur Admin und Ferien Editorin): eigene Zeile
   *  bei den ZAZ mit dezentem Balken an den Einsatztagen. */
  einsaetze?: Array<{ datum: string; name: string; von: string; bis: string }>
  /** PDF-Export-Knopf in der Kopfzeile (nur Admin und Ferien Editorin — die API-Route
   *  prüft die Berechtigung zusätzlich serverseitig). */
  pdfExport?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [view, setView] = useState<'year' | number>('year')
  const [err, setErr] = useState<string | null>(null)
  const regelVon = useCallback((empId: string) => anteilAus(anteile, empId), [anteile])

  // ── PDF-Export (Dialog mit wählbarem Zeitraum) ──
  const [pdfOpen, setPdfOpen] = useState(false)
  const [pdfFrom, setPdfFrom] = useState('')
  const [pdfTo, setPdfTo]     = useState('')
  // Schnellwahl als eigener Zustand, damit die Auswahl im Feld sichtbar
  // BLEIBT (vorher sprang das Feld sofort auf den Platzhalter zurück, was
  // v.a. am Handy wie «nicht gespeichert» wirkte)
  const [pdfPresetSel, setPdfPresetSel] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfErr, setPdfErr]   = useState<string | null>(null)
  // Vorab geladenes PDF: so kann der Klick aufs Teilen-Menü (Handy) ohne
  // Wartezeit und innerhalb der Nutzer-Geste erfolgen
  const [pdfBlob, setPdfBlob] = useState<{ url: string; blob: Blob } | null>(null)

  function openPdfDialog() {
    // Vorbelegung aus der aktuellen Ansicht: Jahresansicht → ganzes Jahr,
    // Monatsansicht → dieser Monat
    if (view === 'year') {
      setPdfFrom(`${planYear}-01-01`); setPdfTo(`${planYear}-12-31`)
      setPdfPresetSel('jahr')
    } else {
      const mm = String(view).padStart(2, '0')
      const last = new Date(planYear, view, 0).getDate()
      setPdfFrom(`${planYear}-${mm}-01`); setPdfTo(`${planYear}-${mm}-${String(last).padStart(2, '0')}`)
      setPdfPresetSel('')
    }
    setPdfErr(null)
    setPdfOpen(true)
  }
  const pdfValid =
    /^\d{4}-\d{2}-\d{2}$/.test(pdfFrom) && /^\d{4}-\d{2}-\d{2}$/.test(pdfTo) &&
    pdfTo >= pdfFrom &&
    (new Date(`${pdfTo}T00:00:00`).getTime() - new Date(`${pdfFrom}T00:00:00`).getTime()) / 86400000 <= 750
  const pdfUrl = `/api/ferienplan-pdf?from=${pdfFrom}&to=${pdfTo}`
  function pdfPreset(p: string) {
    const y = planYear
    const map: Record<string, [string, string]> = {
      jahr: [`${y}-01-01`, `${y}-12-31`],
      h1:   [`${y}-01-01`, `${y}-06-30`],
      h2:   [`${y}-07-01`, `${y}-12-31`],
      q1:   [`${y}-01-01`, `${y}-03-31`],
      q2:   [`${y}-04-01`, `${y}-06-30`],
      q3:   [`${y}-07-01`, `${y}-09-30`],
      q4:   [`${y}-10-01`, `${y}-12-31`],
    }
    const r = map[p]
    if (r) { setPdfFrom(r[0]); setPdfTo(r[1]); setPdfPresetSel(p) }
  }

  // PDF im Hintergrund vorbereiten, sobald der Dialog offen und der
  // Zeitraum gültig ist (klein, ~30 KB) — kurz entprellt beim Datumstippen
  useEffect(() => {
    if (!pdfOpen || !pdfValid) return
    const ac = new AbortController()
    const t = setTimeout(() => {
      fetch(pdfUrl, { signal: ac.signal })
        .then(r => (r.ok ? r.blob() : null))
        .then(b => { if (b) setPdfBlob({ url: pdfUrl, blob: b }) })
        .catch(() => { /* beim Klick greifen die Fallbacks */ })
    }, 300)
    return () => { clearTimeout(t); ac.abort() }
  }, [pdfOpen, pdfValid, pdfUrl])

  /** Ansehen/Herunterladen — auch in der installierten Handy-App:
   *  · Desktop/Browser: «Ansehen» öffnet ein neues Tab (Dateiname via
   *    Header), «Herunterladen» speichert direkt.
   *  · Handy/PWA (Popup unterdrückt oder Touch-Gerät): natives TEILEN-MENÜ
   *    mit Vorschau, «In Dateien sichern», Drucken und Weiterleiten —
   *    statt einer Vollbild-Sackgasse ohne Knöpfe. */
  async function pdfAction(kind: 'view' | 'save') {
    if (!pdfValid || pdfBusy) return
    setPdfErr(null)
    const nav = navigator as Navigator & {
      canShare?: (d?: { files?: File[] }) => boolean
      share?: (d: { files?: File[]; title?: string }) => Promise<void>
    }
    const touchGeraet = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
    if (kind === 'view') {
      // Browser (auch am Handy): neues Tab mit der Vorschau — dort gibt es
      // Teilen/Speichern. Nur wenn das Popup unterdrückt wird (installierte
      // App), geht es unten mit dem Teilen-Menü weiter.
      const w = window.open(pdfUrl, '_blank', 'noopener')
      if (w) { setPdfOpen(false); return }
    }
    setPdfBusy(true)
    try {
      const blob = pdfBlob && pdfBlob.url === pdfUrl
        ? pdfBlob.blob
        : await fetch(pdfUrl).then(r => { if (!r.ok) throw new Error('http'); return r.blob() })
      const fname = `Ferienplan_${pdfFrom}_bis_${pdfTo}.pdf`
      const file = new File([blob], fname, { type: 'application/pdf' })
      const teilenMenu = (kind === 'save' ? touchGeraet : true)   // Speichern am Computer lädt direkt
      if (teilenMenu && nav.share && nav.canShare?.({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: fname })
          setPdfOpen(false)
        } catch (e) {
          // Teilen bewusst abgebrochen → Dialog offen lassen, kein Fehler
          if ((e as Error)?.name !== 'AbortError') throw e
        }
        return
      }
      const obj = URL.createObjectURL(blob)
      if (kind === 'view') {
        const w = window.open(obj, '_blank', 'noopener')
        if (!w) { window.location.assign(pdfUrl); return }
      } else {
        const a = document.createElement('a')
        a.href = obj
        a.download = fname
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
      setTimeout(() => URL.revokeObjectURL(obj), 60_000)
      setPdfOpen(false)
    } catch {
      setPdfErr('Export fehlgeschlagen — bitte erneut versuchen.')
    } finally {
      setPdfBusy(false)
    }
  }

  const ordered = useMemo(() => [...employees].sort((a, b) => {
    const ga = GROUPS.findIndex(g => g.match(a.job_title))
    const gb = GROUPS.findIndex(g => g.match(b.job_title))
    if (ga !== gb) return ga - gb
    const sa = a.schedule_order ?? Number.MAX_SAFE_INTEGER
    const sb = b.schedule_order ?? Number.MAX_SAFE_INTEGER
    if (sa !== sb) return sa - sb
    return a.full_name.localeCompare(b.full_name)
  }), [employees])

  const groups = useMemo(() =>
    GROUPS.map(g => ({ ...g, emps: ordered.filter(e => g.match(e.job_title)) })).filter(g => g.emps.length > 0),
  [ordered])

  const weeks = useMemo(() => buildWeeks(planYear), [planYear])
  const monthSpans = useMemo(() => {
    const spans: { label: string; count: number }[] = []
    for (const w of weeks) {
      const m = parseInt(w.days[3].slice(5, 7), 10) - 1
      const label = MON_SHORT[m]
      const last = spans[spans.length - 1]
      if (last && last.label === label) last.count++
      else spans.push({ label, count: 1 })
    }
    return spans
  }, [weeks])

  // Feste Einsätze pro Tag (Text für die Info beim Überfahren)
  const einsatzTage = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const e of einsaetze ?? []) m.set(e.datum, [...(m.get(e.datum) ?? []), `${e.name} ${e.von.replace(':', '.')} bis ${e.bis.replace(':', '.')} Uhr`])
    return m
  }, [einsaetze])

  const { acceptedDays, wishDays, wishGewicht } = useMemo(() => {
    const acc = new Map<string, AcceptCode>()
    for (const v of vacations) {
      if (!v.schedule_date.startsWith(String(planYear))) continue
      const code: AcceptCode | null =
        v.entry === 'F' || v.entry.startsWith('F:') ? 'F' : v.entry === 'UF' ? 'UF' : v.entry === 'WB' ? 'WB' : v.entry === 'ND' ? 'ND' : null
      if (code) acc.set(`${v.employee_id}|${v.schedule_date}`, code)
    }
    // Gewicht eines offenen Wunschtags: gewählte Tage je 1, ältere Wünsche ohne Tagesauswahl nach Pensum
    const faktor: Record<string, number> = {}
    for (const e of employees) faktor[e.id] = e.pensum != null && e.pensum > 0 && e.pensum <= 100 ? e.pensum / 100 : 1
    const wish = new Map<string, WunschArt>()
    const gewicht = new Map<string, number>()
    for (const w of wishes) {
      if (w.status !== 'offen') continue
      for (const d of wunschTageListe(w)) {
        const k = `${w.employeeId}|${d}`
        if (!acc.has(k)) { wish.set(k, w.art); gewicht.set(k, w.tage && w.tage.length > 0 ? 1 : (faktor[w.employeeId] ?? 1)) }
      }
    }
    return { acceptedDays: acc, wishDays: wish, wishGewicht: gewicht }
  }, [vacations, wishes, planYear, employees])

  // ── Info-Karte beim Überfahren einer Zelle ──
  // Eingetragene Tage werden pro Person und Code zu Perioden
  // zusammengefasst (Wochenenden überbrückt), damit die Karte den ganzen
  // Zeitraum, die Anzahl Tage und (für ZAZ) die Ferienvertretung zeigt.
  type Periode = { code: AcceptCode; from: string; to: string; days: number; counted: number; gewichtet: boolean }
  const perioden = useMemo(() => {
    const byEmp = new Map<string, Periode[]>()
    const rows = vacations
      .filter(v => v.schedule_date.startsWith(String(planYear)))
      .map(v => {
        const code: AcceptCode | null =
          v.entry === 'F' || v.entry.startsWith('F:') ? 'F' : v.entry === 'UF' ? 'UF' : v.entry === 'WB' ? 'WB' : v.entry === 'ND' ? 'ND' : null
        const w = code === 'F' ? (ferienGewicht(v.entry, regelVon(v.employee_id), v.schedule_date) ?? 1) : 1
        return code ? { empId: v.employee_id, date: v.schedule_date, code, w, gewichtet: w !== 1 } : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.empId.localeCompare(b.empId) || a.date.localeCompare(b.date))
    for (const r of rows) {
      const list = byEmp.get(r.empId) ?? []
      const last = list[list.length - 1]
      const diff = last ? (new Date(`${r.date}T00:00:00`).getTime() - new Date(`${last.to}T00:00:00`).getTime()) / 86400000 : 99
      if (last && last.code === r.code && diff <= 3) {
        last.to = r.date; last.days++; last.counted = round2(last.counted + r.w); last.gewichtet = last.gewichtet || r.gewichtet
      } else {
        list.push({ code: r.code, from: r.date, to: r.date, days: 1, counted: round2(r.w), gewichtet: r.gewichtet })
      }
      byEmp.set(r.empId, list)
    }
    return byEmp
  }, [vacations, planYear, regelVon])

  type InfoEintrag = { titel: string; farbe: string; zeitraum: string; tage: string; kw: string; vertretung: Array<{ name: string; tage: string }> | null }
  type Info = { key: string; x: number; y: number; name: string; eintraege: InfoEintrag[] }
  const [info, setInfo] = useState<Info | null>(null)

  const fmtDLang = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
  const zeitraumText = (from: string, to: string) => (from === to ? fmtDLang(from) : `${fmtDLang(from)} – ${fmtDLang(to)}`)
  const kwText = kwBereich
  // Vertretung(en) einer Periode mit Wochentag und Datum je Vertretungstag
  const vertretungText = (empId: string, from: string, to: string): Array<{ name: string; tage: string }> | null => {
    const det = vertretungDetails(vertretungen, empId, from, to)
    return det.length > 0 ? det.map(d => ({ name: d.name, tage: tageText(d.tage) })) : null
  }
  const ACCEPT_INK: Record<AcceptCode, string> = { F: '#33574F', UF: '#6E6749', WB: '#5A5170', ND: '#A85E38' }

  /** Einträge einer Person, die den Bereich [von, bis] berühren. */
  function eintraegeFuer(emp: Emp, von: string, bis: string): InfoEintrag[] {
    const out: InfoEintrag[] = []
    for (const p of perioden.get(emp.id) ?? []) {
      if (p.to < von || p.from > bis) continue
      const tage = p.code === 'F'
        ? `${p.days} Ferientag${p.days !== 1 ? 'e' : ''}${p.gewichtet && p.counted !== p.days ? ` (angerechnet ${p.counted})` : ''}`
        : `${p.days} Tag${p.days !== 1 ? 'e' : ''} (Mo–Fr)`
      out.push({
        titel: ACCEPT_LABEL[p.code], farbe: ACCEPT_INK[p.code],
        zeitraum: zeitraumText(p.from, p.to), tage, kw: kwText(p.from, p.to),
        vertretung: p.code === 'ND' ? null : vertretungText(emp.id, p.from, p.to),
      })
    }
    for (const w of wishes) {
      if (w.employeeId !== emp.id || w.status !== 'offen') continue
      if (w.to < von || w.from > bis) continue
      const n = wunschTageListe(w).length
      out.push({
        titel: `Wunsch: ${wunschArtLabel(w.art)} (offen, Prio ${w.prio ?? 3})`, farbe: '#A86A26',
        zeitraum: zeitraumText(w.from, w.to), tage: `${n} Tag${n !== 1 ? 'e' : ''}${w.tage && w.tage.length > 0 && w.tage.length < weekdaysBetween(w.from, w.to).length ? ' (gewählte Tage)' : ''}`, kw: kwText(w.from, w.to),
        vertretung: null,
      })
    }
    return out
  }

  function zeigeInfo(e: React.MouseEvent, emp: Emp, von: string, bis: string, key: string) {
    const eintraege = eintraegeFuer(emp, von, bis)
    if (eintraege.length === 0) { setInfo(null); return }
    const breite = 300, hoehe = 90 + eintraege.reduce((s, e) => s + 92 + (e.vertretung?.length ?? 0) * 34, 0)
    const x = Math.min(e.clientX + 14, Math.max(8, window.innerWidth - breite - 8))
    const y = e.clientY + 16 + hoehe > window.innerHeight ? Math.max(8, e.clientY - hoehe - 8) : e.clientY + 16
    setInfo({ key, x, y, name: emp.full_name, eintraege })
  }

  const totals = useMemo(() => {
    // «Tage» zählt nur echte Ferientage (F): ein F zählt einen Tag, F:x sein
    // Gewicht — unbezahlte Ferien und Weiterbildung verbrauchen kein Ferienguthaben.
    const nameById: Record<string, string> = {}
    for (const e of employees) nameById[e.id] = e.full_name
    // Pro Kalenderwoche gezählt: Teilzeit mit einer ganzen Woche F nach Pensum
    // (40 Prozent = 2 Tage), siehe ferientageZaehlen
    const pensumVon: Record<string, number | null | undefined> = {}
    for (const e of employees) pensumVon[e.id] = e.pensum
    const fTage: Record<string, FerienTag[]> = {}
    for (const v of vacations) {
      if (!v.schedule_date.startsWith(String(planYear))) continue
      if (!(v.entry === 'F' || v.entry.startsWith('F:'))) continue
      // Vereinbarte Ausnahme: diese F-Tage sind kein Ferienbezug (Minusstunden)
      if (istFerienAlsMinusstunden(nameById[v.employee_id], v.schedule_date)) continue
      ;(fTage[v.employee_id] ??= []).push({ datum: v.schedule_date, gewicht: v.entry.startsWith('F:') ? (ferienWeight(v.entry) ?? 1) : 1 })
    }
    const acc: Record<string, number> = {}
    for (const [id, tage] of Object.entries(fTage)) acc[id] = ferientageZaehlen(tage, pensumVon[id], regelVon(id))
    // Offene Wünsche: gewählte Tage wie oben gezählt, Tage ohne Auswahl nach Pensum
    const gewaehlt: Record<string, FerienTag[]> = {}
    const geschaetzt: Record<string, number> = {}
    wishDays.forEach((art, k) => {
      if (art !== 'ferien') return
      const [id, datum] = k.split('|')
      const g = wishGewicht.get(k) ?? 1
      if (g === 1) (gewaehlt[id] ??= []).push({ datum, gewicht: 1 })
      else geschaetzt[id] = (geschaetzt[id] ?? 0) + g
    })
    const open: Record<string, number> = {}
    for (const id of Array.from(new Set([...Object.keys(gewaehlt), ...Object.keys(geschaetzt)]))) {
      open[id] = round2(ferientageZaehlen(gewaehlt[id] ?? [], pensumVon[id], regelVon(id)) + (geschaetzt[id] ?? 0))
    }
    return { acc, open }
  }, [vacations, wishDays, wishGewicht, planYear, employees, regelVon])

  // Weekdays of the selected month, with KW header spans
  const monthDays = useMemo(() => {
    if (view === 'year') return []
    const days: string[] = []
    const last = new Date(planYear, view, 0).getDate()
    for (let d = 1; d <= last; d++) {
      const dt = new Date(planYear, view - 1, d)
      const dow = dt.getDay()
      if (dow === 0 || dow === 6) continue
      days.push(`${planYear}-${String(view).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
    }
    return days
  }, [view, planYear])
  const monthKwSpans = useMemo(() => {
    const spans: { kw: number; count: number }[] = []
    for (const d of monthDays) {
      const kw = isoKw(d)
      const last = spans[spans.length - 1]
      if (last && last.kw === kw) last.count++
      else spans.push({ kw, count: 1 })
    }
    return spans
  }, [monthDays])

  function toggleDay(emp: Emp, ds: string) {
    if (!canEditDays || isPending) return
    const code = acceptedDays.get(`${emp.id}|${ds}`)
    if (code === 'UF' || code === 'WB' || code === 'ND') return   // per Klick nur F-Tage — UF/WB/ND über Wunsch, Arbeitsplan oder Notfalldienst-Erfassung
    const has = code === 'F'
    const q = has
      ? `${emp.full_name}: Ferientag am ${fmtD(ds)} entfernen?`
      : `${emp.full_name}: ${fmtD(ds)} als Ferientag eintragen?`
    if (!confirm(q)) return
    setErr(null)
    startTransition(async () => {
      const r = has
        ? await removeVacation(emp.id, ds, ds)
        : await addVacation(emp.id, ds, ds, 'F', null)
      if (r && 'error' in r && r.error) setErr(r.error)
      else router.refresh()
    })
  }

  const totalCols = 1 + (view === 'year' ? weeks.length : monthDays.length) + (showTotals ? 1 : 0)
  const farbeVon = (montag: string): WochenFarbe | undefined => wochenFarben?.[montag]
  const spaltenTint = (montag: string): React.CSSProperties | undefined => { const f = farbeVon(montag); return f ? { background: hexAlpha(FARBEN[f].bg, 0.85) } : undefined }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-edge-soft">
        <p className="text-sm font-semibold text-ink">Ferienkalender {planYear}</p>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5 text-[11px] text-ink-2">
            <span className="inline-block w-[22px] h-[12px] rounded-[4px]" style={{ background: ACCEPT_FILL.F }} />
            Ferien
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-ink-2">
            <span className="inline-block w-[22px] h-[12px] rounded-[4px]" style={{ background: ACCEPT_FILL.UF }} />
            Unbez. Ferien
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-ink-2">
            <span className="inline-block w-[22px] h-[12px] rounded-[4px]" style={{ background: ACCEPT_FILL.WB }} />
            Weiterbildung
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-ink-2">
            <span className="inline-block w-[22px] h-[12px] rounded-[4px]" style={{ background: ACCEPT_FILL.ND }} />
            Notfalldienst
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-ink-2" title="Schraffiert in der Farbe der Art = noch offener Wunsch">
            <span className="inline-block w-[22px] h-[12px] rounded-[4px]" style={{ background: WISH_FILL.ferien }} />
            gestreift = Wunsch (offen)
          </span>
          {vertretungen && (
            <span className="flex items-center gap-1.5 text-[11px] text-ink-2"
              title="Dunkelgrüner Balken = Ferienvertretung eingetragen (ZAZ). Jahresansicht: die ganze Woche, Monatsansicht: nur die Tage, an denen die Vertretung kommt. Beim Überfahren stehen Name und Tage.">
              <span className="inline-block w-[22px] h-[12px] rounded-[4px]" style={{ background: ACCEPT_FILL.F, ...vertretungStyle(3) }} />
              Balken = mit Ferienvertretung
            </span>
          )}
          {pdfExport && (
            <button onClick={openPdfDialog}
              className="btn-secondary !px-3 !py-1.5 !text-xs inline-flex items-center gap-1.5"
              title="Ferienplan als PDF exportieren (Zeitraum wählbar, immer eine Seite)">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              PDF
            </button>
          )}
        </div>
      </div>

      {/* ── PDF-Export-Dialog ── */}
      {pdfOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">Ferienplan als PDF</h3>
                <p className="text-xs text-ink-4 mt-0.5">
                  Nur akzeptierte Einträge, im Stil der übrigen Exporte — passt immer auf eine
                  A4-Querseite (kurze Zeiträume mit Tages-Spalten, längere als Wochenübersicht).
                </p>
              </div>
              <button onClick={() => setPdfOpen(false)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4 flex-shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-ink-4 mb-1">Von</p>
                  <input type="date" value={pdfFrom}
                    onChange={e => { setPdfFrom(e.target.value); setPdfPresetSel('') }}
                    className="input-field w-full" />
                </div>
                <div>
                  <p className="text-[10px] text-ink-4 mb-1">Bis</p>
                  <input type="date" value={pdfTo}
                    onChange={e => { setPdfTo(e.target.value); setPdfPresetSel('') }}
                    className="input-field w-full" />
                </div>
              </div>
              <div>
                <p className="text-[10px] text-ink-4 mb-1">Schnellwahl</p>
                <select value={pdfPresetSel} onChange={e => { if (e.target.value) pdfPreset(e.target.value) }} className="input-field w-full">
                  <option value="">Eigener Zeitraum</option>
                  <option value="jahr">Ganzes Jahr {planYear}</option>
                  <option value="h1">1. Halbjahr {planYear}</option>
                  <option value="h2">2. Halbjahr {planYear}</option>
                  <option value="q1">Q1 {planYear}</option>
                  <option value="q2">Q2 {planYear}</option>
                  <option value="q3">Q3 {planYear}</option>
                  <option value="q4">Q4 {planYear}</option>
                </select>
              </div>
              {!pdfValid && (
                <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink inline-block">
                  ⚠ Bitte Von und Bis wählen (Bis nicht vor Von, maximal zwei Jahre).
                </p>
              )}
              {pdfErr && (
                <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {pdfErr}</p>
              )}
              <p className="text-[11px] text-ink-4">
                Am Computer öffnet «Ansehen» die Vorschau in einem neuen Tab (dort speicher- und
                druckbar), «Herunterladen» speichert direkt. Am Handy öffnet sich das Teilen-Menü —
                dort kannst du das PDF ansehen, «in Dateien sichern», drucken oder weiterleiten.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={() => setPdfOpen(false)} className="btn-secondary flex-1">Abbrechen</button>
              <button disabled={!pdfValid || pdfBusy}
                onClick={() => pdfAction('view')}
                className="btn-secondary flex-1 disabled:opacity-50">Ansehen</button>
              <button disabled={!pdfValid || pdfBusy}
                onClick={() => pdfAction('save')}
                className="btn-primary flex-1 disabled:opacity-50">{pdfBusy ? 'Wird erstellt…' : '⬇ Herunterladen'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Month boxes, like the Arbeitsplan week boxes */}
      <div className="px-6 pt-4">
        <div className="inline-flex flex-wrap items-center gap-1 bg-edge-row rounded-tile p-1">
          <button onClick={() => setView('year')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${view === 'year' ? 'bg-white text-ink shadow-sm' : 'text-ink-3 hover:text-ink'}`}>
            Ganzes Jahr
          </button>
          {MON_SHORT.map((m, i) => (
            <button key={m} onClick={() => setView(i + 1)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${view === i + 1 ? 'bg-white text-ink shadow-sm' : 'text-ink-3 hover:text-ink'}`}>
              {m}
            </button>
          ))}
        </div>
        {err && <p className="mt-3 text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink inline-block ml-3">⚠ {err}</p>}
      </div>

      <div className="overflow-x-auto mt-3" style={{ WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain' } as React.CSSProperties}>
        <table className="w-full table-fixed border-collapse" style={{ minWidth: view === 'year' ? '780px' : '560px' }}>
          <colgroup>
            <col style={{ width: 148 }} />
            {view === 'year'
              ? weeks.map(w => <col key={w.kw} />)
              : monthDays.map(d => <col key={d} />)}
            {showTotals && <col style={{ width: 46 }} />}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2}
                className="sticky left-0 z-20 bg-white border-b-[1.5px] border-r border-edge-ctl px-2 py-2 text-left text-[10.5px] font-semibold tracking-[.12em] text-ink-4 uppercase align-bottom"
              >Mitarbeiter</th>
              {view === 'year'
                ? monthSpans.map((m, i) => (
                    <th key={i} colSpan={m.count}
                      className="border-b border-l border-edge-row bg-surface py-1 text-center text-[9.5px] font-bold uppercase tracking-[.06em] text-ink-3"
                    >{m.label}</th>
                  ))
                : monthKwSpans.map(s => (
                    <th key={s.kw} colSpan={s.count}
                      className="border-b border-l border-edge-row bg-surface py-1 text-center text-[9.5px] font-bold uppercase tracking-[.06em] text-ink-3"
                      style={(() => { const f = farbeVon(montagVon(monthDays.find(d => isoKw(d) === s.kw) ?? monthDays[0])); return f ? { boxShadow: `inset 0 4px 0 0 ${FARBEN[f].fg}`, background: FARBEN[f].bg, color: FARBEN[f].fg } : undefined })()}
                    >KW {s.kw}</th>
                  ))}
              {showTotals && (
                <th rowSpan={2}
                  className="sticky right-0 z-20 bg-white border-b-[1.5px] border-l border-edge-ctl px-1 py-2 text-center text-[10.5px] font-semibold tracking-[.08em] text-ink-4 uppercase align-bottom"
                >Tage</th>
              )}
            </tr>
            <tr>
              {view === 'year'
                ? weeks.map(w => (
                    <th key={w.kw}
                      title={`KW ${w.kw} · ${fmtShort(w.days[0])} – ${fmtShort(w.days[4])}${farbeVon(w.days[0]) ? ` · ${FARBEN[farbeVon(w.days[0])!].titel}` : ''}`}
                      className="border-b-[1.5px] border-edge-ctl pb-1 pt-0.5 text-center overflow-hidden" style={farbeVon(w.days[0]) ? { background: FARBEN[farbeVon(w.days[0])!].bg } : { background: '#fff' }}>
                      {farbeVon(w.days[0]) && <div className="h-[4px] rounded-full mx-[2px] mb-[3px]" style={{ background: FARBEN[farbeVon(w.days[0])!].fg }} />}
                      <div className="text-[8.5px] font-bold leading-none tnum" style={farbeVon(w.days[0]) ? { color: FARBEN[farbeVon(w.days[0])!].fg } : undefined}>{w.kw}</div>
                    </th>
                  ))
                : monthDays.map(d => (
                    <th key={d} className="border-b-[1.5px] border-edge-ctl bg-white py-1 text-center overflow-hidden">
                      <div className="text-[10px] font-bold leading-none tnum text-ink-2">{parseInt(d.slice(8), 10)}</div>
                      <div className="text-[8px] leading-none text-ink-4 mt-0.5">{DOW_SHORT[(new Date(`${d}T00:00:00`).getDay() + 6) % 7]}</div>
                    </th>
                  ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(group => (
              <React.Fragment key={group.key}>
                <tr>
                  <td colSpan={totalCols} className="px-2 pt-2.5 pb-1 bg-white">
                    <span className={`inline-flex items-center px-2.5 py-[3px] rounded-md text-[10px] font-bold uppercase tracking-[.1em] ${group.badgeCls}`}>
                      {group.label}
                    </span>
                  </td>
                </tr>
                {group.key === 'ZAZ' && einsaetze && einsaetze.length > 0 && (
                  <tr className="hover:bg-hovrow">
                    <td className="sticky left-0 z-10 bg-white border-b border-r border-edge-row px-2 py-1">
                      <p className="text-[10.5px] font-semibold text-ink-3 truncate leading-tight pl-[26px]" title="Feste Vertretungseinsätze mit Uhrzeit (Balken an den Einsatztagen)">Feste Einsätze</p>
                    </td>
                    {view === 'year'
                      ? weeks.map(w => {
                          const proTag = w.days.map(d => einsatzTage.get(d))
                          const title = proTag.flatMap(x => x ?? []).join('\n')
                          return (
                            <td key={w.kw} title={title || undefined} className={`border-b border-edge-row p-[1.5px] h-[26px] ${title ? 'cursor-help' : ''}`} style={spaltenTint(w.days[0])}>
                              <div className="flex h-[13px] rounded-[3px]" style={{ background: TRACK_BG }}>
                                {proTag.map((x, i) => <div key={i} className={`flex-1 ${x ? 'rounded-[3px]' : ''}`} style={x ? { background: hexAlpha(VERTRETUNG_BALKEN, 0.22), ...vertretungStyle(3) } : undefined} />)}
                              </div>
                            </td>
                          )
                        })
                      : monthDays.map(d => {
                          const x = einsatzTage.get(d)
                          return (
                            <td key={d} title={x?.join('\n')} className={`border-b border-edge-row p-[2px] h-[30px] ${x ? 'cursor-help' : ''}`} style={spaltenTint(montagVon(d))}>
                              <div className="h-[20px] rounded-[4px]" style={x ? { background: hexAlpha(VERTRETUNG_BALKEN, 0.22), ...vertretungStyle(4) } : { background: TRACK_BG }} />
                            </td>
                          )
                        })}
                    {showTotals && <td className="sticky right-0 z-10 bg-white border-b border-l border-edge-row" />}
                  </tr>
                )}
                {group.emps.map(emp => (
                  <tr key={emp.id} className="hover:bg-hovrow">
                    <td className="sticky left-0 z-10 bg-white border-b border-r border-edge-row px-2 py-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="w-[20px] h-[20px] rounded-full bg-dune flex items-center justify-center flex-shrink-0">
                          <span className="text-ink-2 text-[8px] font-bold">{initials(emp.full_name)}</span>
                        </div>
                        <p className="text-[11px] font-semibold text-ink truncate leading-tight">{emp.full_name}</p>
                      </div>
                    </td>

                    {view === 'year'
                      ? weeks.map(w => {
                          const states: CellState[] = w.days.map(d => {
                            const k = `${emp.id}|${d}`
                            const acc = acceptedDays.get(k)
                            if (acc) return acc
                            const wa = wishDays.get(k)
                            return wa ? (`w:${wa}` as CellState) : null
                          })
                          const aCount = states.filter(s => s && !s.startsWith('w:')).length
                          const wCount = states.filter(s => s && s.startsWith('w:')).length
                          const title = `${emp.full_name} · KW ${w.kw} (${fmtShort(w.days[0])} – ${fmtShort(w.days[4])})`
                            + (aCount ? ` · ${aCount} Tag(e) geplant` : '')
                            + (wCount ? ` · ${wCount} Tag(e) Wunsch` : '')
                          const hatInhalt = aCount + wCount > 0
                          const cellKey = `${emp.id}|kw${w.kw}`
                          // Jahresansicht: die ganze Abwesenheitswoche trägt den Balken,
                          // sobald an einem Tag eine Vertretung eingetragen ist
                          const vtWoche = !!vertretungen && w.days.some(d => vertretungen[`${emp.id}|${d}`])
                          return (
                            <td key={w.kw} title={hatInhalt ? undefined : title}
                              onMouseEnter={hatInhalt ? e => zeigeInfo(e, emp, w.days[0], w.days[4], cellKey) : undefined}
                              onMouseLeave={hatInhalt ? () => setInfo(null) : undefined}
                              onClick={hatInhalt ? e => (info?.key === cellKey ? setInfo(null) : zeigeInfo(e, emp, w.days[0], w.days[4], cellKey)) : undefined}
                              className={`border-b border-edge-row p-[1.5px] h-[26px] ${hatInhalt ? 'cursor-help' : ''}`} style={spaltenTint(w.days[0])}>
                              <div className="flex h-[13px] rounded-[3px]" style={{ background: TRACK_BG }}>
                                {states.map((s, i) => {
                                  const prev = i > 0 ? states[i - 1] : null
                                  const next = i < 4 ? states[i + 1] : null
                                  const rounded = `${prev !== s ? 'rounded-l-[3px]' : ''} ${next !== s ? 'rounded-r-[3px]' : ''}`
                                  const vt = vtWoche && s && !s.startsWith('w:') && s !== 'ND'
                                  return (
                                    <div key={i} className={`flex-1 ${s ? rounded : ''}`}
                                      style={vt ? { ...(cellFill(s) ?? {}), ...vertretungStyle(3) } : cellFill(s)} />
                                  )
                                })}
                              </div>
                            </td>
                          )
                        })
                      : monthDays.map(d => {
                          const k = `${emp.id}|${d}`
                          const acc = acceptedDays.get(k)
                          const wa = acc ? undefined : wishDays.get(k)
                          const s: CellState = acc ?? (wa ? (`w:${wa}` as CellState) : null)
                          const base = `${emp.full_name} · ${fmtD(d)}${s ? ` · ${cellLabel(s)}` : ''}`
                          const title = canEditDays && (s === 'F' || s === null)
                            ? `${base} — klicken zum ${s === 'F' ? 'Entfernen' : 'Eintragen'}`
                            : base
                          const cellKey = `${emp.id}|${d}`
                          return (
                            <td key={d} title={s ? undefined : title}
                              onMouseEnter={s ? e => zeigeInfo(e, emp, d, d, cellKey) : undefined}
                              onMouseLeave={s ? () => setInfo(null) : undefined}
                              onClick={canEditDays
                                ? () => toggleDay(emp, d)
                                : s ? e => (info?.key === cellKey ? setInfo(null) : zeigeInfo(e, emp, d, d, cellKey)) : undefined}
                              className={`border-b border-edge-row p-[2px] h-[30px] ${canEditDays ? 'cursor-pointer' : s ? 'cursor-help' : ''}`} style={spaltenTint(montagVon(d))}>
                              <div className={`h-[20px] rounded-[4px] ${canEditDays ? 'hover:ring-1 hover:ring-dusk/40' : ''}`}
                                style={{
                                  ...(cellFill(s) ?? { background: TRACK_BG }),
                                  ...(s && !s.startsWith('w:') && s !== 'ND' && vertretungen?.[cellKey] ? vertretungStyle(4) : {}),
                                }} />
                            </td>
                          )
                        })}

                    {showTotals && (
                      <td className="sticky right-0 z-10 bg-white border-b border-l border-edge-row px-1 text-center tnum">
                        <span className="text-[11px] font-bold text-mint-ink">{(totals.acc[emp.id] ?? 0) > 0 ? totals.acc[emp.id] : '–'}</span>
                        {(totals.open[emp.id] ?? 0) > 0 && <span className="text-[10px] font-semibold text-apricot-mid"> +{totals.open[emp.id]}</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {info && (
        <div
          className="pointer-events-none fixed z-[70] w-[300px] max-w-[calc(100vw-16px)] rounded-xl border border-edge bg-white shadow-xl px-4 py-3 text-[12px]"
          style={{ left: info.x, top: info.y }}
          role="tooltip"
        >
          <p className="font-bold text-ink text-[12.5px]">{info.name}</p>
          {info.eintraege.map((e, i) => (
            <div key={i} className={i === 0 ? 'mt-1.5' : 'mt-2.5 pt-2.5 border-t border-edge-soft'}>
              <p className="text-[10px] font-bold uppercase tracking-[.1em]" style={{ color: e.farbe }}>{e.titel}</p>
              <p className="tnum text-ink mt-0.5">{e.zeitraum}</p>
              <p className="tnum text-ink-3">{e.tage} · {e.kw}</p>
              {e.vertretung && (
                <div className="mt-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-[.1em] text-mint-ink">Ferienvertretung</p>
                  {e.vertretung.map((v, j) => (
                    <p key={j} className="text-ink mt-0.5"><span className="font-semibold">{v.name}</span><br /><span className="tnum text-ink-3">{v.tage}</span></p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {farbLegende && wochenFarben && (
        <div className="px-6 pt-3 pb-1 border-t border-edge-soft">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {FARBEN_REIHENFOLGE.map(f => (
              <div key={f} className="flex items-start gap-2 text-[11px] leading-snug">
                <span className="mt-[3px] w-3 h-3 rounded-sm flex-shrink-0 border" style={{ background: FARBEN[f].bg, borderColor: FARBEN[f].fg }} />
                <p className="text-ink-3"><span className="font-semibold" style={{ color: FARBEN[f].fg }}>{FARBEN[f].label}, {FARBEN[f].titel}.</span> {FARBEN[f].text}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] font-semibold text-ink-2">{FARBEN_HINWEIS} {FARBEN_HINWEIS_2}</p>
        </div>
      )}
      <p className="px-6 py-3 text-[11px] text-ink-4 border-t border-edge-soft">
        {view === 'year'
          ? <>Kalenderwochen (Mo–Fr) des Jahres {planYear}. Über die Monats-Knöpfe öffnet ihr einen einzelnen Monat mit allen Tagen.</>
          : <>{MON_LONG[(view as number) - 1]} {planYear}, Werktage Mo–Fr.{canEditDays ? ' Ein Klick auf einen Tag trägt einen einzelnen Ferientag ein oder entfernt ihn.' : ''}</>}
        {showTotals && <> «Tage» = akzeptierte Ferientage <span className="text-apricot-mid font-semibold">+ offene Ferien-Wunschtage</span> (unbezahlte Ferien und Weiterbildung zählen nicht als Ferientage).</>}
      </p>
    </div>
  )
}
