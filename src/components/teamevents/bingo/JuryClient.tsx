'use client'

// Jurybereich des Fotobingos (Bianka und Noah): Fotokontrolle mit Filtern,
// Live Resultate mit Herleitung, Wertungen und Korrektur, Matrix aller
// Aufgaben gegen alle Teams, Jurypreis Galerie, Siegerehrung für den Bus
// und das Protokoll aller Entscheidungen.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  bingoFotoEntscheiden, bingoFotoLoeschen, bingoFotoLink, bingoWertungSetzen, bingoFavoritSetzen, bingoJurypreisSetzen, bingoResultateVeroeffentlichen,
} from '@/actions/teamevent-bingo'
import { BINGO_FREI_ID, PUNKTE, type FotoStatus } from '@/lib/teamevent-bingo'
import type { JuryDaten, JuryFoto, JuryTeam } from '@/lib/teamevent-bingo-data'
import FotoVollbild from '../FotoVollbild'

type Tab = 'kontrolle' | 'resultate' | 'jurypreis' | 'siegerehrung' | 'protokoll'
const TABS: Array<[Tab, string]> = [['kontrolle', 'Fotokontrolle'], ['resultate', 'Resultate'], ['jurypreis', 'Jurypreis'], ['siegerehrung', 'Siegerehrung'], ['protokoll', 'Protokoll']]
const STATUS_UI: Record<FotoStatus, { label: string; cls: string }> = {
  offen: { label: 'Offen', cls: 'bg-apricot-bg text-apricot-ink' },
  akzeptiert: { label: 'Akzeptiert', cls: 'bg-mint-bg text-mint-ink' },
  abgelehnt: { label: 'Abgelehnt', cls: 'bg-blush-bg text-blush-ink' },
}
const MARKIERUNGEN: Record<string, { feld: 'buchstabenOk' | 'bonusKuerbis' | 'bonusSchritte'; label: string }> = {
  buchstaben: { feld: 'buchstabenOk', label: 'Alle acht Buchstaben gefunden' },
  kuerbis: { feld: 'bonusKuerbis', label: 'Meiste Kürbisse, 2 Extrapunkte' },
  schritte: { feld: 'bonusSchritte', label: 'Meiste Schritte, 2 Extrapunkte' },
}

const fmtZeit = (iso: string) => iso ? new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }) : ''
const fmtTagZeit = (iso: string) => iso ? `${new Date(iso).toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'Europe/Zurich' })} ${fmtZeit(iso)}` : ''

