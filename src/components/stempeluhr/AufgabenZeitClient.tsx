'use client'

// Aufgaben Zeiterfassung auf «Meine Stempeluhr», nur für Bianka: zuoberst
// das schnelle Erfassen mit fünf Knöpfen für die häufigsten Aufgaben,
// Aufgabenliste mit den zuletzt verwendeten zuoberst, Dauer über Chips oder
// Std. und Min., Notiz. Darunter die Auswertung pro Woche, Monat oder Jahr
// (Total, Tage, Einträge in einer Zeile, Balken pro Aufgabe); die Tage lassen
// sich antippen und zeigen ihre Einträge mit Aufgabe und Dauer (ändern,
// löschen). Kategorien und Aufgaben werden im Dialog «Einstellungen»
// gepflegt. Die Rechnung macht src/lib/aufgaben-zeit.ts.

import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { aufgabenKonfigSpeichern, aufgabenZeitAendern, aufgabenZeitErfassen, aufgabenZeitLoeschen } from '@/actions/aufgaben-zeit'
import {
  addTage, anzahlProAufgabe, aufgabenIndex, auswerten, fmtDatum, fmtDatumLang, fmtDauer, fmtDauerKurz, fmtKurz, haeufigsteAufgaben, neueId, periodeFuer, periodeVerschieben,
  tagesSumme, wochentagIndex, zuletztVerwendet, PERIODE_LABEL, NAME_MAX, NOTIZ_MAX, WOCHENTAGE, MONATE,
  type AufgabenKonfig, type PeriodeArt, type ZeitEintrag,
} from '@/lib/aufgaben-zeit'

const ART_KEY = 'aufgaben-zeit-art'
const SCHNELL = [15, 30, 45, 60, 90, 120]
const FARBEN = ['#2F6F62', '#B08350', '#6B5B95', '#4A7FB5', '#C25B5B', '#5B8C5A', '#8A6D3B', '#3F7F8C']
const KNOPF = {
  chip: (an: boolean) => `px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${an ? 'bg-dusk text-white border-dusk' : 'bg-white text-ink-2 border-edge-ctl hover:bg-edge-row'}`,
  klein: 'text-[10.5px] font-semibold text-ink-4 hover:text-ink hover:underline disabled:opacity-40 disabled:no-underline',
  rot: 'text-[10.5px] font-semibold text-ink-4 hover:text-red-500 disabled:opacity-40',
}
type Msg = { type: 'ok' | 'err'; text: string } | null

