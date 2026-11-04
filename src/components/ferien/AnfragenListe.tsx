'use client'

// Anfragen der Ferienplanung für Admins und Laura, gruppiert pro Person:
// zuoberst die Person mit der neuesten Anfrage, zugeklappt nur Name und
// Zähler, aufgeklappt alle Anfragen der Person (neueste zuerst) mit Typ,
// Zeitraum, gewählten Tagen, Bemerkung, Farbe der Woche, Belegung der
// eigenen Kategorie gegen die Plätze, Eingang, Status und Aktionen.
// Anfragen über mehrere Wochen (Wünsche und Doppelwochen) stehen als ein
// Block mit einer Zeile pro Woche, jede mit eigenem Status («Offen»,
// «Akzeptiert» mit den Tagen im Arbeitsplan, «Abgelehnt») und eigenen
// Knöpfen, damit sichtbar ist, welche Wochen schon entschieden sind.

import { useMemo, useState } from 'react'
import { PLAN_YEAR, weekdaysBetween, wunschArtLabel, wunschArtCode, type FerienWunsch } from '@/lib/ferien-wuensche'
import { FARBEN, KATEGORIE_LABEL, kategorieFuer, wunschKosten, wochenTeile, montagVon, type Woche, type Kategorie } from '@/lib/ferien-wochen'
import { isoKw, kwBereich } from '@/lib/ferien'
import { istFeiertag } from '@/lib/feiertage'
import type { WocheAdmin } from '@/lib/ferien-wochen-data'
import { tagKurz, tageText } from '@/lib/ferien-vertretung'
import { aktionKey, LAUFEND, type Aktion, type Teil } from '@/lib/ferien-aktion'

type Emp = { id: string; full_name: string; job_title: string | null; pensum?: number | null }
type Vac = { employee_id: string; schedule_date: string; entry: string }
type Status = 'alle' | 'offen' | 'akzeptiert' | 'abgelehnt'
type Typ = 'alle' | 'woche' | 'wunsch'

/** Eine Zeile der Liste: ein einzelner Wunsch oder ein Block mit mehreren Wochen.
 *  «virtuell»: der Wunsch liegt noch als eine Zeile über mehrere Wochen vor,
 *  die Wochen werden erst beim ersten Einzelentscheid aufgeteilt. */
type Eintrag =
  | { typ: 'einzeln'; w: FerienWunsch; createdAt: string }
  | { typ: 'gruppe'; key: string; basis: FerienWunsch; teile: FerienWunsch[]; virtuell: boolean; createdAt: string }

const fmtD = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
const fmtTs = (iso: string) => `${new Date(iso).toLocaleString('de-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} Uhr`
const initials = (name: string) => name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)
const pz = (n: number) => String(n).replace('.', ',')

