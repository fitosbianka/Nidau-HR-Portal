'use client'

// Wochenübersicht 2027 für Admins und Ferien Editorinnen: pro Woche Farbe, Grund,
// Personalstand, Belegung pro Kategorie mit Namen in Reihenfolge der
// Anmeldung, akzeptierte Plätze (offene Anmeldungen separat), Assistenz in
// Tagen, Warnungen, Tagesansicht Montag bis Freitag, Akzeptieren (mit
// Hinweis auf verletzte Regeln) und Ablehnen pro Person, bei Wünschen über
// mehrere Wochen nur für diese Woche, Farbe ändern.
// Standard ist die Tabelle aller 52 Wochen mit Namen, Zahlen und Warnungen;
// jede Zeile lässt sich für die Details aufklappen (Personen mit Knöpfen,
// Tagesansicht). Die Kachelansicht pro Monat bleibt wählbar, die Wahl merkt
// sich der Browser. Der ganze Abschnitt lässt sich von der Seite zuklappen.

import { Fragment, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { wochenfarbeSetzen } from '@/actions/ferien-wochen'
import { FARBEN, FARBEN_REIHENFOLGE, KATEGORIE_LABEL, kurzDatum, wochenTeile, montagVon, type Kategorie, type WochenFarbe } from '@/lib/ferien-wochen'
import { PERSONALSTAND_LABEL, tagKurz, wochentagName, type Personalstand } from '@/lib/ferien-kapazitaet'
import type { WocheAdmin, BelegtAnsicht } from '@/lib/ferien-wochen-data'
import type { FerienWunsch } from '@/lib/ferien-wuensche'
import { aktionKey, LAUFEND, type Aktion, type Teil } from '@/lib/ferien-aktion'

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const ANSICHT_KEY = 'ferien-wochen-ansicht'
const KATEGORIEN: Kategorie[] = ['ZAZ', 'DHPA', 'ASSISTENZ']
const fmtTs = (iso: string) => iso ? new Date(iso).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }) : ''
const pz = (n: number) => String(n).replace('.', ',')
const vorname = (n: string) => n.split(' ')[0]
const STAND_CLS: Record<Personalstand, string> = {
  zuwenig: 'bg-blush-bg text-blush-ink', knapp: 'bg-apricot-bg text-apricot-ink', ok: 'bg-mint-bg text-mint-ink', reserve: 'bg-steel-bg text-steel-ink',
}
const KNOPF = {
  primaer: 'px-2 py-0.5 rounded-md bg-dusk hover:bg-dusk-deep text-white text-[10.5px] font-semibold disabled:opacity-50',
  ablehnen: 'px-2 py-0.5 rounded-md border border-blush-bg text-blush-ink text-[10.5px] font-semibold hover:bg-blush-bg disabled:opacity-50',
  filter: (an: boolean) => `px-2.5 py-1 rounded-full text-[11px] font-semibold border ${an ? 'bg-dusk text-white border-dusk' : 'bg-white text-ink-2 border-edge-ctl'}`,
}
const Chevron = ({ offen }: { offen: boolean }) => (
  <svg className={`w-4 h-4 text-ink-4 transition-transform flex-shrink-0 ${offen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
)

type TeilHandler = (w: FerienWunsch, teil: Teil, aktion: 'akzeptieren' | 'ablehnen') => void

export default function WochenUebersichtAdmin({ wochen, wishes, verwalten, isPending = false, laufend = null, fehlerBei = null, eingeklappt = false, onToggle, onAkzeptieren, onAblehnen, onZuruecknehmen, onTeil }: {
  wochen: WocheAdmin[]
  wishes: FerienWunsch[]
  verwalten: boolean
  /** Eine Aktion der Seite läuft (Knöpfe gesperrt) */
  isPending?: boolean
  /** Laufende Aktion (aktionKey), der betroffene Knopf zeigt «Wird eingetragen …» */
  laufend?: string | null
  /** Fehler der letzten Aktion, direkt bei der betroffenen Person («<employeeId>_<from>») */
  fehlerBei?: { key: string; text: string } | null
  /** Abschnitt zugeklappt: nur der Kopf mit der Zusammenfassung */
  eingeklappt?: boolean
  /** Auf- und Zuklappen durch die Seite */
  onToggle?: () => void
  onAkzeptieren: (w: FerienWunsch, verletzungen: string[]) => void
  onAblehnen: (w: FerienWunsch) => void
  onZuruecknehmen: (w: FerienWunsch) => void
  /** Nur diese Woche eines Wunsches über mehrere Wochen akzeptieren oder ablehnen (teilt den Wunsch auf) */
  onTeil?: TeilHandler
}) {
  const router = useRouter()
  const [farbeLaeuft, startTransition] = useTransition()
  const [nurOffen, setNurOffen] = useState(false)
  const [nurWarnungen, setNurWarnungen] = useState(false)
  // Tabelle ist Standard, die Wahl bleibt im Browser gemerkt
  const [tabelle, setTabelleState] = useState(true)
  useEffect(() => { try { if (localStorage.getItem(ANSICHT_KEY) === 'kacheln') setTabelleState(false) } catch { /* ohne Speicher */ } }, [])
  const setTabelle = (v: boolean) => { setTabelleState(v); try { localStorage.setItem(ANSICHT_KEY, v ? 'tabelle' : 'kacheln') } catch { /* ohne Speicher */ } }
  const [offenTage, setOffenTage] = useState<Set<string>>(new Set())
  const [offenZeilen, setOffenZeilen] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState<string | null>(null)
  const gesperrt = isPending || farbeLaeuft || laufend !== null
  /** Wunsch zu einem Belegungseintrag: derselbe Schlüssel, sonst der Wunsch
   *  der Person, der diese Woche berührt (nach dem Aufteilen in Wochen). */
  const wunschVon = (b: BelegtAnsicht, w: WocheAdmin) => {
    if (b.art === 'eingetragen') return undefined
    const passt = (x: FerienWunsch) => x.employeeId === b.employeeId && x.from <= w.freitag && x.to >= w.montag
    return wishes.find(x => x.from === b.from && passt(x)) ?? wishes.find(x => passt(x) && x.status !== 'abgelehnt' && x.quelle !== 'woche')
  }
  const offenIn = (w: WocheAdmin) => Object.values(w.belegung).flat().filter(b => b.status === 'offen').length
  const sichtbar = useMemo(() => wochen.filter(w => (!nurOffen || offenIn(w) > 0) && (!nurWarnungen || w.warnungen.length > 0)), [wochen, nurOffen, nurWarnungen])
  const monate = useMemo(() => {
    const m = new Map<number, WocheAdmin[]>()
    for (const w of sichtbar) { const mo = parseInt(w.montag.slice(5, 7), 10) - 1; m.set(mo, [...(m.get(mo) ?? []), w]) }
    return Array.from(m.entries())
  }, [sichtbar])
  const offenTotal = wochen.reduce((s, w) => s + offenIn(w), 0)
  const warnTotal = wochen.filter(w => w.warnungen.length > 0).length

  function farbe(w: WocheAdmin, f: string) {
    setMsg(null)
    startTransition(async () => {
      const r = await wochenfarbeSetzen(w.montag, f === 'standard' ? null : (f as WochenFarbe))
      if ('error' in r && r.error) { setMsg(r.error); return }
      router.refresh()
    })
  }
  const toggleSet = (set: (f: (s: Set<string>) => Set<string>) => void, key: string) => set(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const toggleTage = (montag: string) => toggleSet(setOffenTage, montag)
  const toggleZeile = (montag: string) => toggleSet(setOffenZeilen, montag)
  const alleOffen = sichtbar.length > 0 && sichtbar.every(w => offenZeilen.has(w.montag))
  const alleZeilen = () => setOffenZeilen(alleOffen ? new Set() : new Set(sichtbar.map(w => w.montag)))

  /** Zähler einer Kategorie: akzeptierte Plätze gegen die Plätze der Farbe, offene Anmeldungen separat */
  function zaehler(w: WocheAdmin, k: Kategorie): { text: string; cls: string; offen: number; akzeptiert: number } {
    const liste = w.belegung[k]
    const offen = liste.filter(b => b.status === 'offen').length
    const akzeptiert = liste.length - offen
    const offenText = offen > 0 ? ` · ${offen} offen` : ''
    if (k === 'ASSISTENZ') {
      const a = w.assistenzAkzeptiert
      // Rote Woche: gesperrt, ausser eine ZAZ fehlt fest, dann Plätze pro Tag
      const o = w.oeffnungAkzeptiert
      const voll = w.farbe === 'rot' ? !!o && o.freiPersonen === 0 : a.freiPersonen === 0
      const rotText = o ? `rot, offen durch ZAZ Ferien, noch ${o.freiPersonen} ${o.freiPersonen === 1 ? 'Platz' : 'Plätze'}` : 'gesperrt'
      const text = `${akzeptiert} akzeptiert${offenText}, ${w.farbe === 'rot' ? rotText : `noch etwa ${a.freiPersonen} ${a.freiPersonen === 1 ? 'Platz' : 'Plätze'} (frei ${pz(a.frei)} Tage)`}`
      return { text, cls: a.frei < -0.005 ? 'text-blush-ink' : voll ? 'text-apricot-ink' : 'text-ink-4', offen, akzeptiert }
    }
    const akz = w.plaetzeAkzeptiert[k]
    const ueber = akz > w.plaetze[k], voll = akz >= w.plaetze[k]
    const text = `${akz} von ${w.plaetze[k]} pro Tag akzeptiert${ueber ? ', über den Plätzen' : voll ? ', voll' : ''}${offenText}`
    return { text, cls: ueber ? 'text-blush-ink' : voll ? 'text-apricot-ink' : 'text-ink-4', offen, akzeptiert }
  }

  /** Farbe dieser Woche ändern (nur mit Verwaltungsrecht) */
  const farbeWahl = (w: WocheAdmin, kompakt = false) => (
    <select value={w.farbe === w.standardFarbe ? 'standard' : w.farbe} onChange={e => farbe(w, e.target.value)} disabled={gesperrt}
      className={`input-field !w-auto !py-0.5 text-[11px] ${kompakt ? '!px-1.5' : 'ml-auto'}`} title="Farbe dieser Woche ändern">
      <option value="standard">Standard ({FARBEN[w.standardFarbe].label})</option>
      {FARBEN_REIHENFOLGE.filter(x => x !== w.standardFarbe).map(x => <option key={x} value={x}>{FARBEN[x].label}</option>)}
    </select>
  )

  /** Namen einer Kategorie kompakt für die Tabelle: akzeptiert grün, offen mit Fragezeichen, abgelehnt durchgestrichen */
  const namen = (w: WocheAdmin, k: Kategorie) => {
    const liste = w.belegung[k]
    if (liste.length === 0) return <span className="text-ink-5">niemand</span>
    return liste.map((b, i) => {
      const st = wunschVon(b, w)?.status ?? b.status
      const cls = b.art === 'eingetragen' || st === 'akzeptiert' ? 'text-mint-ink' : st === 'abgelehnt' ? 'text-ink-4 line-through' : 'text-apricot-ink'
      return (
        <span key={b.employeeId} className={cls} title={`${b.name}, ${b.art === 'eingetragen' ? 'im Arbeitsplan' : st}${b.vertreten ? ', vertreten' : ''}`}>
          {i > 0 && <span className="text-ink-5">, </span>}{vorname(b.name)}{b.art !== 'eingetragen' && st === 'offen' ? ' ?' : ''}{b.vertreten ? ' (v)' : ''}
        </span>
      )
    })
  }

  /** Warnungen als Chips */
  const warnungen = (w: WocheAdmin) => w.warnungen.length === 0 ? null : (
    <div className="flex flex-wrap gap-1.5">
      {w.warnungen.map((t, i) => <span key={i} className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-blush-bg text-blush-ink">⚠ {t}</span>)}
    </div>
  )

  /** Personen pro Kategorie in Reihenfolge der Anmeldung, mit Zähler und Knöpfen */
  const kategorien = (w: WocheAdmin) => (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-2">
      {KATEGORIEN.map(k => {
        const liste = w.belegung[k]
        const z = zaehler(w, k)
        return (
          <div key={k} className="min-w-0">
            <p className={`text-[10px] font-semibold uppercase tracking-wider ${z.cls}`} title="Akzeptierte Anmeldungen und Einträge im Arbeitsplan gegen die Plätze der Farbe; offene Anmeldungen zählen nicht mit und stehen separat">
              {KATEGORIE_LABEL[k]} <span className="normal-case tracking-normal tnum">{z.text}</span>
            </p>
            {k === 'ASSISTENZ' && w.oeffnungText && <p className="text-[10.5px] text-steel-ink leading-snug">{w.oeffnungText}</p>}
            <ul className="mt-0.5 space-y-0.5">
              {liste.length === 0 && <li className="text-[11px] text-ink-5">niemand</li>}
              {liste.map((b, i) => (
                <PersonZeile key={b.employeeId} b={b} nr={i + 1} w={w} wunsch={wunschVon(b, w)} wishes={wishes} verwalten={verwalten} gesperrt={gesperrt} laufend={laufend} fehlerBei={fehlerBei}
                  onAkzeptieren={onAkzeptieren} onAblehnen={onAblehnen} onZuruecknehmen={onZuruecknehmen} onTeil={onTeil} />
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )

  /** Tagesansicht Montag bis Freitag mit der Assistenz Rechnung und den festen Einsätzen */
  const tagesansicht = (w: WocheAdmin) => (
    <div className="rounded-xl border border-edge-soft bg-surface p-3">
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-[11.5px]">
        {w.tage.map(t => (
          <div key={t.datum} className="rounded-lg bg-white border border-edge-soft p-2 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-3 tnum">{wochentagName(t.datum).slice(0, 2)} {kurzDatum(t.datum)}</p>
            <p className={`mt-1 ${t.zaz.length === 0 ? 'text-blush-ink font-semibold' : 'text-ink'}`}><span className="text-[10px] text-ink-4">ZAZ </span>{t.zaz.length === 0 ? 'keine' : t.zaz.join(', ')}</p>
            {t.zazHalb.length > 0 && <p className="text-ink-3 text-[10.5px]">Einsatz {t.zazHalb.join('; ')}</p>}
            <p className={`mt-1 ${t.dhpa.length === 0 ? 'text-blush-ink font-semibold' : 'text-ink'}`}><span className="text-[10px] text-ink-4">DH / PA </span>{t.dhpa.length === 0 ? 'keine' : t.dhpa.join(', ')}</p>
            {(t.zazWeg.length > 0 || t.dhpaWeg.length > 0) && <p className="mt-0.5 text-[10px] text-ink-4">weg {[...t.zazWeg, ...t.dhpaWeg].join(', ')}</p>}
            <p className="mt-1 text-ink-2 tnum"><span className="text-[10px] text-ink-4">Assistenz Bedarf </span>{pz(t.bedarf)}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] text-ink-2 tnum">
        Assistenz pro Woche (alle Anmeldungen): Bedarf {pz(w.assistenz.bedarf)}, Angebot {pz(w.assistenz.angebot)} ({w.assistenz.personen} Personen), abwesend {pz(w.assistenz.abwesend)}{w.assistenz.reserve > 0 ? `, Reserve ${pz(w.assistenz.reserve)}` : ''}, frei <span className={`font-semibold ${w.assistenz.frei < 0 ? 'text-blush-ink' : 'text-mint-ink'}`}>{pz(w.assistenz.frei)} Tage</span>
        {w.assistenzAkzeptiert.frei !== w.assistenz.frei && <> · nur akzeptiert: abwesend {pz(w.assistenzAkzeptiert.abwesend)}, frei <span className="font-semibold text-mint-ink">{pz(w.assistenzAkzeptiert.frei)} Tage</span></>}
      </p>
      {w.einsaetze.length > 0 && (
        <p className="mt-1 text-[11px] text-ink-3">Feste Einsätze: {w.einsaetze.map(e => `${e.name} ${tagKurz(e.datum)} ${e.von.replace(':', '.')} bis ${e.bis.replace(':', '.')} Uhr`).join('; ')}</p>
      )}
    </div>
  )

  const personalstand = (w: WocheAdmin) => (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${STAND_CLS[w.personalstand]}`} title={`Mit allen Anmeldungen. Assistenz: Bedarf ${pz(w.assistenz.bedarf)}, Angebot ${pz(w.assistenz.angebot)}, weg ${pz(w.assistenz.abwesend)}, frei ${pz(w.assistenz.frei)} Tage`}>{PERSONALSTAND_LABEL[w.personalstand]}</span>
  )

  return (
    <div className="card overflow-hidden">
      <div className={`px-5 py-4 flex flex-wrap items-center justify-between gap-3 ${eingeklappt ? '' : 'border-b border-edge-soft'}`}>
        <button type="button" onClick={onToggle} disabled={!onToggle} className="flex items-start gap-2 text-left min-w-0 flex-1 disabled:cursor-default" aria-expanded={!eingeklappt} title={onToggle ? (eingeklappt ? 'Aufklappen' : 'Zuklappen') : undefined}>
          {onToggle && <span className="mt-0.5"><Chevron offen={!eingeklappt} /></span>}
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink">
              Wochenübersicht 2027 <span className="font-normal text-ink-4 tnum">· {wochen.length} Wochen, {offenTotal} offene {offenTotal === 1 ? 'Anfrage' : 'Anfragen'}, {warnTotal} mit Warnungen</span>
            </span>
            {!eingeklappt && <span className="block text-[11.5px] text-ink-4 mt-0.5">Pro Kategorie die Personen in Reihenfolge der Anmeldung. Gezählt werden akzeptierte Anmeldungen und Einträge im Arbeitsplan, offene Anmeldungen stehen separat dabei (in der Tabelle mit Fragezeichen). ZAZ und DH / PA gegen die Plätze der Farbe pro Tag (zwei Personen passen in dieselbe Woche, wenn ihre Tage sich nicht überschneiden), die Assistenz in Tagen nach Bedarf und Angebot. Bei Wünschen über mehrere Wochen gilt der Entscheid nur für diese Woche. Die Tagesregeln lesen die Standardwochen, bei Behandlern gilt ein leerer Tag als frei, bei der Assistenz bitte % setzen.</span>}
          </span>
        </button>
        {!eingeklappt && (
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setNurOffen(v => !v)} className={KNOPF.filter(nurOffen)}>
              Nur Wochen mit offenen Anfragen{offenTotal > 0 ? ` (${offenTotal})` : ''}
            </button>
            <button onClick={() => setNurWarnungen(v => !v)} className={KNOPF.filter(nurWarnungen)}>
              Nur Wochen mit Warnungen{warnTotal > 0 ? ` (${warnTotal})` : ''}
            </button>
            <span className="w-px h-5 bg-edge-ctl mx-0.5 self-center" />
            <button onClick={() => setTabelle(true)} className={KNOPF.filter(tabelle)} title="Alle Wochen untereinander mit Namen, Zahlen und Warnungen, Details pro Zeile aufklappbar">Tabelle</button>
            <button onClick={() => setTabelle(false)} className={KNOPF.filter(!tabelle)} title="Pro Monat eine Kachel pro Woche mit allen Personen und Knöpfen">Kacheln</button>
            {tabelle && <button onClick={alleZeilen} className={KNOPF.filter(alleOffen)} title="Details aller angezeigten Wochen auf- oder zuklappen">{alleOffen ? 'Details schliessen' : 'Alle Details'}</button>}
          </div>
        )}
      </div>
      {!eingeklappt && (
        <>
          {msg && <p className="mx-5 mt-3 text-xs px-3 py-2 rounded-ctl inline-block bg-blush-bg text-blush-ink">⚠ {msg}</p>}

          {tabelle ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] tnum min-w-[1100px]">
                <thead>
                  <tr className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink-4 border-b-[1.5px] border-edge-ctl">
                    <th className="w-8 py-2 pl-3" aria-label="Details" />
                    <th className="text-left px-2 py-2">KW</th><th className="text-left py-2">Woche</th><th className="text-left py-2 pl-3">Farbe</th>
                    <th className="text-left py-2 pl-4">ZAZ</th><th className="text-left py-2 pl-4">DH / PA</th><th className="text-left py-2 pl-4">Assistenz</th>
                    <th className="text-right py-2 pl-3">Bedarf</th><th className="text-right py-2">Angebot</th><th className="text-right py-2">Frei</th><th className="text-right py-2">Plätze</th>
                    <th className="text-left py-2 pl-4">Personalstand</th><th className="text-right py-2 pl-4 pr-5">Warnungen</th>
                  </tr>
                </thead>
                <tbody>
                  {sichtbar.length === 0 && <tr><td colSpan={13} className="px-5 py-8 text-sm text-ink-4 text-center">Keine Wochen mit diesem Filter.</td></tr>}
                  {sichtbar.map(w => {
                    const f = FARBEN[w.farbe]
                    const zaz = zaehler(w, 'ZAZ'), dhpa = zaehler(w, 'DHPA'), ass = zaehler(w, 'ASSISTENZ')
                    const a = w.assistenzAkzeptiert
                    const auf = offenZeilen.has(w.montag)
                    const platz = (k: 'ZAZ' | 'DHPA', z: { offen: number; text: string }) => (
                      <td className="py-1.5 pl-4 align-top" title={z.text}>
                        <span className={`font-semibold ${w.plaetzeAkzeptiert[k] > w.plaetze[k] ? 'text-blush-ink' : 'text-ink'}`}>{w.plaetzeAkzeptiert[k]} von {w.plaetze[k]}</span>
                        {z.offen > 0 && <span className="text-ink-4 text-[10.5px]"> · {z.offen} offen</span>}
                        <span className="block text-[10.5px] leading-snug max-w-[170px]">{namen(w, k)}</span>
                      </td>
                    )
                    return (
                      <Fragment key={w.montag}>
                        <tr className={`border-b border-edge-row hover:bg-hovrow align-top ${auf ? 'bg-hovrow' : ''}`} style={{ boxShadow: `inset 4px 0 0 0 ${f.fg}` }}>
                          <td className="py-1.5 pl-3 align-top">
                            <button onClick={() => toggleZeile(w.montag)} className="p-0.5 rounded hover:bg-edge-row" title={auf ? 'Details schliessen' : 'Details: Personen mit Knöpfen, Tagesansicht'} aria-expanded={auf}><Chevron offen={auf} /></button>
                          </td>
                          <td className="px-2 py-1.5 font-semibold align-top">{w.kw}</td>
                          <td className="py-1.5 text-ink-2 align-top">
                            <span className="whitespace-nowrap">{kurzDatum(w.montag)} bis {kurzDatum(w.freitag)}</span>
                            {(w.grund || w.feiertage > 0) && <span className="block text-[10.5px] text-ink-4 leading-snug max-w-[180px]">{w.grund}{w.feiertage > 0 ? `${w.grund ? ' · ' : ''}${w.feiertage} Feiertag` : ''}</span>}
                          </td>
                          <td className="py-1.5 pl-3 align-top">
                            {verwalten ? farbeWahl(w, true) : <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full border" style={{ background: f.bg, borderColor: f.fg }} />{f.label}</span>}
                          </td>
                          {platz('ZAZ', zaz)}
                          {platz('DHPA', dhpa)}
                          <td className="py-1.5 pl-4 align-top" title={ass.text}>
                            <span className={`font-semibold ${a.frei < -0.005 ? 'text-blush-ink' : 'text-ink'}`}>{ass.akzeptiert} ({pz(a.abwesend)} T)</span>
                            {ass.offen > 0 && <span className="text-ink-4 text-[10.5px]"> · {ass.offen} offen</span>}
                            <span className="block text-[10.5px] leading-snug max-w-[200px]">{namen(w, 'ASSISTENZ')}</span>
                          </td>
                          <td className="py-1.5 pl-3 text-right align-top">{pz(a.bedarf)}</td>
                          <td className="py-1.5 text-right align-top">{pz(a.angebot)}</td>
                          <td className={`py-1.5 text-right align-top ${a.frei < 0 ? 'text-blush-ink font-semibold' : ''}`}>{pz(a.frei)}</td>
                          <td className="py-1.5 text-right align-top">{w.farbe === 'rot' ? (w.oeffnungAkzeptiert?.freiPersonen ?? 0) : a.freiPersonen}</td>
                          <td className="py-1.5 pl-4 align-top">{personalstand(w)}</td>
                          <td className="py-1.5 pl-4 pr-5 align-top text-right">
                            {w.warnungen.length === 0 ? <span className="text-ink-5">–</span> : (
                              <span className="text-blush-ink font-semibold cursor-help" title={w.warnungen.join('\n')}>⚠ {w.warnungen.length}</span>
                            )}
                          </td>
                        </tr>
                        {auf && (
                          <tr className="border-b border-edge-row" style={{ boxShadow: `inset 4px 0 0 0 ${f.fg}` }}>
                            <td colSpan={13} className="px-5 py-3 bg-surface">
                              <div className="space-y-3">
                                {warnungen(w)}
                                {kategorien(w)}
                                {tagesansicht(w)}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
              <p className="px-5 py-3 text-[11px] text-ink-4 border-t border-edge-soft">ZAZ und DH / PA zeigen die höchste Zahl akzeptierter Abwesender an einem Tag gegen die Plätze der Farbe (ZAZ ohne vollständig Vertretene, «(v)»), offene Anmeldungen separat und mit Fragezeichen beim Namen. Assistenz: Personen mit akzeptierter Anmeldung und ihre Tage; Frei = Angebot minus Bedarf minus Abwesenheiten minus Reserve, Plätze = Frei geteilt durch die durchschnittlichen Praxistage pro Person, abgerundet. Personalstand und Warnungen rechnen alle Anmeldungen mit; die Warnungen zeigt der Mauszeiger über dem Symbol, aufgeklappt stehen sie ausgeschrieben. Der Pfeil links öffnet die Personen mit Knöpfen und die Tagesansicht.</p>
            </div>
          ) : (
            <>
              {monate.length === 0 && <p className="px-5 py-8 text-sm text-ink-4 text-center">Keine Wochen mit diesem Filter.</p>}
              {monate.map(([mo, liste]) => (
                <div key={mo}>
                  <p className="px-5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4">{MONATE[mo]}</p>
                  <ul className="divide-y divide-edge-row">
                    {liste.map(w => {
                      const f = FARBEN[w.farbe]
                      const tageOffen = offenTage.has(w.montag)
                      return (
                        <li key={w.montag} className="px-5 py-3 border-l-4" style={{ borderLeftColor: f.fg }}>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            <span className="w-3 h-3 rounded-full border flex-shrink-0" style={{ background: f.bg, borderColor: f.fg }} />
                            <p className="text-[13px] font-semibold text-ink tnum">KW {w.kw} <span className="font-normal text-ink-2">{kurzDatum(w.montag)} bis {kurzDatum(w.freitag)}</span></p>
                            <p className="text-[11px] text-ink-4">{w.grund}{w.feiertage > 0 ? ` · ${w.feiertage} Feiertag` : ''}</p>
                            {personalstand(w)}
                            <button onClick={() => toggleTage(w.montag)} className="text-[11px] text-steel-ink hover:underline">{tageOffen ? 'Tagesansicht schliessen' : 'Tagesansicht'}</button>
                            {verwalten && farbeWahl(w)}
                          </div>
                          {w.warnungen.length > 0 && <div className="mt-1.5">{warnungen(w)}</div>}
                          <div className="mt-2">{kategorien(w)}</div>
                          {tageOffen && <div className="mt-3">{tagesansicht(w)}</div>}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}

function PersonZeile({ b, nr, w, wunsch, wishes, verwalten, gesperrt, laufend, fehlerBei, onAkzeptieren, onAblehnen, onZuruecknehmen, onTeil }: {
  b: BelegtAnsicht; nr: number; w: WocheAdmin; wunsch?: FerienWunsch; wishes: FerienWunsch[]; verwalten: boolean; gesperrt: boolean; laufend: string | null; fehlerBei: { key: string; text: string } | null
  onAkzeptieren: (w: FerienWunsch, verletzungen: string[]) => void; onAblehnen: (w: FerienWunsch) => void; onZuruecknehmen: (w: FerienWunsch) => void; onTeil?: TeilHandler
}) {
  // Status aus dem Wunsch (nach eigenen Aktionen sofort aktuell), sonst aus der Belegung
  const status: 'offen' | 'akzeptiert' | 'abgelehnt' = wunsch ? wunsch.status : b.status
  // Ungeteilter Wunsch über mehrere Wochen: der Teil dieser Woche wird einzeln entschieden
  const teile = wunsch && wunsch.quelle !== 'woche' ? wochenTeile(wunsch.from, wunsch.to) : []
  const teil = teile.length > 1 ? teile.find(t => montagVon(t.from) === w.montag) : undefined
  // Aufgeteilte Anfrage: «Woche 2 von 4»
  const gruppe = wunsch?.gruppe ? wishes.filter(x => x.employeeId === wunsch.employeeId && x.gruppe === wunsch.gruppe).sort((a, c) => a.from.localeCompare(c.from)) : []
  const nrInGruppe = gruppe.length > 1 && wunsch ? gruppe.findIndex(x => x.from === wunsch.from) + 1 : 0
  const typ = b.art === 'woche'
    ? (nrInGruppe > 0 ? `Doppelwoche ${nrInGruppe} von ${gruppe.length}` : b.gruppe ? 'Doppelwoche' : 'Woche')
    : b.art === 'wunsch'
      ? (nrInGruppe > 0 ? `Wunsch, Woche ${nrInGruppe} von ${gruppe.length}, ${b.tage} Tage` : teil ? `Wunsch über ${teile.length} Wochen, hier ${b.tage} Tage` : `Wunsch ${b.tage} Tage`)
      : ''
  const tageHier = (wunsch?.tage ?? []).filter(d => d >= w.montag && d <= w.freitag)
  const key = teil ? teil.from : (wunsch?.from ?? b.from)
  const txt = (a: Aktion, t: string) => (laufend === aktionKey(b.employeeId, key, a) ? LAUFEND[a] : t)
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
      <span className="text-[10px] font-bold text-ink-4 tnum w-4">{nr}.</span>
      <span className={`font-semibold ${status === 'akzeptiert' ? 'text-mint-ink' : status === 'abgelehnt' ? 'text-ink-4 line-through' : 'text-ink'}`}>{b.name}</span>
      {b.vertreten && <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-mint-bg text-mint-ink" title="Vollständig vertreten, belegt keinen ZAZ Platz">vertreten</span>}
      {b.art === 'eingetragen' ? (
        <span className="text-[10px] text-ink-4">im Arbeitsplan</span>
      ) : (
        <>
          <span className="text-[10px] text-ink-4 tnum">{typ} · {fmtTs(b.createdAt)}</span>
          {tageHier.length > 0 && tageHier.length < w.arbeitstage && <span className="text-[10px] text-ink-3 tnum" title="Gewählte Ferientage">{tageHier.map(tagKurz).join(', ')}</span>}
          {wunsch?.bemerkung && <span className="text-[10px] text-ink-3 italic" title={wunsch.bemerkung}>«{wunsch.bemerkung.length > 48 ? `${wunsch.bemerkung.slice(0, 48)}…` : wunsch.bemerkung}»</span>}
          {b.verletzungen.length > 0 && status === 'offen' && <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-blush-bg text-blush-ink" title={b.verletzungen.join('\n')}>⚠ {b.verletzungen.length === 1 ? 'Regel' : `${b.verletzungen.length} Regeln`}</span>}
          {status === 'akzeptiert' ? (
            <>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-mint-bg text-mint-ink" title="Akzeptiert, im Arbeitsplan eingetragen">✓ akzeptiert</span>
              {verwalten && wunsch && <button onClick={() => onZuruecknehmen(wunsch)} disabled={gesperrt} className="text-[10.5px] text-ink-4 hover:text-red-500 disabled:opacity-50">{txt('zuruecknehmen', 'Zurücknehmen')}</button>}
            </>
          ) : status === 'abgelehnt' ? (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blush-bg text-blush-ink">abgelehnt</span>
          ) : verwalten && wunsch ? (
            teil && onTeil ? (
              <>
                <button onClick={() => onTeil(wunsch, teil, 'akzeptieren')} disabled={gesperrt} className={KNOPF.primaer} title="Nur diese Woche akzeptieren, die übrigen Wochen des Wunsches bleiben offen">{txt('akzeptieren', 'Diese Woche akzeptieren')}</button>
                <button onClick={() => onTeil(wunsch, teil, 'ablehnen')} disabled={gesperrt} className={KNOPF.ablehnen} title="Nur diese Woche ablehnen, mit Grund">{txt('ablehnen', 'Diese Woche ablehnen')}</button>
                <button onClick={() => onAkzeptieren(wunsch, b.verletzungen)} disabled={gesperrt} className="text-[10.5px] text-ink-4 hover:underline disabled:opacity-50" title={`Alle ${teile.length} Wochen des Wunsches akzeptieren`}>Alle {teile.length} Wochen</button>
              </>
            ) : (
              <>
                <button onClick={() => onAkzeptieren(wunsch, b.verletzungen)} disabled={gesperrt} className={KNOPF.primaer}>{txt('akzeptieren', 'Akzeptieren')}</button>
                <button onClick={() => onAblehnen(wunsch)} disabled={gesperrt} className={KNOPF.ablehnen}>{txt('ablehnen', 'Ablehnen')}</button>
              </>
            )
          ) : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-apricot-bg text-apricot-ink">offen</span>}
          {fehlerBei && fehlerBei.key === `${b.employeeId}_${key}` && <span className="basis-full text-[10.5px] font-semibold text-blush-ink">⚠ {fehlerBei.text}</span>}
        </>
      )}
    </li>
  )
}