const Zahnrad = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.3 4.3a1.7 1.7 0 0 1 3.4 0l.2 1.2a7.5 7.5 0 0 1 1.9 1.1l1.2-.4a1.7 1.7 0 0 1 1.7 2.9l-1 .8a7.6 7.6 0 0 1 0 2.2l1 .8a1.7 1.7 0 0 1-1.7 2.9l-1.2-.4a7.5 7.5 0 0 1-1.9 1.1l-.2 1.2a1.7 1.7 0 0 1-3.4 0l-.2-1.2a7.5 7.5 0 0 1-1.9-1.1l-1.2.4a1.7 1.7 0 0 1-1.7-2.9l1-.8a7.6 7.6 0 0 1 0-2.2l-1-.8a1.7 1.7 0 0 1 1.7-2.9l1.2.4a7.5 7.5 0 0 1 1.9-1.1z" /><circle cx="12" cy="12" r="2.5" /></svg>
)
const Meldung = ({ msg }: { msg: Msg }) => msg ? (
  <p className={`text-xs px-3 py-2 rounded-ctl inline-block ${msg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>{msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}</p>
) : null

/** Eingabe der Dauer in Stunden und Minuten, intern Minuten */
function DauerEingabe({ minuten, onChange, klein = false, stdRef }: { minuten: number; onChange: (m: number) => void; klein?: boolean; stdRef?: React.RefObject<HTMLInputElement> }) {
  const std = Math.floor(minuten / 60), min = minuten % 60
  const cls = `input-field tnum text-center ${klein ? 'text-xs w-14 !py-1' : 'text-sm w-16'}`
  const zahl = (v: string, max: number) => Math.min(max, Math.max(0, parseInt(v || '0', 10) || 0))
  return (
    <span className="inline-flex items-center gap-1.5">
      <input ref={stdRef} type="number" min={0} max={24} inputMode="numeric" value={std} onChange={e => onChange(zahl(e.target.value, 24) * 60 + min)} onFocus={e => e.target.select()} className={cls} aria-label="Stunden" />
      <span className="text-[11px] text-ink-4">Std.</span>
      <input type="number" min={0} max={59} step={5} inputMode="numeric" value={min} onChange={e => onChange(std * 60 + zahl(e.target.value, 59))} onFocus={e => e.target.select()} className={cls} aria-label="Minuten" />
      <span className="text-[11px] text-ink-4">Min.</span>
    </span>
  )
}

export default function AufgabenZeitClient({ konfig: konfigServer, eintraege, heute }: { konfig: AufgabenKonfig; eintraege: ZeitEintrag[]; heute: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // Lokale Kopie der Kategorien, damit die Einstellungen sofort reagieren
  const [konfig, setKonfig] = useState(konfigServer)
  useEffect(() => { setKonfig(konfigServer) }, [konfigServer])
  const index = useMemo(() => aufgabenIndex(konfig), [konfig])
  const anzahl = useMemo(() => anzahlProAufgabe(eintraege), [eintraege])
  const aktive = useMemo(() => konfig.kategorien.flatMap(k => k.aufgaben.filter(a => !a.archiviert).map(a => ({ ...a, kategorie: k.name, kategorieId: k.id }))), [konfig])
  const aktiv = (id: string) => { const a = index.get(id); return a && !a.archiviert ? a : null }
  /** Die fünf am häufigsten erfassten Aufgaben, als grosse Knöpfe */
  const haeufigste = useMemo(() => haeufigsteAufgaben(eintraege, 5).map(h => ({ ...h, info: aktiv(h.id) })).filter(h => h.info), [eintraege, index])  // eslint-disable-line react-hooks/exhaustive-deps
  /** Zuletzt verwendete Aufgaben, zuoberst in der Liste */
  const zuletzt = useMemo(() => zuletztVerwendet(eintraege, 8).map(aktiv).filter((a): a is NonNullable<typeof a> => !!a), [eintraege, index])  // eslint-disable-line react-hooks/exhaustive-deps
  const farbeVon = (kategorieId: string) => FARBEN[Math.max(0, konfig.kategorien.findIndex(k => k.id === kategorieId)) % FARBEN.length]

  // ── Erfassen ──
  const [datum, setDatum] = useState(heute)
  const [aufgabeId, setAufgabeId] = useState('')
  const [minuten, setMinuten] = useState(0)
  const [notiz, setNotiz] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const stdRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const heuteSumme = tagesSumme(eintraege, heute)
  const datumSumme = tagesSumme(eintraege, datum)
  const waehlen = (id: string) => { setAufgabeId(id); setMsg(null); if (minuten === 0) stdRef.current?.focus() }

  function erfassen(e: FormEvent) {
    e.preventDefault()
    if (!aufgabeId) { setMsg({ type: 'err', text: 'Bitte eine Aufgabe wählen.' }); return }
    if (minuten <= 0) { setMsg({ type: 'err', text: 'Bitte die Dauer eingeben.' }); return }
    const titel = index.get(aufgabeId)?.titel ?? ''
    const dauer = minuten
    setMsg(null)
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof aufgabenZeitErfassen>>
      try { r = await aufgabenZeitErfassen({ datum, aufgabeId, minuten: dauer, notiz }) } catch { r = { error: 'Netzwerkfehler. Bitte erneut versuchen.' } }
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      setMsg({ type: 'ok', text: `${fmtDauer(dauer)} für «${titel}» am ${fmtDatum(datum)} gespeichert.` })
      setMinuten(0); setNotiz('')
      router.refresh()
    })
  }

  // ── Auswertung ──
  const [art, setArtState] = useState<PeriodeArt>('woche')
  const [bezug, setBezugState] = useState(heute)
  /** Gewählter Tag, dessen Einträge unter den Kacheln stehen */
  const [tagWahl, setTagWahl] = useState<string | null>(heute)
  useEffect(() => { try { const a = localStorage.getItem(ART_KEY); if (a === 'woche' || a === 'monat' || a === 'jahr') setArtState(a) } catch { /* ohne Speicher */ } }, [])
  /** Zeitraum wechseln: heute bleibt gewählt, wenn es im Zeitraum liegt, sonst kein Tag */
  const zeitraum = (neuBezug: string, neuArt: PeriodeArt) => {
    const p = periodeFuer(neuBezug, neuArt)
    setBezugState(neuBezug); setArtState(neuArt)
    setTagWahl(heute >= p.von && heute <= p.bis ? heute : null)
    try { localStorage.setItem(ART_KEY, neuArt) } catch { /* ohne Speicher */ }
  }
  const setArt = (a: PeriodeArt) => zeitraum(bezug, a)
  const setBezug = (b: string) => zeitraum(b, art)
  const periode = useMemo(() => periodeFuer(bezug, art), [bezug, art])
  const ausw = useMemo(() => auswerten(eintraege, konfig, periode.von, periode.bis), [eintraege, konfig, periode])
  /** Tage des Zeitraums (Woche oder Monat) mit Minuten, für die Kacheln */
  const tage = useMemo(() => {
    if (art === 'jahr') return []
    const m = new Map(ausw.proTag.map(t => [t.datum, t.minuten]))
    const out: Array<{ datum: string; minuten: number }> = []
    for (let d = periode.von; d <= periode.bis; d = addTage(d, 1)) out.push({ datum: d, minuten: m.get(d) ?? 0 })
    return out
  }, [art, ausw, periode])
  const maxTag = Math.max(1, ...tage.map(t => t.minuten))
  /** Monate des Jahres mit Minuten */
  const monate = useMemo(() => {
    if (art !== 'jahr') return []
    const y = periode.von.slice(0, 4)
    return MONATE.map((name, i) => { const pre = `${y}-${String(i + 1).padStart(2, '0')}`; return { name, von: `${pre}-01`, minuten: ausw.proTag.filter(t => t.datum.startsWith(pre)).reduce((sum, t) => sum + t.minuten, 0) } })
  }, [art, ausw, periode])
  const maxMonat = Math.max(1, ...monate.map(m => m.minuten))
  /** Einträge des gewählten Tages, neueste zuerst */
  const tagEintraege = useMemo(() => (tagWahl ? eintraege.filter(e => e.datum === tagWahl).sort((a, b) => b.erfasst.localeCompare(a.erfasst)) : []), [eintraege, tagWahl])
  const [bearbeiten, setBearbeiten] = useState<{ id: string; altDatum: string; datum: string; aufgabeId: string; minuten: number; notiz: string } | null>(null)
  const [listeMsg, setListeMsg] = useState<Msg>(null)

  function aenderungSpeichern() {
    if (!bearbeiten) return
    const b = bearbeiten
    if (b.minuten <= 0) { setListeMsg({ type: 'err', text: 'Bitte die Dauer eingeben.' }); return }
    setListeMsg(null)
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof aufgabenZeitAendern>>
      try { r = await aufgabenZeitAendern({ datum: b.altDatum, id: b.id }, { datum: b.datum, aufgabeId: b.aufgabeId, minuten: b.minuten, notiz: b.notiz }) } catch { r = { error: 'Netzwerkfehler. Bitte erneut versuchen.' } }
      if ('error' in r && r.error) { setListeMsg({ type: 'err', text: r.error }); return }
      setBearbeiten(null); setListeMsg({ type: 'ok', text: 'Eintrag geändert.' })
      router.refresh()
    })
  }
  function loeschen(e: ZeitEintrag) {
    if (!confirm(`${fmtDauer(e.minuten)} «${index.get(e.aufgabeId)?.titel ?? 'Aufgabe'}» vom ${fmtDatum(e.datum)} löschen?`)) return
    setListeMsg(null)
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof aufgabenZeitLoeschen>>
      try { r = await aufgabenZeitLoeschen(e.datum, e.id) } catch { r = { error: 'Netzwerkfehler. Bitte erneut versuchen.' } }
      if ('error' in r && r.error) { setListeMsg({ type: 'err', text: r.error }); return }
      setListeMsg({ type: 'ok', text: 'Eintrag gelöscht.' })
      router.refresh()
    })
  }

  // ── Einstellungen: Kategorien und Aufgaben (Dialog) ──
  const [einstellungen, setEinstellungen] = useState(false)
  const [verwMsg, setVerwMsg] = useState<Msg>(null)
  const [neueKategorie, setNeueKategorie] = useState('')
  const [neueAufgabe, setNeueAufgabe] = useState<Record<string, string>>({})
  const [umbenennen, setUmbenennen] = useState<{ id: string; wert: string } | null>(null)
  useEffect(() => {
    if (!einstellungen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEinstellungen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [einstellungen])
  function speichereKonfig(neu: AufgabenKonfig, ok?: string) {
    const vorher = konfig
    setKonfig(neu); setVerwMsg(null)
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof aufgabenKonfigSpeichern>>
      try { r = await aufgabenKonfigSpeichern(neu) } catch { r = { error: 'Netzwerkfehler. Bitte erneut versuchen.' } }
      if ('error' in r && r.error) { setKonfig(vorher); setVerwMsg({ type: 'err', text: r.error }); return }
      if (ok) setVerwMsg({ type: 'ok', text: ok })
      router.refresh()
    })
  }
  const verschiebe = <T,>(arr: T[], i: number, d: number): T[] => { const j = i + d; if (j < 0 || j >= arr.length) return arr; const n = [...arr]; [n[i], n[j]] = [n[j], n[i]]; return n }
  function kategorieAnlegen() {
    const name = neueKategorie.trim()
    if (!name) return
    speichereKonfig({ kategorien: [...konfig.kategorien, { id: neueId(), name, aufgaben: [] }] }, `Kategorie «${name}» angelegt.`)
    setNeueKategorie('')
  }
  function aufgabeAnlegen(katId: string) {
    const titel = (neueAufgabe[katId] ?? '').trim()
    if (!titel) return
    speichereKonfig({ kategorien: konfig.kategorien.map(k => (k.id === katId ? { ...k, aufgaben: [...k.aufgaben, { id: neueId(), titel, archiviert: false }] } : k)) }, `Aufgabe «${titel}» angelegt.`)
    setNeueAufgabe(n => ({ ...n, [katId]: '' }))
  }
  function umbenennenSpeichern() {
    if (!umbenennen) return
    const wert = umbenennen.wert.trim()
    if (!wert) { setUmbenennen(null); return }
    speichereKonfig({ kategorien: konfig.kategorien.map(k => k.id === umbenennen.id ? { ...k, name: wert } : { ...k, aufgaben: k.aufgaben.map(a => (a.id === umbenennen.id ? { ...a, titel: wert } : a)) }) })
    setUmbenennen(null)
  }
  const archivieren = (aufgId: string, archiviert: boolean) => speichereKonfig({ kategorien: konfig.kategorien.map(k => ({ ...k, aufgaben: k.aufgaben.map(a => (a.id === aufgId ? { ...a, archiviert } : a)) })) })
  function aufgabeLoeschen(katId: string, aufgId: string) {
    if ((anzahl.get(aufgId) ?? 0) > 0) return
    speichereKonfig({ kategorien: konfig.kategorien.map(k => (k.id === katId ? { ...k, aufgaben: k.aufgaben.filter(a => a.id !== aufgId) } : k)) })
  }
  function kategorieLoeschen(katId: string) {
    const k = konfig.kategorien.find(x => x.id === katId)
    if (!k || k.aufgaben.length > 0) return
    speichereKonfig({ kategorien: konfig.kategorien.filter(x => x.id !== katId) })
  }

  const Umbenennbar = ({ id, text, cls }: { id: string; text: string; cls: string }) => umbenennen?.id === id ? (
    <span className="inline-flex items-center gap-1.5">
      <input autoFocus value={umbenennen.wert} maxLength={NAME_MAX} onChange={e => setUmbenennen({ id, wert: e.target.value })}
        onKeyDown={e => { if (e.key === 'Enter') umbenennenSpeichern(); if (e.key === 'Escape') setUmbenennen(null) }} className="input-field text-sm !py-1 w-56" />
      <button onClick={umbenennenSpeichern} className="btn-primary !px-2.5 !py-1 !text-[11px]">OK</button>
      <button onClick={() => setUmbenennen(null)} className={KNOPF.klein}>Abbrechen</button>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className={cls}>{text}</span>
      <button onClick={() => setUmbenennen({ id, wert: text })} className="text-ink-5 hover:text-ink-2" title="Umbenennen">✎</button>
    </span>
  )

  /** Aufgabenliste: zuletzt verwendete zuoberst, dann alle nach Kategorie */
  const aufgabenSelect = (wert: string, onChange: (v: string) => void, cls: string) => (
    <select value={wert} onChange={e => onChange(e.target.value)} className={cls}>
      <option value="">Aus der Liste wählen …</option>
      {zuletzt.length > 0 && (
        <optgroup label="Zuletzt verwendet">{zuletzt.map(a => <option key={`z_${a.id}`} value={a.id}>{a.titel} ({a.kategorie})</option>)}</optgroup>
      )}
      {konfig.kategorien.map(k => {
        const liste = k.aufgaben.filter(a => !a.archiviert || a.id === wert)
        return liste.length === 0 ? null : (
          <optgroup key={k.id} label={k.name}>{liste.map(a => <option key={a.id} value={a.id}>{a.titel}{a.archiviert ? ' (ausgeblendet)' : ''}</option>)}</optgroup>
        )
      })}
    </select>
  )

  const gewaehlt = aufgabeId ? index.get(aufgabeId) : undefined

  return (
    <div className="space-y-5">
      {/* ── Zeit erfassen ─────────────────────────────────────────────── */}
      <form ref={formRef} onSubmit={erfassen} className="card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-edge-soft flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-ink">Zeit erfassen</p>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-[11.5px] text-ink-4 tnum">Heute erfasst <span className="font-semibold text-ink">{fmtDauer(heuteSumme)}</span>{datum !== heute ? <> · am {fmtDatum(datum)} <span className="font-semibold text-ink">{fmtDauer(datumSumme)}</span></> : null}</p>
            <button type="button" onClick={() => { setVerwMsg(null); setEinstellungen(true) }} className="btn-secondary !px-3 !py-1.5 !text-xs inline-flex items-center gap-1.5" title="Kategorien und Aufgaben anlegen, umbenennen, ausblenden"><Zahnrad /> Einstellungen</button>
          </div>
        </div>
        {aktive.length === 0 ? (
          <div className="px-5 py-5 text-sm text-ink-3">
            Noch keine Aufgaben. Lege in den Einstellungen zuerst eine Kategorie an, zum Beispiel «Administration», und darunter die Aufgaben, zum Beispiel «Lohnabrechnungen».
            <button type="button" onClick={() => setEinstellungen(true)} className="ml-2 font-semibold text-steel-ink underline">Einstellungen öffnen</button>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-3.5">
            {haeufigste.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4 mb-1.5">Häufigste Aufgaben</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {haeufigste.map(h => {
                    const an = aufgabeId === h.id
                    return (
                      <button type="button" key={h.id} onClick={() => waehlen(h.id)} title={`${h.info!.kategorie} · ${h.anzahl}× erfasst, ${fmtDauer(h.minuten)}`}
                        className={`rounded-tile px-3 py-2.5 text-left border transition-all ${an ? 'bg-dusk border-dusk text-white shadow-md' : 'bg-surface border-edge-soft hover:border-edge-strong hover:-translate-y-0.5 hover:shadow-sm'}`}>
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: an ? '#fff' : farbeVon(h.info!.kategorieId) }} />
                          <span className={`text-[12.5px] font-semibold truncate ${an ? 'text-white' : 'text-ink'}`}>{h.info!.titel}</span>
                        </span>
                        <span className={`block text-[10px] mt-0.5 truncate ${an ? 'text-white/75' : 'text-ink-4'}`}>{h.info!.kategorie} · {h.anzahl}×</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1 min-w-[240px] flex-1 max-w-md">
                <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Aufgabe{gewaehlt ? <span className="normal-case font-normal text-mint-ink"> ✓ {gewaehlt.titel}</span> : null}</label>
                {aufgabenSelect(aufgabeId, waehlen, 'input-field text-sm')}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Datum</label>
                <div className="flex items-center gap-1.5">
                  <input type="date" value={datum} max={heute} onChange={e => e.target.value && setDatum(e.target.value)} className="input-field text-sm w-40" />
                  <button type="button" onClick={() => setDatum(heute)} className={KNOPF.chip(datum === heute)}>Heute</button>
                  <button type="button" onClick={() => setDatum(addTage(heute, -1))} className={KNOPF.chip(datum === addTage(heute, -1))}>Gestern</button>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Dauer</label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {SCHNELL.map(m => <button type="button" key={m} onClick={() => setMinuten(m)} className={KNOPF.chip(minuten === m)}>{m < 60 ? `${m} Min.` : fmtDauer(m)}</button>)}
                  <DauerEingabe minuten={minuten} onChange={setMinuten} stdRef={stdRef} />
                </div>
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-[200px] max-w-md">
                <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Notiz <span className="normal-case font-normal">(optional)</span></label>
                <input value={notiz} maxLength={NOTIZ_MAX} onChange={e => setNotiz(e.target.value)} placeholder="Worum ging es" className="input-field text-sm" />
              </div>
              <button type="submit" disabled={isPending} className="btn-primary disabled:opacity-50">{isPending ? 'Wird gespeichert …' : 'Erfassen'}</button>
            </div>
            {msg && <Meldung msg={msg} />}
          </div>
        )}
      </form>

      {/* ── Auswertung ───────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-edge-soft flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-ink">Auswertung</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {(['woche', 'monat', 'jahr'] as PeriodeArt[]).map(a => <button key={a} onClick={() => setArt(a)} className={KNOPF.chip(art === a)}>{PERIODE_LABEL[a]}</button>)}
            <span className="w-px h-5 bg-edge-ctl mx-1" />
            <button onClick={() => setBezug(periodeVerschieben(bezug, art, -1))} className="px-2 py-1 rounded-full border border-edge-ctl bg-white text-ink-2 hover:bg-edge-row text-[12px]" title="Zurück">‹</button>
            <span className="text-[12px] font-semibold text-ink tnum min-w-[150px] text-center">{periode.label}</span>
            <button onClick={() => setBezug(periodeVerschieben(bezug, art, 1))} disabled={periode.bis >= heute} className="px-2 py-1 rounded-full border border-edge-ctl bg-white text-ink-2 hover:bg-edge-row text-[12px] disabled:opacity-40" title="Vor">›</button>
            {bezug !== heute && <button onClick={() => setBezug(heute)} className={KNOPF.klein}>Heute</button>}
          </div>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-[12px] text-ink-3 tnum">
            {ausw.total > 0
              ? <><span className="font-semibold text-ink">{fmtDauer(ausw.total)}</span> · {ausw.tage} {ausw.tage === 1 ? 'Tag' : 'Tage'} mit Einträgen · {ausw.anzahl} {ausw.anzahl === 1 ? 'Eintrag' : 'Einträge'}</>
              : 'Noch keine Zeit erfasst.'}
          </p>
          {/* Tage antippen: Woche und Monat als Tage, Jahr als Monate */}
          {art === 'woche' && (
            <div className="grid grid-cols-7 gap-1.5">
              {tage.map(t => {
                const an = tagWahl === t.datum
                return (
                  <button type="button" key={t.datum} onClick={() => setTagWahl(an ? null : t.datum)} title={`${fmtDatumLang(t.datum)}: ${fmtDauer(t.minuten)}, antippen für die Einträge`}
                    className={`rounded-lg border px-1.5 pt-1.5 pb-1 text-center transition-colors ${an ? 'border-dusk bg-dusk' : t.datum === heute ? 'border-dusk bg-white hover:bg-surface' : 'border-edge-soft bg-surface hover:border-edge-strong'}`}>
                    <p className={`text-[9.5px] font-bold uppercase tracking-wider ${an ? 'text-white/80' : 'text-ink-4'}`}>{WOCHENTAGE[wochentagIndex(t.datum)].slice(0, 2)} <span className="font-normal normal-case tracking-normal">{fmtKurz(t.datum)}</span></p>
                    <div className="h-10 flex items-end justify-center mt-1">
                      <div className={`w-5 rounded-t ${an ? 'bg-white' : 'bg-dusk'}`} style={{ height: `${Math.round((t.minuten / maxTag) * 100)}%`, opacity: t.minuten > 0 ? 1 : 0.15 }} />
                    </div>
                    <p className={`text-[10.5px] tnum mt-0.5 ${an ? 'text-white' : 'text-ink-2'}`}>{t.minuten > 0 ? fmtDauerKurz(t.minuten) : '–'}</p>
                  </button>
                )
              })}
            </div>
          )}
          {art === 'monat' && (
            <div>
              <div className="grid grid-cols-7 gap-1 text-[9.5px] font-bold uppercase tracking-wider text-ink-4 text-center mb-1">{WOCHENTAGE.map(w => <span key={w}>{w.slice(0, 2)}</span>)}</div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: wochentagIndex(periode.von) }, (_, i) => <span key={`leer${i}`} />)}
                {tage.map(t => {
                  const an = tagWahl === t.datum
                  return (
                    <button type="button" key={t.datum} onClick={() => setTagWahl(an ? null : t.datum)} title={`${fmtDatumLang(t.datum)}: ${fmtDauer(t.minuten)}, antippen für die Einträge`}
                      className={`rounded-lg border px-1 py-1.5 text-center transition-colors ${an ? 'border-dusk bg-dusk' : t.datum === heute ? 'border-dusk bg-white hover:bg-surface' : t.minuten > 0 ? 'border-edge-soft bg-surface hover:border-edge-strong' : 'border-edge-soft bg-white hover:bg-surface'}`}>
                      <span className={`block text-[11px] font-semibold tnum ${an ? 'text-white' : 'text-ink'}`}>{parseInt(t.datum.slice(8, 10), 10)}</span>
                      <span className={`block text-[10px] tnum ${an ? 'text-white/85' : t.minuten > 0 ? 'text-ink-2' : 'text-ink-5'}`}>{t.minuten > 0 ? fmtDauerKurz(t.minuten) : '–'}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {art === 'jahr' && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {monate.map(m => (
                <button type="button" key={m.von} onClick={() => zeitraum(m.von, 'monat')} title={`${m.name}: ${fmtDauer(m.minuten)}, antippen für den Monat`}
                  className="rounded-lg border border-edge-soft bg-surface hover:border-edge-strong px-2 pt-1.5 pb-1 text-center transition-colors">
                  <p className="text-[9.5px] font-bold uppercase tracking-wider text-ink-4">{m.name.slice(0, 3)}</p>
                  <div className="h-10 flex items-end justify-center mt-1">
                    <div className="w-5 rounded-t bg-dusk" style={{ height: `${Math.round((m.minuten / maxMonat) * 100)}%`, opacity: m.minuten > 0 ? 1 : 0.15 }} />
                  </div>
                  <p className="text-[10.5px] tnum text-ink-2 mt-0.5">{m.minuten > 0 ? fmtDauer(m.minuten) : '–'}</p>
                </button>
              ))}
            </div>
          )}

          {/* Einträge des gewählten Tages: Aufgabe und Dauer, ändern, löschen */}
          {art !== 'jahr' && (
            <div className="rounded-xl border border-edge-soft overflow-hidden">
              {tagWahl ? (
                <>
                  <div className="px-4 py-2.5 bg-surface border-b border-edge-soft flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[12px] font-semibold text-ink">{fmtDatumLang(tagWahl)} <span className="font-normal text-ink-4 tnum">· {tagEintraege.length} {tagEintraege.length === 1 ? 'Eintrag' : 'Einträge'}, {fmtDauer(tagEintraege.reduce((sum, e) => sum + e.minuten, 0))}</span></p>
                    {tagWahl <= heute && <button type="button" onClick={() => { setDatum(tagWahl); formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} className={KNOPF.klein}>Zeit für diesen Tag erfassen</button>}
                  </div>
                  {listeMsg && <div className="px-4 pt-3"><Meldung msg={listeMsg} /></div>}
                  {tagEintraege.length === 0 && <p className="px-4 py-4 text-sm text-ink-4">An diesem Tag ist nichts erfasst.</p>}
                  <ul className="divide-y divide-edge-row">
                    {tagEintraege.map(e => {
                      const info = index.get(e.aufgabeId)
                      if (bearbeiten?.id === e.id) {
                        return (
                          <li key={e.id} className="px-4 py-3 flex flex-wrap items-end gap-3 bg-surface">
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Datum</label>
                              <input type="date" value={bearbeiten.datum} max={heute} onChange={ev => ev.target.value && setBearbeiten({ ...bearbeiten, datum: ev.target.value })} className="input-field text-xs !py-1 w-36" /></div>
                            <div className="flex flex-col gap-1 min-w-[200px]"><label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Aufgabe</label>
                              {aufgabenSelect(bearbeiten.aufgabeId, v => setBearbeiten({ ...bearbeiten, aufgabeId: v }), 'input-field text-xs !py-1')}</div>
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Dauer</label>
                              <DauerEingabe klein minuten={bearbeiten.minuten} onChange={m => setBearbeiten({ ...bearbeiten, minuten: m })} /></div>
                            <div className="flex flex-col gap-1 flex-1 min-w-[160px]"><label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Notiz</label>
                              <input value={bearbeiten.notiz} maxLength={NOTIZ_MAX} onChange={ev => setBearbeiten({ ...bearbeiten, notiz: ev.target.value })} className="input-field text-xs !py-1" /></div>
                            <div className="flex items-center gap-2">
                              <button onClick={aenderungSpeichern} disabled={isPending || !bearbeiten.aufgabeId} className="btn-primary !px-3 !py-1.5 !text-xs disabled:opacity-50">Speichern</button>
                              <button onClick={() => setBearbeiten(null)} className={KNOPF.klein}>Abbrechen</button>
                            </div>
                          </li>
                        )
                      }
                      return (
                        <li key={e.id} className="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: farbeVon(info?.kategorieId ?? '') }} />
                          <span className="font-semibold text-ink">{info?.titel ?? 'Gelöschte Aufgabe'}</span>
                          <span className="text-[11px] text-ink-4">{info?.kategorie ?? ''}</span>
                          {e.notiz && <span className="text-[11.5px] text-ink-3 italic">«{e.notiz}»</span>}
                          <span className="ml-auto tnum font-semibold text-ink-2">{fmtDauer(e.minuten)}</span>
                          <button onClick={() => setBearbeiten({ id: e.id, altDatum: e.datum, datum: e.datum, aufgabeId: e.aufgabeId, minuten: e.minuten, notiz: e.notiz ?? '' })} disabled={isPending} className={KNOPF.klein}>Ändern</button>
                          <button onClick={() => loeschen(e)} disabled={isPending} className={KNOPF.rot}>Löschen</button>
                        </li>
                      )
                    })}
                  </ul>
                </>
              ) : (
                <p className="px-4 py-3 text-[12px] text-ink-4">Tag antippen für die Einträge.</p>
              )}
            </div>
          )}

          {ausw.total > 0 && (
            <div className="space-y-3">
              {ausw.kategorien.map(k => {
                const farbe = farbeVon(k.id)
                return (
                  <div key={k.id}>
                    <div className="flex items-center justify-between gap-3 text-[12px]">
                      <p className="font-semibold text-ink inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: farbe }} />{k.name}</p>
                      <p className="tnum text-ink-2"><span className="font-semibold">{fmtDauer(k.minuten)}</span> · {k.anteil} %</p>
                    </div>
                    <ul className="mt-1 space-y-1">
                      {k.aufgaben.map(a => (
                        <li key={a.id} className="grid grid-cols-[minmax(140px,1fr)_minmax(0,2fr)_auto] items-center gap-3 text-[11.5px]">
                          <span className="truncate text-ink-2" title={a.titel}>{a.titel}</span>
                          <span className="h-2.5 rounded-full bg-edge-row overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${Math.max(1, a.anteil)}%`, background: farbe }} /></span>
                          <span className="tnum text-ink-3 whitespace-nowrap">{fmtDauer(a.minuten)} · {a.anteil} % · {a.anzahl}×</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Einstellungen: Kategorien und Aufgaben (Dialog) ──────────── */}
      {einstellungen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Einstellungen, Kategorien und Aufgaben">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEinstellungen(false)} />
          <div className="relative bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
            <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-edge-soft flex-shrink-0">
              <div>
                <p className="text-sm font-bold text-ink">Einstellungen, Kategorien und Aufgaben</p>
                <p className="text-[11.5px] text-ink-4 mt-0.5">Kategorien anlegen, darunter die Aufgaben. Umbenennen mit dem Stift, Reihenfolge mit den Pfeilen. «Ausblenden» nimmt eine Aufgabe aus der Erfassung, die Einträge bleiben. Jede Änderung wird sofort gespeichert.</p>
              </div>
              <button onClick={() => setEinstellungen(false)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 flex-shrink-0" title="Schliessen">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-5 py-4 overflow-y-auto space-y-3">
              {verwMsg && <Meldung msg={verwMsg} />}
              {konfig.kategorien.length === 0 && <p className="text-sm text-ink-4">Noch keine Kategorien. Lege unten die erste an.</p>}
              {konfig.kategorien.map((k, ki) => (
                <div key={k.id} className="rounded-xl border border-edge-soft bg-surface p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: farbeVon(k.id) }} />
                    <Umbenennbar id={k.id} text={k.name} cls="text-[13px] font-semibold text-ink" />
                    <span className="ml-auto flex items-center gap-2">
                      <button onClick={() => speichereKonfig({ kategorien: verschiebe(konfig.kategorien, ki, -1) })} disabled={ki === 0 || isPending} className={KNOPF.klein} title="Nach oben">↑</button>
                      <button onClick={() => speichereKonfig({ kategorien: verschiebe(konfig.kategorien, ki, 1) })} disabled={ki === konfig.kategorien.length - 1 || isPending} className={KNOPF.klein} title="Nach unten">↓</button>
                      <button onClick={() => kategorieLoeschen(k.id)} disabled={k.aufgaben.length > 0 || isPending} className={KNOPF.rot} title={k.aufgaben.length > 0 ? 'Zuerst die Aufgaben entfernen' : 'Kategorie löschen'}>Löschen</button>
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {k.aufgaben.length === 0 && <li className="text-[11.5px] text-ink-5">Noch keine Aufgaben.</li>}
                    {k.aufgaben.map((a, ai) => {
                      const n = anzahl.get(a.id) ?? 0
                      return (
                        <li key={a.id} className={`flex flex-wrap items-center gap-2 text-[12.5px] rounded-lg bg-white border border-edge-soft px-2.5 py-1.5 ${a.archiviert ? 'opacity-60' : ''}`}>
                          <Umbenennbar id={a.id} text={a.titel} cls={`text-ink ${a.archiviert ? 'line-through' : ''}`} />
                          <span className="text-[10.5px] text-ink-4 tnum">{n} {n === 1 ? 'Eintrag' : 'Einträge'}</span>
                          <span className="ml-auto flex items-center gap-2">
                            <button onClick={() => speichereKonfig({ kategorien: konfig.kategorien.map(x => (x.id === k.id ? { ...x, aufgaben: verschiebe(x.aufgaben, ai, -1) } : x)) })} disabled={ai === 0 || isPending} className={KNOPF.klein} title="Nach oben">↑</button>
                            <button onClick={() => speichereKonfig({ kategorien: konfig.kategorien.map(x => (x.id === k.id ? { ...x, aufgaben: verschiebe(x.aufgaben, ai, 1) } : x)) })} disabled={ai === k.aufgaben.length - 1 || isPending} className={KNOPF.klein} title="Nach unten">↓</button>
                            <button onClick={() => archivieren(a.id, !a.archiviert)} disabled={isPending} className={KNOPF.klein} title={a.archiviert ? 'Wieder zum Erfassen anbieten' : 'Beim Erfassen nicht mehr anbieten, Einträge bleiben'}>{a.archiviert ? 'Einblenden' : 'Ausblenden'}</button>
                            <button onClick={() => aufgabeLoeschen(k.id, a.id)} disabled={n > 0 || isPending} className={KNOPF.rot} title={n > 0 ? 'Hat Einträge, darum nur ausblenden' : 'Aufgabe löschen'}>Löschen</button>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                  <div className="mt-2 flex items-center gap-2">
                    <input value={neueAufgabe[k.id] ?? ''} maxLength={NAME_MAX} onChange={e => setNeueAufgabe(n => ({ ...n, [k.id]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); aufgabeAnlegen(k.id) } }}
                      placeholder="Neue Aufgabe in dieser Kategorie" className="input-field text-sm !py-1.5 flex-1 max-w-xs" />
                    <button onClick={() => aufgabeAnlegen(k.id)} disabled={isPending || !(neueAufgabe[k.id] ?? '').trim()} className="btn-secondary !px-3 !py-1.5 !text-xs disabled:opacity-50">＋ Aufgabe</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-edge-soft flex flex-wrap items-center gap-2 flex-shrink-0 bg-surface rounded-b-2xl">
              <input value={neueKategorie} maxLength={NAME_MAX} onChange={e => setNeueKategorie(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); kategorieAnlegen() } }}
                placeholder="Neue Kategorie, zum Beispiel Administration" className="input-field text-sm flex-1 min-w-[200px]" />
              <button onClick={kategorieAnlegen} disabled={isPending || !neueKategorie.trim()} className="btn-primary !px-3.5 !py-2 !text-xs disabled:opacity-50">＋ Kategorie</button>
              <button onClick={() => setEinstellungen(false)} className="btn-secondary !px-3.5 !py-2 !text-xs ml-auto">Fertig</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
