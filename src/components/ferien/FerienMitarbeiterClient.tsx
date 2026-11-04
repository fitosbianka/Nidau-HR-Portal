'use client'

// Mitarbeiterseite der Ferienplanung 2027: Statuszeile, Ferienkonto,
// Kalender mit den akzeptierten Ferien des Teams und den Wochenfarben,
// Wochenliste zum Anmelden (first come first served, auch als Doppelwoche),
// Samstage und Notfalldienste, Ferienwunsch für einzelne Tage. Der Browser
// erhält nur Zahlen und die eigenen Daten, keine Anmeldungen anderer.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import FerienKalender from '@/components/ferien/FerienKalender'
import FerienHinweisPopup from '@/components/ferien/FerienHinweisPopup'
import DiensteMitarbeiter from '@/components/ferien/DiensteMitarbeiter'
import { createOwnWunsch } from '@/actions/ferien-wuensche'
import { wochenAnmelden, wocheZurueckziehen } from '@/actions/ferien-wochen'
import { PLAN_YEAR, PRIO_OPTIONEN, weekdaysBetween, type FerienWunsch, type WunschPrio } from '@/lib/ferien-wuensche'
import { FARBEN, KATEGORIE_LABEL, wocheText, kurzDatum, type Kategorie, type WochenFarbe } from '@/lib/ferien-wochen'
import { grundIstVoll } from '@/lib/ferien-kapazitaet'
import type { WocheZahlen } from '@/lib/ferien-wochen-data'
import type { SamstagZahlen, SamstagRolle } from '@/lib/samstage'
import type { NdZahlen, NdRolle } from '@/lib/notfalldienste'
import { kwBereich } from '@/lib/ferien'
import { istFeiertag } from '@/lib/feiertage'

type Emp = { id: string; full_name: string; job_title: string | null; schedule_order: number | null; pensum?: number | null }
type Vac = { employee_id: string; schedule_date: string; entry: string }
export type MeinKonto = {
  anspruch: number | null
  wochen: number | null
  hinweis?: string
  angepasst: boolean
  akzeptiert: number
  angemeldet: number
  nochZuPlanen: number | null
  herleitung: string
  gruen: { gruen: number; dunkelgruen: number; ok: boolean }
  /** Zwei Wochen am Stück geplant; null = gilt nicht für diese Person */
  zweiWochen: boolean | null
}

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const fmtD = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`
const fmtTs = (iso: string) => iso ? new Date(iso).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }) : ''
const pz = (n: number) => String(n).replace('.', ',')

/** Kurzer Grund für die Wochenliste, zum Beispiel «Freitag ohne DH / PA». */
function kurzGrund(g: string | null): string {
  if (!g) return ''
  let m = g.match(/^Am (\w+) wäre keine Zahnärztin/); if (m) return `${m[1]} ohne ZAZ`
  m = g.match(/^Am (\w+) wäre keine DH oder PA/); if (m) return `${m[1]} ohne DH / PA`
  m = g.match(/^Am (\w+) ist für .+? kein Platz/); if (m) return `${m[1]} voll`
  m = g.match(/^Am (\w+) können Valérie/); if (m) return `${m[1]} nicht gleichzeitig mit Valérie oder Fränzi`
  if (g.startsWith('Für die Assistenz')) return 'Assistenz reicht nicht'
  if (g.startsWith('Von den Leitenden')) return 'Leitende DA schon weg'
  m = g.match(/^Rote Woche, am (\w+) ist keine Zahnärztin/); if (m) return `${m[1]} keine ZAZ in den Ferien`
  if (g.startsWith('Rote Woche')) return 'Rote Woche'
  return g
}
const istVoll = (g: string | null) => grundIstVoll(g)

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const isoWd = (d: string) => (new Date(`${d}T12:00:00`).getDay() + 6) % 7 + 1
/** «02.10. Mo» für die Tagesknöpfe */
const tagKnopf = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}. ${WD[isoWd(d) - 1]}`
/** «Mo 02.10.» für Listen */
const tagKurz = (d: string) => `${WD[isoWd(d) - 1]} ${d.slice(8, 10)}.${d.slice(5, 7)}.`

