'use client'

import React, { useState, useMemo, useCallback, useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addVacation, removeVacation, updateVacationRange, addNotfalldienst, removeNotfalldienst } from '@/actions/vacations'
import { createWunsch, updateWunsch, acceptWunsch, deleteWunsch, savePhasen, wunschWocheEntscheiden } from '@/actions/ferien-wuensche'
import { ferienWeight, round2, kwBereich, isoKw } from '@/lib/ferien'
import { istFerienAlsMinusstunden } from '@/lib/ferien-minusstunden'
import {
  PLAN_YEAR, PHASE_DEFS, PHASE_START_KEY, PHASE_OPEN_TIME, PHASE_CLOSE_TIME, phaseStateFor, zurichNow, weekdaysBetween, WUNSCH_ARTEN, PRIO_OPTIONEN, wunschArtLabel, wunschArtCode,
  type FerienWunsch, type PhasenDeadlines, type WunschArt, type WunschPrio,
} from '@/lib/ferien-wuensche'
import type { FerienBestand } from '@/lib/ferienplanung-data'
import { istZaz, vertretungFuerPeriode, vertretungDetails, tagKurz, tageText } from '@/lib/ferien-vertretung'
import FerienKalender from '@/components/ferien/FerienKalender'
import SamstageSection from '@/components/ferien/SamstageSection'
import NotfalldiensteSection from '@/components/ferien/NotfalldiensteSection'
import WochenUebersichtAdmin from '@/components/ferien/WochenUebersichtAdmin'
import FerienNotizBox from '@/components/ferien/FerienNotizBox'
import AnfragenListe from '@/components/ferien/AnfragenListe'
import { aktionKey, type Aktion, type Teil } from '@/lib/ferien-aktion'
import RegelnDialog from '@/components/ferien/RegelnDialog'
import type { Samstag, SamstagRolle } from '@/lib/samstage'
import type { SamstagPerson } from '@/lib/samstage-data'
import type { Notfalldienst, NdRolle } from '@/lib/notfalldienste'
import type { WocheAdmin } from '@/lib/ferien-wochen-data'
import { wochen2027, wunschKosten, gruenRegel, wochenTeile, ferientageZaehlen, type WochenFarbe, type FerienTag } from '@/lib/ferien-wochen'
import type { Regeln, PersonRegel, Einsatz } from '@/lib/ferien-regeln'
import { anspruchTageFor } from '@/lib/ferien-anspruch'
import { wunschAblehnen, wunschZuruecknehmen, anspruchSetzen } from '@/actions/ferien-wochen'

/** Browser Speicher: welche Abschnitte zugeklappt sind */
const ABSCHNITTE_KEY = 'ferienplanung-abschnitte'
type Abschnitt = 'anfragen' | 'wuensche' | 'wochen'

type Emp = { id: string; full_name: string; job_title: string | null; schedule_order: number | null; pensum?: number | null }
type Vac = { employee_id: string; schedule_date: string; entry: string }

type Props = {
  employees: Emp[]
  vacations: Vac[]
  wishes: FerienWunsch[]
  phasen: PhasenDeadlines
  bestand: Record<string, FerienBestand>
  kontoYear: number
  /** Ferienvertretungen der ZAZ (`${employeeId}|${date}` → Name) — nur Admin/Laura */
  vertretungen?: Record<string, string>
  /** Wählbare Vertretungen (alle aktiven ZAZ, inkl. externe) */
  kandidaten?: string[]
  /** Samstagsöffnungen (Liste, Anmeldungen); Verwaltung nur für Admins */
  samstage?: Samstag[]
  samstageTeam?: SamstagPerson[]
  samstageVerwalten?: boolean
  meinId?: string
  meineRolle?: SamstagRolle | null
  heute?: string
  /** Wochenplanung 2027 (Farben, Belegung mit Namen, Plätze, Warnungen) */
  wochen?: WocheAdmin[]
  /** Zentrale Regeln, Personenregeln und feste Einsätze (Dialog Regeln bearbeiten) */
  regeln?: Regeln
  personRegeln?: Record<string, PersonRegel & { gespeichert?: boolean }>
  einsaetze?: Einsatz[]
  /** Zwei Wochen am Stück pro Person (null = gilt nicht, zum Beispiel Valérie) */
  zweiWochen?: Record<string, boolean | null>
  /** Admin Anpassungen des Anspruchs in Tagen pro Person */
  anspruchAnpassungen?: Record<string, number | null>
  notfalldienste?: Notfalldienst[]
  meineNdRolle?: NdRolle | null
  /** Admin Rolle (Anspruch anpassen); Laura hat alle übrigen Rechte */
  istAdmin?: boolean
  /** Persönliche Notizen (nur Bianka); null = keine Notizbox */
  notiz?: { text: string; am: string | null } | null
}

/** Ferienvertretung (nur ZAZ): Name plus die Tage, an denen sie kommt. */
type VertretungWert = { name: string; tage: string[] }
const VERTRETUNG_LEER: VertretungWert = { name: '', tage: [] }

/** Parameter für die Server-Actions: nicht ZAZ → beides undefined (unverändert
 *  lassen); kein Name → null/null (entfernen); Name ohne Tag im Zeitraum → Fehler. */
function vertretungParams(v: VertretungWert, from: string, to: string, zaz: boolean): { name?: string | null; tage?: string[] | null; fehler?: string } {
  if (!zaz) return {}
  const name = v.name.trim() || null
  if (!name) return { name: null, tage: null }
  if (!from || !to || to < from) return { name, tage: null }
  const bereich = new Set(weekdaysBetween(from, to))
  const tage = v.tage.filter(d => bereich.has(d))
  if (tage.length === 0) return { fehler: 'Bitte mindestens einen Tag wählen, an dem die Ferienvertretung kommt — oder «Keine Vertretung».' }
  return { name, tage }
}

const addTage = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const montagVon = (iso: string) => addTage(iso, -((new Date(`${iso}T00:00:00`).getDay() + 6) % 7))

/** Auswahl der Ferienvertretung (nur ZAZ): Kandidatenliste plus freie Eingabe,
 *  darunter ein Wochenraster Mo–Fr des Zeitraums — anklicken, an welchen
 *  Tagen die Vertretung kommt (Standard: alle Tage). */
