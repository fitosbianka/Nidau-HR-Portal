'use client'

// Verfügbarkeit pro Monat: Tage antippen, an denen die Person arbeiten
// könnte, optional eine Notiz. Für die Person selbst unter ihrem
// Arbeitsplan, für Admins als Liste unter dem Admin Arbeitsplan (dort auch
// bearbeitbar, falls die Angaben telefonisch kommen).
// Daneben der Stand pro Tag, für beide Seiten immer aktuell: eingeplant
// (steht im Arbeitsplan), angenommen oder abgelehnt (Entscheidung der
// Admins), angefragt (Einsatzanfrage mit Antwort der Person) oder offen.
// Darunter die Einsatzanfragen: Admins tragen Tag und Position ein, die
// Person sagt pro Tag zu oder ab (jederzeit änderbar), die Liste zeigt
// beiden Seiten immer die aktuelle Antwort.
// Sichtbarkeit: nur Admins (Admin-Arbeitsplan) und die Person selbst
// (ihr Arbeitsplan, Prüfung istVerfuegbarkeitPerson); keine anderen
// Mitarbeitenden, auch keine Leitenden. Der PDF-Export des Arbeitsplans
// enthält den Abschnitt nicht, beim Drucken der Seite ist er ausgeblendet.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { verfuegbarkeitSpeichern, einsatzAnfrageHinzufuegen, einsatzAnfrageEntfernen, einsatzAnfrageEntscheiden, einsatzAnfragenAusPlan, einsatzAnfrageAendern, verfuegbarkeitEntscheiden, verfuegbarkeitOffeneAblehnen } from '@/actions/verfuegbarkeit'
import {
  MONATSNAMEN, tageImMonat, wochentag, istWochenende, tagKurz, POSITIONEN, SCHICHTEN, positionText, positionZerlegen, planPositionAnfragbar,
  tagesStand, offeneTage, standZaehler,
  type Verfuegbarkeit, type EinsatzAnfrage, type AnfrageStatus, type Entscheidungen, type Entscheidung, type TagStand,
} from '@/lib/verfuegbarkeit'

const KOPF = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

const fmtDatum = (iso: string) => new Date(iso).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })

const STATUS_CHIP: Record<AnfrageStatus, { text: string; cls: string }> = {
  offen:    { text: 'offen',    cls: 'bg-edge-row text-ink-3' },
  zugesagt: { text: 'zugesagt', cls: 'bg-mint-bg text-mint-ink' },
  abgesagt: { text: 'abgesagt', cls: 'bg-blush-bg text-blush-ink' },
}
const STAND_CHIP: Record<TagStand['art'], { text: string; cls: string }> = {
  eingeplant: { text: 'eingeplant', cls: 'bg-mint-mid text-white' },
  angenommen: { text: 'angenommen', cls: 'bg-mint-bg text-mint-ink' },
  angefragt:  { text: 'angefragt',  cls: 'bg-apricot-bg text-apricot-ink' },
  abgelehnt:  { text: 'abgelehnt',  cls: 'bg-blush-bg text-blush-ink' },
  offen:      { text: 'offen',      cls: 'bg-edge-row text-ink-3' },
}
// feste Vorgabewerte, damit der Abgleich mit den Props nicht bei jedem Rendern neu anstösst
const KEINE_ANFRAGEN: EinsatzAnfrage[] = []
const KEINE_ENTSCHEIDUNGEN: Entscheidungen = {}
const KEINE_EINTRAEGE: Array<{ datum: string; position: string }> = []