export default function JuryClient({ daten, basis }: { daten: JuryDaten; basis: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<Tab>('kontrolle')
  const [fTeam, setFTeam] = useState('')
  const [fAufgabe, setFAufgabe] = useState('')
  const [fStatus, setFStatus] = useState<FotoStatus | 'alle'>('offen')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [ansicht, setAnsicht] = useState<{ liste: JuryFoto[]; index: number } | null>(null)
  const [offenTeam, setOffenTeam] = useState<string | null>(null)
  const [korr, setKorr] = useState<Record<string, { punkte: string; grund: string }>>({})
  const [schritt, setSchritt] = useState(-1)   // Siegerehrung, -1 = noch nicht gestartet

  // Still aktualisieren: beim Zurückkehren und alle 30 Sekunden, nicht während ein Foto gross offen ist
  const dialogRef = useRef(false)
  dialogRef.current = !!ansicht
  useEffect(() => {
    const still = () => { if (document.visibilityState === 'visible' && !dialogRef.current) router.refresh() }
    const onVis = () => { if (document.visibilityState === 'visible') still() }
    document.addEventListener('visibilitychange', onVis)
    const iv = setInterval(still, 30_000)
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(iv) }
  }, [router])

  const aufgabenInReihenfolge = useMemo(() => daten.layout.filter(id => id !== BINGO_FREI_ID).map(id => daten.aufgaben.find(a => a.id === id)!).filter(Boolean), [daten.layout, daten.aufgaben])
  const teamById = useMemo(() => new Map(daten.teams.map(t => [t.id, t])), [daten.teams])
  const fotoById = useMemo(() => new Map(daten.fotos.map(f => [f.id, f])), [daten.fotos])
  const zaehler = useMemo(() => ({
    offen: daten.fotos.filter(f => f.status === 'offen').length,
    akzeptiert: daten.fotos.filter(f => f.status === 'akzeptiert').length,
    abgelehnt: daten.fotos.filter(f => f.status === 'abgelehnt').length,
    alle: daten.fotos.length,
  }), [daten.fotos])
  const gefiltert = useMemo(() => daten.fotos.filter(f =>
    (!fTeam || f.team === fTeam) && (!fAufgabe || f.aufgabe === fAufgabe) && (fStatus === 'alle' || f.status === fStatus),
  ), [daten.fotos, fTeam, fAufgabe, fStatus])
  const rangiert = useMemo(() => daten.teams.filter(t => !t.ausserKonkurrenz && t.rang != null).sort((a, b) => (a.rang ?? 99) - (b.rang ?? 99)), [daten.teams])
  const ausserKonkurrenz = useMemo(() => daten.teams.filter(t => t.ausserKonkurrenz), [daten.teams])
  const preisFoto = daten.jury.preis ? fotoById.get(daten.jury.preis) ?? null : null
  const favoritenFotos = useMemo(() => daten.jury.favoriten.map(id => fotoById.get(id)).filter((f): f is JuryFoto => !!f), [daten.jury.favoriten, fotoById])
  const sortierteFotos = useMemo(() => [...daten.fotos].sort((a, b) => (a.status === 'akzeptiert' ? 0 : a.status === 'offen' ? 1 : 2) - (b.status === 'akzeptiert' ? 0 : b.status === 'offen' ? 1 : 2) || a.am.localeCompare(b.am)), [daten.fotos])

  function run(fn: () => Promise<{ error?: string } | { success: true }>, id?: string, ok?: string) {
    setMsg(null); if (id) setBusy(id)
    startTransition(async () => {
      const r = await fn()
      setBusy(null)
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      if (ok) setMsg({ type: 'ok', text: ok })
      router.refresh()
    })
  }
  const entscheiden = (f: JuryFoto, status: FotoStatus) => run(() => bingoFotoEntscheiden(daten.slug, f.id, status), f.id)
  const loeschen = (f: JuryFoto) => { if (confirm(`Foto von ${f.teamName} (${f.aufgabeTitel}) endgültig löschen?`)) run(() => bingoFotoLoeschen(daten.slug, f.id), f.id, 'Foto gelöscht.') }
  const oeffnen = (f: JuryFoto, liste: JuryFoto[]) => setAnsicht({ liste, index: Math.max(0, liste.findIndex(x => x.id === f.id)) })
  const linkFuer = async (f: JuryFoto) => {
    const r = await bingoFotoLink(daten.slug, f.id, 'ansicht')
    return 'error' in r && r.error ? null : (r as { url: string }).url
  }
  function korrekturSpeichern(t: JuryTeam) {
    const k = korr[t.id] ?? { punkte: String(t.wertung.korrektur), grund: t.wertung.korrekturGrund }
    const n = parseInt(k.punkte || '0', 10)
    if (Number.isNaN(n)) { setMsg({ type: 'err', text: 'Bitte eine ganze Zahl eingeben.' }); return }
    run(() => bingoWertungSetzen(daten.slug, t.id, { korrektur: n, korrekturGrund: k.grund }), t.id, 'Korrektur gespeichert.')
  }

  const Status = ({ s }: { s: FotoStatus }) => <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_UI[s].cls}`}>{STATUS_UI[s].label}</span>

  // ── Siegerehrung ──
  const plaetze = useMemo(() => [...rangiert].sort((a, b) => (b.rang ?? 0) - (a.rang ?? 0)), [rangiert])   // letzter Platz zuerst
  const schritte = plaetze.length + (preisFoto ? 1 : 0)

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-ink-4">
          <Link href={basis} className="hover:text-ink-2">Teamevents</Link><span className="mx-1.5">/</span>
          <Link href={`${basis}/${daten.slug}`} className="hover:text-ink-2">{daten.ordner.name}</Link><span className="mx-1.5">/</span>
          <Link href={`${basis}/${daten.slug}/spiele`} className="hover:text-ink-2">Spiele</Link><span className="mx-1.5">/</span>
          <span className="text-ink-2">Jury</span>
        </p>
        <h1 className="page-title mt-1">Jury</h1>
        <p className="page-subtitle">Fotokontrolle, Resultate und Siegerehrung. Nur für Bianka und Noah sichtbar.</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-full text-[12.5px] font-semibold border transition-colors ${tab === k ? 'bg-dusk text-white border-dusk' : 'bg-white text-ink-2 border-edge-ctl hover:bg-edge-row'}`}>
            {l}{k === 'kontrolle' && zaehler.offen > 0 && <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${tab === k ? 'bg-white/20' : 'bg-apricot-bg text-apricot-ink'}`}>{zaehler.offen}</span>}
          </button>
        ))}
      </div>

      {msg && (
        <p className={`text-xs px-3 py-2 rounded-ctl inline-block ${msg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>{msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}</p>
      )}

      {/* ── Fotokontrolle ── */}
      {tab === 'kontrolle' && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <select value={fTeam} onChange={e => setFTeam(e.target.value)} className="input-field !w-auto text-[13px]">
                <option value="">Alle Teams</option>
                {daten.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select value={fAufgabe} onChange={e => setFAufgabe(e.target.value)} className="input-field !w-auto text-[13px]">
                <option value="">Alle Aufgaben</option>
                {[...aufgabenInReihenfolge, daten.aufgaben.find(a => a.id === BINGO_FREI_ID)!].filter(Boolean).map(a => <option key={a.id} value={a.id}>{a.titel}</option>)}
              </select>
              <div className="flex flex-wrap gap-1 ml-auto">
                {(['offen', 'akzeptiert', 'abgelehnt', 'alle'] as const).map(s => (
                  <button key={s} onClick={() => setFStatus(s)} className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold border ${fStatus === s ? 'bg-dusk text-white border-dusk' : 'bg-white text-ink-2 border-edge-ctl'}`}>
                    {s === 'alle' ? 'Alle' : STATUS_UI[s].label} <span className="tnum opacity-80">{zaehler[s]}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[12px] text-ink-3 tnum">
              <span className={`font-bold ${zaehler.offen > 0 ? 'text-apricot-ink' : 'text-mint-ink'}`}>{zaehler.offen} Fotos offen</span>
              {zaehler.offen === 0 && daten.fotos.length > 0 ? ', alles geprüft' : ''} · {zaehler.alle} Fotos gesamt
            </p>
            {fAufgabe && MARKIERUNGEN[fAufgabe] && (
              <div className="rounded-xl border border-edge-ctl bg-surface p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4 mb-2">{MARKIERUNGEN[fAufgabe].label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {daten.teams.map(t => {
                    const an = t.wertung[MARKIERUNGEN[fAufgabe].feld]
                    return (
                      <button key={t.id} disabled={isPending} onClick={() => run(() => bingoWertungSetzen(daten.slug, t.id, { [MARKIERUNGEN[fAufgabe].feld]: !an }), t.id)}
                        className={`px-2.5 py-1 rounded-full text-[12px] font-semibold border ${an ? 'bg-mint-ink text-white border-mint-ink' : 'bg-white text-ink-2 border-edge-ctl'}`}>
                        {an ? '✓ ' : ''}{t.name}
                      </button>
                    )
                  })}
                </div>
                {fAufgabe === 'buchstaben' && <p className="text-[11px] text-ink-4 mt-2">Ohne diese Markierung zählt die Buchstabenjagd nicht, egal wie viele Fotos akzeptiert sind.</p>}
              </div>
            )}
          </div>

          {gefiltert.length === 0 ? (
            <div className="card px-6 py-12 text-center text-sm text-ink-4">{fStatus === 'offen' ? 'Keine offenen Fotos. Alles geprüft.' : 'Keine Fotos mit diesen Filtern.'}</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {gefiltert.map(f => (
                <div key={f.id} className="card overflow-hidden flex flex-col">
                  <button onClick={() => oeffnen(f, gefiltert)} disabled={busy === f.id} className="relative block w-full aspect-square bg-surface overflow-hidden" aria-label="Foto öffnen">
                    {f.vorschauUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.vorschauUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                    ) : <span className="absolute inset-0 flex items-center justify-center text-[11px] text-ink-4">Keine Vorschau</span>}
                    <span className="absolute top-1.5 left-1.5 flex gap-1"><Status s={f.status} />{f.test && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/90 text-apricot-ink border border-apricot-bg">Test</span>}</span>
                    {daten.jury.preis === f.id && <span className="absolute top-1.5 right-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-lilac-bg text-lilac-ink">Jurypreis</span>}
                  </button>
                  <div className="px-3 py-2 flex-1">
                    <p className="text-[12.5px] font-semibold text-ink leading-tight truncate">{f.teamName}</p>
                    <p className="text-[11.5px] text-ink-2 truncate">{f.aufgabeTitel}</p>
                    <p className="text-[10.5px] text-ink-4 tnum">{f.rufname} · {fmtTagZeit(f.am)}</p>
                    {f.status !== 'offen' && f.entschiedenVon && <p className="text-[10px] text-ink-4 tnum">{STATUS_UI[f.status].label} von {f.entschiedenVon.split(/\s+/)[0]} {f.entschiedenAm ? fmtZeit(f.entschiedenAm) : ''}</p>}
                  </div>
                  <div className="px-2 pb-2 grid grid-cols-2 gap-1.5">
                    <button onClick={() => entscheiden(f, f.status === 'akzeptiert' ? 'offen' : 'akzeptiert')} disabled={busy === f.id || isPending}
                      className={`py-2 rounded-lg text-[12px] font-semibold border ${f.status === 'akzeptiert' ? 'bg-mint-ink text-white border-mint-ink' : 'bg-white text-mint-ink border-mint-mid/60 hover:bg-mint-bg'}`}>
                      ✓ Akzeptieren
                    </button>
                    <button onClick={() => entscheiden(f, f.status === 'abgelehnt' ? 'offen' : 'abgelehnt')} disabled={busy === f.id || isPending}
                      className={`py-2 rounded-lg text-[12px] font-semibold border ${f.status === 'abgelehnt' ? 'bg-blush-ink text-white border-blush-ink' : 'bg-white text-blush-ink border-blush-bg hover:bg-blush-bg'}`}>
                      ✕ Ablehnen
                    </button>
                    <button onClick={() => loeschen(f)} disabled={busy === f.id || isPending} className="col-span-2 text-[10.5px] text-ink-4 hover:text-red-500 py-0.5">Foto löschen</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-ink-4 px-1">Ein zweiter Tipp auf den aktiven Knopf setzt das Foto wieder auf offen. Entscheide lassen sich jederzeit ändern, auch nach dem Ende des Spiels.</p>
        </div>
      )}

      {/* ── Resultate ── */}
      {tab === 'resultate' && (
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-edge-soft flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">Live Rangliste</p>
              <p className="text-[11px] text-ink-4">Feld {PUNKTE.feld}, Reihe {PUNKTE.reihe}, volle Karte {PUNKTE.karte}, Bonus je {PUNKTE.bonus}, Maximum {PUNKTE.max}. Rechnet sich nach jedem Entscheid neu.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] min-w-[560px]">
                <thead>
                  <tr className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink-4 border-b-[1.5px] border-edge-ctl">
                    <th className="text-left px-4 py-2">Rang</th><th className="text-left px-2 py-2">Team</th>
                    <th className="text-right px-2 py-2">Felder</th><th className="text-right px-2 py-2">Reihen</th><th className="text-right px-2 py-2">Karte</th>
                    <th className="text-right px-2 py-2">Bonus</th><th className="text-right px-2 py-2">Korr.</th><th className="text-right px-4 py-2">Punkte</th>
                  </tr>
                </thead>
                <tbody>
                  {rangiert.map(t => (
                    <tr key={t.id} onClick={() => setOffenTeam(offenTeam === t.id ? null : t.id)} className={`border-b border-edge-row cursor-pointer hover:bg-hovrow ${offenTeam === t.id ? 'bg-active' : ''}`}>
                      <td className="px-4 py-2.5 font-bold tnum">{t.rang}</td>
                      <td className="px-2 py-2.5 font-semibold">{t.name}</td>
                      <td className="px-2 py-2.5 text-right tnum">{t.punkte.felder}</td>
                      <td className="px-2 py-2.5 text-right tnum">{t.punkte.reihen}</td>
                      <td className="px-2 py-2.5 text-right tnum">{t.punkte.volleKarte ? `+${PUNKTE.karte}` : '–'}</td>
                      <td className="px-2 py-2.5 text-right tnum">{t.punkte.bonus > 0 ? `+${t.punkte.bonus * PUNKTE.bonus}` : '–'}</td>
                      <td className="px-2 py-2.5 text-right tnum">{t.punkte.korrektur !== 0 ? (t.punkte.korrektur > 0 ? `+${t.punkte.korrektur}` : t.punkte.korrektur) : '–'}</td>
                      <td className="px-4 py-2.5 text-right font-bold text-mint-ink tnum">{t.punkte.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {ausserKonkurrenz.length > 0 && (
              <p className="px-5 py-2.5 text-[11.5px] text-ink-4 border-t border-edge-soft">
                Ausser Konkurrenz {ausserKonkurrenz.map(t => `${t.name} (${t.punkte.total} Punkte)`).join(', ')}
              </p>
            )}
          </div>

          {offenTeam && teamById.get(offenTeam) && (() => {
            const t = teamById.get(offenTeam)!
            const erledigt = new Set(t.punkte.erledigt)
            const k = korr[t.id] ?? { punkte: String(t.wertung.korrektur), grund: t.wertung.korrekturGrund }
            return (
              <div className="card p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4">Herleitung</p>
                    <p className="text-[16px] font-bold text-ink">{t.name}</p>
                    <p className="text-[12px] text-ink-3 tnum">{t.punkte.felder} Felder = {t.punkte.felder * PUNKTE.feld}, {t.punkte.reihen} Reihen = {t.punkte.reihen * PUNKTE.reihe}{t.punkte.volleKarte ? `, volle Karte = ${PUNKTE.karte}` : ''}{t.punkte.bonus ? `, Bonus = ${t.punkte.bonus * PUNKTE.bonus}` : ''}{t.punkte.korrektur ? `, Korrektur = ${t.punkte.korrektur}` : ''}, total {t.punkte.total}</p>
                  </div>
                  <button onClick={() => setOffenTeam(null)} className="text-ink-4 hover:text-ink-2 text-sm">✕</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(['buchstabenOk', 'bonusKuerbis', 'bonusSchritte'] as const).map(feld => {
                    const label = feld === 'buchstabenOk' ? 'Alle acht Buchstaben gefunden' : feld === 'bonusKuerbis' ? 'Bonus Kürbismeer' : 'Bonus Schrittzähler'
                    const an = t.wertung[feld]
                    return (
                      <button key={feld} disabled={isPending} onClick={() => run(() => bingoWertungSetzen(daten.slug, t.id, { [feld]: !an }), t.id)}
                        className={`px-3 py-2 rounded-xl text-[12.5px] font-semibold border text-left ${an ? 'bg-mint-ink text-white border-mint-ink' : 'bg-white text-ink-2 border-edge-ctl'}`}>
                        {an ? '✓ ' : '○ '}{label}
                      </button>
                    )
                  })}
                </div>
                <div className="rounded-xl border border-edge-ctl bg-surface p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4 mb-2">Korrektur (wird separat ausgewiesen und protokolliert)</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1"><span className="text-[10px] text-ink-4">Punkte, plus oder minus</span>
                      <input type="number" min={-99} max={99} value={k.punkte} onChange={e => setKorr({ ...korr, [t.id]: { ...k, punkte: e.target.value } })} className="input-field text-sm w-24" /></label>
                    <label className="flex flex-col gap-1 flex-1 min-w-[180px]"><span className="text-[10px] text-ink-4">Grund</span>
                      <input value={k.grund} onChange={e => setKorr({ ...korr, [t.id]: { ...k, grund: e.target.value } })} maxLength={200} className="input-field text-sm" placeholder="z. B. Foto per WhatsApp nachgereicht" /></label>
                    <button onClick={() => korrekturSpeichern(t)} disabled={isPending} className="btn-primary !px-3 !py-2 !text-xs">Speichern</button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4 mb-2">Erledigt ({erledigt.size})</p>
                    <ul className="space-y-1.5">
                      {aufgabenInReihenfolge.filter(a => erledigt.has(a.id)).map(a => {
                        const f = daten.fotos.filter(x => x.team === t.id && x.aufgabe === a.id && x.status === 'akzeptiert').sort((x, y) => x.am.localeCompare(y.am))[0]
                        return (
                          <li key={a.id} className="flex items-center gap-2 text-[12.5px]">
                            {f?.vorschauUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={f.vorschauUrl} alt="" className="w-8 h-8 rounded-md object-cover flex-shrink-0" />
                            ) : <span className="w-8 h-8 rounded-md bg-mint-bg flex-shrink-0" />}
                            <span className="font-semibold text-ink truncate">{a.titel}</span>
                            {f && <span className="text-[10.5px] text-ink-4 tnum ml-auto whitespace-nowrap">{f.rufname} {fmtTagZeit(f.am)}</span>}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4 mb-2">Offen ({aufgabenInReihenfolge.length - erledigt.size})</p>
                    <div className="flex flex-wrap gap-1.5">
                      {aufgabenInReihenfolge.filter(a => !erledigt.has(a.id)).map(a => {
                        const n = daten.fotos.filter(x => x.team === t.id && x.aufgabe === a.id && x.status === 'offen').length
                        return <span key={a.id} className={`text-[11.5px] px-2 py-0.5 rounded-full border ${n > 0 ? 'bg-apricot-bg text-apricot-ink border-apricot-bg' : 'bg-surface text-ink-3 border-edge-ctl'}`}>{a.titel}{n > 0 ? ` · ${n} offen` : ''}</span>
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}

          <div className="card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-edge-soft"><p className="text-sm font-semibold text-ink">Matrix Aufgaben gegen Teams</p><p className="text-[11px] text-ink-4">✓ erledigt (akzeptiert), ◔ Fotos offen, ✕ nur abgelehnte Fotos</p></div>
            <div className="overflow-x-auto">
              <table className="text-[11.5px]">
                <thead>
                  <tr className="border-b-[1.5px] border-edge-ctl">
                    <th className="text-left px-4 py-2 sticky left-0 bg-white text-[10px] font-semibold uppercase tracking-[.1em] text-ink-4">Aufgabe</th>
                    {daten.teams.map(t => <th key={t.id} className="px-2 py-2 text-[10px] font-semibold text-ink-3 whitespace-nowrap max-w-[90px] truncate" title={t.name}>{t.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {aufgabenInReihenfolge.map(a => (
                    <tr key={a.id} className="border-b border-edge-row">
                      <td className="px-4 py-1.5 sticky left-0 bg-white font-semibold text-ink whitespace-nowrap">{a.titel}</td>
                      {daten.teams.map(t => {
                        const fs = daten.fotos.filter(f => f.team === t.id && f.aufgabe === a.id)
                        const ok = t.punkte.erledigt.includes(a.id)
                        const sym = ok ? '✓' : fs.some(f => f.status === 'offen') ? '◔' : fs.length > 0 ? '✕' : '·'
                        const cls = ok ? 'text-mint-ink font-bold' : sym === '◔' ? 'text-apricot-ink' : sym === '✕' ? 'text-blush-ink' : 'text-ink-5'
                        return <td key={t.id} className={`px-2 py-1.5 text-center ${cls}`}>{sym}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Jurypreis ── */}
      {tab === 'jurypreis' && (
        <div className="space-y-4">
          <div className="card p-5">
            <p className="text-sm font-semibold text-ink mb-1">Jurypreis für das kreativste Foto</p>
            <p className="text-[12px] text-ink-3 mb-3">Mit dem Stern Favoriten sammeln, dann ein Foto als Jurypreis wählen. Der Preis gibt keine Punkte und erscheint nach «Resultate veröffentlichen» für alle im Ordner Spiele.</p>
            {preisFoto ? (
              <div className="flex items-center gap-3 rounded-xl border border-lilac-bg bg-lilac-soft p-3">
                {preisFoto.vorschauUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preisFoto.vorschauUrl} alt="" className="w-20 h-20 rounded-lg object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-lilac-label">Jurypreis</p>
                  <p className="text-[14px] font-bold text-ink">{preisFoto.teamName}</p>
                  <p className="text-[12px] text-ink-3">{preisFoto.aufgabeTitel} · {preisFoto.rufname}</p>
                </div>
                <button onClick={() => run(() => bingoJurypreisSetzen(daten.slug, null), 'preis', 'Jurypreis zurückgenommen.')} disabled={isPending} className="text-[11px] text-ink-4 hover:text-red-500">Zurücknehmen</button>
              </div>
            ) : <p className="text-[12.5px] text-ink-4">Noch kein Jurypreis vergeben.</p>}
          </div>
          {daten.jury.favoriten.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4 mb-2 px-1">Favoriten ({daten.jury.favoriten.length})</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {favoritenFotos.map(f => <JuryKarte key={f.id} f={f} favorit preis={daten.jury.preis === f.id} busy={busy === f.id || isPending} onOeffnen={() => oeffnen(f, favoritenFotos)}
                  onFavorit={() => run(() => bingoFavoritSetzen(daten.slug, f.id, false), f.id)} onPreis={() => run(() => bingoJurypreisSetzen(daten.slug, f.id), f.id, 'Jurypreis vergeben.')} />)}
              </div>
            </div>
          )}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4 mb-2 px-1">Alle Fotos ({daten.fotos.length})</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {sortierteFotos.map(f => (
                <JuryKarte key={f.id} f={f} favorit={daten.jury.favoriten.includes(f.id)} preis={daten.jury.preis === f.id} busy={busy === f.id || isPending} onOeffnen={() => oeffnen(f, sortierteFotos)}
                  onFavorit={() => run(() => bingoFavoritSetzen(daten.slug, f.id, !daten.jury.favoriten.includes(f.id)), f.id)} onPreis={() => run(() => bingoJurypreisSetzen(daten.slug, f.id), f.id, 'Jurypreis vergeben.')} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Siegerehrung ── */}
      {tab === 'siegerehrung' && (
        <div className="space-y-4">
          <div className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink">Resultate veröffentlichen</p>
                <p className="text-[12px] text-ink-3 mt-0.5">Erst danach sehen alle die Rangliste mit Punkten und den Jurypreis im Ordner Spiele. {zaehler.offen > 0 ? `Achtung, ${zaehler.offen} Fotos sind noch offen.` : 'Alle Fotos sind geprüft.'}</p>
              </div>
              {daten.rolle.verwaltet ? (
                <button onClick={() => run(() => bingoResultateVeroeffentlichen(daten.slug, !daten.einstellungen.resultate), 'resultate', daten.einstellungen.resultate ? 'Resultate wieder verborgen.' : 'Resultate veröffentlicht.')} disabled={isPending}
                  className={daten.einstellungen.resultate ? 'btn-secondary' : 'btn-primary'}>
                  {daten.einstellungen.resultate ? 'Veröffentlichung zurücknehmen' : 'Resultate veröffentlichen'}
                </button>
              ) : <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${daten.einstellungen.resultate ? 'bg-mint-bg text-mint-ink' : 'bg-edge-row text-ink-3'}`}>{daten.einstellungen.resultate ? 'Veröffentlicht' : 'Noch nicht veröffentlicht'} (nur Bianka)</span>}
            </div>
          </div>

          <div className="card p-5 min-h-[360px] flex flex-col items-center justify-center text-center">
            {schritt < 0 ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-ink-4">Fotobingo Europapark 2026</p>
                <p className="text-[26px] font-bold text-ink mt-1">Siegerehrung</p>
                <p className="text-[13px] text-ink-3 mt-2 max-w-sm">Ein Tipp pro Platz, vom letzten zum ersten. Zum Schluss der Jurypreis. Gemacht fürs Handy im Bus.</p>
                <button onClick={() => setSchritt(0)} disabled={plaetze.length === 0} className="btn-primary mt-6 !px-6 !py-3 !text-sm">Los gehts</button>
              </>
            ) : schritt < plaetze.length ? (() => {
              const t = plaetze[schritt]
              const erster = t.rang === 1
              return (
                <>
                  <p className="text-[12px] font-semibold uppercase tracking-[.18em] text-ink-4">Platz</p>
                  <p className={`font-bold leading-none mt-1 ${erster ? 'text-[88px] text-mint-ink' : 'text-[72px] text-ink'}`}>{t.rang}</p>
                  <p className="text-[24px] font-bold text-ink mt-3">{t.name}</p>
                  <p className="text-[18px] font-bold text-mint-ink tnum mt-1">{t.punkte.total} Punkte</p>
                  <p className="text-[12px] text-ink-3 tnum mt-1">{t.punkte.felder} Felder · {t.punkte.reihen} Reihen{t.punkte.volleKarte ? ' · volle Karte' : ''}{t.punkte.bonus ? ` · ${t.punkte.bonus} Bonus` : ''}{t.punkte.korrektur ? ` · Korrektur ${t.punkte.korrektur > 0 ? '+' : ''}${t.punkte.korrektur}` : ''}</p>
                  <button onClick={() => setSchritt(s => s + 1)} className="btn-primary mt-6 !px-6 !py-3 !text-sm">{schritt + 1 < schritte ? 'Weiter' : 'Fertig'}</button>
                </>
              )
            })() : schritt === plaetze.length && preisFoto ? (
              <>
                <p className="text-[12px] font-semibold uppercase tracking-[.18em] text-lilac-label">Jurypreis für das kreativste Foto</p>
                {preisFoto.vorschauUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preisFoto.vorschauUrl} alt="" className="mt-3 max-h-[320px] rounded-2xl object-contain shadow-lg" />
                )}
                <p className="text-[24px] font-bold text-ink mt-3">{preisFoto.teamName}</p>
                <p className="text-[13px] text-ink-3">{preisFoto.aufgabeTitel} · {preisFoto.rufname}</p>
                <button onClick={() => setSchritt(s => s + 1)} className="btn-primary mt-6 !px-6 !py-3 !text-sm">Fertig</button>
              </>
            ) : (
              <>
                <p className="text-[26px] font-bold text-ink">Danke fürs Mitspielen</p>
                <button onClick={() => setSchritt(-1)} className="btn-secondary mt-6">Zurück zum Anfang</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Protokoll ── */}
      {tab === 'protokoll' && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-edge-soft"><p className="text-sm font-semibold text-ink">Protokoll</p><p className="text-[11px] text-ink-4">Jede Entscheidung mit Zeit und Person, neueste zuerst.</p></div>
          {daten.log.length === 0 ? <p className="px-5 py-8 text-sm text-ink-4 text-center">Noch keine Einträge.</p> : (
            <ul className="divide-y divide-edge-row">
              {daten.log.map(l => (
                <li key={l.id} className="px-5 py-2 text-[12.5px] flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="tnum text-ink-4 w-[110px]">{fmtTagZeit(l.am)}</span>
                  <span className="font-semibold text-ink-2">{l.von.split(/\s+/)[0]}</span>
                  <span className="text-ink-2 flex-1 min-w-[200px]">{l.text}</span>
                  {l.test && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-apricot-bg text-apricot-ink self-center">Test</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {ansicht && ansicht.liste[ansicht.index] && (
        <FotoVollbild liste={ansicht.liste} index={ansicht.index} onIndex={i => setAnsicht({ ...ansicht, index: i })} laden={linkFuer} onClose={() => setAnsicht(null)}
          titel={f => `${f.teamName} · ${f.aufgabeTitel}`} untertitel={f => `${f.rufname} · ${fmtTagZeit(f.am)} · ${STATUS_UI[f.status].label}`}
          aktionen={f => (<>
            <button onClick={() => entscheiden(f, f.status === 'akzeptiert' ? 'offen' : 'akzeptiert')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${f.status === 'akzeptiert' ? 'bg-mint-ink' : 'bg-white/15 hover:bg-mint-ink/80'}`}>✓ Akzeptieren</button>
            <button onClick={() => entscheiden(f, f.status === 'abgelehnt' ? 'offen' : 'abgelehnt')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${f.status === 'abgelehnt' ? 'bg-blush-ink' : 'bg-white/15 hover:bg-blush-ink/80'}`}>✕ Ablehnen</button>
          </>)} />
      )}
    </div>
  )
}

function JuryKarte({ f, favorit, preis, busy, onOeffnen, onFavorit, onPreis }: { f: JuryFoto; favorit: boolean; preis: boolean; busy: boolean; onOeffnen: () => void; onFavorit: () => void; onPreis: () => void }) {
  return (
    <div className={`card overflow-hidden ${preis ? 'ring-2 ring-lilac-ink' : ''}`}>
      <button onClick={onOeffnen} disabled={busy} className="relative block w-full aspect-square bg-surface overflow-hidden" aria-label="Foto öffnen">
        {f.vorschauUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={f.vorschauUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : <span className="absolute inset-0 flex items-center justify-center text-[11px] text-ink-4">Keine Vorschau</span>}
        <span className={`absolute top-1.5 left-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_UI[f.status].cls}`}>{STATUS_UI[f.status].label}</span>
        {preis && <span className="absolute top-1.5 right-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-lilac-bg text-lilac-ink">Jurypreis</span>}
      </button>
      <div className="px-3 py-2">
        <p className="text-[12.5px] font-semibold text-ink truncate">{f.teamName}</p>
        <p className="text-[11px] text-ink-3 truncate">{f.aufgabeTitel} · {f.rufname}</p>
      </div>
      <div className="px-2 pb-2 flex gap-1.5">
        <button onClick={onFavorit} disabled={busy} className={`flex-1 py-1.5 rounded-lg text-[12px] font-semibold border ${favorit ? 'bg-apricot-ink text-white border-apricot-ink' : 'bg-white text-apricot-ink border-apricot-bg'}`}>{favorit ? '★ Favorit' : '☆ Favorit'}</button>
        <button onClick={onPreis} disabled={busy || preis} className="flex-1 py-1.5 rounded-lg text-[12px] font-semibold border bg-white text-lilac-ink border-lilac-bg disabled:opacity-50">Jurypreis</button>
      </div>
    </div>
  )
}