const KNOPF = {
  primaer: 'px-2 py-1 rounded-lg bg-dusk hover:bg-dusk-deep text-white text-[11px] font-semibold transition-colors disabled:opacity-50',
  ablehnen: 'px-2 py-1 rounded-lg border border-blush-bg text-blush-ink text-[11px] font-semibold hover:bg-blush-bg transition-colors disabled:opacity-50',
  neutral: 'px-2 py-1 rounded-lg border border-edge-ctl bg-white text-ink-2 text-[11px] font-semibold hover:bg-edge-row transition-colors disabled:opacity-50',
  icon: 'p-1.5 rounded-lg border border-edge-ctl bg-white text-ink-2 hover:bg-edge-row transition-colors disabled:opacity-50',
  iconRot: 'p-1.5 rounded-lg border border-edge-ctl bg-white text-ink-4 hover:text-red-500 hover:bg-edge-row transition-colors disabled:opacity-50',
}
const Pfeil = ({ auf }: { auf: boolean }) => (
  <svg className={`w-4 h-4 text-ink-4 transition-transform flex-shrink-0 ${auf ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
)
const Stift = () => <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
const Kreuz = () => <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>

export default function AnfragenListe({ wishes, employees, wochen, alleWochen, vacations = [], isPending, laufend = null, fehlerBei = null, aktualisiert = false, hinweis = null, eingeklappt = false, onToggle, nur, titel, untertitel, onNeu, onBearbeiten, onAkzeptieren, onAblehnen, onZuruecknehmen, onLoeschen, onTeil }: {
  wishes: FerienWunsch[]
  /** In Arbeitsplan Reihenfolge */
  employees: Emp[]
  wochen: WocheAdmin[]
  alleWochen: Woche[]
  /** Einträge im Arbeitsplan (F, UF, WB), um bei akzeptierten Wochen zu zeigen, was eingetragen ist */
  vacations?: Vac[]
  isPending: boolean
  /** Laufende Aktion (aktionKey), der betroffene Knopf zeigt «Wird eingetragen …» */
  laufend?: string | null
  /** Fehler der letzten Aktion, direkt bei der betroffenen Zeile («<employeeId>_<from>») */
  fehlerBei?: { key: string; text: string } | null
  /** Die Liste zeigt eine lokal angepasste Anzeige, die Seite lädt die neuen Daten gerade nach */
  aktualisiert?: boolean
  /** Letzte Meldung (Erfolg oder Fehler), direkt bei der Liste sichtbar */
  hinweis?: { type: 'ok' | 'err'; text: string } | null
  /** Abschnitt zugeklappt: nur der Kopf mit den Zahlen */
  eingeklappt?: boolean
  /** Auf- und Zuklappen durch die Seite */
  onToggle?: () => void
  /** Nur Wochenanmeldungen oder nur Wünsche zeigen (eigener Abschnitt pro Typ) */
  nur?: 'woche' | 'wunsch'
  titel?: string
  untertitel?: string
  onNeu: () => void
  onBearbeiten: (w: FerienWunsch) => void
  onAkzeptieren: (w: FerienWunsch) => void
  onAblehnen: (w: FerienWunsch) => void
  onZuruecknehmen: (w: FerienWunsch) => void
  onLoeschen: (w: FerienWunsch) => void
  /** Eine Woche eines offenen Wunsches über mehrere Wochen einzeln akzeptieren oder ablehnen (teilt den Wunsch auf) */
  onTeil: (w: FerienWunsch, teil: Teil, aktion: 'akzeptieren' | 'ablehnen') => void
}) {
  const [status, setStatus] = useState<Status>('alle')
  const [typWahl, setTyp] = useState<Typ>('alle')
  const typ: Typ = nur ?? typWahl
  /** Anfragen dieses Abschnitts (bei «nur» nur der eine Typ) */
  const basisListe = useMemo(() => (nur ? wishes.filter(w => (w.quelle === 'woche') === (nur === 'woche')) : wishes), [wishes, nur])
  const [offen, setOffen] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOffen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const gesperrt = isPending || laufend !== null

  const wocheByMontag = useMemo(() => new Map(wochen.map(w => [w.montag, w])), [wochen])
  const planByMontag = useMemo(() => new Map(alleWochen.map(w => [w.montag, w])), [alleWochen])
  const gruppeKey = (w: FerienWunsch) => (w.gruppe ? `${w.employeeId}|${w.gruppe}` : null)
  const gruppenGroesse = useMemo(() => { const m = new Map<string, number>(); for (const w of wishes) { const k = gruppeKey(w); if (k) m.set(k, (m.get(k) ?? 0) + 1) } return m }, [wishes])
  // Im Arbeitsplan eingetragene Tage: «<employeeId>_<datum>_<code>» (F:x zählt als F)
  const planSet = useMemo(() => new Set(vacations.map(v => `${v.employee_id}_${v.schedule_date}_${v.entry.split(':')[0]}`)), [vacations])
  /** Wie viele der Tage eines akzeptierten Wunsches stehen im Arbeitsplan */
  const imPlan = (w: FerienWunsch) => {
    const code = wunschArtCode(w.art)
    const alle = weekdaysBetween(w.from, w.to).filter(d => w.art !== 'ferien' || !istFeiertag(d))
    const tage = w.art === 'ferien' && w.tage && w.tage.length > 0 ? w.tage.filter(d => !istFeiertag(d)) : alle
    return { drin: tage.filter(d => planSet.has(`${w.employeeId}_${d}_${code}`)).length, total: tage.length, code }
  }

  const gefiltert = useMemo(() => wishes.filter(w => (status === 'alle' || w.status === status) && (typ === 'alle' || (typ === 'woche' ? w.quelle === 'woche' : w.quelle !== 'woche'))), [wishes, status, typ])

  // Personen: zuerst die mit der neuesten Anfrage, dahinter die ohne Anfragen
  const personen = useMemo(() => {
    const proPerson = new Map<string, FerienWunsch[]>()
    for (const w of gefiltert) proPerson.set(w.employeeId, [...(proPerson.get(w.employeeId) ?? []), w])
    const mit = employees.filter(e => proPerson.has(e.id)).map(e => {
      const liste = (proPerson.get(e.id) ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return { e, liste, neueste: liste[0].createdAt }
    }).sort((a, b) => b.neueste.localeCompare(a.neueste))
    // Personen ohne Anfragen nur bei den Wochenanmeldungen (wer hat sich noch nicht angemeldet)
    const ohne = status === 'alle' && (typ === 'alle' || nur === 'woche') ? employees.filter(e => !proPerson.has(e.id)).map(e => ({ e, liste: [] as FerienWunsch[], neueste: '' })) : []
    return [...mit, ...ohne]
  }, [gefiltert, employees, status, typ, nur])

  const mehrereWochen = (w: FerienWunsch) => w.quelle !== 'woche' && new Set(weekdaysBetween(w.from, w.to).map(montagVon)).size > 1

  /** Einträge einer Person: einzelne Wünsche und Wochen sowie ein Block pro
   *  Anfrage über mehrere Wochen (alle Wochen der Anfrage, auch schon entschiedene). */
  const eintraegeVon = (liste: FerienWunsch[]): Eintrag[] => {
    const out: Eintrag[] = []
    const gesehen = new Set<string>()
    for (const w of liste) {
      const gk = gruppeKey(w)
      if (gk && (gruppenGroesse.get(gk) ?? 0) >= 2) {
        if (gesehen.has(gk)) continue
        gesehen.add(gk)
        const teile = wishes.filter(x => x.employeeId === w.employeeId && x.gruppe === w.gruppe).sort((a, b) => a.from.localeCompare(b.from))
        out.push({ typ: 'gruppe', key: gk, basis: teile[0], teile, virtuell: false, createdAt: teile[0].createdAt })
      } else if (w.status === 'offen' && mehrereWochen(w)) {
        const alteTage = w.tage && w.tage.length > 0 ? w.tage : null
        const teile = wochenTeile(w.from, w.to).map(t => {
          // ohne Tagesauswahl bleibt jede Woche ohne Tagesauswahl (zählt nach Pensum)
          const tage = alteTage ? alteTage.filter(d => d >= t.from && d <= t.to) : []
          return { ...w, from: t.from, to: t.to, tage: w.art === 'ferien' && tage.length > 0 ? tage : null }
        })
        out.push({ typ: 'gruppe', key: `${w.employeeId}_${w.from}`, basis: w, teile, virtuell: true, createdAt: w.createdAt })
      } else out.push({ typ: 'einzeln', w, createdAt: w.createdAt })
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /** Wochen, die ein Eintrag berührt, mit Farbe und Belegung der eigenen
   *  Kategorie: gezählt werden nur akzeptierte Anmeldungen (und Einträge im
   *  Arbeitsplan), offene Anmeldungen anderer Personen stehen separat dabei. */
  function wochenInfo(w: Pick<FerienWunsch, 'from' | 'to' | 'employeeId'>, kat: Kategorie | null) {
    const montage = Array.from(new Set(weekdaysBetween(w.from, w.to).map(montagVon)))
    return montage.map(m => {
      const wa = wocheByMontag.get(m)
      if (!wa) return null
      const liste = kat ? wa.belegung[kat] : []
      const weitereOffen = liste.filter(b => b.status === 'offen' && b.employeeId !== w.employeeId).length
      const offenText = weitereOffen > 0 ? `, ${weitereOffen} weitere offen` : ''
      const selbst = liste.some(b => b.employeeId === w.employeeId)
      let belegung = ''
      let voll = false
      // Woche für die Kategorie durch die anderen (offen und akzeptiert) schon voll:
      // dann ging für diese Person nur noch ein Wunsch
      let vollDurchAndere = false
      if (kat === 'ASSISTENZ') {
        const a = wa.assistenzAkzeptiert
        const akz = liste.filter(b => b.status === 'akzeptiert').length
        // Rote Woche: gesperrt, ausser eine ZAZ fehlt fest (Öffnung mit Plätzen pro Tag)
        const oA = wa.oeffnungAkzeptiert
        voll = wa.farbe === 'rot' ? !oA || oA.freiPersonen === 0 : a.freiPersonen === 0
        vollDurchAndere = wa.farbe === 'rot' ? !wa.oeffnung || wa.oeffnung.freiPersonen === 0 : wa.assistenz.freiPersonen === 0
        belegung = `Assistenz ${akz} akzeptiert${offenText}, ${wa.farbe === 'rot' ? (oA ? `rot, offen durch ZAZ Ferien, noch ${oA.freiPersonen} ${oA.freiPersonen === 1 ? 'Platz' : 'Plätze'}` : 'gesperrt') : `noch etwa ${a.freiPersonen} ${a.freiPersonen === 1 ? 'Platz' : 'Plätze'}`}`
      } else if (kat) {
        const akz = wa.plaetzeAkzeptiert[kat]
        voll = akz >= wa.plaetze[kat]
        vollDurchAndere = wa.farbe === 'rot' || wa.plaetzeBelegt[kat] - (selbst ? 1 : 0) >= wa.plaetze[kat]
        belegung = `${KATEGORIE_LABEL[kat]} ${akz} von ${wa.plaetze[kat]} pro Tag akzeptiert${akz > wa.plaetze[kat] ? ', über den Plätzen' : voll ? ', voll' : ''}${offenText}`
      }
      return { kw: wa.kw, farbe: wa.farbe, titel: FARBEN[wa.farbe].titel, belegung, voll, vollDurchAndere, warnungen: wa.warnungen.length }
    }).filter((x): x is NonNullable<typeof x> => x !== null)
  }

  const zaehler = (k: Status) => (k === 'alle' ? basisListe.length : basisListe.filter(w => w.status === k).length)
  const laeuft = (w: FerienWunsch, aktion: Aktion) => laufend === aktionKey(w.employeeId, w.from, aktion)
  const knopfText = (w: FerienWunsch, aktion: Aktion, text: string) => (laeuft(w, aktion) ? LAUFEND[aktion] : text)

  /** Status einer Woche oder eines Wunsches; akzeptiert mit den Tagen im Arbeitsplan */
  const StatusChip = ({ w, days }: { w: FerienWunsch; days: number }) => {
    if (w.status === 'akzeptiert') {
      const p = imPlan(w)
      const text = p.drin === 0
        ? (aktualisiert || isPending || laufend ? 'wird im Arbeitsplan eingetragen …' : 'nicht im Arbeitsplan')
        : p.drin < p.total ? `${p.drin} von ${p.total} Tagen im Arbeitsplan als ${p.code}` : `im Arbeitsplan, ${p.total} ${p.total === 1 ? 'Tag' : 'Tage'} ${p.code}`
      const warnung = p.drin < p.total && !(p.drin === 0 && (aktualisiert || isPending || laufend))
      return (
        <span className="inline-flex flex-col items-end">
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-1 rounded-full bg-mint-bg text-mint-ink">✓ Akzeptiert</span>
          <span className={`text-[10px] mt-0.5 tnum ${warnung ? 'text-blush-ink font-semibold' : 'text-ink-4'}`}>{warnung ? '⚠ ' : ''}{text}</span>
          {w.vertretung && (
            <span className="text-[10px] font-semibold text-mint-ink mt-0.5 text-right" title={`Ferienvertretung: ${w.vertretung}${w.vertretungTage ? ` — ${tageText(w.vertretungTage)}` : ''}`}>
              Vertretung {w.vertretung}{w.vertretungTage && w.vertretungTage.length < days ? ` (${w.vertretungTage.length} von ${days} Tagen)` : ''}
            </span>
          )}
        </span>
      )
    }
    if (w.status === 'abgelehnt') return <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-1 rounded-full bg-blush-bg text-blush-ink" title={w.grund ?? undefined}>✕ Abgelehnt{w.grund ? ` · ${w.grund.length > 30 ? `${w.grund.slice(0, 30)}…` : w.grund}` : ''}</span>
    return <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-1 rounded-full bg-apricot-bg text-apricot-ink">Offen</span>
  }
  const Entschieden = ({ w }: { w: FerienWunsch }) => (w.decidedAt ? <span className="text-[10px] text-ink-4 tnum">{w.status === 'akzeptiert' ? 'akzeptiert' : w.status === 'abgelehnt' ? 'abgelehnt' : 'entschieden'} {fmtTs(w.decidedAt)}{w.decidedBy ? ` von ${w.decidedBy}` : ''}</span> : null)
  const Fehler = ({ w }: { w: FerienWunsch }) => (fehlerBei && fehlerBei.key === `${w.employeeId}_${w.from}` ? <p className="basis-full text-[11px] font-semibold text-blush-ink">⚠ {fehlerBei.text}</p> : null)

  /** Knöpfe eines einzelnen Wunsches oder einer aufgeteilten Woche */
  const Aktionen = ({ w, ganz }: { w: FerienWunsch; ganz: boolean }) => (
    <div className="flex items-center gap-1.5">
      {w.status !== 'akzeptiert' && <button onClick={() => onAkzeptieren(w)} disabled={gesperrt} className={KNOPF.primaer}>{knopfText(w, 'akzeptieren', ganz && w.status === 'offen' && mehrereWochen(w) ? 'Alle Wochen akzeptieren' : 'Akzeptieren')}</button>}
      {w.status === 'offen' && <button onClick={() => onAblehnen(w)} disabled={gesperrt} className={KNOPF.ablehnen} title="Ablehnen, mit Grund">{knopfText(w, 'ablehnen', ganz && mehrereWochen(w) ? 'Alle ablehnen' : 'Ablehnen')}</button>}
      {w.status !== 'offen' && <button onClick={() => onZuruecknehmen(w)} disabled={gesperrt} className={KNOPF.neutral} title={w.status === 'akzeptiert' ? 'Akzeptierte Anmeldung zurücknehmen (Tage aus dem Arbeitsplan entfernen)' : 'Ablehnung aufheben'}>{knopfText(w, 'zuruecknehmen', 'Zurücknehmen')}</button>}
      <button onClick={() => onBearbeiten(w)} disabled={gesperrt} className={KNOPF.icon} title="Bearbeiten / verlängern"><Stift /></button>
      <button onClick={() => onLoeschen(w)} disabled={gesperrt} className={KNOPF.iconRot} title={laeuft(w, 'loeschen') ? LAUFEND.loeschen : 'Löschen'}><Kreuz /></button>
    </div>
  )

  return (
    <div className="card overflow-hidden">
      <div className={`flex flex-wrap items-center justify-between gap-3 px-6 py-4 ${eingeklappt ? '' : 'border-b border-edge-soft'}`}>
        <button type="button" onClick={onToggle} disabled={!onToggle} className="flex items-start gap-2 text-left min-w-0 flex-1 disabled:cursor-default" aria-expanded={!eingeklappt} title={onToggle ? (eingeklappt ? 'Aufklappen' : 'Zuklappen') : undefined}>
          {onToggle && <svg className={`w-4 h-4 mt-0.5 text-ink-4 transition-transform flex-shrink-0 ${eingeklappt ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>}
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink">{titel ?? `Anfragen ${PLAN_YEAR}`} <span className="font-normal text-ink-4 tnum">· {zaehler('offen')} offen, {zaehler('akzeptiert')} akzeptiert, {zaehler('abgelehnt')} abgelehnt</span></span>
            {!eingeklappt && <span className="block text-[11.5px] text-ink-4 mt-0.5">{untertitel ?? 'Pro Person, die neueste Anfrage zuoberst. Aufklappen zeigt alle Anfragen der Person mit Farbe der Woche und Belegung ihrer Kategorie (gezählt werden nur akzeptierte Anmeldungen, offene Anmeldungen anderer stehen separat dabei). Anfragen über mehrere Wochen zeigen jede Woche einzeln mit eigenem Status. Akzeptierte Einträge stehen im Arbeitsplan als «F», «UF» oder «WB».'}</span>}
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          {!eingeklappt && (
            <>
              {(['alle', 'offen', 'akzeptiert', 'abgelehnt'] as const).map(k => (
                <button key={k} onClick={() => setStatus(k)} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${status === k ? 'bg-dusk text-white border-dusk' : 'bg-white text-ink-2 border-edge-ctl'}`}>
                  {k === 'alle' ? 'Alle' : k === 'offen' ? 'Offen' : k === 'akzeptiert' ? 'Akzeptiert' : 'Abgelehnt'} <span className="tnum opacity-80">{zaehler(k)}</span>
                </button>
              ))}
              {!nur && (
                <>
                  <span className="w-px h-5 bg-edge-ctl mx-1" />
                  {(['alle', 'woche', 'wunsch'] as const).map(k => (
                    <button key={k} onClick={() => setTyp(k)} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${typ === k ? 'bg-dusk text-white border-dusk' : 'bg-white text-ink-2 border-edge-ctl'}`}>
                      {k === 'alle' ? 'Beide Typen' : k === 'woche' ? 'Wochen' : 'Wünsche'}
                    </button>
                  ))}
                </>
              )}
            </>
          )}
          <button onClick={onNeu} className="btn-primary !px-3.5 !py-2 !text-xs ml-1">＋ Wunsch erfassen</button>
        </div>
      </div>
      {!eingeklappt && (<>
      {hinweis && (
        <p className={`mx-6 my-3 text-xs px-3 py-2 rounded-ctl inline-block ${hinweis.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>
          {hinweis.type === 'ok' ? '✓ ' : '⚠ '}{hinweis.text}
        </p>
      )}

      {personen.length === 0 ? <p className="text-sm text-ink-4 py-10 text-center">{basisListe.length === 0 ? (nur === 'wunsch' ? 'Noch keine Wünsche.' : 'Noch keine Anfragen.') : 'Keine Anfragen mit diesen Filtern.'}</p> : (
        <ul className="divide-y divide-edge-row">
          {personen.map(({ e, liste, neueste }) => {
            const auf = offen.has(e.id)
            const kat = kategorieFuer(e.job_title)
            const n = (s: FerienWunsch['status']) => liste.filter(w => w.status === s).length
            const eintraege = auf ? eintraegeVon(liste) : []
            return (
              <li key={e.id}>
                <button onClick={() => toggle(e.id)} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-3 text-left hover:bg-hovrow" aria-expanded={auf}>
                  <div className="w-[26px] h-[26px] rounded-full bg-dune flex items-center justify-center flex-shrink-0"><span className="text-ink-2 text-[9.5px] font-bold">{initials(e.full_name)}</span></div>
                  <span className="text-[13.5px] font-semibold text-ink min-w-[160px]">{e.full_name}</span>
                  <span className="text-[11px] text-ink-4">{e.job_title ?? ''}{kat ? ` · ${KATEGORIE_LABEL[kat]}` : ''}</span>
                  <span className="flex items-center gap-1.5 ml-auto">
                    {liste.length === 0 ? <span className="text-[10.5px] text-ink-5">Noch keine Anfragen</span> : (
                      <>
                        {n('offen') > 0 && <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-apricot-bg text-apricot-ink tnum">{n('offen')} offen</span>}
                        {n('akzeptiert') > 0 && <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-mint-bg text-mint-ink tnum">{n('akzeptiert')} akzeptiert</span>}
                        {n('abgelehnt') > 0 && <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-blush-bg text-blush-ink tnum">{n('abgelehnt')} abgelehnt</span>}
                        <span className="text-[10.5px] text-ink-4 tnum">zuletzt {fmtTs(neueste)}</span>
                      </>
                    )}
                    <Pfeil auf={auf} />
                  </span>
                </button>
                {auf && eintraege.length > 0 && (
                  <ul className="divide-y divide-edge-row border-t border-edge-row bg-surface/50">
                    {eintraege.map(eintrag => {
                      if (eintrag.typ === 'einzeln') {
                        const w = eintrag.w
                        const woche = w.quelle === 'woche' ? planByMontag.get(w.from) : undefined
                        const tage = w.art === 'ferien' ? wunschKosten(w, woche, e.pensum) : weekdaysBetween(w.from, w.to).length
                        const days = weekdaysBetween(w.from, w.to).length
                        const gewaehlt = w.tage && w.tage.length > 0 && w.tage.length < days ? w.tage : null
                        const infos = wochenInfo(w, kat)
                        return (
                          <li key={`${w.employeeId}_${w.from}`} className="px-6 py-3 pl-[62px] flex flex-wrap items-start gap-x-5 gap-y-2 text-[13px]">
                            <div className="min-w-[230px] flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${w.quelle === 'woche' ? 'bg-steel-bg text-steel-ink' : 'bg-edge-row text-ink-3'}`}>{w.quelle === 'woche' ? `Woche KW ${w.kw ?? ''}` : 'Wunsch'}</span>
                                <span className="text-[10px] font-semibold text-ink-3 tnum">{kwBereich(w.from, w.to)}</span>
                                <span className="tnum font-semibold text-ink">{fmtD(w.from)} – {fmtD(w.to)}</span>
                                {w.art !== 'ferien' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-lilac-bg text-lilac-ink whitespace-nowrap">{wunschArtLabel(w.art)}</span>}
                                {w.quelle !== 'woche' && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${w.prio === 1 ? 'bg-blush-bg text-blush-ink' : w.prio === 2 ? 'bg-apricot-bg text-apricot-ink' : 'bg-edge-row text-ink-3'}`}>Prio {w.prio ?? 3}</span>}
                                {w.quelle !== 'woche' && kat && infos.some(i => i.vollDurchAndere) && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-blush-bg text-blush-ink" title={`Die Woche ist für ${KATEGORIE_LABEL[kat]} durch andere Anmeldungen schon voll, darum ging nur ein Wunsch`}>Woche für {KATEGORIE_LABEL[kat]} voll</span>}
                                <span className="text-[11px] text-ink-3 tnum" title={`${days} Werktage`}>{pz(tage)} {tage === 1 ? 'Tag' : 'Tage'}</span>
                              </div>
                              {gewaehlt && <p className="text-[10.5px] text-ink-3 mt-0.5 tnum" title="Gewählte Ferientage">Tage {gewaehlt.map(tagKurz).join(', ')}</p>}
                              {w.bemerkung && <p className="text-[11.5px] text-ink-2 mt-0.5 whitespace-pre-wrap break-words">«{w.bemerkung}»</p>}
                              <p className="text-[10.5px] text-ink-4 tnum mt-0.5">Eingang {fmtTs(w.createdAt)}{w.decidedAt ? <> · <Entschieden w={w} /></> : null}</p>
                            </div>
                            <div className="min-w-[220px] space-y-1">
                              {infos.length === 0 && <span className="text-[11px] text-ink-5">ausserhalb der Planung {PLAN_YEAR}</span>}
                              {infos.map(i => (
                                <div key={i.kw} className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
                                  <span className="w-3 h-3 rounded-full border flex-shrink-0" style={{ background: FARBEN[i.farbe].bg, borderColor: FARBEN[i.farbe].fg }} />
                                  <span className="font-semibold tnum" style={{ color: FARBEN[i.farbe].fg }}>KW {i.kw} {FARBEN[i.farbe].label}</span>
                                  <span className="text-ink-4">{i.titel}</span>
                                  {i.belegung && <span className={`tnum ${i.voll ? 'text-blush-ink font-semibold' : 'text-ink-2'}`}>{i.belegung}</span>}
                                  {i.warnungen > 0 && <span className="text-[10px] font-semibold text-blush-ink" title="Warnungen in der Wochenübersicht">⚠ {i.warnungen}</span>}
                                </div>
                              ))}
                            </div>
                            <div className="flex flex-col items-end gap-1.5 ml-auto">
                              <StatusChip w={w} days={days} />
                              <Aktionen w={w} ganz />
                            </div>
                            <Fehler w={w} />
                          </li>
                        )
                      }

                      // Block einer Anfrage über mehrere Wochen: Kopf mit dem ganzen Zeitraum, dann eine Zeile pro Woche
                      const { basis, teile, virtuell } = eintrag
                      const erste = teile[0], letzte = teile[teile.length - 1]
                      const total = teile.reduce((s, t) => s + (t.art === 'ferien' ? wunschKosten(t, planByMontag.get(montagVon(t.from)), e.pensum) : weekdaysBetween(t.from, t.to).length), 0)
                      const z = (s: FerienWunsch['status']) => teile.filter(t => t.status === s).length
                      return (
                        <li key={eintrag.key} className="px-6 py-3 pl-[62px] text-[13px]">
                          <div className="flex flex-wrap items-start gap-x-5 gap-y-2">
                            <div className="min-w-[230px] flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${basis.quelle === 'woche' ? 'bg-steel-bg text-steel-ink' : 'bg-edge-row text-ink-3'}`}>{basis.quelle === 'woche' ? 'Doppelwoche' : `Wunsch · ${teile.length} Wochen`}</span>
                                <span className="text-[10px] font-semibold text-ink-3 tnum">{kwBereich(erste.from, letzte.to)}</span>
                                <span className="tnum font-semibold text-ink">{fmtD(erste.from)} – {fmtD(letzte.to)}</span>
                                {basis.art !== 'ferien' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-lilac-bg text-lilac-ink whitespace-nowrap">{wunschArtLabel(basis.art)}</span>}
                                {basis.quelle !== 'woche' && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${basis.prio === 1 ? 'bg-blush-bg text-blush-ink' : basis.prio === 2 ? 'bg-apricot-bg text-apricot-ink' : 'bg-edge-row text-ink-3'}`}>Prio {basis.prio ?? 3}</span>}
                                <span className="text-[11px] text-ink-3 tnum">{pz(total)} Tage gesamt</span>
                              </div>
                              {basis.bemerkung && <p className="text-[11.5px] text-ink-2 mt-0.5 whitespace-pre-wrap break-words">«{basis.bemerkung}»</p>}
                              <p className="text-[10.5px] text-ink-4 tnum mt-0.5">Eingang {fmtTs(basis.createdAt)}</p>
                            </div>
                            <div className="flex flex-col items-end gap-1.5 ml-auto">
                              <div className="flex items-center gap-1">
                                {z('akzeptiert') > 0 && <span className="text-[10.5px] font-semibold px-2 py-1 rounded-full bg-mint-bg text-mint-ink tnum">✓ {z('akzeptiert')} {z('akzeptiert') === 1 ? 'Woche' : 'Wochen'} akzeptiert</span>}
                                {z('abgelehnt') > 0 && <span className="text-[10.5px] font-semibold px-2 py-1 rounded-full bg-blush-bg text-blush-ink tnum">✕ {z('abgelehnt')} abgelehnt</span>}
                                {z('offen') > 0 && <span className="text-[10.5px] font-semibold px-2 py-1 rounded-full bg-apricot-bg text-apricot-ink tnum">{z('offen')} offen</span>}
                              </div>
                              {virtuell && <Aktionen w={basis} ganz />}
                            </div>
                          </div>
                          <div className="mt-2 rounded-xl border border-edge-soft bg-white overflow-hidden">
                            <ul className="divide-y divide-edge-row">
                              {teile.map((t, idx) => {
                                const days = weekdaysBetween(t.from, t.to).length
                                const n = t.art === 'ferien' ? wunschKosten(t, planByMontag.get(montagVon(t.from)), e.pensum) : days
                                const gewaehlt = t.tage && t.tage.length > 0 && t.tage.length < days ? t.tage : null
                                const infosTeil = wochenInfo(t, kat)
                                const teil: Teil = { from: t.from, to: t.to, tage: t.tage ?? wochenTeile(t.from, t.to)[0]?.tage ?? [] }
                                return (
                                  <li key={t.from} className={`px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] ${t.status === 'akzeptiert' ? 'bg-mint-bg/30' : t.status === 'abgelehnt' ? 'bg-blush-bg/30' : ''}`}>
                                    <span className="min-w-[230px] tnum">
                                      <span className="text-[10px] font-semibold text-ink-4 mr-1.5">Woche {idx + 1} von {teile.length}</span>
                                      <span className="font-semibold text-ink">KW {isoKw(t.from)}</span> <span className="text-ink-2">{fmtD(t.from)} – {fmtD(t.to)}</span> <span className="text-ink-4">· {pz(n)} {n === 1 ? 'Tag' : 'Tage'}</span>
                                      {gewaehlt && <span className="block text-[10.5px] text-ink-3" title="Gewählte Ferientage">Tage {gewaehlt.map(tagKurz).join(', ')}</span>}
                                    </span>
                                    <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] flex-1 min-w-[200px]">
                                      {infosTeil.map(i => (
                                        <span key={i.kw} className="inline-flex items-center gap-1.5">
                                          <span className="w-3 h-3 rounded-full border flex-shrink-0" style={{ background: FARBEN[i.farbe].bg, borderColor: FARBEN[i.farbe].fg }} />
                                          <span className="font-semibold" style={{ color: FARBEN[i.farbe].fg }}>{FARBEN[i.farbe].label}</span>
                                          {i.belegung && <span className={`tnum ${i.voll ? 'text-blush-ink font-semibold' : 'text-ink-2'}`}>{i.belegung}</span>}
                                          {basis.quelle !== 'woche' && kat && i.vollDurchAndere && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blush-bg text-blush-ink" title="Durch andere Anmeldungen schon voll">Woche voll</span>}
                                          {i.warnungen > 0 && <span className="text-[10px] font-semibold text-blush-ink" title="Warnungen in der Wochenübersicht">⚠ {i.warnungen}</span>}
                                        </span>
                                      ))}
                                      {infosTeil.length === 0 && <span className="text-ink-5">ausserhalb der Planung {PLAN_YEAR}</span>}
                                    </span>
                                    <span className="flex flex-col items-end gap-1 ml-auto">
                                      <span className="flex items-center gap-2">
                                        <StatusChip w={t} days={days} />
                                        {virtuell ? (
                                          <span className="flex items-center gap-1.5">
                                            <button onClick={() => onTeil(basis, teil, 'akzeptieren')} disabled={gesperrt} className={KNOPF.primaer}>{knopfText(t, 'akzeptieren', 'Akzeptieren')}</button>
                                            <button onClick={() => onTeil(basis, teil, 'ablehnen')} disabled={gesperrt} className={KNOPF.ablehnen} title="Diese Woche ablehnen, mit Grund">{knopfText(t, 'ablehnen', 'Ablehnen')}</button>
                                          </span>
                                        ) : <Aktionen w={t} ganz={false} />}
                                      </span>
                                      <Entschieden w={t} />
                                    </span>
                                    <Fehler w={t} />
                                  </li>
                                )
                              })}
                            </ul>
                            {virtuell && <p className="px-3 py-1.5 text-[10.5px] text-ink-4 border-t border-edge-row">Beim Entscheiden einer Woche wird der Wunsch in Wochen aufgeteilt, die übrigen Wochen bleiben offen.</p>}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
      </>)}
    </div>
  )
}