export default function VerfuegbarkeitClient({ profileId, name, year, month, initial, eigene, anfragen = KEINE_ANFRAGEN, planEintraege = KEINE_EINTRAEGE, entscheidungen = KEINE_ENTSCHEIDUNGEN, planSichtbar = !eigene }: {
  profileId: string; name: string; year: number; month: number; initial: Verfuegbarkeit; eigene: boolean
  /** Einsatzanfragen der Admins für diesen Monat */
  anfragen?: EinsatzAnfrage[]
  /** Einträge der Person im Arbeitsplan dieses Monats: bei Admins zum Übernehmen und zum Abgleich, bei der Person ihre eigenen Einträge für den Stand pro Tag */
  planEintraege?: Array<{ datum: string; position: string }>
  /** Rückmeldung der Admins pro Tag (angenommen, abgelehnt) */
  entscheidungen?: Entscheidungen
  /** Darf die Person die Positionen sehen (Monat veröffentlicht oder vergangen)? Admins immer. */
  planSichtbar?: boolean
}) {
  const router = useRouter()
  const [tage, setTage] = useState<Set<string>>(() => new Set(initial.tage))
  const [notiz, setNotiz] = useState(initial.notiz)
  const [gespeichert, setGespeichert] = useState<{ tage: string[]; notiz: string }>({ tage: initial.tage, notiz: initial.notiz })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Einsatzanfragen: die Actions geben die frische Liste zurück
  const [liste, setListe] = useState<EinsatzAnfrage[]>(anfragen)
  const [aBusy, setABusy] = useState<string | null>(null)     // Anfrage-id oder 'neu'
  const [aMsg, setAMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [neuDatum, setNeuDatum] = useState('')
  const [neuPos, setNeuPos] = useState('✓')
  const [neuSchicht, setNeuSchicht] = useState<'' | 'f' | 't' | 's' | 'h'>('')
  const [neuZeit, setNeuZeit] = useState('')
  type Schicht = '' | 'f' | 't' | 's' | 'h'
  // Admin: Anfrage bearbeiten (Tag, Position, Zeit)
  const [bearbeiten, setBearbeiten] = useState<{ a: EinsatzAnfrage; datum: string; basis: string; schicht: Schicht; zeit: string; zuruecksetzen: boolean } | null>(null)
  const [bearbeitenErr, setBearbeitenErr] = useState<string | null>(null)
  // Person: Antwort mit Bemerkung (oder nur die Bemerkung ändern)
  const [antwort, setAntwort] = useState<{ a: EinsatzAnfrage; status: AnfrageStatus; bemerkung: string; nurBemerkung: boolean } | null>(null)
  const [antwortErr, setAntwortErr] = useState<string | null>(null)
  // Anfragen entstehen auch aus dem Arbeitsplan (Knopf in der Zelle): nach
  // router.refresh() kommt die Liste frisch vom Server
  useEffect(() => { setListe(anfragen) }, [anfragen])
  // Rückmeldung pro Tag (Admins): die Actions geben den frischen Stand zurück
  const [entsch, setEntsch] = useState<Entscheidungen>(entscheidungen)
  const [tBusy, setTBusy] = useState<string | null>(null)       // Datum oder 'alle'
  const [tMsg, setTMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  useEffect(() => { setEntsch(entscheidungen) }, [entscheidungen])

  const alle = tageImMonat(year, month)
  // Plan-Abgleich (Admins): Position im Arbeitsplan pro Tag, und wie viele
  // Plan-Einträge sich noch als Anfrage übernehmen lassen
  const planByDatum = new Map(planEintraege.map(e => [e.datum, e.position.split('|')[0].trim()]))
  const uebernehmbar = planEintraege.filter(e => planPositionAnfragbar(e.position.split('|')[0].trim()) && !liste.some(a => a.datum === e.datum)).length
  const gewaehlt = alle.filter(t => tage.has(t))
  const geaendert = gewaehlt.join(',') !== gespeichert.tage.join(',') || notiz.trim() !== gespeichert.notiz
  const vorname = name.split(' ')[0]
  // Leerfelder vor dem 1. (Montag = 0)
  const offset = (wochentag(alle[0]) + 6) % 7
  const verfuegbar = new Set(gespeichert.tage)

  const toggle = (t: string) => { setMsg(null); setTage(s => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n }) }

  // Stand pro Tag: gespeicherte Verfügbarkeit, Arbeitsplan, Anfragen und Entscheidungen zusammengeführt
  const zeilen = tagesStand({ verfuegbar: gespeichert.tage, planEintraege, planSichtbar, anfragen: liste, entscheidungen: entsch, year, month })
  const zaehlerTage = standZaehler(zeilen)
  const offen = offeneTage(zeilen)

  type TagAntwort = { error?: string; entscheidungen?: Entscheidungen; anzahl?: number }
  async function tagAktion(key: string, fn: () => Promise<TagAntwort>, okText: string | ((r: TagAntwort) => string)) {
    setTBusy(key); setTMsg(null)
    try {
      let r: TagAntwort
      try { r = await fn() } catch { r = { error: 'Netzwerkfehler — bitte erneut versuchen.' } }
      if (r.error) { setTMsg({ type: 'err', text: r.error }); return }
      if (r.entscheidungen) setEntsch(r.entscheidungen)
      const text = typeof okText === 'function' ? okText(r) : okText
      if (text) setTMsg({ type: 'ok', text })
      router.refresh()
    } finally { setTBusy(null) }
  }
  function tagEntscheiden(datum: string, status: Entscheidung | 'offen') {
    void tagAktion(datum, () => verfuegbarkeitEntscheiden(profileId, year, month, datum, status),
      status === 'angenommen' ? `${tagKurz(datum)} angenommen.` : status === 'abgelehnt' ? `${tagKurz(datum)} abgelehnt.` : `${tagKurz(datum)} wieder offen.`)
  }
  function uebrigeAblehnen() {
    const n = offen.length
    if (n === 0) return
    if (!confirm(`${n} offene${n === 1 ? 'n' : ''} Tag${n === 1 ? '' : 'e'} ablehnen?\n${vorname} sieht diese Tage dann als abgelehnt. Eingeplante, angefragte und schon beantwortete Tage bleiben unverändert.`)) return
    void tagAktion('alle', () => verfuegbarkeitOffeneAblehnen(profileId, year, month),
      r => r.anzahl ? `${r.anzahl} Tag${r.anzahl === 1 ? '' : 'e'} abgelehnt.` : 'Nichts zu entscheiden.')
  }

  async function speichern() {
    setBusy(true); setMsg(null)
    try {
      const r = await verfuegbarkeitSpeichern(profileId, year, month, gewaehlt, notiz)
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      setGespeichert({ tage: gewaehlt, notiz: notiz.trim() })
      setMsg({ type: 'ok', text: 'Gespeichert.' })
      router.refresh()
    } finally { setBusy(false) }
  }

  // ── Einsatzanfragen ──
  type Antwort = { error?: string; anfragen?: EinsatzAnfrage[]; neu?: number }
  async function anfrageAktion(key: string, fn: () => Promise<Antwort>, okText: string | ((r: Antwort) => string)) {
    setABusy(key); setAMsg(null)
    try {
      let r: Antwort
      try { r = await fn() } catch { r = { error: 'Netzwerkfehler — bitte erneut versuchen.' } }
      if (r.error) { setAMsg({ type: 'err', text: r.error }); return false }
      if (r.anfragen) setListe(r.anfragen)
      const text = typeof okText === 'function' ? okText(r) : okText
      if (text) setAMsg({ type: 'ok', text })
      router.refresh()
      return true
    } finally { setABusy(null) }
  }
  function ausPlanUebernehmen() {
    if (uebernehmbar === 0) return
    if (!confirm(`${uebernehmbar} Einsatz${uebernehmbar === 1 ? '' : 'e'} aus dem Arbeitsplan ${MONATSNAMEN[month - 1]} ${year} als Anfrage${uebernehmbar === 1 ? '' : 'n'} übernehmen?\nTage, die schon eine Anfrage haben, bleiben unverändert.`)) return
    void anfrageAktion('plan', () => einsatzAnfragenAusPlan(profileId, year, month),
      r => r.neu ? `${r.neu} Einsatz${r.neu === 1 ? '' : 'e'} aus dem Arbeitsplan übernommen.` : 'Nichts zu übernehmen.')
  }
  async function hinzufuegen() {
    if (!neuDatum) { setAMsg({ type: 'err', text: 'Bitte einen Tag wählen.' }); return }
    const position = neuPos === '✓' ? '✓' : `${neuPos}${neuSchicht}`
    const ok = await anfrageAktion('neu', () => einsatzAnfrageHinzufuegen(profileId, year, month, { datum: neuDatum, position, zeit: neuZeit }), 'Angefragt.')
    if (ok) { setNeuDatum(''); setNeuZeit('') }
  }
  function entfernen(a: EinsatzAnfrage) {
    if (!confirm(`Anfrage ${tagKurz(a.datum)} (${positionText(a.position)}) entfernen?`)) return
    void anfrageAktion(a.id, () => einsatzAnfrageEntfernen(profileId, year, month, a.id), 'Anfrage entfernt.')
  }
  function entscheiden(a: EinsatzAnfrage, status: AnfrageStatus) {
    // die Person antwortet mit optionaler Bemerkung; Admins (telefonisch) direkt
    if (eigene) { setAMsg(null); setAntwortErr(null); setAntwort({ a, status, bemerkung: a.bemerkung, nurBemerkung: false }); return }
    void anfrageAktion(a.id, () => einsatzAnfrageEntscheiden(profileId, year, month, a.id, status),
      status === 'zugesagt' ? `${tagKurz(a.datum)} zugesagt.` : status === 'abgesagt' ? `${tagKurz(a.datum)} abgesagt.` : '')
  }
  async function direkt(fn: () => Promise<Antwort>): Promise<Antwort> {
    try { return await fn() } catch { return { error: 'Netzwerkfehler — bitte erneut versuchen.' } }
  }
  async function antwortSenden() {
    const m = antwort
    if (!m) return
    setAntwortErr(null); setABusy(m.a.id)
    try {
      const r = await direkt(() => einsatzAnfrageEntscheiden(profileId, year, month, m.a.id, m.status, m.bemerkung))
      if (r.error) { setAntwortErr(r.error); return }
      if (r.anfragen) setListe(r.anfragen)
      setAntwort(null)
      setAMsg({ type: 'ok', text: m.nurBemerkung ? 'Bemerkung gespeichert.' : m.status === 'zugesagt' ? `${tagKurz(m.a.datum)} zugesagt.` : `${tagKurz(m.a.datum)} abgesagt.` })
      router.refresh()
    } finally { setABusy(null) }
  }
  function bearbeitenOeffnen(a: EinsatzAnfrage) {
    setBearbeitenErr(null)
    setBearbeiten({ a, datum: a.datum, ...positionZerlegen(a.position), zeit: a.zeit, zuruecksetzen: a.status !== 'offen' })
  }
  async function bearbeitenSpeichern() {
    const b = bearbeiten
    if (!b) return
    setBearbeitenErr(null); setABusy(b.a.id)
    try {
      const position = b.basis === '✓' ? '✓' : `${b.basis}${b.schicht}`
      const r = await direkt(() => einsatzAnfrageAendern(profileId, year, month, b.a.id, { datum: b.datum, position, zeit: b.zeit, antwortZuruecksetzen: b.zuruecksetzen }))
      if (r.error) { setBearbeitenErr(r.error); return }
      if (r.anfragen) setListe(r.anfragen)
      setBearbeiten(null)
      setAMsg({ type: 'ok', text: 'Anfrage geändert.' })
      router.refresh()
    } finally { setABusy(null) }
  }

  const zaehler = {
    zugesagt: liste.filter(a => a.status === 'zugesagt').length,
    abgesagt: liste.filter(a => a.status === 'abgesagt').length,
    offen: liste.filter(a => a.status === 'offen').length,
  }

  return (
    <div className="card p-4 sm:p-5 print:hidden">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <p className="text-sm font-semibold text-ink">
            {eigene ? 'Meine Verfügbarkeit' : `Verfügbarkeit ${vorname}`} <span className="text-ink-4 font-normal">· {MONATSNAMEN[month - 1]} {year}</span>
          </p>
          <p className="text-[11px] text-ink-4 mt-0.5">
            {eigene
              ? 'Tippe die Tage an, an denen du arbeiten könntest. Bianka sieht die Liste und plant dich danach ein.'
              : `Tage, an denen ${vorname} arbeiten könnte. Nur für Admins sichtbar, du kannst sie hier auch selbst anpassen.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {geaendert && <span className="text-[11px] text-apricot-ink">Noch nicht gespeichert</span>}
          <button onClick={speichern} disabled={!geaendert || busy} className="btn-primary text-xs">{busy ? 'Speichert…' : 'Speichern'}</button>
        </div>
      </div>

      {msg && (
        <p className={`text-xs px-3 py-1.5 rounded-ctl inline-block mb-3 ${msg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>
          {msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-5">
        {/* Monatskalender zum Antippen */}
        <div className="w-full max-w-[340px]">
          <div className="grid grid-cols-7 gap-1 mb-1">
            {KOPF.map(k => <div key={k} className="text-center text-[10px] font-semibold uppercase tracking-wider text-ink-4">{k}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: offset }).map((_, i) => <div key={`l${i}`} />)}
            {alle.map(t => {
              const an = tage.has(t)
              const we = istWochenende(t)
              return (
                <button key={t} type="button" onClick={() => toggle(t)} aria-pressed={an}
                  title={`${tagKurz(t)} ${an ? 'verfügbar' : 'nicht verfügbar'}`}
                  className={`h-10 rounded-lg text-sm font-semibold tnum transition-colors border ${
                    an ? 'bg-mint-mid border-mint-mid text-white' : we ? 'bg-surface border-edge-soft text-ink-4 hover:border-mint-mid' : 'bg-white border-edge-soft text-ink-2 hover:border-mint-mid'
                  }`}>
                  {Number(t.slice(8, 10))}
                </button>
              )
            })}
          </div>
          <div className="flex gap-3 mt-2 text-[11px]">
            <button type="button" onClick={() => { setMsg(null); setTage(new Set(alle.filter(t => !istWochenende(t)))) }} className="text-mint-ink hover:underline">Alle Werktage</button>
            <button type="button" onClick={() => { setMsg(null); setTage(new Set()) }} className="text-ink-4 hover:underline">Leeren</button>
            <span className="ml-auto text-ink-4 tnum">{gewaehlt.length} Tag{gewaehlt.length !== 1 ? 'e' : ''}</span>
          </div>
        </div>

        {/* Stand pro Tag und Notiz */}
        <div className="min-w-0 space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">{eigene ? 'Stand deiner Tage' : `Tage von ${vorname}`}</p>
              {zeilen.length > 0 && (
                <p className="text-[11px] tnum flex flex-wrap gap-x-2">
                  {zaehlerTage.eingeplant > 0 && <span className="text-mint-ink font-semibold">{zaehlerTage.eingeplant} eingeplant</span>}
                  {zaehlerTage.angenommen > 0 && <span className="text-mint-ink font-semibold">{zaehlerTage.angenommen} angenommen</span>}
                  {zaehlerTage.angefragt > 0 && <span className="text-apricot-ink font-semibold">{zaehlerTage.angefragt} angefragt</span>}
                  {zaehlerTage.abgelehnt > 0 && <span className="text-blush-ink font-semibold">{zaehlerTage.abgelehnt} abgelehnt</span>}
                  {zaehlerTage.offen > 0 && <span className="text-ink-3 font-semibold">{zaehlerTage.offen} offen</span>}
                </p>
              )}
            </div>
            <p className="text-[11px] text-ink-4 mb-2">
              {eigene
                ? 'Immer aktuell: ob Bianka einen Tag angenommen oder abgelehnt hat und an welchen Tagen du eingeplant bist.'
                : `Pro Tag annehmen oder ablehnen, ${vorname} sieht den Stand sofort unter ihrem Arbeitsplan. Tage, an denen sie im Arbeitsplan steht, gelten automatisch als eingeplant.`}
            </p>
            {tMsg && (
              <p className={`text-xs px-3 py-1.5 rounded-ctl inline-block mb-2 ${tMsg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>
                {tMsg.type === 'ok' ? '✓ ' : '⚠ '}{tMsg.text}
              </p>
            )}
            {zeilen.length === 0 ? (
              <p className="text-xs text-ink-4">{eigene ? 'Noch keine Tage gespeichert.' : `Noch keine Tage von ${vorname}.`}</p>
            ) : (
              <div className="border border-edge-soft rounded-ctl divide-y divide-edge-row overflow-hidden">
                {zeilen.map(z => {
                  const chip = STAND_CHIP[z.stand.art]
                  const laeuft = tBusy === z.datum || tBusy === 'alle'
                  const aktiv = z.entscheidung?.status
                  const entscheidbar = !eigene && (z.stand.art === 'offen' || z.stand.art === 'angenommen' || z.stand.art === 'abgelehnt')
                  const fremd = !eigene && !!z.entscheidung?.von && z.entscheidung.von !== name
                  const antwortCls = (st: AnfrageStatus) => st === 'zugesagt' ? 'text-mint-ink' : st === 'abgesagt' ? 'text-blush-ink' : 'text-ink-3'
                  return (
                    <div key={z.datum} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 ${z.stand.art === 'eingeplant' || z.stand.art === 'angenommen' ? 'bg-mint-col' : z.stand.art === 'abgelehnt' ? 'bg-blush-bg/30' : ''}`}>
                      <span className="text-[12.5px] font-semibold text-ink tnum w-[78px]">{tagKurz(z.datum)}</span>
                      <span className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded-full ${chip.cls}`}>{chip.text}</span>
                      <span className="text-[12px] text-ink-2 min-w-0">
                        {z.stand.art === 'eingeplant' && (
                          <>
                            <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-md bg-white border border-edge-ctl text-ink-2 tnum mr-1.5">{z.stand.position === '*' ? '✱' : z.stand.position}</span>
                            {positionText(z.stand.position)}{z.stand.zeit ? <span className="text-ink-3"> · {z.stand.zeit}</span> : null}
                          </>
                        )}
                        {z.stand.art === 'angenommen' && (eigene
                          ? (z.stand.imPlan ? 'Bianka hat dich eingeplant, die Details folgen mit dem Arbeitsplan' : 'Bianka hat den Tag angenommen, der Einsatz folgt im Arbeitsplan')
                          : <span className="text-apricot-ink">noch nicht im Arbeitsplan</span>)}
                        {z.stand.art === 'angefragt' && (
                          <>
                            {positionText(z.stand.anfrage.position)}{z.stand.anfrage.zeit ? <span className="text-ink-3"> · {z.stand.anfrage.zeit}</span> : null}
                            {' · '}
                            <span className={`font-semibold ${antwortCls(z.stand.anfrage.status)}`}>
                              {eigene
                                ? (z.stand.anfrage.status === 'offen' ? 'bitte unten zusagen oder absagen' : `von dir ${z.stand.anfrage.status}`)
                                : `Antwort: ${z.stand.anfrage.status}`}
                            </span>
                          </>
                        )}
                        {z.stand.art === 'abgelehnt' && eigene && 'An diesem Tag brauchen wir dich nicht'}
                        {z.stand.art === 'offen' && eigene && 'Bianka hat noch nicht entschieden'}
                      </span>
                      {!z.verfuegbar && (
                        <span className="text-[10.5px] text-apricot-ink" title={eigene ? 'Diesen Tag hast du in deiner Verfügbarkeit nicht angetippt' : `${vorname} hat diesen Tag in ihrer Verfügbarkeit nicht angegeben`}>
                          {eigene ? 'nicht in deiner Verfügbarkeit' : 'nicht in ihrer Verfügbarkeit'}
                        </span>
                      )}
                      {!eigene && z.entscheidung?.status === 'abgelehnt' && (z.stand.art === 'eingeplant' || z.stand.art === 'angefragt') && (
                        <span className="text-[10.5px] text-apricot-ink" title="Der Arbeitsplan geht vor: der Tag gilt trotz der Ablehnung als eingeplant">zuvor abgelehnt</span>
                      )}
                      <span className="flex-1" />
                      {entscheidbar && z.entscheidung?.am && (
                        <span className="text-[10.5px] text-ink-4 tnum">{fmtDatum(z.entscheidung.am)}{fremd ? ` · ${z.entscheidung.von.split(' ')[0]}` : ''}</span>
                      )}
                      {entscheidbar && (
                        <div className="flex gap-1">
                          <button disabled={laeuft} onClick={() => tagEntscheiden(z.datum, aktiv === 'angenommen' ? 'offen' : 'angenommen')}
                            className={`text-[11px] font-semibold px-2 py-1 rounded-md border disabled:opacity-40 ${aktiv === 'angenommen' ? 'bg-mint-mid border-mint-mid text-white' : 'bg-white border-edge-ctl text-mint-ink hover:bg-mint-bg'}`}
                            title={aktiv === 'angenommen' ? 'Entscheidung zurücknehmen' : `${tagKurz(z.datum)} annehmen`}>
                            {aktiv === 'angenommen' ? '✓ Angenommen' : 'Annehmen'}
                          </button>
                          <button disabled={laeuft} onClick={() => tagEntscheiden(z.datum, aktiv === 'abgelehnt' ? 'offen' : 'abgelehnt')}
                            className={`text-[11px] font-semibold px-2 py-1 rounded-md border disabled:opacity-40 ${aktiv === 'abgelehnt' ? 'bg-blush-ink border-blush-ink text-white' : 'bg-white border-edge-ctl text-blush-ink hover:bg-blush-bg'}`}
                            title={aktiv === 'abgelehnt' ? 'Entscheidung zurücknehmen' : `${tagKurz(z.datum)} ablehnen`}>
                            {aktiv === 'abgelehnt' ? '✕ Abgelehnt' : 'Ablehnen'}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {!eigene && offen.length > 0 && (
              <button onClick={uebrigeAblehnen} disabled={tBusy === 'alle'} className="btn-secondary !py-1.5 text-xs mt-2"
                title="Alle angebotenen Tage ablehnen, über die noch nicht entschieden ist. Eingeplante, angefragte und schon beantwortete Tage bleiben.">
                {tBusy === 'alle' ? 'Speichert…' : `Übrige ${offen.length} Tag${offen.length === 1 ? '' : 'e'} ablehnen`}
              </button>
            )}
            {eigene && geaendert && (
              <p className="text-[11px] text-apricot-ink mt-1.5">Die Liste zeigt den gespeicherten Stand. Deine neue Auswahl im Kalender ist noch nicht gespeichert.</p>
            )}
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Notiz <span className="normal-case font-normal">(optional)</span></label>
            <textarea value={notiz} onChange={e => { setMsg(null); setNotiz(e.target.value) }} rows={2} maxLength={500}
              placeholder={eigene ? 'z. B. nur vormittags, ab 9.00 Uhr' : 'z. B. nur vormittags'} className="input-field text-sm w-full mt-1" />
          </div>
          {gespeichert.tage.length > 0 && initial.aktualisiertAm && !geaendert && (
            <p className="text-[11px] text-ink-4 tnum">Stand {fmtDatum(initial.aktualisiertAm)}</p>
          )}
        </div>
      </div>

      {/* ── Einsatzanfragen ─────────────────────────────────────────── */}
      <div className="mt-5 pt-4 border-t border-edge-soft">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-2.5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">
              {eigene ? 'An diesen Tagen brauchen wir dich' : `Einsätze, an denen wir ${vorname} brauchen`}
            </p>
            <p className="text-[11px] text-ink-4 mt-0.5">
              {eigene
                ? 'Sage pro Tag zu oder ab, mit einer Bemerkung, wenn du möchtest. Du kannst deine Antwort jederzeit ändern, die Liste zeigt immer deinen aktuellen Stand.'
                : `Tag und Position eintragen. ${vorname} sieht die Anfragen unter ihrem Arbeitsplan und sagt pro Tag zu oder ab; die Liste zeigt immer ihre aktuelle Antwort. Der Arbeitsplan selbst wird nicht automatisch ausgefüllt.`}
            </p>
          </div>
          {!eigene && liste.length > 0 && (
            <p className="text-[11px] tnum flex flex-wrap gap-x-2">
              <span className="text-mint-ink font-semibold">{zaehler.zugesagt} zugesagt</span>
              <span className="text-blush-ink font-semibold">{zaehler.abgesagt} abgesagt</span>
              <span className="text-ink-3 font-semibold">{zaehler.offen} offen</span>
            </p>
          )}
        </div>

        {!eigene && (
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div>
              <p className="field-label">Tag</p>
              <select value={neuDatum} onChange={e => { setAMsg(null); setNeuDatum(e.target.value) }} className="input-field !py-1.5 text-sm">
                <option value="">Tag wählen…</option>
                {alle.map(t => (
                  <option key={t} value={t}>{tagKurz(t)}{verfuegbar.has(t) ? ' · verfügbar' : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="field-label">Position</p>
              <select value={neuPos} onChange={e => { setAMsg(null); setNeuPos(e.target.value) }} className="input-field !py-1.5 text-sm">
                {POSITIONEN.map(p => <option key={p.code} value={p.code}>{p.code === '*' ? 'Stern' : p.code} · {p.label}</option>)}
              </select>
            </div>
            <div>
              <p className="field-label">Schicht</p>
              <select value={neuSchicht} onChange={e => { setAMsg(null); setNeuSchicht(e.target.value as '' | 'f' | 't' | 's' | 'h') }}
                disabled={neuPos === '✓'} className="input-field !py-1.5 text-sm disabled:opacity-50">
                {SCHICHTEN.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[160px]">
              <p className="field-label">Zeit / Bemerkung <span className="normal-case font-normal">(optional)</span></p>
              <input value={neuZeit} onChange={e => { setAMsg(null); setNeuZeit(e.target.value) }} maxLength={120}
                placeholder="z. B. 8.00 bis 12.00 Uhr" className="input-field !py-1.5 text-sm w-full" />
            </div>
            <button onClick={hinzufuegen} disabled={aBusy === 'neu'} className="btn-primary !py-1.5 text-xs">
              {aBusy === 'neu' ? 'Speichert…' : '＋ Anfragen'}
            </button>
            <button onClick={ausPlanUebernehmen} disabled={aBusy === 'plan' || uebernehmbar === 0} className="btn-secondary !py-1.5 text-xs"
              title={uebernehmbar > 0
                ? `Alle Einträge von ${vorname} aus dem Arbeitsplan dieses Monats als Anfragen übernehmen (Tage mit bestehender Anfrage bleiben)`
                : `Im Arbeitsplan dieses Monats gibt es keinen Eintrag von ${vorname}, der noch nicht angefragt ist`}>
              {aBusy === 'plan' ? 'Übernimmt…' : `Aus dem Arbeitsplan übernehmen${uebernehmbar > 0 ? ` (${uebernehmbar})` : ''}`}
            </button>
          </div>
        )}

        {aMsg && (
          <p className={`text-xs px-3 py-1.5 rounded-ctl inline-block mb-2.5 ${aMsg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>
            {aMsg.type === 'ok' ? '✓ ' : '⚠ '}{aMsg.text}
          </p>
        )}

        {liste.length === 0 ? (
          <p className="text-xs text-ink-4">{eigene ? 'Zurzeit keine Anfragen für diesen Monat.' : 'Noch keine Anfragen für diesen Monat.'}</p>
        ) : (
          <div className="border border-edge-soft rounded-ctl divide-y divide-edge-row overflow-hidden">
            {liste.map(a => {
              const chip = STATUS_CHIP[a.status]
              const laeuft = aBusy === a.id
              const fremd = !eigene && a.entschiedenVon && a.entschiedenVon !== name
              return (
                <div key={a.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 ${a.status === 'zugesagt' ? 'bg-mint-col' : a.status === 'abgesagt' ? 'bg-blush-bg/30' : ''}`}>
                  <span className="text-[12.5px] font-semibold text-ink tnum w-[78px]">{tagKurz(a.datum)}</span>
                  <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-md bg-white border border-edge-ctl text-ink-2 tnum">{a.position === '*' ? '✱' : a.position}</span>
                  <span className="text-[12px] text-ink-2">
                    {positionText(a.position)}{a.zeit ? <span className="text-ink-3"> · {a.zeit}</span> : null}
                  </span>
                  {!eigene && (planByDatum.has(a.datum)
                    ? (planByDatum.get(a.datum) === a.position
                      ? <span className="text-[10.5px] text-mint-ink" title="Der Arbeitsplan hat an diesem Tag denselben Eintrag">im Plan</span>
                      : <span className="text-[10.5px] text-apricot-ink" title="Der Arbeitsplan hat an diesem Tag einen anderen Eintrag">im Plan: {planByDatum.get(a.datum)}</span>)
                    : <span className="text-[10.5px] text-ink-4" title="Im Arbeitsplan ist dieser Tag noch leer">nicht im Plan</span>)}
                  <span className="flex-1" />
                  <span className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded-full ${chip.cls}`}>{chip.text}</span>
                  {a.entschiedenAm && (
                    <span className="text-[10.5px] text-ink-4 tnum">{fmtDatum(a.entschiedenAm)}{fremd ? ` · ${a.entschiedenVon!.split(' ')[0]}` : ''}</span>
                  )}
                  <div className="flex gap-1">
                    <button disabled={laeuft || a.status === 'zugesagt'} onClick={() => entscheiden(a, 'zugesagt')}
                      className={`text-[11px] font-semibold px-2 py-1 rounded-md border disabled:cursor-default ${a.status === 'zugesagt' ? 'bg-mint-mid border-mint-mid text-white' : 'bg-white border-edge-ctl text-mint-ink hover:bg-mint-bg disabled:opacity-40'}`}
                      title={a.status === 'zugesagt' ? 'Bereits zugesagt' : 'Zusagen'}>
                      {a.status === 'zugesagt' ? '✓ Zugesagt' : 'Zusagen'}
                    </button>
                    <button disabled={laeuft || a.status === 'abgesagt'} onClick={() => entscheiden(a, 'abgesagt')}
                      className={`text-[11px] font-semibold px-2 py-1 rounded-md border disabled:cursor-default ${a.status === 'abgesagt' ? 'bg-blush-ink border-blush-ink text-white' : 'bg-white border-edge-ctl text-blush-ink hover:bg-blush-bg disabled:opacity-40'}`}
                      title={a.status === 'abgesagt' ? 'Bereits abgesagt' : 'Absagen'}>
                      {a.status === 'abgesagt' ? '✕ Abgesagt' : 'Absagen'}
                    </button>
                  </div>
                  {!eigene && (
                    <>
                      <button disabled={laeuft} onClick={() => bearbeitenOeffnen(a)} className="text-ink-4 hover:text-ink px-1 disabled:opacity-40" title="Tag, Position oder Zeit ändern" aria-label="Anfrage bearbeiten">✎</button>
                      <button disabled={laeuft} onClick={() => entfernen(a)} className="text-ink-4 hover:text-ink px-1 disabled:opacity-40" title="Anfrage entfernen" aria-label="Anfrage entfernen">✕</button>
                    </>
                  )}
                  {a.bemerkung ? (
                    <p className="w-full text-[11.5px] text-ink-2 italic sm:pl-[90px]">
                      💬 {a.bemerkung}
                      {eigene && (
                        <button onClick={() => { setAntwortErr(null); setAntwort({ a, status: a.status, bemerkung: a.bemerkung, nurBemerkung: true }) }}
                          className="ml-2 not-italic text-[10.5px] text-ink-4 hover:underline">ändern</button>
                      )}
                    </p>
                  ) : eigene && a.status !== 'offen' ? (
                    <button onClick={() => { setAntwortErr(null); setAntwort({ a, status: a.status, bemerkung: '', nurBemerkung: true }) }}
                      className="w-full text-left text-[10.5px] text-ink-4 hover:underline sm:pl-[90px]">Bemerkung hinzufügen</button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Admin: Anfrage bearbeiten */}
      {bearbeiten && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">Anfrage bearbeiten</h3>
                <p className="text-xs text-ink-4 mt-0.5">bisher {tagKurz(bearbeiten.a.datum)} · {positionText(bearbeiten.a.position)}{bearbeiten.a.zeit ? ` · ${bearbeiten.a.zeit}` : ''}</p>
              </div>
              <button onClick={() => setBearbeiten(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4">✕</button>
            </div>
            <div className="px-6 py-4 space-y-3.5">
              <div>
                <p className="field-label">Tag</p>
                <select value={bearbeiten.datum} onChange={e => setBearbeiten(b => b ? { ...b, datum: e.target.value } : b)} className="input-field w-full">
                  {alle.map(t => <option key={t} value={t}>{tagKurz(t)}{verfuegbar.has(t) ? ' · verfügbar' : ''}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="field-label">Position</p>
                  <select value={bearbeiten.basis} onChange={e => setBearbeiten(b => b ? { ...b, basis: e.target.value } : b)} className="input-field w-full">
                    {POSITIONEN.map(p => <option key={p.code} value={p.code}>{p.code === '*' ? 'Stern' : p.code} · {p.label}</option>)}
                    {!POSITIONEN.some(p => p.code === bearbeiten.basis) && <option value={bearbeiten.basis}>{bearbeiten.basis} · eigener Code</option>}
                  </select>
                </div>
                <div>
                  <p className="field-label">Schicht</p>
                  <select value={bearbeiten.schicht} onChange={e => setBearbeiten(b => b ? { ...b, schicht: e.target.value as Schicht } : b)}
                    disabled={bearbeiten.basis === '✓'} className="input-field w-full disabled:opacity-50">
                    {SCHICHTEN.map(sch => <option key={sch.code} value={sch.code}>{sch.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <p className="field-label">Zeit / Bemerkung <span className="normal-case font-normal">(optional)</span></p>
                <input value={bearbeiten.zeit} onChange={e => setBearbeiten(b => b ? { ...b, zeit: e.target.value } : b)} maxLength={120}
                  placeholder="z. B. 8.00 bis 12.00 Uhr" className="input-field w-full" />
              </div>
              {bearbeiten.a.status !== 'offen' && (
                <label className="flex items-start gap-2 text-[12px] text-ink-2">
                  <input type="checkbox" checked={bearbeiten.zuruecksetzen} onChange={e => setBearbeiten(b => b ? { ...b, zuruecksetzen: e.target.checked } : b)} className="mt-0.5" />
                  <span>Antwort von {vorname} zurücksetzen (bisher {STATUS_CHIP[bearbeiten.a.status].text}): sie sieht die Anfrage wieder als offen und sagt neu zu oder ab. Ihre Bemerkung bleibt erhalten.</span>
                </label>
              )}
              {bearbeitenErr && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {bearbeitenErr}</p>}
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={() => setBearbeiten(null)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={bearbeitenSpeichern} disabled={aBusy === bearbeiten.a.id} className="btn-primary flex-1">
                {aBusy === bearbeiten.a.id ? 'Wird gespeichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Person: zusagen oder absagen, mit Bemerkung */}
      {antwort && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">{antwort.nurBemerkung ? 'Bemerkung' : antwort.status === 'zugesagt' ? 'Zusagen' : 'Absagen'}</h3>
                <p className="text-xs text-ink-4 mt-0.5">{tagKurz(antwort.a.datum)} · {positionText(antwort.a.position)}{antwort.a.zeit ? ` · ${antwort.a.zeit}` : ''}</p>
              </div>
              <button onClick={() => setAntwort(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4">✕</button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <p className="field-label">Bemerkung <span className="normal-case font-normal">(optional)</span></p>
                <textarea value={antwort.bemerkung} onChange={e => setAntwort(m => m ? { ...m, bemerkung: e.target.value } : m)} rows={3} maxLength={300}
                  placeholder={antwort.status === 'abgesagt' ? 'z. B. an diesem Tag habe ich einen Termin' : 'z. B. erst ab 8.30 Uhr möglich'} className="input-field text-sm w-full" />
              </div>
              {antwortErr && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {antwortErr}</p>}
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={() => setAntwort(null)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={antwortSenden} disabled={aBusy === antwort.a.id}
                className={`flex-1 ${antwort.status === 'abgesagt' && !antwort.nurBemerkung ? 'btn-danger' : 'btn-primary'}`}>
                {aBusy === antwort.a.id ? 'Wird gespeichert…' : antwort.nurBemerkung ? 'Speichern' : antwort.status === 'zugesagt' ? '✓ Zusagen' : '✕ Absagen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