export default function FerienMitarbeiterClient({ employees, vacations, wochen, wochenFarben, myId, kategorie, pensum, arbeitstage, statusText, eingabeAktiv, konto, eigene, samstage, notfalldienste, samstagRolle, ndRolle, heute, extern = false, hinweisZeigen = false }: {
  employees: Emp[]
  vacations: Vac[]
  wochen: WocheZahlen[]
  wochenFarben: Record<string, WochenFarbe>
  myId: string
  kategorie: Kategorie | null
  pensum: number | null
  /** ISO Wochentage 1 bis 5, an denen ich laut Standardwoche arbeite (Vorauswahl der Tage bei Teilzeit) */
  arbeitstage: number[]
  statusText: string
  eingabeAktiv: boolean
  konto: MeinKonto
  /** Externe (selbständig): kein Ferienkonto, keine Anmeldung, nur der Kalender */
  extern?: boolean
  /** Erklärfenster «So funktioniert die Ferienplanung» (Assistenz, Eingabe offen, nicht abgestellt) */
  hinweisZeigen?: boolean
  /** Nur die eigenen Wünsche und Wochenanmeldungen (auch abgelehnte) */
  eigene: FerienWunsch[]
  samstage: SamstagZahlen[]
  notfalldienste: NdZahlen[]
  samstagRolle: SamstagRolle | null
  ndRolle: NdRolle | null
  heute: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [filter, setFilter] = useState<'alle' | 'gruen' | 'frei' | 'empfohlen'>('alle')
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [bestaetigen, setBestaetigen] = useState<WocheZahlen[] | null>(null)
  /** Gewählte Ferientage pro Woche (Montag → Tage), nur bei Teilzeit */
  const [auswahl, setAuswahl] = useState<Record<string, string[]>>({})
  const teilzeit = pensum != null && pensum > 0 && pensum < 100
  const wochenTageVon = (w: WocheZahlen) => weekdaysBetween(w.montag, w.freitag).filter(d => !istFeiertag(d))
  const tagFrei = (w: WocheZahlen, d: string) => w.tageStatus.find(t => t.datum === d)?.moeglich ?? false
  const tagGrund = (w: WocheZahlen, d: string) => w.tageStatus.find(t => t.datum === d)?.grund ?? null
  /** Vorauswahl: bei 100 Prozent alle freien Tage; bei Teilzeit die freien
   *  Tage der eigenen Standardwoche, wenn sie eine echte Teilmenge sind,
   *  sonst muss gewählt werden. */
  const vorauswahl = (w: WocheZahlen) => {
    const alle = wochenTageVon(w)
    const frei = alle.filter(d => tagFrei(w, d))
    if (!teilzeit) return frei
    const std = alle.filter(d => arbeitstage.includes(isoWd(d)))
    return std.length > 0 && std.length < alle.length ? std.filter(d => tagFrei(w, d)) : []
  }
  function oeffnen(liste: WocheZahlen[]) {
    setAuswahl(Object.fromEntries(liste.map(w => [w.montag, vorauswahl(w)])))
    setBestaetigen(liste)
  }
  const tagToggle = (montag: string, d: string) => setAuswahl(a => { const l = a[montag] ?? []; return { ...a, [montag]: l.includes(d) ? l.filter(x => x !== d) : [...l, d].sort() } })
  const kostenAuswahl = (liste: WocheZahlen[]) => liste.reduce((s, w) => s + (auswahl[w.montag]?.length ?? 0), 0)
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [prio, setPrio] = useState<WunschPrio>(3)
  const [bemerkung, setBemerkung] = useState('')
  const [wunschMsg, setWunschMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  /** Woche, für die ein Wunsch vorbereitet wurde (weil sie für die Kategorie voll ist) */
  const [wunschWoche, setWunschWoche] = useState<WocheZahlen | null>(null)
  /** Letzte abgelehnte Anmeldung wegen voller Woche: Knopf zum Wunsch */
  const [vollWoche, setVollWoche] = useState<WocheZahlen | null>(null)
  const wunschRef = useRef<HTMLDivElement | null>(null)
  /** Wunsch für eine volle Woche vorbereiten: Zeitraum setzen und zum Formular springen */
  function wunschFuer(w: WocheZahlen) {
    setFrom(w.montag); setTo(w.freitag); setWunschWoche(w); setWunschMsg(null); setVollWoche(null)
    setTimeout(() => wunschRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  // Still aktualisieren: alle 30 Sekunden und beim Zurückkehren, nicht während ein Dialog offen ist
  const dialogRef = useRef(false)
  dialogRef.current = !!bestaetigen
  useEffect(() => {
    const still = () => { if (document.visibilityState === 'visible' && !dialogRef.current) router.refresh() }
    const onVis = () => { if (document.visibilityState === 'visible') still() }
    document.addEventListener('visibilitychange', onVis)
    const iv = setInterval(still, 30_000)
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(iv) }
  }, [router])

  function run(fn: () => Promise<{ error?: string } | { success: true }>, ok?: string) {
    setMsg(null)
    startTransition(async () => {
      let r: { error?: string } | { success: true }
      try { r = await fn() } catch { r = { error: 'Netzwerkfehler. Bitte erneut versuchen.' } }
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      if (ok) setMsg({ type: 'ok', text: ok })
      router.refresh()
    })
  }

  const meineKat = kategorie
  const anmeldbar = (w: WocheZahlen) => !!meineKat && w.moeglich && (!w.mein || w.mein.status === 'abgelehnt')
  const naechste = (w: WocheZahlen) => wochen.find(x => x.kw === w.kw + 1)
  const doppelMoeglich = (w: WocheZahlen) => { const n = naechste(w); return !!n && anmeldbar(w) && anmeldbar(n) }
  const sichtbar = useMemo(() => wochen.filter(w => filter === 'alle' || (filter === 'gruen' ? (w.farbe === 'dunkelgruen' || w.farbe === 'hellgruen') : filter === 'empfohlen' ? (w.empfohlen.ja && anmeldbar(w)) : anmeldbar(w))), [wochen, filter, meineKat])  // eslint-disable-line react-hooks/exhaustive-deps
  const monate = useMemo(() => {
    const m = new Map<number, WocheZahlen[]>()
    for (const w of sichtbar) { const mo = parseInt(w.montag.slice(5, 7), 10) - 1; m.set(mo, [...(m.get(mo) ?? []), w]) }
    return Array.from(m.entries())
  }, [sichtbar])

  function anmelden(liste: WocheZahlen[]) {
    if (liste.some(w => (auswahl[w.montag]?.length ?? 0) === 0)) { setMsg({ type: 'err', text: 'Bitte wähle in jeder Woche mindestens einen Tag.' }); return }
    const tage = Object.fromEntries(liste.map(w => [w.montag, auswahl[w.montag] ?? []]))
    setBestaetigen(null)
    const text = liste.length === 2 ? `KW ${liste[0].kw} und ${liste[1].kw} angemeldet.` : `KW ${liste[0].kw} angemeldet.`
    setMsg(null); setVollWoche(null)
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof wochenAnmelden>>
      try { r = await wochenAnmelden(liste.map(w => w.montag), tage) } catch { r = { error: 'Netzwerkfehler. Bitte erneut versuchen.' } }
      if ('error' in r && r.error) {
        setMsg({ type: 'err', text: r.error })
        // Volle Woche: direkt den Wunsch anbieten
        if ('voll' in r && r.voll) setVollWoche(liste[0])
        router.refresh()
        return
      }
      setMsg({ type: 'ok', text: `${text} Dein Platz ist reserviert, die Praxisleitung bestätigt die Anmeldung.` })
      router.refresh()
    })
  }
  function zurueckziehen(from: string, text: string) {
    if (!confirm(`${text} zurückziehen?`)) return
    run(() => wocheZurueckziehen(from), 'Zurückgezogen.')
  }

  function submitWunsch() {
    if (!from || !to) { setWunschMsg({ type: 'err', text: 'Bitte Von und Bis wählen.' }); return }
    setWunschMsg(null)
    startTransition(async () => {
      let r: { error?: string } | undefined
      try { r = await createOwnWunsch(from, to, prio, bemerkung) } catch { r = { error: 'Netzwerkfehler. Bitte erneut versuchen.' } }
      if (r?.error) setWunschMsg({ type: 'err', text: r.error })
      else { setWunschMsg({ type: 'ok', text: 'Wunsch erfasst. Die Praxisleitung sieht ihn in der Planung.' }); setFrom(''); setTo(''); setPrio(3); setBemerkung(''); setWunschWoche(null); router.refresh() }
    })
  }

  const eigeneSortiert = useMemo(() => [...eigene].sort((a, b) => a.from.localeCompare(b.from)), [eigene])
  const gruppenGroesse = useMemo(() => { const m = new Map<string, number>(); for (const w of eigene) if (w.gruppe) m.set(w.gruppe, (m.get(w.gruppe) ?? 0) + 1); return m }, [eigene])
  const typVon = (w: FerienWunsch) => {
    const n = w.gruppe ? (gruppenGroesse.get(w.gruppe) ?? 0) : 0
    if (w.quelle === 'woche') return n > 1 ? 'Doppelwoche' : 'Woche'
    if (n > 1) { const teile = eigene.filter(x => x.gruppe === w.gruppe).sort((a, b) => a.from.localeCompare(b.from)); return `Wunsch, Teil ${teile.findIndex(x => x.from === w.from) + 1} von ${n}` }
    return 'Wunsch'
  }
  const anteil = (n: number) => (konto.anspruch ? Math.min(100, Math.round((n / konto.anspruch) * 100)) : 0)
  const regelcheck = `Grüne Wochen ${konto.gruen.gruen} von 2, davon dunkelgrün ${konto.gruen.dunkelgruen} von 1${konto.zweiWochen === null ? '' : konto.zweiWochen ? ', zwei Wochen am Stück geplant' : ', zwei Wochen am Stück noch offen'}`
  const regelOk = konto.gruen.ok && konto.zweiWochen !== false

  if (extern) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="page-title">Ferienplanung {PLAN_YEAR}</h1>
          <p className="mt-1.5 text-[12.5px] text-ink-3">Der Kalender zeigt, wann das Team abwesend ist.</p>
        </div>
        <FerienKalender employees={employees} vacations={vacations} wishes={[]} planYear={PLAN_YEAR} showTotals={false} canEditDays={false} wochenFarben={wochenFarben} farbLegende />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {hinweisZeigen && <FerienHinweisPopup planYear={PLAN_YEAR} />}
      <div>
        <h1 className="page-title">Ferienplanung {PLAN_YEAR}</h1>
        <p className={`mt-1.5 inline-block text-[12.5px] px-3 py-1.5 rounded-ctl ${eingabeAktiv ? 'bg-mint-bg text-mint-ink' : 'bg-lilac-soft text-lilac-ink'}`}>{statusText}</p>
      </div>

      {msg && (
        <p className={`text-xs px-3 py-2 rounded-ctl inline-block ${msg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>
          {msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}
          {vollWoche && <button onClick={() => wunschFuer(vollWoche)} className="ml-2 font-semibold underline">Wunsch für KW {vollWoche.kw} eingeben</button>}
        </p>
      )}

      {/* Ferienkonto zuoberst */}
      <div className="card p-5 space-y-4">
        <div>
          <p className="text-sm font-semibold text-ink">Mein Ferienkonto {PLAN_YEAR}</p>
          <p className="text-[11px] text-ink-4 mt-0.5">{konto.herleitung}</p>
        </div>
        {konto.anspruch == null ? (
          <div className="grid grid-cols-2 gap-2">
            <Kachel label="Akzeptiert" wert={konto.akzeptiert} cls="bg-steel-bg text-steel-ink" />
            <Kachel label="Angemeldet" wert={konto.angemeldet} cls="bg-apricot-bg text-apricot-ink" sub="wartet" />
            <p className="col-span-2 text-[11.5px] text-ink-3">{konto.hinweis ?? 'Für dich gilt kein festes Kontingent.'} Angezeigt werden die geplanten Tage.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Kachel label="Anspruch" wert={konto.anspruch} cls="bg-mint-bg text-mint-ink" sub="Tage" />
              <Kachel label="Akzeptiert" wert={konto.akzeptiert} cls="bg-steel-bg text-steel-ink" sub="Tage" />
              <Kachel label="Angemeldet" wert={konto.angemeldet} cls="bg-apricot-bg text-apricot-ink" sub="wartet" />
              <Kachel label="Noch zu planen" wert={konto.nochZuPlanen ?? 0} cls="bg-lilac-bg text-lilac-ink" sub={konto.nochZuPlanen === 0 ? 'alles verplant' : 'Tage'} />
            </div>
            <div className="h-3 rounded-full bg-edge-row overflow-hidden flex" title={`${pz(konto.akzeptiert)} akzeptiert, ${pz(konto.angemeldet)} angemeldet, ${pz(konto.nochZuPlanen ?? 0)} offen`}>
              <div className="h-full bg-steel-ink" style={{ width: `${anteil(konto.akzeptiert)}%` }} />
              <div className="h-full" style={{ width: `${anteil(konto.angemeldet)}%`, background: 'repeating-linear-gradient(135deg, #B08350 0px, #B08350 3px, #F7EAD9 3px, #F7EAD9 6px)' }} />
            </div>
          </>
        )}
        <p className={`text-[11.5px] ${regelOk ? 'text-mint-ink' : 'text-ink-3'}`}>{regelcheck}{regelOk ? ' ✓' : ''}</p>
        {konto.zweiWochen === false && <p className="text-[11.5px] px-3 py-2 rounded-ctl inline-block bg-apricot-bg text-apricot-ink">Du hast noch keine zwei Wochen am Stück geplant. Nach Gesetz müssen jedes Jahr mindestens zwei Ferienwochen zusammenhängen. Mit «Zwei Wochen anmelden» geht das in einem Schritt.</p>}
        <div className="pt-3 border-t border-edge-soft">
          <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4 mb-2">Meine Anmeldungen und Wünsche</p>
          {eigeneSortiert.length === 0 ? <p className="text-[12px] text-ink-4">Noch nichts angemeldet.</p> : (
            <ul className="space-y-1.5">
              {eigeneSortiert.map(w => (
                <li key={w.from} className="text-[12px] rounded-lg border border-edge-soft bg-surface px-2.5 py-1.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[10px] font-semibold text-ink-3 tnum">{kwBereich(w.from, w.to)}</span>
                    <span className="tnum text-ink">{fmtD(w.from)} bis {fmtD(w.to)}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-edge-row text-ink-3">{typVon(w)}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${w.status === 'akzeptiert' ? 'bg-mint-bg text-mint-ink' : w.status === 'abgelehnt' ? 'bg-blush-bg text-blush-ink' : 'bg-apricot-bg text-apricot-ink'}`}>
                      {w.status === 'akzeptiert' ? 'Akzeptiert' : w.status === 'abgelehnt' ? 'Abgelehnt' : 'Offen'}
                    </span>
                    {w.status === 'offen' && <button onClick={() => zurueckziehen(w.from, `${w.quelle === 'woche' ? `KW ${w.kw}` : 'Wunsch'} ${fmtD(w.from)} bis ${fmtD(w.to)}`)} disabled={isPending} className="ml-auto text-ink-5 hover:text-red-500" title="Zurückziehen">✕</button>}
                  </div>
                  <p className="text-[10.5px] text-ink-4 tnum mt-0.5">Angemeldet {fmtTs(w.createdAt)}{w.tage && w.tage.length > 0 && w.tage.length < weekdaysBetween(w.from, w.to).length ? ` · ${w.tage.map(tagKurz).join(', ')}` : ''}{w.bemerkung ? ` · ${w.bemerkung}` : ''}{w.status === 'abgelehnt' && w.grund ? ` · Grund ${w.grund}` : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <FerienKalender employees={employees} vacations={vacations} wishes={[]} planYear={PLAN_YEAR} showTotals={false} canEditDays={false} wochenFarben={wochenFarben} farbLegende />

      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-edge-soft">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-ink">Wochen {PLAN_YEAR}</p>
              <p className="text-[11.5px] text-ink-4 mt-0.5">
                {meineKat ? `Du meldest dich für ganze Wochen an, deine Kategorie ist ${KATEGORIE_LABEL[meineKat]}. Wer zuerst kommt, hat den Platz. Pro Woche siehst du, wie viele Plätze jede Kategorie hat und wie viele schon belegt sind. Ist deine Kategorie voll, geht nur noch ein Ferienwunsch.` : 'Für deine Kategorie gibt es keine Wochenanmeldung. Ferienwünsche gibst du unten ein.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {([['alle', 'Alle'], ['gruen', 'Nur grüne Wochen'], ['frei', 'Nur Wochen mit Platz für mich'], ...(meineKat === 'ASSISTENZ' ? [['empfohlen', 'Ferien erwünscht']] : [])] as Array<[typeof filter, string]>).map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${filter === k ? 'bg-dusk text-white border-dusk' : 'bg-white text-ink-2 border-edge-ctl'}`}>{l}</button>
              ))}
            </div>
          </div>
        </div>
        {monate.length === 0 && <p className="px-5 py-8 text-sm text-ink-4 text-center">Keine Wochen mit diesem Filter.</p>}
        {monate.map(([mo, liste]) => (
          <div key={mo}>
            <p className="px-5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4">{MONATE[mo]}</p>
            <ul className="divide-y divide-edge-row">
              {liste.map(w => {
                const f = FARBEN[w.farbe]
                const frei = anmeldbar(w)
                const z = w.zaehler
                const reicht = meineKat === 'ASSISTENZ' && w.farbe !== 'rot' && (!w.mein || w.mein.status === 'abgelehnt') ? (w.moeglich || !w.nichtMoeglich?.startsWith('Für die Assistenz')) : null
                return (
                  <li key={w.montag} className="px-5 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-l-4" style={{ borderLeftColor: f.fg, background: `${f.bg}66` }}>
                    <div className="flex items-start gap-2.5 min-w-[160px]">
                      <span className="mt-1 w-3 h-3 rounded-full flex-shrink-0 border" style={{ background: f.bg, borderColor: f.fg }} title={`${f.label}, ${f.titel}`} />
                      <div>
                        <p className="text-[13px] font-semibold text-ink tnum">KW {w.kw} <span className="font-normal text-ink-2">{kurzDatum(w.montag)} bis {kurzDatum(w.freitag)}</span></p>
                        <p className="text-[10.5px] text-ink-4 leading-snug">{w.grund}{w.feiertage > 0 ? ` · ${w.feiertage} Feiertag` : ''}{w.oeffnung ? ` · für die Assistenz offen ${w.oeffnung.tage.length === w.arbeitstage ? 'die ganze Woche' : `am ${w.oeffnung.tage.map(d => WD[isoWd(d) - 1]).join(', ')}`}, weil eine ZAZ in den Ferien ist` : ''}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap items-center text-[11.5px] tnum">
                      {(['ZAZ', 'DHPA', 'ASSISTENZ'] as const).map(k => {
                        const p = z[k]
                        const meine = meineKat === k
                        // Rote Woche, für die Assistenz geöffnet (eine ZAZ fehlt fest): Plätze pro Tag statt «gesperrt»
                        const rotOffen = k === 'ASSISTENZ' && w.farbe === 'rot' && !!w.oeffnung
                        const gesperrt = w.farbe === 'rot' && !rotOffen
                        const voll = !gesperrt && p.frei === 0
                        return (
                          <div key={k} className={`px-2 py-1 rounded-lg ${meine ? 'bg-surface border border-edge-ctl' : ''}`}
                            title={rotOffen ? 'Rote Woche, für die Assistenz geöffnet: an Tagen, an denen eine Zahnärztin fest in den Ferien ist, darf pro fehlende Zahnärztin eine Person der Assistenz frei nehmen' : k === 'ASSISTENZ' ? 'Assistenz: Personen mit Anmeldung in dieser Woche und geschätzte weitere Plätze nach Bedarf und Angebot in Tagen, alle Anmeldungen gerechnet' : `${KATEGORIE_LABEL[k]}: Plätze der Farbe pro Tag und die höchste Zahl Abwesender an einem Tag, offene und akzeptierte Anmeldungen (wer zuerst kommt, hat den Platz)`}>
                            <p className={meine ? 'font-bold text-ink' : 'text-ink-2'}>
                              {KATEGORIE_LABEL[k]} {gesperrt ? 'gesperrt' : rotOffen ? `${p.belegt} belegt, noch ${p.frei} frei (ZAZ in den Ferien)` : k === 'ASSISTENZ' ? `${p.belegt} belegt, noch etwa ${p.frei} frei` : `${p.belegt} von ${p.plaetze} ${p.plaetze === 1 ? 'Platz' : 'Plätzen'} belegt`}
                            </p>
                            {meine && !gesperrt && (!w.mein || w.mein.status === 'abgelehnt') && (
                              k === 'ASSISTENZ' && reicht !== null
                                ? <p className={`text-[10px] font-semibold ${reicht ? 'text-mint-ink' : 'text-blush-ink'}`}>{reicht ? 'reicht für dich' : 'reicht für dich nicht'}</p>
                                : <p className={`text-[10px] font-semibold ${voll ? 'text-blush-ink' : 'text-mint-ink'}`}>{voll ? 'für dich voll' : `noch ${p.frei} frei für dich`}</p>
                            )}
                          </div>
                        )
                      })}
                      {w.empfohlen.ja && (!w.mein || w.mein.status === 'abgelehnt') && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-steel-bg text-steel-ink" title={w.empfohlen.grund ?? undefined}>Ferien erwünscht{w.empfohlen.grund ? ` · ${w.empfohlen.grund}` : ''}</span>
                      )}
                    </div>
                    <div className="ml-auto flex items-center gap-2 text-right">
                      {w.mein?.status === 'akzeptiert' || w.mein?.status === 'eingetragen' ? (
                        <span className="text-[10.5px] font-bold px-2 py-1 rounded-full bg-mint-bg text-mint-ink">✓ Akzeptiert</span>
                      ) : w.mein?.status === 'offen' ? (
                        <>
                          <span className="text-[10.5px] font-bold px-2 py-1 rounded-full bg-apricot-bg text-apricot-ink">Angemeldet, wartet auf Freigabe{w.mein.gruppe ? ' (Doppelwoche)' : ''}</span>
                          <button onClick={() => zurueckziehen(w.mein!.from, `Anmeldung KW ${w.kw}`)} disabled={isPending} className="text-[11px] text-ink-4 hover:text-red-500">Zurückziehen</button>
                        </>
                      ) : w.mein?.status === 'abgelehnt' ? (
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-[10.5px] font-bold px-2 py-1 rounded-full bg-blush-bg text-blush-ink" title={w.mein.grund ?? undefined}>Abgelehnt{w.mein.grund ? ` · ${w.mein.grund}` : ''}</span>
                          {frei && eingabeAktiv && <button onClick={() => oeffnen([w])} disabled={isPending} className="btn-secondary !px-3 !py-1 !text-xs">Nochmals anmelden</button>}
                        </div>
                      ) : w.farbe === 'rot' && !(meineKat === 'ASSISTENZ' && w.oeffnung) ? (
                        <span className="text-[10.5px] font-bold px-2 py-1 rounded-full bg-blush-bg text-blush-ink">Gesperrt</span>
                      ) : !meineKat ? null : !frei ? (
                        <div className="flex flex-col items-end gap-1">
                          <span className={`text-[10.5px] font-bold px-2 py-1 rounded-full ${istVoll(w.nichtMoeglich) ? 'bg-blush-bg text-blush-ink' : 'bg-edge-row text-ink-3'}`} title={w.nichtMoeglich ?? undefined}>{istVoll(w.nichtMoeglich) ? `Voll für ${KATEGORIE_LABEL[meineKat]}` : 'Nicht möglich'}</span>
                          <span className="text-[10px] text-ink-4 max-w-[180px] text-right leading-snug">{kurzGrund(w.nichtMoeglich)}</span>
                          {istVoll(w.nichtMoeglich) && eingabeAktiv && <button onClick={() => wunschFuer(w)} className="btn-secondary !px-2.5 !py-1 !text-[11px]" title="Die Woche ist für deine Kategorie voll. Ein Wunsch geht an die Praxisleitung, sie entscheidet">Wunsch für KW {w.kw}</button>}
                        </div>
                      ) : (
                        <>
                          <button onClick={() => oeffnen([w])} disabled={isPending || !eingabeAktiv} title={eingabeAktiv ? 'Diese Woche als Ferien anmelden, der Platz ist dann für dich reserviert' : statusText} className="btn-primary !px-3 !py-1.5 !text-xs disabled:opacity-50">Als Ferien anmelden</button>
                          {doppelMoeglich(w) && <button onClick={() => oeffnen([w, naechste(w)!])} disabled={isPending || !eingabeAktiv} title={eingabeAktiv ? `KW ${w.kw} und KW ${w.kw + 1} in einem Schritt` : statusText} className="btn-secondary !px-3 !py-1.5 !text-xs disabled:opacity-50">Zwei Wochen anmelden</button>}
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        <p className="px-5 py-3 text-[11px] text-ink-4 border-t border-edge-soft">Pro Woche siehst du für jede Kategorie die Plätze und wie viele davon belegt sind (offene und akzeptierte Anmeldungen, wer zuerst kommt, hat den Platz), aber keine Namen. Bei ZAZ und DH / PA gelten die Plätze der Farbe pro Tag, darum können zwei Personen in derselben Woche frei nehmen, wenn ihre Tage sich nicht überschneiden. Bei der Assistenz rechnet das Portal in Tagen nach Bedarf und Angebot, damit jeden Tag genug und nie zu viel Personal in der Praxis ist; sind Behandler abwesend, braucht es weniger Assistenz, dann werden Wochen als «Ferien erwünscht» markiert. Rote Wochen sind gesperrt. Ist aber eine Zahnärztin an einem Tag fest in den Ferien, ohne Vertretung, braucht es an diesem Tag eine Person der Assistenz weniger: dieser Tag ist dann für die Assistenz offen, pro fehlende Zahnärztin eine Person, und Ferien sind dort erwünscht. Ist eine Woche für deine Kategorie voll, kannst du sie nicht anmelden, sondern nur einen Ferienwunsch eingeben, über den die Praxisleitung entscheidet.</p>
      </div>

      <DiensteMitarbeiter samstage={samstage} notfalldienste={notfalldienste} samstagRolle={samstagRolle} ndRolle={ndRolle} heute={heute} />

      {/* Ferienwunsch für einzelne Tage */}
      <div className="card p-5" ref={wunschRef}>
        <p className="text-sm font-semibold text-ink mb-1">Ferienwunsch {PLAN_YEAR}</p>
        <p className="text-[11.5px] text-ink-4 mb-4">Für Wochen, die in deiner Kategorie schon voll sind, für einzelne Tage, andere Zeiträume und Ausnahmen. Schreib in die Bemerkung, wofür du die Tage brauchst. Ein Wunsch über mehrere Wochen wird pro Woche gespeichert, die Praxisleitung entscheidet jede Woche einzeln. Der Eingang wird mit Datum und Uhrzeit festgehalten, akzeptierte Wünsche erscheinen als F im Arbeitsplan.</p>
        {wunschWoche && (
          <p className="mb-3 text-[11.5px] px-3 py-2 rounded-ctl inline-flex items-center gap-2 bg-apricot-bg text-apricot-ink">
            KW {wunschWoche.kw} ({kurzDatum(wunschWoche.montag)} bis {kurzDatum(wunschWoche.freitag)}) ist für {meineKat ? KATEGORIE_LABEL[meineKat] : 'deine Kategorie'} schon voll. Der Wunsch geht an die Praxisleitung, sie entscheidet.
            <button onClick={() => { setWunschWoche(null); setFrom(''); setTo('') }} className="font-semibold underline">verwerfen</button>
          </p>
        )}
        {eingabeAktiv ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Von</label>
              <input type="date" value={from} min={`${PLAN_YEAR}-01-01`} max={`${PLAN_YEAR}-12-31`} onChange={e => setFrom(e.target.value)} className="input-field text-sm w-40" /></div>
            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Bis</label>
              <input type="date" value={to} min={`${PLAN_YEAR}-01-01`} max={`${PLAN_YEAR}-12-31`} onChange={e => setTo(e.target.value)} className="input-field text-sm w-40" /></div>
            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Priorität</label>
              <select value={prio} onChange={e => setPrio(parseInt(e.target.value, 10) as WunschPrio)} className="input-field text-sm w-64">{PRIO_OPTIONEN.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
            <div className="flex flex-col gap-1 basis-full max-w-xl"><label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Bemerkung <span className="normal-case font-normal">(wofür brauchst du diese Tage)</span></label>
              <textarea value={bemerkung} onChange={e => setBemerkung(e.target.value)} rows={2} maxLength={500} className="input-field text-sm" /></div>
            <button onClick={submitWunsch} disabled={isPending} className="btn-primary">{isPending ? 'Wird gesendet…' : 'Wunsch einreichen'}</button>
            {from && to && to >= from && <p className="text-xs text-ink-3 pb-2.5">{weekdaysBetween(from, to).length} Werktag(e)</p>}
          </div>
        ) : (
          <p className="text-[12.5px] px-3.5 py-2.5 rounded-ctl inline-block bg-lilac-soft text-lilac-ink">{statusText}</p>
        )}
        {wunschMsg && <p className={`mt-3 text-xs px-3 py-2 rounded-ctl inline-block ${wunschMsg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>{wunschMsg.type === 'ok' ? '✓ ' : '⚠ '}{wunschMsg.text}</p>}
        {eigeneSortiert.some(w => w.quelle !== 'woche') && (
          <div className="mt-4 pt-3 border-t border-edge-soft">
            <p className="eyebrow mb-2">Meine Wünsche</p>
            <div className="flex flex-wrap gap-2">
              {eigeneSortiert.filter(w => w.quelle !== 'woche').map(w => (
                <span key={w.from} className="inline-flex items-center gap-2 text-xs bg-surface border border-edge-ctl rounded-lg px-2.5 py-1.5 tnum" title={w.bemerkung ?? undefined}>
                  <span className="text-[10px] font-semibold text-ink-3">{kwBereich(w.from, w.to)}</span>{fmtD(w.from)} bis {fmtD(w.to)}
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${w.status === 'akzeptiert' ? 'bg-mint-bg text-mint-ink' : w.status === 'abgelehnt' ? 'bg-blush-bg text-blush-ink' : 'bg-apricot-bg text-apricot-ink'}`}>{w.status === 'akzeptiert' ? 'Akzeptiert' : w.status === 'abgelehnt' ? 'Abgelehnt' : 'Offen'}</span>
                  {w.status === 'offen' && <button onClick={() => zurueckziehen(w.from, `Wunsch ${fmtD(w.from)} bis ${fmtD(w.to)}`)} disabled={isPending} className="text-ink-5 hover:text-red-500">✕</button>}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {bestaetigen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setBestaetigen(null)} />
          <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl p-5 space-y-3">
            {bestaetigen.map(b => {
              const tage = wochenTageVon(b)
              const gewaehlt = auswahl[b.montag] ?? []
              return (
                <div key={b.montag}>
                  <p className="text-[10px] font-semibold uppercase tracking-[.14em]" style={{ color: FARBEN[b.farbe].fg }}>{FARBEN[b.farbe].label}, {FARBEN[b.farbe].titel}</p>
                  <p className="text-[16px] font-bold text-ink">KW {b.kw}, {wocheText({ ...b, arbeitstage: [] })}</p>
                  {b.feiertage > 0 && <p className="text-[11.5px] text-ink-4">Diese Woche hat {b.feiertage} Feiertag, der nicht zählt.</p>}
                  {b.oeffnung && <p className="text-[11.5px] text-ink-4">Rote Woche, für die Assistenz geöffnet, weil eine Zahnärztin fest in den Ferien ist. Du kannst nur die offenen Tage wählen.</p>}
                  <div className="mt-2">
                    <p className="text-[11.5px] text-ink-3 mb-1.5">An welchen Tagen nimmst du frei? <span className="tnum">({gewaehlt.length} von {tage.length})</span></p>
                    <div className="grid grid-cols-5 gap-1">
                      {tage.map(d => {
                        const an = gewaehlt.includes(d)
                        const frei = tagFrei(b, d)
                        const grund = tagGrund(b, d)
                        return (
                          <button key={d} type="button" onClick={() => frei && tagToggle(b.montag, d)} aria-pressed={an} disabled={!frei}
                            title={frei ? `${tagKurz(d)} ist frei` : `${tagKurz(d)} ist nicht möglich${grund ? `, ${kurzGrund(grund)}` : ''}`}
                            className={`rounded-lg px-1 py-1.5 text-center leading-tight border transition-colors ${an ? 'bg-[#2F6F62] border-[#2F6F62] text-white' : frei ? 'bg-white border-edge-ctl text-ink-3 hover:border-edge-strong' : 'bg-edge-row border-edge-row text-ink-5 cursor-not-allowed'}`}>
                            <span className={`block text-[10.5px] font-bold tnum ${frei ? '' : 'line-through'}`}>{tagKnopf(d).slice(0, 6)}</span>
                            <span className="block text-[10px]">{WD[isoWd(d) - 1]}</span>
                            <span className={`block text-[9px] ${an ? 'text-white/80' : frei ? 'text-mint-ink' : 'text-ink-5'}`}>{an ? 'gewählt' : frei ? 'frei' : grund?.startsWith('Rote Woche') ? 'gesperrt' : 'belegt'}</span>
                          </button>
                        )
                      })}
                    </div>
                    {tage.some(d => !tagFrei(b, d)) && <p className="mt-1 text-[10.5px] text-ink-4">{tage.filter(d => !tagFrei(b, d)).map(d => kurzGrund(tagGrund(b, d))).filter((v, i, a) => a.indexOf(v) === i).join(' · ')}</p>}
                    {b.assistenzFrei != null && <p className={`mt-1 text-[10.5px] ${gewaehlt.length > b.assistenzFrei + 0.005 ? 'text-blush-ink font-semibold' : 'text-ink-4'}`}>Assistenz: in dieser Woche sind noch {pz(b.assistenzFrei)} Tage frei{gewaehlt.length > b.assistenzFrei + 0.005 ? `, du hast ${gewaehlt.length} gewählt` : ''}</p>}
                  </div>
                </div>
              )
            })}
            <p className="text-[13px] text-ink-2">
              {bestaetigen.length === 2 ? 'Doppelwoche. Zählt' : 'Zählt'} {pz(kostenAuswahl(bestaetigen))} Ferientage{teilzeit ? ` (jeder gewählte Tag ein Tag, bei deinem Pensum von ${pensum} % sind das im Schnitt ${pz(Math.round(5 * (pensum ?? 100)) / 100)} Tage pro Woche)` : ''}. Die Anmeldung gilt erst, wenn die Praxisleitung sie akzeptiert.
            </p>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setBestaetigen(null)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={() => anmelden(bestaetigen)} disabled={isPending || bestaetigen.some(b => (auswahl[b.montag]?.length ?? 0) === 0 || (b.assistenzFrei != null && (auswahl[b.montag]?.length ?? 0) > b.assistenzFrei + 0.005))} className="btn-primary flex-1 disabled:opacity-50">{isPending ? 'Wird gespeichert…' : bestaetigen.length === 2 ? 'Zwei Wochen anmelden' : 'Anmelden'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Kachel({ label, wert, cls, sub }: { label: string; wert: number; cls: string; sub?: string }) {
  return (
    <div className={`rounded-tile px-3 py-2.5 ${cls}`}>
      <p className="text-[9.5px] font-semibold uppercase tracking-[.12em] opacity-80">{label}</p>
      <p className="text-[20px] font-bold tnum leading-tight">{String(wert).replace('.', ',')}</p>
      {sub && <p className="text-[10px] opacity-80">{sub}</p>}
    </div>
  )
}