function VertretungFeld({ value, onChange, kandidaten, ausser, from, to, className = '' }: {
  value: VertretungWert; onChange: (v: VertretungWert) => void; kandidaten: string[]; ausser?: string
  from: string; to: string; className?: string
}) {
  const optionen = kandidaten.filter(k => k !== ausser)
  const [frei, setFrei] = useState(() => value.name !== '' && !optionen.includes(value.name))
  const wochentage = useMemo(() => (from && to && to >= from ? weekdaysBetween(from, to) : []), [from, to])
  const gewaehlt = useMemo(() => new Set(value.tage), [value.tage])

  // Zeitraum geändert und kein gewählter Tag liegt mehr darin → alle Tage
  useEffect(() => {
    if (!value.name || wochentage.length === 0) return
    if (!wochentage.some(d => gewaehlt.has(d))) onChange({ name: value.name, tage: wochentage })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wochentage])

  const wochen = useMemo(() => {
    const montage = Array.from(new Set(wochentage.map(montagVon))).sort()
    return montage.map(mo => ({ montag: mo, kw: isoKw(mo), tage: [0, 1, 2, 3, 4].map(i => addTage(mo, i)) }))
  }, [wochentage])

  const setName = (name: string) =>
    onChange({ name, tage: name ? (value.tage.some(d => wochentage.includes(d)) ? value.tage : wochentage) : [] })
  const toggle = (d: string) =>
    onChange({ name: value.name, tage: gewaehlt.has(d) ? value.tage.filter(x => x !== d) : [...value.tage, d].sort() })
  const anzahl = wochentage.filter(d => gewaehlt.has(d)).length

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <select
        value={frei ? '__frei__' : value.name}
        onChange={e => {
          if (e.target.value === '__frei__') { setFrei(true); setName('') }
          else { setFrei(false); setName(e.target.value) }
        }}
        className="input-field text-sm w-full"
      >
        <option value="">Keine Vertretung</option>
        {optionen.map(k => <option key={k} value={k}>{k}</option>)}
        <option value="__frei__">Andere Person…</option>
      </select>
      {frei && (
        <input type="text" value={value.name} onChange={e => setName(e.target.value)}
          placeholder="Name der Vertretung" className="input-field text-sm w-full" />
      )}
      {value.name && wochentage.length > 0 && (
        <div className="rounded-xl border border-edge-ctl bg-surface p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-[10.5px] font-semibold text-ink-3">
              An welchen Tagen kommt die Vertretung? <span className="font-normal tnum">({anzahl} von {wochentage.length})</span>
            </p>
            <span className="flex gap-2.5 text-[10.5px] font-semibold">
              <button type="button" onClick={() => onChange({ name: value.name, tage: wochentage })} className="text-steel-ink hover:underline">Alle</button>
              <button type="button" onClick={() => onChange({ name: value.name, tage: [] })} className="text-ink-4 hover:underline">Keine</button>
            </span>
          </div>
          <div className="space-y-1">
            {wochen.map(w => (
              <div key={w.montag} className="grid grid-cols-[44px_repeat(5,minmax(0,1fr))] gap-1 items-center">
                <span className="text-[10px] font-bold text-ink-4 tnum">KW {w.kw}</span>
                {w.tage.map(d => wochentage.includes(d) ? (
                  <button key={d} type="button" onClick={() => toggle(d)} aria-pressed={gewaehlt.has(d)}
                    title={gewaehlt.has(d) ? `${tagKurz(d)} — Vertretung kommt (klicken zum Abwählen)` : `${tagKurz(d)} — keine Vertretung (klicken zum Wählen)`}
                    className={`rounded-lg px-1 py-1 text-center leading-tight border transition-colors ${
                      gewaehlt.has(d) ? 'bg-[#2F6F62] border-[#2F6F62] text-white' : 'bg-white border-edge-ctl text-ink-3 hover:border-edge-strong'
                    }`}>
                    <span className="block text-[10.5px] font-bold">{tagKurz(d).slice(0, 2)}</span>
                    <span className="block text-[9.5px] tnum">{d.slice(8, 10)}.{d.slice(5, 7)}.</span>
                  </button>
                ) : (
                  <span key={d} className="rounded-lg px-1 py-1 text-center leading-tight border border-dashed border-edge-row text-ink-5"
                    title="ausserhalb der Abwesenheit">
                    <span className="block text-[10.5px] font-semibold opacity-60">{tagKurz(d).slice(0, 2)}</span>
                    <span className="block text-[9.5px] opacity-60">–</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      {value.name && wochentage.length === 0 && (
        <p className="text-[10.5px] text-ink-4">Zuerst den Zeitraum (Von/Bis) wählen — dann lassen sich die Vertretungstage anklicken.</p>
      )}
    </div>
  )
}

// ── Calendar groups (Arbeitsplan colours) ────────────────────────────────────
const GROUPS = [
  { key: 'ZAZ',      label: 'ZAZ',      match: (t: string | null) => t === 'ZAZ',                                badgeCls: 'bg-mint-bg    text-mint-ink' },
  { key: 'DH_PA',    label: 'DH / PA',  match: (t: string | null) => t === 'DH / PA' || t === 'DH' || t === 'PA', badgeCls: 'bg-steel-bg   text-steel-ink' },
  { key: 'DA',       label: 'DA',       match: (t: string | null) => t === 'DA' || t === 'Leitende DA',           badgeCls: 'bg-apricot-bg text-apricot-ink' },
  { key: 'Lernende', label: 'Lernende', match: (t: string | null) => t === 'Lernende',                            badgeCls: 'bg-lilac-bg   text-lilac-ink' },
  { key: 'Andere',   label: 'Weitere',  match: (t: string | null) => !['ZAZ','DH / PA','DH','PA','DA','Leitende DA','Lernende'].includes(t ?? ''), badgeCls: 'bg-edge-row text-ink-2' },
]

function fmtD(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtTs(iso: string) {
  return `${new Date(iso).toLocaleString('de-CH', {
    timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })} Uhr`
}
function initials(name: string) {
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)
}
// group consecutive weekday dates into ranges for the bottom list
function toRanges(entries: { date: string; w: number }[]): { from: string; to: string; days: number; counted: number }[] {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))
  const ranges: { from: string; to: string; days: number; counted: number }[] = []
  for (const e of sorted) {
    const last = ranges[ranges.length - 1]
    if (last) {
      const prev = new Date(`${last.to}T00:00:00`)
      const cur = new Date(`${e.date}T00:00:00`)
      const diff = (cur.getTime() - prev.getTime()) / 86400000
      // same range if within 3 days (skips a weekend)
      if (diff <= 3) { last.to = e.date; last.days++; last.counted = round2(last.counted + e.w); continue }
    }
    ranges.push({ from: e.date, to: e.date, days: 1, counted: round2(e.w) })
  }
  return ranges
}

export default function FerienplanungClient({ employees, vacations, wishes, phasen, bestand, kontoYear, vertretungen, kandidaten = [], samstage, samstageTeam = [], samstageVerwalten = false, meinId = '', meineRolle = null, heute = '', wochen = [], regeln, personRegeln = {}, einsaetze = [], zweiWochen = {}, anspruchAnpassungen = {}, notfalldienste = [], meineNdRolle = null, istAdmin = false, notiz = null }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const now = zurichNow()

  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Laufende Aktion an einem Wunsch oder einer Woche, damit der gedrückte
  // Knopf in der Anfragenliste sofort «Wird eingetragen …» zeigt
  const [laufend, setLaufend] = useState<string | null>(null)
  // Fehler einer Aktion, direkt bei der betroffenen Zeile («<employeeId>_<from>»)
  const [fehler, setFehler] = useState<{ key: string; text: string } | null>(null)
  // Sofortige Anzeige nach eigenen Aktionen, bis die Seite die neuen Daten
  // vom Server hat: lokale Kopie der Wünsche, gültig nur solange die
  // Server-Daten dieselben sind (neue Daten verwerfen die Kopie von selbst)
  const [lokal, setLokal] = useState<{ basis: FerienWunsch[]; liste: FerienWunsch[] } | null>(null)
  const wishesRef = useRef(wishes); wishesRef.current = wishes
  const lokalAktiv = lokal !== null && lokal.basis === wishes
  const wishesAnzeige = lokalAktiv && lokal ? lokal.liste : wishes
  const zeigeLokal = useCallback((f: (liste: FerienWunsch[]) => FerienWunsch[]) => {
    const basis = wishesRef.current
    setLokal(l => ({ basis, liste: f(l && l.basis === basis ? l.liste : basis) }))
  }, [])
  const setzeStatusLokal = useCallback((employeeId: string, from: string, status: FerienWunsch['status'], patch: Partial<FerienWunsch> = {}) => {
    zeigeLokal(liste => liste.map(x => x.employeeId === employeeId && x.from === from
      ? { ...x, status, decidedAt: status === 'offen' ? null : new Date().toISOString(), decidedBy: status === 'offen' ? null : x.decidedBy, ...patch }
      : x))
  }, [zeigeLokal])
  /** Lokal so aufteilen wie der Server: eine Zeile pro Woche, gleiche Gruppe */
  const teileLokal = useCallback((w: FerienWunsch) => {
    const teile = wochenTeile(w.from, w.to)
    if (teile.length < 2) return
    const gruppe = w.gruppe ?? `wn-${w.from}`
    const alteTage = w.tage && w.tage.length > 0 ? w.tage : null
    zeigeLokal(liste => {
      // nur, solange der ungeteilte Wunsch (gleicher Zeitraum) noch in der Liste steht
      const istOriginal = (x: FerienWunsch) => x.employeeId === w.employeeId && x.from === w.from && x.to === w.to
      if (!liste.some(istOriginal)) return liste
      const froms = new Set(teile.map(t => t.from))
      const out: FerienWunsch[] = []
      for (const x of liste) {
        if (istOriginal(x)) out.push(...teile.map(t => { const tage = alteTage ? alteTage.filter(d => d >= t.from && d <= t.to) : []; return { ...w, from: t.from, to: t.to, gruppe, decidedAt: null, decidedBy: null, grund: null, tage: w.art === 'ferien' && tage.length > 0 ? tage : null } }))
        else if (!(x.employeeId === w.employeeId && froms.has(x.from))) out.push(x)
      }
      return out
    })
  }, [zeigeLokal])
  const entferneLokal = useCallback((employeeId: string, from: string) => zeigeLokal(liste => liste.filter(x => !(x.employeeId === employeeId && x.from === from))), [zeigeLokal])

  // direct-entry form
  const [addEmp, setAddEmp] = useState('')
  const [from, setFrom]     = useState('')
  const [to, setTo]         = useState('')
  const [angerechnet, setAngerechnet] = useState('')
  const [addVertretung, setAddVertretung] = useState<VertretungWert>(VERTRETUNG_LEER)
  // Wunsch einer ZAZ akzeptieren: kleiner Dialog mit Ferienvertretung
  const [acceptModal, setAcceptModal] = useState<{ w: FerienWunsch; vertretung: VertretungWert; teilVon?: FerienWunsch } | null>(null)

  // bottom-list filters
  const [filterEmp, setFilterEmp]   = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo]     = useState('')
  // «Alle anzeigen»-Popup der eingetragenen Ferien
  const [zeigeAlle, setZeigeAlle] = useState(false)
  // Bearbeiten einer eingetragenen Ferienperiode
  const [editRange, setEditRange] = useState<{
    empId: string; name: string; oldFrom: string; oldTo: string
    from: string; to: string; angerechnet: string; vertretung: VertretungWert
  } | null>(null)
  const [editRangeErr, setEditRangeErr] = useState<string | null>(null)

  // Notfalldienst form
  const [ndEmp, setNdEmp]   = useState('')
  const [ndFrom, setNdFrom] = useState('')
  const [ndTo, setNdTo]     = useState('')

  // wish modal (create or edit)
  const [wunschModal, setWunschModal] = useState<{ mode: 'create' | 'edit'; empId: string; origFrom: string; from: string; to: string; art: WunschArt; prio: WunschPrio; vertretung: VertretungWert; bemerkung: string } | null>(null)
  const [modalErr, setModalErr] = useState<string | null>(null)

  // phase-deadline modal
  const [phasenModal, setPhasenModal] = useState<PhasenDeadlines | null>(null)
  // Wochenplanung 2027
  const [regelnDialog, setRegelnDialog] = useState(false)
  const [direktOffen, setDirektOffen] = useState(false)
  // Anfragen und Wochenübersicht ein- und ausklappbar, der Stand bleibt im Browser gemerkt
  const [abschnitte, setAbschnitte] = useState<Record<Abschnitt, boolean>>({ anfragen: true, wuensche: true, wochen: true })
  useEffect(() => {
    try {
      const j = JSON.parse(localStorage.getItem(ABSCHNITTE_KEY) ?? '') as Partial<Record<Abschnitt, boolean>>
      setAbschnitte(a => ({ anfragen: typeof j.anfragen === 'boolean' ? j.anfragen : a.anfragen, wuensche: typeof j.wuensche === 'boolean' ? j.wuensche : a.wuensche, wochen: typeof j.wochen === 'boolean' ? j.wochen : a.wochen }))
    } catch { /* nichts gemerkt */ }
  }, [])
  const abschnittUmschalten = (k: Abschnitt) => setAbschnitte(a => {
    const n = { ...a, [k]: !a[k] }
    try { localStorage.setItem(ABSCHNITTE_KEY, JSON.stringify(n)) } catch { /* ohne Speicher */ }
    return n
  })
  const [anspruchEdit, setAnspruchEdit] = useState<{ id: string; name: string; wert: string; standard: number | null } | null>(null)
  const wochenFarben = useMemo(() => Object.fromEntries(wochen.map(w => [w.montag, w.farbe])) as Record<string, WochenFarbe>, [wochen])
  const alleWochen = useMemo(() => wochen2027(wochenFarben), [wochenFarben])
  const offeneAnfragen = wishesAnzeige.filter(w => w.status === 'offen').length

  // Immer aktuell: alle 30 Sekunden und beim Zurückkehren in den Tab, nicht
  // solange ein Dialog offen ist; nach eigenen Aktionen sofort (router.refresh).
  const dialogRef = useRef(false)
  dialogRef.current = !!(acceptModal || editRange || wunschModal || phasenModal || zeigeAlle || regelnDialog || anspruchEdit)
  useEffect(() => {
    const still = () => { if (document.visibilityState === 'visible' && !dialogRef.current) router.refresh() }
    const onVis = () => { if (document.visibilityState === 'visible') still() }
    document.addEventListener('visibilitychange', onVis)
    const iv = setInterval(still, 30_000)
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(iv) }
  }, [router])

  const nameById = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e.full_name])), [employees])
  const jobById = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e.job_title])), [employees])
  const istZazId = useCallback((id: string) => istZaz(jobById[id]), [jobById])
  const vertretungFuer = useCallback((empId: string, from: string, to: string) => vertretungFuerPeriode(vertretungen, empId, from, to), [vertretungen])
  // Vertretung einer Periode aus den gespeicherten Tagen (für Dialoge)
  const vertretungAusKarte = useCallback((empId: string, from: string, to: string): VertretungWert => {
    const det = vertretungDetails(vertretungen, empId, from, to)
    return { name: det.map(d => d.name).join(', '), tage: det.flatMap(d => d.tage).sort() }
  }, [vertretungen])
  // Vertretung eines Wunsches: akzeptiert → gespeicherte Tage, sonst Angaben aus dem Wunsch
  const wunschVertretung = useCallback((w: FerienWunsch): VertretungWert => {
    if (w.status === 'akzeptiert') { const k = vertretungAusKarte(w.employeeId, w.from, w.to); if (k.name) return k }
    const name = w.vertretung ?? ''
    return { name, tage: name ? (w.vertretungTage ?? weekdaysBetween(w.from, w.to)) : [] }
  }, [vertretungAusKarte])
  // Chip-Text: Name, bei Teil-Vertretung mit «(2 von 5 Tagen)»
  const vertretungChip = useCallback((empId: string, from: string, to: string): string => {
    const total = weekdaysBetween(from, to).length
    return vertretungDetails(vertretungen, empId, from, to)
      .map(d => `${d.name}${d.tage.length < total ? ` (${d.tage.length} von ${total} Tagen)` : ''}`).join(', ')
  }, [vertretungen])

  // Arbeitsplan order: groups top-to-bottom (ZAZ … Lernende), within a group
  // by schedule_order (nulls last), then name.
  const ordered = useMemo(() => [...employees].sort((a, b) => {
    const ga = GROUPS.findIndex(g => g.match(a.job_title))
    const gb = GROUPS.findIndex(g => g.match(b.job_title))
    if (ga !== gb) return ga - gb
    const sa = a.schedule_order ?? Number.MAX_SAFE_INTEGER
    const sb = b.schedule_order ?? Number.MAX_SAFE_INTEGER
    if (sa !== sb) return sa - sb
    return a.full_name.localeCompare(b.full_name)
  }), [employees])

  // Pensumgewichtete FERIEN-Zählung (nur F/F:x): angerechnete Einträge (F:x)
  // zählen mit ihrem Gewicht, glattes F mit dem Pensum-Faktor der Person.
  // Überall auf 2 Dezimalstellen gerundet.
  const fGewicht = useCallback((empId: string, entry: string): number | null => {
    if (entry.startsWith('F:')) return ferienWeight(entry) ?? 1
    if (entry === 'F') return 1
    return null
  }, [])

  // per-employee totals (accepted «F» days) for the bottom list: pro
  // Kalenderwoche gezählt, Teilzeit mit einer ganzen Woche F nach Pensum
  // (40 Prozent = 2 Tage), siehe ferientageZaehlen
  const planTotals = useMemo(() => {
    const proPerson: Record<string, FerienTag[]> = {}
    for (const v of vacations) {
      if (!v.schedule_date.startsWith(String(PLAN_YEAR))) continue
      const w = fGewicht(v.employee_id, v.entry)
      if (w == null) continue
      // Vereinbarte Ausnahme: diese F-Tage sind kein Ferienbezug (Minusstunden)
      if (istFerienAlsMinusstunden(nameById[v.employee_id], v.schedule_date)) continue
      ;(proPerson[v.employee_id] ??= []).push({ datum: v.schedule_date, gewicht: w })
    }
    const pensumVon = Object.fromEntries(employees.map(e => [e.id, e.pensum]))
    const acc: Record<string, number> = {}
    for (const [id, tage] of Object.entries(proPerson)) acc[id] = ferientageZaehlen(tage, pensumVon[id])
    return { acc }
  }, [vacations, fGewicht, nameById, employees])

  // phase status from start date / deadlines, minute-precise: die Eingabe
  // öffnet am Starttag um 06:00 und schliesst am Fristtag um 23:55
  // (shared logic — ein explizites Startdatum übersteuert die Kaskade)
  const phaseStatus = (idx: number) => phaseStateFor(phasen, PHASE_DEFS[idx].key, now)
  const PHASE_STATUS_UI = {
    aktiv:         { label: 'Aktiv',            cls: 'bg-mint-bg text-mint-ink' },
    abgeschlossen: { label: 'Frist abgelaufen', cls: 'bg-edge-row text-ink-3' },
    ausstehend:    { label: 'Ausstehend',       cls: 'bg-lilac-bg text-lilac-ink' },
    offen:         { label: 'Keine Frist',      cls: 'bg-surface text-ink-4 border border-edge-ctl' },
  } as const

  // ── handlers ──────────────────────────────────────────────────────────────
  /** Server-Aktion ausführen; «nachher» passt bei Erfolg die lokale Anzeige
   *  sofort an, bis die Seite die neuen Daten geladen hat. */
  function run(fn: () => Promise<{ error?: string } | { success?: boolean } | void>, okText?: string, nachher?: () => void, fehlerKey?: string) {
    setMsg(null); setFehler(null)
    const zeigeFehler = (text: string) => { setMsg({ type: 'err', text }); if (fehlerKey) setFehler({ key: fehlerKey, text }) }
    startTransition(async () => {
      try {
        const r = await fn()
        if (r && 'error' in r && r.error) { zeigeFehler(r.error); router.refresh() }
        else {
          if (okText) setMsg({ type: 'ok', text: okText })
          nachher?.()
          router.refresh()
        }
      } catch {
        zeigeFehler('Verbindung unterbrochen oder die Seite ist nicht mehr aktuell. Bitte die Seite neu laden und erneut versuchen.')
      } finally { setLaufend(null) }
    })
  }
  const mehrereWochen = (w: FerienWunsch) => w.quelle !== 'woche' && new Set(weekdaysBetween(w.from, w.to).map(montagVon)).size > 1
  const starte = (w: FerienWunsch, aktion: Aktion) => setLaufend(aktionKey(w.employeeId, w.from, aktion))

  function saveWunschModal() {
    if (!wunschModal) return
    const m = wunschModal
    if (!m.empId || !m.from || !m.to) { setModalErr('Bitte Mitarbeiterin und Zeitraum wählen.'); return }
    setModalErr(null)
    startTransition(async () => {
      const vp = vertretungParams(m.vertretung, m.from, m.to, istZazId(m.empId))
      if (vp.fehler) { setModalErr(vp.fehler); return }
      const r = m.mode === 'create'
        ? await createWunsch(m.empId, m.from, m.to, m.art, m.prio, vp.name, vp.tage, m.bemerkung)
        : await updateWunsch(m.empId, m.origFrom, m.from, m.to, m.art, m.prio, vp.name, vp.tage, m.bemerkung)
      if (r && 'error' in r && r.error) { setModalErr(r.error); return }
      setWunschModal(null)
      setMsg({ type: 'ok', text: m.mode === 'create' ? 'Wunsch erfasst.' : 'Wunsch angepasst.' })
      router.refresh()
    })
  }

  function savePhasenModal() {
    if (!phasenModal) return
    const p = phasenModal
    startTransition(async () => {
      const r = await savePhasen(p)
      if (r && 'error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      setPhasenModal(null)
      setMsg({ type: 'ok', text: 'Fristen gespeichert.' })
      router.refresh()
    })
  }

  /** Verletzte Regeln einer offenen Anmeldung in der Woche von «inWoche»
   *  (aus der Wochenübersicht); ohne Angabe die Woche, in der sie beginnt. */
  const verletzungenVon = useCallback((w: FerienWunsch, inWoche: string = w.from): string[] => {
    const woche = wochen.find(x => x.montag === montagVon(inWoche))
    if (!woche) return []
    for (const l of Object.values(woche.belegung)) { const b = l.find(x => x.employeeId === w.employeeId && x.from === w.from); if (b) return b.verletzungen }
    return []
  }, [wochen])

  /** Akzeptieren mit einem Klick; eine Rückfrage nur bei verletzten Regeln
   *  oder wenn ein ganzer Wunsch über mehrere Wochen auf einmal akzeptiert
   *  wird. Gibt zurück, ob eine Aktion gestartet wurde. */
  function handleAccept(w: FerienWunsch, verletzungen?: string[]): boolean {
    const name = nameById[w.employeeId] ?? '—'
    // Über die Regeln hinaus akzeptieren: vorher ein Hinweis mit allen verletzten Regeln
    const v = verletzungen ?? verletzungenVon(w)
    if (v.length > 0 && !confirm(`Diese Anmeldung von ${name} verletzt ${v.length === 1 ? 'eine Regel' : `${v.length} Regeln`}:\n\n${v.map(x => `• ${x}`).join('\n')}\n\nTrotzdem akzeptieren?`)) return false
    // ZAZ: Dialog mit Ferienvertretung, sofern noch keine hinterlegt ist
    if (istZazId(w.employeeId) && !(w.vertretung ?? '').trim()) { setLaufend(null); setAcceptModal({ w, vertretung: wunschVertretung(w) }); return true }
    if (w.status === 'offen' && mehrereWochen(w) && !confirm(`Alle Wochen des ${wunschArtLabel(w.art)}-Wunsches von ${name} (${fmtD(w.from)} – ${fmtD(w.to)}) akzeptieren?\nDie Tage werden im Arbeitsplan als «${wunschArtCode(w.art)}» eingetragen.`)) return false
    starte(w, 'akzeptieren')
    run(() => acceptWunsch(w.employeeId, w.from), `${wunschArtLabel(w.art)}-Wunsch von ${name} akzeptiert und im Arbeitsplan eingetragen.`, () => setzeStatusLokal(w.employeeId, w.from, 'akzeptiert'), `${w.employeeId}_${w.from}`)
    return true
  }

  function confirmAccept() {
    if (!acceptModal) return
    const { w, vertretung } = acceptModal
    const vp = vertretungParams(vertretung, w.from, w.to, true)
    if (vp.fehler) { setMsg({ type: 'err', text: vp.fehler }); return }
    const v = vp.name ?? null
    setMsg(null)
    const teilVon = acceptModal.teilVon
    startTransition(async () => {
      let r: { error?: string } | { success?: boolean }
      try {
        r = teilVon ? await wunschWocheEntscheiden(w.employeeId, teilVon.from, w.from, 'akzeptieren', null, v, vp.tage ?? null) : await acceptWunsch(w.employeeId, w.from, v, vp.tage)
      } catch { r = { error: 'Verbindung unterbrochen oder die Seite ist nicht mehr aktuell. Bitte die Seite neu laden und erneut versuchen.' } }
      if (r && 'error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      setAcceptModal(null)
      setMsg({ type: 'ok', text: `Wunsch akzeptiert und im Arbeitsplan eingetragen${v ? ` · Ferienvertretung: ${v}` : ''}.` })
      if (teilVon) teileLokal(teilVon)
      setzeStatusLokal(w.employeeId, w.from, 'akzeptiert', { vertretung: v, vertretungTage: vp.tage ?? null })
      router.refresh()
    })
  }

  /** Eine Woche eines Wunsches über mehrere Wochen einzeln entscheiden, in
   *  einem Schritt auf dem Server: aufteilen (falls nötig) und nur diese
   *  Woche akzeptieren oder ablehnen, die übrigen Wochen bleiben offen. Die
   *  Liste zeigt das Ergebnis sofort. */
  function handleTeil(w: FerienWunsch, teil: Teil, aktion: 'akzeptieren' | 'ablehnen') {
    const name = nameById[w.employeeId] ?? '—'
    // ohne Tagesauswahl bleibt auch die Woche ohne Tagesauswahl (zählt nach Pensum)
    const tage = w.tage && w.tage.length > 0 ? w.tage.filter(d => d >= teil.from && d <= teil.to) : []
    const part: FerienWunsch = { ...w, from: teil.from, to: teil.to, gruppe: w.gruppe ?? `wn-${w.from}`, tage: w.art === 'ferien' && tage.length > 0 ? tage : null }
    const kw = `KW ${isoKw(teil.from)} (${fmtD(teil.from)} – ${fmtD(teil.to)})`
    let grund: string | null = null
    if (aktion === 'ablehnen') {
      const g = prompt(`${kw} von ${name} ablehnen?\nGrund (optional, für die Person sichtbar):`)
      if (g === null) return
      grund = g
    } else {
      const v = verletzungenVon(w, teil.from)
      if (v.length > 0 && !confirm(`${kw} von ${name} verletzt ${v.length === 1 ? 'eine Regel' : `${v.length} Regeln`}:\n\n${v.map(x => `• ${x}`).join('\n')}\n\nTrotzdem akzeptieren?`)) return
      // ZAZ ohne hinterlegte Vertretung: Dialog mit Ferienvertretung, dann derselbe Schritt
      if (istZazId(w.employeeId) && !(w.vertretung ?? '').trim()) { setAcceptModal({ w: part, vertretung: wunschVertretung(part), teilVon: w }); return }
    }
    setLaufend(aktionKey(w.employeeId, teil.from, aktion))
    run(
      () => wunschWocheEntscheiden(w.employeeId, w.from, teil.from, aktion, grund),
      aktion === 'akzeptieren' ? `${kw} von ${name} akzeptiert und im Arbeitsplan eingetragen.` : `${kw} von ${name} abgelehnt.`,
      () => { teileLokal(w); setzeStatusLokal(w.employeeId, teil.from, aktion === 'akzeptieren' ? 'akzeptiert' : 'abgelehnt', aktion === 'ablehnen' ? { grund: (grund ?? '').trim() || null } : {}) },
      `${w.employeeId}_${teil.from}`,
    )
  }

  /** Ablehnen mit Grund; gibt zurück, ob eine Aktion gestartet wurde. */
  function handleAblehnen(w: FerienWunsch): boolean {
    const name = nameById[w.employeeId] ?? '—'
    const grund = prompt(`${w.quelle === 'woche' ? `Wochenanmeldung KW ${w.kw}` : 'Wunsch'} von ${name} (${fmtD(w.from)} – ${fmtD(w.to)}) ablehnen?\nGrund (optional, für die Person sichtbar):`)
    if (grund === null) return false
    starte(w, 'ablehnen')
    run(() => wunschAblehnen(w.employeeId, w.from, grund), 'Abgelehnt.', () => setzeStatusLokal(w.employeeId, w.from, 'abgelehnt', { grund: grund.trim() || null }), `${w.employeeId}_${w.from}`)
    return true
  }
  function handleZuruecknehmen(w: FerienWunsch) {
    const name = nameById[w.employeeId] ?? '—'
    const text = w.status === 'akzeptiert' ? 'Akzeptierte Anmeldung zurücknehmen? Die Tage werden aus dem Arbeitsplan entfernt, die Anmeldung ist danach wieder offen.' : 'Ablehnung aufheben? Die Anmeldung ist danach wieder offen.'
    if (!confirm(`${name}, ${fmtD(w.from)} – ${fmtD(w.to)}: ${text}`)) return
    starte(w, 'zuruecknehmen')
    run(() => wunschZuruecknehmen(w.employeeId, w.from), 'Zurückgenommen.', () => setzeStatusLokal(w.employeeId, w.from, 'offen', { grund: null, vertretung: null, vertretungTage: null }), `${w.employeeId}_${w.from}`)
  }
  function saveAnspruch(modus: 'wert' | 'kein' | 'standard') {
    if (!anspruchEdit) return
    const e = anspruchEdit
    let tage: number | null | undefined
    if (modus === 'standard') tage = undefined
    else if (modus === 'kein') tage = null
    else { tage = parseFloat(e.wert.replace(',', '.')); if (isNaN(tage) || tage < 0) { setMsg({ type: 'err', text: 'Bitte eine Zahl eingeben (z. B. 15 oder 12.5).' }); return } }
    startTransition(async () => {
      const r = await anspruchSetzen(e.id, tage)
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      setAnspruchEdit(null)
      setMsg({ type: 'ok', text: 'Anspruch gespeichert.' })
      router.refresh()
    })
  }

  function handleDeleteWunsch(w: FerienWunsch) {
    const name = nameById[w.employeeId] ?? '—'
    const extra = w.status === 'akzeptiert' ? '\nDie bereits eingetragenen Ferientage werden ebenfalls entfernt.' : ''
    if (!confirm(`Wunsch von ${name} (${fmtD(w.from)} – ${fmtD(w.to)}) löschen?${extra}`)) return
    starte(w, 'loeschen')
    run(() => deleteWunsch(w.employeeId, w.from), 'Wunsch gelöscht.', () => entferneLokal(w.employeeId, w.from), `${w.employeeId}_${w.from}`)
  }

  function handleAdd() {
    if (!addEmp || !from || !to) { setMsg({ type: 'err', text: 'Bitte Mitarbeiter und Zeitraum wählen.' }); return }
    let angerechnetNum: number | null = null
    if (angerechnet.trim() !== '') {
      angerechnetNum = parseFloat(angerechnet.replace(',', '.'))
      if (isNaN(angerechnetNum) || angerechnetNum <= 0) { setMsg({ type: 'err', text: 'Angerechnete Tage müssen eine Zahl grösser 0 sein (z. B. 2.5).' }); return }
    }
    setMsg(null)
    const vp = vertretungParams(addVertretung, from, to, istZazId(addEmp))
    if (vp.fehler) { setMsg({ type: 'err', text: vp.fehler }); return }
    const vertretung = vp.name
    startTransition(async () => {
      const r = await addVacation(addEmp, from, to, 'F', angerechnetNum, vp.name, vp.tage)
      if (r?.error) setMsg({ type: 'err', text: r.error })
      else {
        const countedTxt = r.counted !== r.count ? `, angerechnet ${r.counted} Tag(e)` : ''
        const vTxt = vertretung ? ` · Ferienvertretung: ${vertretung}` : ''
        setMsg({ type: 'ok', text: `${r.count} Ferientag(e) geplant und im Arbeitsplan eingetragen${countedTxt}${vTxt}.` })
        setFrom(''); setTo(''); setAngerechnet(''); setAddVertretung(VERTRETUNG_LEER); router.refresh()
      }
    })
  }

  function handleRemoveRange(empId: string, rFrom: string, rTo: string) {
    if (!confirm(`Ferien von ${fmtD(rFrom)} bis ${fmtD(rTo)} entfernen?`)) return
    run(() => removeVacation(empId, rFrom, rTo))
  }

  // bottom list: ALL employees with their FERIEN-ranges (F/F:x) + Bestand —
  // nur das Jahr des angezeigten Kalenders (PLAN_YEAR), pensumgewichtet.
  // Der Anspruch ist derselbe wie im Planungsstand: Praxisregel nach Pensum
  // oder die Anpassung durch den Admin.
  const bottomList = useMemo(() => {
    const byEmp: Record<string, { date: string; w: number }[]> = {}
    for (const v of vacations) {
      if (!v.schedule_date.startsWith(String(PLAN_YEAR))) continue
      if (filterFrom && v.schedule_date < filterFrom) continue
      if (filterTo && v.schedule_date > filterTo) continue
      const w = fGewicht(v.employee_id, v.entry)
      if (w == null) continue
      ;(byEmp[v.employee_id] ??= []).push({ date: v.schedule_date, w })
    }
    return ordered
      .filter(e => !filterEmp || e.id === filterEmp)
      .map(e => {
        const entries = byEmp[e.id] ?? []
        const a = anspruchTageFor(e.full_name, e.pensum, anspruchAnpassungen[e.id])
        return {
          id: e.id,
          name: e.full_name,
          ranges: toRanges(entries),
          counted: round2(entries.reduce((s, x) => s + x.w, 0)),
          bestand: bestand[e.id] ?? null,
          plan27: planTotals.acc[e.id] ?? 0,
          anspruch: a,
          anspruchTage: a.tage,
        }
      })
  }, [ordered, vacations, filterEmp, filterFrom, filterTo, bestand, planTotals, fGewicht, anspruchAnpassungen])

  // Planungsstand pro Person: akzeptiert (F im Arbeitsplan, gewichtet) plus
  // angemeldet (offene Wochenanmeldungen und Wünsche, in Tagen nach dem
  // Pensum) gegen den Anspruch (Praxisregel oder Admin Anpassung), dazu
  // die Regel «zwei grüne Wochen, davon eine dunkelgrüne».
  const planungsStand = useMemo(() => {
    const byMontag = new Map(alleWochen.map(w => [w.montag, w]))
    const offen: Record<string, number> = {}
    for (const w of wishes) {
      if (w.status !== 'offen' || w.art !== 'ferien') continue
      const emp = employees.find(e => e.id === w.employeeId)
      const t = wunschKosten(w, w.quelle === 'woche' ? byMontag.get(w.from) : undefined, emp?.pensum)
      offen[w.employeeId] = round2((offen[w.employeeId] ?? 0) + t)
    }
    const belegt: Record<string, string[]> = {}
    for (const w of wochen) for (const l of Object.values(w.belegung)) for (const b of l) (belegt[b.employeeId] ??= []).push(w.montag)
    return ordered.map(e => {
      const a = anspruchTageFor(e.full_name, e.pensum, anspruchAnpassungen[e.id])
      const akzeptiert = planTotals.acc[e.id] ?? 0
      const angemeldet = offen[e.id] ?? 0
      const verplant = round2(akzeptiert + angemeldet)
      let status: 'keins' | 'nichts' | 'zuwenig' | 'ok' | 'zuviel'
      if (a.tage == null) status = 'keins'
      else if (verplant === 0) status = 'nichts'
      else if (verplant < a.tage - 0.005) status = 'zuwenig'
      else if (verplant > a.tage + 0.005) status = 'zuviel'
      else status = 'ok'
      return {
        id: e.id, name: e.full_name, anspruchTage: a.tage, angepasst: a.angepasst, akzeptiert, angemeldet, verplant, status,
        diff: a.tage != null ? round2(Math.abs(a.tage - verplant)) : null,
        gruen: gruenRegel(alleWochen, belegt[e.id] ?? []),
        zwei: zweiWochen[e.id] ?? null,
        standard: anspruchTageFor(e.full_name, e.pensum).tage,
      }
    })
  }, [ordered, wishes, planTotals, employees, alleWochen, wochen, anspruchAnpassungen, zweiWochen])

  // Die 5 neuesten eingetragenen Ferienperioden (spätester Beginn zuerst) —
  // die Karte zeigt nur diese; das «Alle anzeigen»-Popup die volle Liste.
  const neuesteEintraege = useMemo(() =>
    bottomList
      .flatMap(g => g.ranges.map(r => ({ empId: g.id, name: g.name, ...r })))
      .sort((a, b) => b.from.localeCompare(a.from))
      .slice(0, 5),
  [bottomList])

  // Notfalldienste als Perioden (für Liste + Entfernen)
  const ndListe = useMemo(() => {
    const byEmp: Record<string, { date: string; w: number }[]> = {}
    for (const v of vacations) {
      if (v.entry !== 'ND') continue
      ;(byEmp[v.employee_id] ??= []).push({ date: v.schedule_date, w: 1 })
    }
    return ordered
      .flatMap(e => (byEmp[e.id] ? toRanges(byEmp[e.id]).map(r => ({ empId: e.id, name: e.full_name, ...r })) : []))
      .sort((a, b) => a.from.localeCompare(b.from))
  }, [vacations, ordered])

  function handleAddNd() {
    if (!ndEmp || !ndFrom || !ndTo) { setMsg({ type: 'err', text: 'Bitte Mitarbeiter und Zeitraum für den Notfalldienst wählen.' }); return }
    setMsg(null)
    startTransition(async () => {
      const r = await addNotfalldienst(ndEmp, ndFrom, ndTo)
      if (r && 'error' in r && r.error) setMsg({ type: 'err', text: r.error })
      else {
        setMsg({ type: 'ok', text: `Notfalldienst eingetragen (${(r as { count?: number }).count ?? ''} Tag(e)) — im Arbeitsplan als «ND» sichtbar.` })
        setNdFrom(''); setNdTo(''); router.refresh()
      }
    })
  }

  function handleRemoveNd(empId: string, rFrom: string, rTo: string) {
    if (!confirm(`Notfalldienst von ${fmtD(rFrom)} bis ${fmtD(rTo)} entfernen?`)) return
    run(() => removeNotfalldienst(empId, rFrom, rTo))
  }

  function openEditRange(empId: string, name: string, r: { from: string; to: string; days: number; counted: number }) {
    setEditRangeErr(null)
    setEditRange({
      empId, name, oldFrom: r.from, oldTo: r.to,
      from: r.from, to: r.to,
      angerechnet: r.counted !== r.days ? String(r.counted) : '',
      vertretung: vertretungAusKarte(empId, r.from, r.to),
    })
  }

  function saveEditRange() {
    if (!editRange) return
    const e = editRange
    if (!e.from || !e.to) { setEditRangeErr('Bitte Von und Bis wählen.'); return }
    let angerechnetNum: number | null = null
    if (e.angerechnet.trim() !== '') {
      angerechnetNum = parseFloat(e.angerechnet.replace(',', '.'))
      if (isNaN(angerechnetNum) || angerechnetNum <= 0) { setEditRangeErr('Angerechnete Tage müssen eine Zahl grösser 0 sein (z. B. 2.5).'); return }
    }
    setEditRangeErr(null)
    startTransition(async () => {
      const vp = vertretungParams(e.vertretung, e.from, e.to, istZazId(e.empId))
      if (vp.fehler) { setEditRangeErr(vp.fehler); return }
      const r = await updateVacationRange(e.empId, e.oldFrom, e.oldTo, e.from, e.to, angerechnetNum, vp.name, vp.tage)
      if (r && 'error' in r && r.error) { setEditRangeErr(r.error); return }
      setEditRange(null)
      setMsg({ type: 'ok', text: 'Ferienperiode angepasst — der Arbeitsplan wurde aktualisiert.' })
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">

      {msg && (
        <p className={`text-xs px-3 py-2 rounded-ctl inline-block ${msg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>
          {msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}
        </p>
      )}

      {/* ── 1 · Kopf: offene Anfragen und Planungsphasen kompakt ───────── */}
      <div className="card px-5 py-3.5 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <span className={`text-[22px] font-bold tnum ${offeneAnfragen > 0 ? 'text-apricot-ink' : 'text-mint-ink'}`}>{offeneAnfragen}</span>
          <span className="text-[11.5px] text-ink-3 leading-tight">offene<br />Anfragen</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
          {PHASE_DEFS.map((p, i) => {
            const st = phaseStatus(i)
            const ui = PHASE_STATUS_UI[st]
            const start = phasen[PHASE_START_KEY[p.key]]
            const frist = phasen[p.key]
            return (
              <span key={p.key} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface border border-edge-soft" title={`${p.label}: Start ${start ? fmtD(start) : 'nach der vorherigen Frist'} um ${PHASE_OPEN_TIME} Uhr, Frist ${frist ? fmtD(frist) : 'offen'} ${PHASE_CLOSE_TIME} Uhr`}>
                <span className="font-semibold text-ink">{p.short}</span>
                <span className="tnum text-ink-3">{start ? `${fmtD(start)} bis ` : 'bis '}{frist ? fmtD(frist) : '–'}</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${ui.cls}`}>{ui.label}</span>
              </span>
            )
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setPhasenModal({ ...phasen })} className="btn-secondary !px-3 !py-1.5 !text-xs">✎ Fristen bearbeiten</button>
          {regeln && <button onClick={() => setRegelnDialog(true)} className="btn-secondary !px-3 !py-1.5 !text-xs" title="Plätze, Assistenz Bedarf, Gültigkeit und Faktoren pro Person, Platzhalter, feste Einsätze">Regeln bearbeiten</button>}
        </div>
      </div>

      {/* ── 1b · Notizen, nur Bianka ───────────────────────────────────── */}
      {notiz && <FerienNotizBox text={notiz.text} am={notiz.am} />}

      {/* ── 2 · Ferienkalender (Jahr + Monatsansichten) ────────────────── */}
      <FerienKalender
        employees={employees}
        vacations={vacations}
        wishes={wishes}
        planYear={PLAN_YEAR}
        showTotals
        canEditDays
        pdfExport
        vertretungen={vertretungen}
        wochenFarben={wochenFarben}
        farbLegende
        einsaetze={einsaetze}
      />

      {/* ── 3 · Wochenanmeldungen pro Person, neueste zuerst ─────────── */}
      <AnfragenListe wishes={wishesAnzeige} employees={ordered} wochen={wochen} alleWochen={alleWochen} vacations={vacations} isPending={isPending} laufend={laufend} fehlerBei={fehler} aktualisiert={lokalAktiv} hinweis={msg} nur="woche" titel={`Wochenanmeldungen ${PLAN_YEAR}`}
        untertitel="Anmeldungen für ganze Wochen innerhalb der Plätze ihrer Kategorie, wer zuerst kommt, hat den Platz. Pro Person, die neueste zuoberst; aufklappen zeigt Farbe der Woche und Belegung der Kategorie. Akzeptierte Einträge stehen im Arbeitsplan als «F»."
        eingeklappt={!abschnitte.anfragen} onToggle={() => abschnittUmschalten('anfragen')}
        onNeu={() => { setModalErr(null); setWunschModal({ mode: 'create', empId: '', origFrom: '', from: '', to: '', art: 'ferien', prio: 3, vertretung: VERTRETUNG_LEER, bemerkung: '' }) }}
        onBearbeiten={w => { setModalErr(null); setWunschModal({ mode: 'edit', empId: w.employeeId, origFrom: w.from, from: w.from, to: w.to, art: w.art, prio: w.prio ?? 3, vertretung: wunschVertretung(w), bemerkung: w.bemerkung ?? '' }) }}
        onAkzeptieren={w => handleAccept(w)} onAblehnen={handleAblehnen} onZuruecknehmen={handleZuruecknehmen} onLoeschen={handleDeleteWunsch}
        onTeil={handleTeil} />


      {/* ── 3b · Wünsche: Wochen, die in der Kategorie schon voll sind, einzelne Tage ── */}
      <AnfragenListe wishes={wishesAnzeige} employees={ordered} wochen={wochen} alleWochen={alleWochen} vacations={vacations} isPending={isPending} laufend={laufend} fehlerBei={fehler} aktualisiert={lokalAktiv} nur="wunsch" titel={`Wünsche ${PLAN_YEAR}`}
        untertitel="Wünsche gehen an den Plätzen vorbei: für Wochen, die in der Kategorie der Person schon voll sind («Woche voll»), für einzelne Tage und Ausnahmen. Die Praxisleitung entscheidet jede Woche einzeln, akzeptierte Wünsche stehen als «F», «UF» oder «WB» im Arbeitsplan."
        eingeklappt={!abschnitte.wuensche} onToggle={() => abschnittUmschalten('wuensche')}
        onNeu={() => { setModalErr(null); setWunschModal({ mode: 'create', empId: '', origFrom: '', from: '', to: '', art: 'ferien', prio: 3, vertretung: VERTRETUNG_LEER, bemerkung: '' }) }}
        onBearbeiten={w => { setModalErr(null); setWunschModal({ mode: 'edit', empId: w.employeeId, origFrom: w.from, from: w.from, to: w.to, art: w.art, prio: w.prio ?? 3, vertretung: wunschVertretung(w), bemerkung: w.bemerkung ?? '' }) }}
        onAkzeptieren={w => handleAccept(w)} onAblehnen={handleAblehnen} onZuruecknehmen={handleZuruecknehmen} onLoeschen={handleDeleteWunsch}
        onTeil={handleTeil} />


      {/* ── 2b · Wochenübersicht 2027 ─────────────────────────────────── */}
      {wochen.length > 0 && (
        <WochenUebersichtAdmin wochen={wochen} wishes={wishesAnzeige} verwalten isPending={isPending} laufend={laufend} fehlerBei={fehler} eingeklappt={!abschnitte.wochen} onToggle={() => abschnittUmschalten('wochen')}
          onAkzeptieren={handleAccept} onAblehnen={handleAblehnen} onZuruecknehmen={handleZuruecknehmen} onTeil={handleTeil} />
      )}

      {/* ── 4d · Samstagsöffnungen ─────────────────────────────────────── */}
      {samstage && (
        <SamstageSection samstage={samstage} meinId={meinId} meineRolle={meineRolle} verwalten={samstageVerwalten} team={samstageTeam} heute={heute} />
      )}
      {samstage && (
        <NotfalldiensteSection dienste={notfalldienste} meinId={meinId} meineRolle={meineNdRolle} team={samstageTeam} heute={heute} />
      )}

      {/* ── 4 · Direkt eintragen (aufklappbar) ─────────────────────────── */}
      <div className="card overflow-hidden">
        <button onClick={() => setDirektOffen(o => !o)} className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left">
          <div>
            <p className="text-sm font-semibold text-ink">Direkt eintragen</p>
            <p className="text-[11.5px] text-ink-4 mt-0.5">Ferien direkt eintragen und Notfalldienst eintragen, ohne Anmeldung.</p>
          </div>
          <svg className={`w-4 h-4 text-ink-4 transition-transform ${direktOffen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </button>
        {direktOffen && (
          <div className="px-5 pb-5 pt-4 border-t border-edge-soft space-y-6">
      <div>
        <p className="text-sm font-semibold text-ink mb-1">Ferien direkt eintragen</p>
        <p className="text-[11.5px] text-ink-4 mb-4">Ohne Wunsch-Workflow — die Tage werden sofort als «F» im Arbeitsplan eingetragen.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Mitarbeiter</label>
            <select value={addEmp} onChange={e => setAddEmp(e.target.value)} className="input-field text-sm w-52">
              <option value="">Wählen…</option>
              {ordered.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Von</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input-field text-sm w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Bis</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input-field text-sm w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Angerechnete Tage <span className="normal-case font-normal">(optional)</span></label>
            <input type="text" inputMode="decimal" placeholder="autom." value={angerechnet}
              onChange={e => setAngerechnet(e.target.value)} className="input-field text-sm w-28" />
          </div>
          {istZazId(addEmp) && (
            <div className="flex flex-col gap-1 basis-full max-w-xl">
              <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Ferienvertretung <span className="normal-case font-normal">(optional)</span></label>
              <VertretungFeld key={addEmp} value={addVertretung} onChange={setAddVertretung} kandidaten={kandidaten} ausser={nameById[addEmp]} from={from} to={to} />
            </div>
          )}
          <button onClick={handleAdd} disabled={isPending}
            className="px-4 py-2.5 rounded-xl bg-dusk hover:bg-dusk-deep text-white text-sm font-semibold transition-colors disabled:opacity-50">
            {isPending ? 'Speichern…' : 'Ferien eintragen'}
          </button>
        </div>
        <p className="mt-3 text-[11px] text-ink-4">
          Nur Wochentage (Mo–Fr) werden als Ferien eingetragen. «Angerechnete Tage» für Teilzeit mit flexiblen Tagen:
          z. B. 50%-Pensum, ganze Woche Mo–Fr abwesend → 5 Wochentage, angerechnet 2.5.
        </p>
      </div>
      <div>
        <p className="text-sm font-semibold text-ink mb-1">Notfalldienst eintragen</p>
        <p className="text-[11.5px] text-ink-4 mb-4">
          Die Tage werden als «ND» im Arbeitsplan eingetragen und erscheinen für alle
          sichtbar in eigener Farbe im Ferienkalender. Sie zählen weder als Ferien noch als Absenz.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Mitarbeiter</label>
            <select value={ndEmp} onChange={e => setNdEmp(e.target.value)} className="input-field text-sm w-52">
              <option value="">Wählen…</option>
              {ordered.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Von</label>
            <input type="date" value={ndFrom} onChange={e => setNdFrom(e.target.value)} className="input-field text-sm w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Bis</label>
            <input type="date" value={ndTo} onChange={e => setNdTo(e.target.value)} className="input-field text-sm w-40" />
          </div>
          <button onClick={handleAddNd} disabled={isPending}
            className="px-4 py-2.5 rounded-xl bg-[#B5613F] hover:bg-[#A6492F] text-white text-sm font-semibold transition-colors disabled:opacity-50">
            {isPending ? 'Speichern…' : 'Notfalldienst eintragen'}
          </button>
        </div>
        {ndListe.length > 0 && (
          <div className="mt-4 pt-3 border-t border-edge-soft">
            <p className="eyebrow mb-2">Eingetragene Notfalldienste</p>
            <div className="flex flex-wrap gap-2">
              {ndListe.map((r, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1 tnum"
                  style={{ background: '#F8DCD2', color: '#A6492F' }}>
                  <span className="font-semibold">{r.name}</span>
                  <span className="text-[10px] font-semibold opacity-80">{kwBereich(r.from, r.to)}</span>
                  {r.from === r.to ? fmtD(r.from) : `${fmtD(r.from)} – ${fmtD(r.to)}`}
                  <span>({r.days} {r.days === 1 ? 'Tag' : 'Tage'})</span>
                  <button onClick={() => handleRemoveNd(r.empId, r.from, r.to)} disabled={isPending}
                    className="hover:text-red-600 transition-colors" title="Entfernen">✕</button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
          </div>
        )}
      </div>

      {/* ── 4c · Planungsstand pro Person ──────────────────────────────── */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-sm font-semibold text-ink mb-1">Planungsstand {PLAN_YEAR}</p>
            <p className="text-[11.5px] text-ink-4">Akzeptiert plus angemeldet gegen den Anspruch, in Tagen (jeder gewählte Tag zählt einen Tag). Dazu die Regeln «zwei grüne Wochen, davon eine dunkelgrüne» und «zwei Wochen am Stück» (Art. 329c OR).</p>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {planungsStand.map(p => (
            <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-lg bg-surface border border-edge-soft text-[12.5px]">
              <span className="font-semibold flex-1 min-w-[120px] truncate">{p.name}</span>
              <span className="tnum text-ink-2 whitespace-nowrap" title={`${p.akzeptiert} akzeptiert plus ${p.angemeldet} angemeldet`}>
                {p.akzeptiert} + {p.angemeldet} = {p.verplant}{p.anspruchTage != null ? ` / ${p.anspruchTage}` : ''} Tage
              </span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full tnum whitespace-nowrap ${p.gruen.gruen >= 2 ? 'bg-mint-bg text-mint-ink' : 'bg-edge-row text-ink-3'}`} title="Grüne Wochen (mindestens 2)">
                grün {p.gruen.gruen} von 2
              </span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full tnum whitespace-nowrap ${p.gruen.dunkelgruen >= 1 ? 'bg-mint-bg text-mint-ink' : 'bg-edge-row text-ink-3'}`} title="Davon dunkelgrün (mindestens 1)">
                dunkelgrün {p.gruen.dunkelgruen} von 1
              </span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${p.zwei === null ? 'bg-edge-row text-ink-4' : p.zwei ? 'bg-mint-bg text-mint-ink' : 'bg-apricot-bg text-apricot-ink'}`} title="Mindestens zwei Ferienwochen am Stück (Art. 329c OR)">
                {p.zwei === null ? 'zwei am Stück gilt nicht' : p.zwei ? 'zwei am Stück ✓' : 'zwei am Stück offen'}
              </span>
              {p.status === 'keins' && <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-edge-row text-ink-3 whitespace-nowrap">ohne Kontingent</span>}
              {p.status === 'nichts' && <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-blush-bg text-blush-ink whitespace-nowrap">Noch nichts</span>}
              {p.status === 'zuwenig' && <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-apricot-bg text-apricot-ink whitespace-nowrap tnum">{p.diff} Tage offen</span>}
              {p.status === 'ok' && <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-mint-bg text-mint-ink whitespace-nowrap">Vollständig ✓</span>}
              {p.status === 'zuviel' && <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-lilac-bg text-lilac-ink whitespace-nowrap tnum">{p.diff} Tage zu viel</span>}
              {istAdmin && (
                <button onClick={() => setAnspruchEdit({ id: p.id, name: p.name, wert: p.anspruchTage != null ? String(p.anspruchTage) : '', standard: p.standard })}
                  className={`text-[10.5px] font-semibold hover:underline ${p.angepasst ? 'text-lilac-ink' : 'text-ink-4'}`} title={p.angepasst ? 'Anspruch durch Admin angepasst' : 'Anspruch anpassen'}>✎ Anspruch</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── 5 · Mitarbeitende: Bestand & geplante Ferien ───────────────── */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <p className="text-sm font-semibold text-ink">Eingetragene Ferien {PLAN_YEAR} — neueste Einträge</p>
            <p className="text-[11.5px] text-ink-4 mt-0.5">
              Die 5 zuletzt beginnenden Ferienperioden im Jahr {PLAN_YEAR} (Jahr des Kalenders).
              «Alle anzeigen» öffnet die vollständige Liste aller Mitarbeitenden mit Bestand und Filtern.
            </p>
          </div>
          <button onClick={() => setZeigeAlle(true)} className="btn-secondary !px-3.5 !py-2 !text-xs">
            Alle anzeigen ({bottomList.reduce((s, g) => s + g.ranges.length, 0)})
          </button>
        </div>
        {neuesteEintraege.length === 0 ? (
          <p className="text-xs text-ink-4">Noch keine Ferien eingetragen.</p>
        ) : (
          <div className="space-y-1.5">
            {neuesteEintraege.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-[13px] px-3 py-2 rounded-lg bg-surface border border-edge-soft">
                <span className="font-semibold flex-1 min-w-[140px]">{r.name}</span>
                <span className="text-[10px] font-semibold text-ink-3 tnum">{kwBereich(r.from, r.to)}</span>
                <span className="tnum">{r.from === r.to ? fmtD(r.from) : `${fmtD(r.from)} – ${fmtD(r.to)}`}</span>
                <span className="text-ink-4 text-xs tnum">
                  ({r.days} {r.days === 1 ? 'Tag' : 'Tage'}{r.counted !== r.days ? `, angerechnet ${r.counted}` : ''})
                </span>
                {vertretungFuer(r.empId, r.from, r.to).length > 0 && (
                  <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-mint-bg text-mint-ink whitespace-nowrap">
                    Vertretung: {vertretungChip(r.empId, r.from, r.to)}
                  </span>
                )}
                <button onClick={() => openEditRange(r.empId, r.name, r)} disabled={isPending}
                  className="p-1 rounded-lg border border-edge-ctl bg-white text-ink-2 hover:bg-edge-row transition-colors" title={istZazId(r.empId) ? 'Daten und Ferienvertretung bearbeiten' : 'Daten bearbeiten'}>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                  </svg>
                </button>
                <button onClick={() => handleRemoveRange(r.empId, r.from, r.to)} disabled={isPending}
                  className="text-ink-5 hover:text-red-500 transition-colors" title="Entfernen">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Regeln bearbeiten ──────────────────────────────────────────── */}
      {regelnDialog && regeln && <RegelnDialog regeln={regeln} personen={employees} personRegeln={personRegeln} einsaetze={einsaetze} onClose={() => setRegelnDialog(false)} />}

      {/* ── Anspruch anpassen (Admin) ──────────────────────────────────── */}
      {anspruchEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setAnspruchEdit(null)} />
          <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-sm p-5 space-y-3">
            <p className="text-sm font-bold text-ink">Ferienanspruch {PLAN_YEAR}</p>
            <p className="text-[12px] text-ink-3">{anspruchEdit.name}. Praxisregel {anspruchEdit.standard != null ? `${anspruchEdit.standard} Tage` : 'ohne festes Kontingent'}. Ein hier gesetzter Wert gilt für die Ferienplanung {PLAN_YEAR} und wird der Person als «durch Admin angepasst» angezeigt.</p>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Anspruch in Tagen</span>
              <input type="text" inputMode="decimal" value={anspruchEdit.wert} onChange={e => setAnspruchEdit({ ...anspruchEdit, wert: e.target.value })} placeholder="z. B. 15 oder 12.5" className="input-field text-sm" />
            </label>
            <div className="flex flex-wrap gap-2 pt-1">
              <button onClick={() => saveAnspruch('wert')} disabled={isPending} className="btn-primary !px-3 !py-2 !text-xs">Speichern</button>
              <button onClick={() => saveAnspruch('kein')} disabled={isPending} className="btn-secondary !px-3 !py-2 !text-xs">Ohne festes Kontingent</button>
              <button onClick={() => saveAnspruch('standard')} disabled={isPending} className="btn-secondary !px-3 !py-2 !text-xs">Praxisregel</button>
              <button onClick={() => setAnspruchEdit(null)} className="text-xs text-ink-4 hover:text-ink-2 ml-auto">Abbrechen</button>
            </div>
          </div>
        </div>
      )}

      {/* ── «Alle anzeigen»-Popup: alle eingetragenen Ferien ───────────── */}
      {zeigeAlle && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-3xl shadow-xl overflow-hidden rounded-t-card border border-edge flex flex-col max-h-[88vh]">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface flex-shrink-0">
              <div>
                <h3 className="text-sm font-bold text-ink">Mitarbeitende — Ferien-Bestand & geplante Ferien</h3>
                <p className="text-xs text-ink-4 mt-0.5">
                  Bestand aus dem Arbeitszeit- und Ferienkonto {kontoYear} · die Liste zeigt die
                  geplanten Ferien {PLAN_YEAR} (Jahr des Kalenders).
                </p>
              </div>
              <button onClick={() => setZeigeAlle(false)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4 flex-shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-3 border-b border-edge-soft flex flex-wrap items-end gap-3 flex-shrink-0">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Mitarbeiter</label>
                <select value={filterEmp} onChange={e => setFilterEmp(e.target.value)} className="input-field text-sm w-48">
                  <option value="">Alle</option>
                  {ordered.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Von</label>
                <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="input-field text-sm w-36" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Bis</label>
                <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="input-field text-sm w-36" />
              </div>
            </div>
            <div className="px-6 py-4 overflow-y-auto">
              <div className="space-y-3">
                {bottomList.map(g => (
                  <div key={g.id} className="border border-edge-soft rounded-xl p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-[26px] h-[26px] rounded-full bg-dune flex items-center justify-center flex-shrink-0">
                          <span className="text-ink-2 text-[9.5px] font-bold">{initials(g.name)}</span>
                        </div>
                        <p className="text-sm font-semibold text-ink">{g.name}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-apricot-ink bg-apricot-bg px-2 py-0.5 rounded-full tnum"
                          title={`Bezogene Ferientage ${kontoYear} (gemäss Konto)`}>
                          Bezogen {kontoYear}: {g.bestand ? g.bestand.bezogen : '–'}
                        </span>
                        <span className="text-[11px] font-semibold text-mint-ink bg-mint-bg px-2 py-0.5 rounded-full tnum"
                          title={`Bleibende Ferientage (Stand Konto ${kontoYear})`}>
                          Bleibend: {g.bestand && g.bestand.rest != null ? `${g.bestand.rest} Tage` : '–'}
                        </span>
                        <span className="text-[11px] font-semibold text-steel-ink bg-steel-bg px-2 py-0.5 rounded-full tnum"
                          title={`Bereits geplante (akzeptierte) Ferientage ${PLAN_YEAR}`}>
                          Geplant {PLAN_YEAR}: {g.plan27}
                        </span>
                        <span className="text-[11px] font-semibold text-lilac-ink bg-lilac-bg px-2 py-0.5 rounded-full tnum"
                          title={g.anspruch.angepasst ? 'Anspruch durch Admin angepasst (Planungsstand)' : (g.anspruch.hinweis ?? `Ferienanspruch ${PLAN_YEAR} gemäss Praxisregel (Wochen × 5 × Pensum)`)}>
                          Anspruch {PLAN_YEAR}: {g.anspruchTage != null ? `${g.anspruchTage} Tage` : 'offen'}{g.anspruch.angepasst ? ' · angepasst' : ''}
                        </span>
                      </div>
                    </div>
                    {g.ranges.length === 0 ? (
                      <p className="text-xs text-ink-4">Keine Ferien im gewählten Bereich eingetragen.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {g.ranges.map((r, i) => (
                          <span key={i} className="group inline-flex items-center gap-1.5 text-xs bg-surface border border-edge-ctl rounded-lg px-2.5 py-1 tnum">
                            <span className="text-[10px] font-semibold text-ink-3">{kwBereich(r.from, r.to)}</span>
                            {r.from === r.to ? fmtD(r.from) : `${fmtD(r.from)} – ${fmtD(r.to)}`}
                            <span className="text-ink-4">
                              ({r.days} {r.days === 1 ? 'Tag' : 'Tage'}{r.counted !== r.days ? `, angerechnet ${r.counted}` : ''})
                            </span>
                            {vertretungFuer(g.id, r.from, r.to).length > 0 && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-mint-bg text-mint-ink whitespace-nowrap">
                                Vertretung: {vertretungChip(g.id, r.from, r.to)}
                              </span>
                            )}
                            <button onClick={() => openEditRange(g.id, g.name, r)} disabled={isPending}
                              className="text-ink-5 hover:text-ink-2 transition-colors" title={istZazId(g.id) ? 'Daten und Ferienvertretung bearbeiten' : 'Daten bearbeiten'}>
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                              </svg>
                            </button>
                            <button onClick={() => handleRemoveRange(g.id, r.from, r.to)} disabled={isPending}
                              className="text-ink-5 hover:text-red-500 transition-colors" title="Entfernen">✕</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="px-6 py-3 border-t border-edge-soft bg-surface flex-shrink-0">
              <button onClick={() => setZeigeAlle(false)} className="btn-secondary w-full">Schliessen</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Wunsch einer ZAZ akzeptieren (mit Ferienvertretung) ─────────── */}
      {acceptModal && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">Wunsch akzeptieren</h3>
                <p className="text-xs text-ink-4 mt-0.5">
                  {nameById[acceptModal.w.employeeId] ?? '—'} · {kwBereich(acceptModal.w.from, acceptModal.w.to)} · {fmtD(acceptModal.w.from)} – {fmtD(acceptModal.w.to)} · {wunschArtLabel(acceptModal.w.art)}.
                  Die Tage werden im Arbeitsplan als «{wunschArtCode(acceptModal.w.art)}» eingetragen.
                </p>
              </div>
              <button onClick={() => setAcceptModal(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4 flex-shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-2">
              <p className="field-label">Ferienvertretung <span className="normal-case font-normal">(optional)</span></p>
              <VertretungFeld value={acceptModal.vertretung} from={acceptModal.w.from} to={acceptModal.w.to}
                onChange={v => setAcceptModal(m => m ? { ...m, vertretung: v } : m)}
                kandidaten={kandidaten} ausser={nameById[acceptModal.w.employeeId]} />
              <p className="text-[11px] text-ink-4">
                Wer die Praxis während dieser Abwesenheit zahnärztlich vertritt. Erscheint in der Info-Karte des
                Ferienkalenders und in den Listen — nur für Admins und die Ferienplanung sichtbar, nicht für das Team.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={() => setAcceptModal(null)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={confirmAccept} disabled={isPending} className="btn-primary flex-1">
                {isPending ? 'Wird gespeichert…' : 'Akzeptieren'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Ferienperiode bearbeiten ───────────────────────────────────── */}
      {editRange && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">Ferienperiode bearbeiten</h3>
                <p className="text-xs text-ink-4 mt-0.5">
                  {editRange.name} — bisher {kwBereich(editRange.oldFrom, editRange.oldTo)} · {fmtD(editRange.oldFrom)} – {fmtD(editRange.oldTo)}.
                  Die Ferientage werden im Arbeitsplan neu eingetragen.
                </p>
              </div>
              <button onClick={() => setEditRange(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4 flex-shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="field-label">Von</p>
                  <input type="date" value={editRange.from}
                    onChange={e => setEditRange(m => m ? { ...m, from: e.target.value } : m)}
                    className="input-field w-full" />
                </div>
                <div>
                  <p className="field-label">Bis</p>
                  <input type="date" value={editRange.to}
                    onChange={e => setEditRange(m => m ? { ...m, to: e.target.value } : m)}
                    className="input-field w-full" />
                </div>
              </div>
              <div>
                <p className="field-label">Angerechnete Tage <span className="normal-case font-normal">(optional, z. B. 2.5 bei Teilzeit)</span></p>
                <input type="text" inputMode="decimal" placeholder="automatisch = Wochentage" value={editRange.angerechnet}
                  onChange={e => setEditRange(m => m ? { ...m, angerechnet: e.target.value } : m)}
                  className="input-field w-full" />
              </div>
              {istZazId(editRange.empId) && (
                <div>
                  <p className="field-label">Ferienvertretung <span className="normal-case font-normal">(optional)</span></p>
                  <VertretungFeld key={`${editRange.empId}|${editRange.oldFrom}`} value={editRange.vertretung} from={editRange.from} to={editRange.to}
                    onChange={v => setEditRange(m => m ? { ...m, vertretung: v } : m)}
                    kandidaten={kandidaten} ausser={editRange.name} />
                </div>
              )}
              {editRange.from && editRange.to && editRange.to >= editRange.from && (
                <p className="text-xs text-ink-3">{weekdaysBetween(editRange.from, editRange.to).length} Werktag(e) (Mo–Fr) · {kwBereich(editRange.from, editRange.to)}</p>
              )}
              {editRangeErr && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink">⚠ {editRangeErr}</p>}
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={() => setEditRange(null)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={saveEditRange} disabled={isPending} className="btn-primary flex-1">
                {isPending ? 'Wird gespeichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Wunsch modal (create / edit) ───────────────────────────────── */}
      {wunschModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">
                  {wunschModal.mode === 'create' ? 'Ferienwunsch erfassen' : 'Ferienwunsch bearbeiten'}
                </h3>
                <p className="text-xs text-ink-4 mt-0.5">
                  {wunschModal.mode === 'create'
                    ? `Eingang wird mit Datum und Uhrzeit festgehalten (first come, first served).`
                    : 'Auch akzeptierte Wünsche können angepasst oder verlängert werden — die Tage im Arbeitsplan werden entsprechend neu eingetragen.'}
                </p>
              </div>
              <button onClick={() => setWunschModal(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4 flex-shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <p className="field-label">Mitarbeiterin / Mitarbeiter</p>
                {wunschModal.mode === 'create' ? (
                  <select value={wunschModal.empId}
                    onChange={e => setWunschModal(m => m ? { ...m, empId: e.target.value } : m)}
                    className="input-field w-full">
                    <option value="">Wählen…</option>
                    {ordered.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                  </select>
                ) : (
                  <p className="text-sm font-semibold text-ink py-1.5">{nameById[wunschModal.empId] ?? '—'}</p>
                )}
              </div>
              <div>
                <p className="field-label">Art</p>
                <select value={wunschModal.art}
                  onChange={e => setWunschModal(m => m ? { ...m, art: e.target.value as WunschArt } : m)}
                  className="input-field w-full">
                  {WUNSCH_ARTEN.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
              </div>
              <div>
                <p className="field-label" title="Priorität 1 = genau dieses Datum ist sehr wichtig · Priorität 3 = flexibel verschiebbar">Priorität</p>
                <select value={wunschModal.prio}
                  onChange={e => setWunschModal(m => m ? { ...m, prio: parseInt(e.target.value, 10) as WunschPrio } : m)}
                  className="input-field w-full">
                  {PRIO_OPTIONEN.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="field-label">Von</p>
                  <input type="date" value={wunschModal.from}
                    min={`${PLAN_YEAR}-01-01`} max={`${PLAN_YEAR}-12-31`}
                    onChange={e => setWunschModal(m => m ? { ...m, from: e.target.value } : m)}
                    className="input-field w-full" />
                </div>
                <div>
                  <p className="field-label">Bis</p>
                  <input type="date" value={wunschModal.to}
                    min={`${PLAN_YEAR}-01-01`} max={`${PLAN_YEAR}-12-31`}
                    onChange={e => setWunschModal(m => m ? { ...m, to: e.target.value } : m)}
                    className="input-field w-full" />
                </div>
              </div>
              <div>
                <p className="field-label">Bemerkung <span className="normal-case font-normal">(wofür die Tage gebraucht werden)</span></p>
                <textarea value={wunschModal.bemerkung} rows={2} maxLength={500}
                  onChange={e => setWunschModal(m => m ? { ...m, bemerkung: e.target.value } : m)}
                  className="input-field w-full" />
              </div>
              {wunschModal.from && wunschModal.to && wunschModal.to >= wunschModal.from && (
                <p className="text-xs text-ink-3">{weekdaysBetween(wunschModal.from, wunschModal.to).length} Werktag(e) (Mo–Fr) · {kwBereich(wunschModal.from, wunschModal.to)}</p>
              )}
              {istZazId(wunschModal.empId) && (
                <div>
                  <p className="field-label">Ferienvertretung <span className="normal-case font-normal">(optional{wunschModal.mode === 'create' ? ' — kann auch erst beim Akzeptieren gesetzt werden' : ''})</span></p>
                  <VertretungFeld key={`${wunschModal.empId}|${wunschModal.origFrom}`} value={wunschModal.vertretung} from={wunschModal.from} to={wunschModal.to}
                    onChange={v => setWunschModal(m => m ? { ...m, vertretung: v } : m)}
                    kandidaten={kandidaten} ausser={nameById[wunschModal.empId]} />
                </div>
              )}
              {modalErr && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink">⚠ {modalErr}</p>}
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={() => setWunschModal(null)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={saveWunschModal} disabled={isPending} className="btn-primary flex-1">
                {isPending ? 'Wird gespeichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Phasen modal ───────────────────────────────────────────────── */}
      {phasenModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">Planungsphasen {PLAN_YEAR}</h3>
                <p className="text-xs text-ink-4 mt-0.5">
                  Pro Gruppe: Frist (bis wann eingeben) und optional ein Startdatum — ist eines
                  gesetzt, öffnet die Eingabe exakt an diesem Tag; ohne Startdatum öffnet sie
                  am Tag nach der letzten früheren Frist. Geöffnet wird jeweils um {PHASE_OPEN_TIME} Uhr,
                  geschlossen am Fristtag um {PHASE_CLOSE_TIME} Uhr.
                </p>
              </div>
              <button onClick={() => setPhasenModal(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4 flex-shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {PHASE_DEFS.map((p, i) => (
                <div key={p.key}>
                  <p className="field-label">{i + 1}. {p.label}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-ink-4 mb-1">Start (optional)</p>
                      <input type="date" value={phasenModal[PHASE_START_KEY[p.key]] ?? ''}
                        onChange={e => setPhasenModal(m => m ? { ...m, [PHASE_START_KEY[p.key]]: e.target.value || null } : m)}
                        className="input-field w-full" />
                    </div>
                    <div>
                      <p className="text-[10px] text-ink-4 mb-1">Frist (Eingabe bis)</p>
                      <input type="date" value={phasenModal[p.key] ?? ''}
                        onChange={e => setPhasenModal(m => m ? { ...m, [p.key]: e.target.value || null } : m)}
                        className="input-field w-full" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={() => setPhasenModal(null)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={savePhasenModal} disabled={isPending} className="btn-primary flex-1">
                {isPending ? 'Wird gespeichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
