'use client'

// Geschäftsanalyse — Übersicht mit Kennzahlen, Trends, Grafiken,
// Monatstabelle, Kategorien-Auswertung, Reserveziel und Prüfliste.
//
// DATENSCHUTZ: Diese Komponente erhält NUR Monats-Aggregate (Zahlen pro
// Kategorie und Monat). Einzelne Buchungen mit Texten (Patientennamen,
// Löhne) werden erst auf Klick über Server Actions geladen und erscheinen
// ausschliesslich in der Buchungsliste und der Prüfliste.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  createFinanzUploadUrl, importUbsCsv, ladeMonatsdetails, setzeKategorieManuell,
  ladePruefliste, markiereGeprueft, regelAusVorschlag, speichereZiel,
  type DetailBuchung, type PrueflisteBuchung,
} from '@/actions/finanzen'
import { decodeCsvBytes, parseUbsCsv, FinanzCsvError, type ParseErgebnis } from '@/lib/finanzen/ubs-csv'
import type { FinanzKonto, ImportEintrag } from '@/lib/finanzen/types'
import { GRUPPEN_META, GRUPPEN_REIHENFOLGE, UNKLASSIERT_ID, type Kategorie } from '@/lib/finanzen/kategorien'
import {
  kombiniereMonate, baueReihen, berechneKennzahlen, trendBetrieb, trendReserven,
  wohinGehtGeld, groessteVeraenderungen, kategorieVergleich, zielStatus, baueHinweise,
  monatLabel, monatKurz, vormonat,
  type MonatsAggregat, type MonatsReihe, type FinanzZiel, type Trend,
} from '@/lib/finanzen/analyse'
import { MonatsverlaufChart, KontostandChart, type VerlaufPunkt, type KontostandPunkt } from './FinanzCharts'
import { fmtChf } from '@/lib/utils'

const fmtRp = (rp: number) => fmtChf(rp / 100)
const fmtSig = (rp: number) => `${rp < 0 ? '−' : ''}${fmtChf(Math.abs(rp) / 100)}`
const fmtSigPlus = (rp: number) => `${rp < 0 ? '−' : '+'}${fmtChf(Math.abs(rp) / 100)}`
const fmtD = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const fmtDk = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`
const fmtZeit = (iso: string) =>
  `${new Date(iso).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })}, ${new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' })}`

const FORMAT_LABEL = { aktuell: 'UBS CSV (aktuell)', transaktionsbetrag: 'UBS CSV (Transaktionsbetrag)', alt21: 'UBS CSV (altes Format, 21 Spalten)' } as const

// Wenn ein Server-Aufruf WIRFT (statt sauber einen Fehler zurückzugeben),
// läuft im Browser meist noch ein älterer Seitenstand (z.B. PWA nach einem
// Update) — vorher wurde das stumm verschluckt und sah wie ein Bug aus.
const AKTUALISIEREN_HINWEIS = 'Das hat nicht geklappt — wahrscheinlich läuft noch eine ältere Version der Seite. Bitte die Seite einmal neu laden und nochmals versuchen.'

// Speicher-Aufrufe strikt NACHEINANDER ausführen: Zwei gleichzeitige
// Zuordnungen bearbeiten dieselbe Jahresdatei, und die zweite würde die
// erste überschreiben (deshalb «verschwanden» Kategorien nach dem
// Neuladen). Der Server sperrt zusätzlich pro Datei — doppelter Schutz.
let speicherKette: Promise<void> = Promise.resolve()
function nacheinander<T>(fn: () => Promise<T>): Promise<T> {
  const lauf = speicherKette.then(fn, fn)
  speicherKette = lauf.then(() => undefined, () => undefined)
  return lauf
}

type Periode = 'l12' | 'jahr' | 'vorjahr' | 'alles'
const PERIODEN: Array<{ key: Periode; label: string }> = [
  { key: 'l12', label: 'Letzte 12 Monate' },
  { key: 'jahr', label: 'Dieses Jahr' },
  { key: 'vorjahr', label: 'Letztes Jahr' },
  { key: 'alles', label: 'Alles' },
]

type Vorschau = {
  datei: File
  parse: ParseErgebnis
  kontoBekannt: boolean
  monate: Array<{ monat: string; status: string }>
}

type Props = {
  kontos: FinanzKonto[]
  kategorien: Kategorie[]
  aggregate: MonatsAggregat[]
  ziel: FinanzZiel
  protokoll: ImportEintrag[]
  heuteMonat: string
  unklassiertOffen: number
  grosseOffen: number
}

function KategorieOptionen({ kategorien }: { kategorien: Kategorie[] }) {
  return (
    <>
      {GRUPPEN_REIHENFOLGE.map(g => {
        const kats = kategorien.filter(k => k.gruppe === g && k.aktiv)
        if (kats.length === 0) return null
        return (
          <optgroup key={g} label={GRUPPEN_META[g].label}>
            {kats.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
          </optgroup>
        )
      })}
    </>
  )
}

const statusBadge = (r: MonatsReihe) =>
  r.status === 'laufend'
    ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-edge-row text-ink-4">laufend</span>
    : r.status === 'unvollstaendig'
      ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-apricot-bg text-apricot-ink">unvollständig</span>
      : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-mint-bg text-mint-ink">OK</span>

export default function FinanzenClient({ kontos, kategorien, aggregate, ziel, protokoll, heuteMonat, unklassiertOffen, grosseOffen }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const dateiRef = useRef<HTMLInputElement>(null)
  const [vorschau, setVorschau] = useState<Vorschau | null>(null)
  const [kontoName, setKontoName] = useState('Geschäftskonto UBS')
  const [fehler, setFehler] = useState<string | null>(null)
  const [erfolg, setErfolg] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)

  const [kontoSel, setKontoSel] = useState<string>('alle')
  const [periode, setPeriode] = useState<Periode>('l12')
  const [offenMonat, setOffenMonat] = useState<string | null>(null)
  const [trendOffen, setTrendOffen] = useState<'b' | 'r' | null>(null)
  const [protokollOffen, setProtokollOffen] = useState(false)

  // ── Analyse (reine Funktionen auf den Aggregaten) ──
  const reihen = useMemo(
    () => baueReihen(kombiniereMonate(aggregate, kontoSel), heuteMonat),
    [aggregate, kontoSel, heuteMonat],
  )
  const kz = useMemo(() => berechneKennzahlen(reihen, heuteMonat), [reihen, heuteMonat])
  const trendB = useMemo(() => trendBetrieb(reihen, fmtRp), [reihen])
  const trendR = useMemo(() => trendReserven(reihen, fmtRp), [reihen])
  const zielSt = useMemo(() => zielStatus(ziel, kz, reihen, heuteMonat), [ziel, kz, reihen, heuteMonat])

  const bereich = useMemo((): { von: string; bis: string } | null => {
    if (reihen.length === 0) return null
    const letzte = reihen[reihen.length - 1].monat
    if (periode === 'jahr') return { von: `${heuteMonat.slice(0, 4)}-01`, bis: `${heuteMonat.slice(0, 4)}-12` }
    if (periode === 'vorjahr') {
      const j = parseInt(heuteMonat.slice(0, 4), 10) - 1
      return { von: `${j}-01`, bis: `${j}-12` }
    }
    if (periode === 'alles') return { von: reihen[0].monat, bis: letzte }
    let von = letzte
    for (let i = 0; i < 11; i++) von = vormonat(von)
    return { von, bis: letzte }
  }, [reihen, periode, heuteMonat])

  const reihenAnzeige = useMemo(
    () => bereich ? reihen.filter(r => r.monat >= bereich.von && r.monat <= bereich.bis) : [],
    [reihen, bereich],
  )
  const wohin = useMemo(
    () => bereich ? wohinGehtGeld(reihen, bereich.von, bereich.bis, kategorien) : [],
    [reihen, bereich, kategorien],
  )
  const veraend = useMemo(() => groessteVeraenderungen(reihen, kategorien), [reihen, kategorien])
  const hinweise = useMemo(
    () => baueHinweise({ reihen, kennzahlen: kz, kategorien, ziel, zielSt, trendB, unklassiertOffen, grosseOffen, fmtRp }),
    [reihen, kz, kategorien, ziel, zielSt, trendB, unklassiertOffen, grosseOffen],
  )

  const verlaufPunkte = useMemo((): VerlaufPunkt[] => reihenAnzeige.map(r => ({
    monat: r.monat, einnahmenRp: r.E + r.R, rueckRp: r.R, ausgabenRp: r.A, betriebRp: r.B, laufend: r.status === 'laufend',
  })), [reihenAnzeige])

  const investKats = useMemo(() => new Set(kategorien.filter(k => k.gruppe === 'INVESTITIONEN').map(k => k.id)), [kategorien])
  const kontostandPunkte = useMemo((): KontostandPunkt[] => reihenAnzeige.map(r => ({
    monat: r.monat, saldoRp: r.saldoEndeRp, laufend: r.status === 'laufend',
    investitionen: Object.entries(r.kategorien)
      .filter(([id, rp]) => investKats.has(id) && rp <= -500000)
      .map(([id, rp]) => ({ name: kategorien.find(k => k.id === id)?.name ?? 'Investition', betragRp: -rp })),
  })), [reihenAnzeige, investKats, kategorien])

  const datenBis = reihen.length > 0 ? reihen[reihen.length - 1].monat : null
  const letzterImport = protokoll[0]?.am ?? null

  // Rollende Ø3-Spalte der Monatstabelle (nur vollständige Monate)
  const oe3ProMonat = useMemo(() => {
    const map = new Map<string, number>()
    const ok: MonatsReihe[] = []
    for (const r of reihen) {
      if (r.status !== 'ok') continue
      ok.push(r)
      if (ok.length >= 3) {
        const drei = ok.slice(-3)
        map.set(r.monat, Math.round(drei.reduce((s, x) => s + x.B, 0) / 3))
      }
    }
    return map
  }, [reihen])
  const bVorjahr = (monat: string) => reihen.find(r => r.monat === `${parseInt(monat.slice(0, 4), 10) - 1}${monat.slice(4)}`)?.B ?? null

  // ── CSV-Upload (Vorschau im Browser, massgebend ist der Server) ──
  const kontoByKey = useMemo(() => new Map(kontos.map(k => [k.kontoKey, k])), [kontos])
  const monateVorhanden = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const a of aggregate) {
      const s = m.get(a.kontoKey) ?? new Set<string>()
      s.add(a.monat)
      m.set(a.kontoKey, s)
    }
    return m
  }, [aggregate])

  async function dateiGewaehlt(datei: File) {
    setFehler(null)
    setErfolg(null)
    try {
      const parse = parseUbsCsv(decodeCsvBytes(new Uint8Array(await datei.arrayBuffer())))
      const bestehend = kontoByKey.get(parse.kontoKey)
      const vorhanden = monateVorhanden.get(parse.kontoKey)
      const monate = Object.entries(parse.monate).sort(([a], [b]) => a.localeCompare(b)).map(([monat, pm]) => {
        const da = vorhanden?.has(monat) ?? false
        const status = pm.vollstaendig ? (da ? 'ersetzt' : 'neu') : (da ? 'ergänzt' : 'neu (unvollständig)')
        return { monat, status }
      })
      setKontoName(bestehend?.name ?? 'Geschäftskonto UBS')
      setVorschau({ datei, parse, kontoBekannt: !!bestehend, monate })
    } catch (e) {
      setFehler(e instanceof FinanzCsvError ? e.message : 'Die Datei konnte nicht gelesen werden — ist es der CSV-Export aus dem UBS Online Banking?')
    }
  }

  function importieren() {
    if (!vorschau) return
    setFehler(null)
    setLaeuft(true)
    startTransition(async () => {
      try {
        const auth = await createFinanzUploadUrl(vorschau.datei.name)
        if ('error' in auth && auth.error) throw new Error(auth.error)
        const { path, token } = auth as { path: string; token: string }
        const supabase = createClient()
        const { error: upErr } = await supabase.storage
          .from('employee-documents')
          .uploadToSignedUrl(path, token, vorschau.datei, { contentType: 'text/csv' })
        if (upErr) throw new Error(`Upload fehlgeschlagen: ${upErr.message}`)
        const r = await importUbsCsv(path, vorschau.kontoBekannt ? undefined : kontoName)
        if ('error' in r && r.error) throw new Error(r.error)
        const ok = r as { anzahl: number; vorgemerkt: number; abgleichOk: boolean | null; monate?: Record<string, 'neu' | 'ersetzt' | 'ergaenzt'> }
        setVorschau(null)
        const STATUS_TEXT = { neu: 'neu', ersetzt: 'aktualisiert', ergaenzt: 'ergänzt' } as const
        const monatsListe = Object.entries(ok.monate ?? {})
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([m, st]) => `${monatLabel(m)} (${STATUS_TEXT[st] ?? st})`)
          .join(', ')
        setErfolg(`Import abgeschlossen: ${ok.anzahl} Buchungen übernommen${ok.vorgemerkt > 0 ? `, ${ok.vorgemerkt} vorgemerkte nicht übernommen` : ''}.${monatsListe ? ` Monate: ${monatsListe} — Kennzahlen, Grafiken, Monatstabelle und Hinweise sind neu berechnet.` : ''}${ok.abgleichOk === false ? ' Achtung, der Saldo-Abgleich stimmt nicht.' : ''}`)
        // Analyse neu laden; der gewählte Zeitraum springt auf «Letzte 12 Monate»,
        // damit der neue Monat sicher sichtbar ist
        setPeriode('l12')
        setOffenMonat(null)
        router.refresh()
      } catch (e) {
        setFehler(e instanceof Error ? e.message : 'Import fehlgeschlagen — bitte erneut versuchen.')
      } finally {
        setLaeuft(false)
      }
    })
  }

  const abgleichBadge = (ok: boolean | null) =>
    ok === true ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-mint-bg text-mint-ink">OK</span>
    : ok === false ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blush-bg text-blush-ink">Abweichung</span>
    : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-edge-row text-ink-4">—</span>

  const trendPill = (t: Trend | null, key: 'b' | 'r') => {
    if (!t) return null
    const farben = t.richtung === 'auf' ? 'bg-mint-bg text-mint-ink' : t.richtung === 'ab' ? 'bg-blush-bg text-blush-ink' : 'bg-lilac-bg text-lilac-ink'
    const pfeil = t.richtung === 'auf' ? '↑' : t.richtung === 'ab' ? '↓' : '→'
    return (
      <div className="relative">
        <button
          onClick={() => setTrendOffen(trendOffen === key ? null : key)}
          onMouseEnter={() => setTrendOffen(key)} onMouseLeave={() => setTrendOffen(o => (o === key ? null : o))}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${farben}`}
        >
          {pfeil} {t.label}
        </button>
        {trendOffen === key && (
          <div className="absolute z-20 top-full mt-1.5 left-0 w-72 bg-white border border-edge rounded-ctl shadow-lg px-3.5 py-2.5 text-[11.5px] text-ink-2 leading-relaxed">
            {t.erklaerung}
          </div>
        )}
      </div>
    )
  }

  const leer = aggregate.length === 0

  return (
    <div className="space-y-5">
      {/* Kopf */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Geschäftsanalyse</h1>
          <p className="page-subtitle">
            {datenBis ? <>Daten bis {monatLabel(datenBis)}{letzterImport && <> · letzter Import {fmtZeit(letzterImport)}</>}</>
              : 'Einnahmen und Ausgaben der Praxis Kehrsatz aus dem UBS Konto'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/finanzen/regeln" className="btn-secondary">Kategorien &amp; Regeln</Link>
          <button onClick={() => dateiRef.current?.click()} className="btn-primary">CSV hochladen</button>
        </div>
        <input ref={dateiRef} type="file" accept=".csv,text/csv" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) dateiGewaehlt(f); e.target.value = '' }} />
      </div>

      {fehler && !vorschau && <p className="text-xs px-3.5 py-2.5 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {fehler}</p>}
      {erfolg && <p className="text-xs px-3.5 py-2.5 rounded-ctl bg-mint-bg text-mint-ink inline-block">✓ {erfolg}</p>}

      {/* Leerer Zustand mit Export-Anleitung */}
      {leer && (
        <div className="card p-6">
          <p className="text-sm font-semibold text-ink mb-2">So exportierst du den Kontoauszug aus dem UBS Online Banking</p>
          <ol className="text-[13px] text-ink-2 space-y-1.5 list-decimal ml-5">
            <li>«Konten &amp; Anlagen» öffnen und «Kontotransaktionen» wählen.</li>
            <li>Das Geschäftskonto und den Zeitraum setzen (beim ersten Mal z.B. Januar 2025 bis heute).</li>
            <li>Über das Excel/CSV-Symbol die Datei herunterladen.</li>
            <li>Die Datei vor dem Hochladen <span className="font-semibold">nicht in Excel öffnen und speichern</span> — das verändert das Format.</li>
            <li>Hier oben rechts auf «CSV hochladen».</li>
          </ol>
          <p className="text-[11.5px] text-ink-4 mt-3">
            Die Seite wertet nur aus — es gibt keine Verbindung zur UBS und es werden keine Zahlungen ausgelöst.
          </p>
        </div>
      )}

      {!leer && (
        <>
          {/* Filter */}
          <div className="card px-4 py-3 flex flex-wrap items-center gap-2">
            {PERIODEN.map(p => (
              <button key={p.key} onClick={() => { setPeriode(p.key); setOffenMonat(null) }}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  periode === p.key ? 'bg-dusk-night text-white' : 'bg-surface border border-edge-ctl text-ink-3 hover:bg-hovrow'}`}>
                {p.label}
              </button>
            ))}
            {kontos.length > 1 && (
              <select value={kontoSel} onChange={e => { setKontoSel(e.target.value); setOffenMonat(null) }} className="select-field ml-auto text-xs">
                <option value="alle">Alle Konten</option>
                {kontos.map(k => <option key={k.kontoKey} value={k.kontoKey}>{k.name}</option>)}
              </select>
            )}
          </div>

          {/* Kennzahlen */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-card bg-lilac-bg p-4">
              <p className="text-[10px] font-bold uppercase tracking-[.1em] text-lilac-ink/70">Kontostand</p>
              <p className="text-xl font-bold text-lilac-ink tnum mt-1">{kz.kontostandRp != null ? fmtSig(kz.kontostandRp) : '—'}</p>
              <p className="text-[11px] text-lilac-ink/80 mt-0.5 tnum">
                {kz.delta3Rp != null ? `${fmtSigPlus(kz.delta3Rp)} in 3 Monaten` : kz.kontostandMonat ? `Stand ${monatKurz(kz.kontostandMonat)} ${kz.kontostandMonat.slice(0, 4)}` : ''}
              </p>
            </div>
            <div className={`rounded-card p-4 ${kz.oeB3Rp != null && kz.oeB3Rp < 0 ? 'bg-blush-bg' : 'bg-mint-bg'}`}>
              <p className={`text-[10px] font-bold uppercase tracking-[.1em] ${kz.oeB3Rp != null && kz.oeB3Rp < 0 ? 'text-blush-ink/70' : 'text-mint-ink/70'}`}>Betriebsergebnis Ø 3 Mt.</p>
              <p className={`text-xl font-bold tnum mt-1 ${kz.oeB3Rp != null && kz.oeB3Rp < 0 ? 'text-blush-ink' : 'text-mint-ink'}`}>{kz.oeB3Rp != null ? fmtSig(kz.oeB3Rp) : '—'}</p>
              <p className={`text-[11px] mt-0.5 tnum ${kz.oeB3Rp != null && kz.oeB3Rp < 0 ? 'text-blush-ink/80' : 'text-mint-ink/80'}`}>
                {kz.oeB3VorjahrRp != null ? `Vorjahr Ø ${fmtSig(kz.oeB3VorjahrRp)}` : 'Vorjahr fehlt noch'}
              </p>
            </div>
            <div className="rounded-card bg-mint-bg p-4">
              <p className="text-[10px] font-bold uppercase tracking-[.1em] text-mint-ink/70">Einnahmen seit Jahresbeginn</p>
              <p className="text-xl font-bold text-mint-ink tnum mt-1">{kz.ytdRp != null ? fmtRp(kz.ytdRp) : '—'}</p>
              <p className="text-[11px] text-mint-ink/80 mt-0.5 tnum">
                {kz.ytdProzent != null ? `${kz.ytdProzent >= 0 ? '+' : '−'}${String(Math.abs(kz.ytdProzent)).replace('.', ',')}% zum Vorjahr` : `${kz.ytdMonate.length} vollständige Monate`}
              </p>
            </div>
            <div className="rounded-card bg-apricot-bg p-4">
              <p className="text-[10px] font-bold uppercase tracking-[.1em] text-apricot-ink/70">Reserve</p>
              <p className="text-xl font-bold text-apricot-ink tnum mt-1">{kz.reserveMonate != null ? `${String(kz.reserveMonate).replace('.', ',')} Monate` : '—'}</p>
              <p className="text-[11px] text-apricot-ink/80 mt-0.5 tnum">
                {kz.oeA6Rp != null ? `bei Ø Ausgaben ${fmtRp(kz.oeA6Rp)}/Monat` : 'braucht 3 vollständige Monate'}
              </p>
            </div>
          </div>

          {/* Trends */}
          {(trendB || trendR) && (
            <div className="flex flex-wrap gap-2">
              {trendPill(trendB, 'b')}
              {trendPill(trendR, 'r')}
            </div>
          )}

          {/* Hinweise */}
          <div className="card overflow-hidden">
            <div className="px-6 py-4 border-b border-edge-soft">
              <p className="text-sm font-semibold text-ink">Hinweise</p>
              <p className="text-[11.5px] text-ink-4 mt-0.5">Automatisch aus den Zahlen abgeleitet — wo läuft es gut, wo lohnt sich ein Blick</p>
            </div>
            <div className="px-6 py-4 space-y-3">
              {hinweise.length === 0 && <p className="text-xs text-ink-4">Zurzeit keine besonderen Hinweise — die Zahlen sind unauffällig.</p>}
              {hinweise.map((h, i) => (
                <div key={i} className="flex gap-3">
                  <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${h.ton === 'gut' ? 'bg-mint-mid' : h.ton === 'achtung' ? 'bg-blush-ink' : 'bg-steel-ink'}`} />
                  <div>
                    <p className="text-[12.5px] font-semibold text-ink">{h.titel}</p>
                    <p className="text-[12px] text-ink-3 leading-relaxed">{h.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Monatsverlauf */}
          <div className="card p-5 sm:p-6">
            <p className="text-sm font-semibold text-ink mb-3">Monatsverlauf</p>
            <MonatsverlaufChart punkte={verlaufPunkte} oe3Rp={kz.oeB3Rp} />
          </div>

          {/* Kontostand */}
          <div className="card p-5 sm:p-6">
            <p className="text-sm font-semibold text-ink mb-3">Kontostand</p>
            <KontostandChart punkte={kontostandPunkte} zielRp={ziel.zielRp} />
          </div>

          {/* Monatstabelle */}
          <div className="card overflow-hidden">
            <div className="px-6 py-4 border-b border-edge-soft">
              <p className="text-sm font-semibold text-ink">Monatstabelle</p>
              <p className="text-[11.5px] text-ink-4 mt-0.5">Auf einen Monat klicken für Kategorien und Buchungen</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px]">
                <thead>
                  <tr>
                    {['Monat', 'Einnahmen', 'Ausgaben', 'Betriebsergebnis', 'Ø 3 Mt.', 'Vorjahresmonat', 'Einmaliges', 'Δ Kontostand', 'Kontostand', 'Status'].map((h, i) => (
                      <th key={h} className={`px-3 py-2 border-b-[1.5px] border-edge-ctl text-[10px] font-semibold uppercase tracking-[.08em] text-ink-4 whitespace-nowrap ${i >= 1 && i <= 8 ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...reihenAnzeige].reverse().map(r => {
                    const einmalig = r.S + r.I + r.F + r.U
                    const oe3 = oe3ProMonat.get(r.monat)
                    const vj = bVorjahr(r.monat)
                    const offen = offenMonat === r.monat
                    return (
                      <FragmentRow key={r.monat}>
                        <tr className="hover:bg-hovrow cursor-pointer" onClick={() => setOffenMonat(offen ? null : r.monat)}>
                          <td className="px-3 py-2.5 border-b border-edge-row text-[12.5px] font-semibold text-ink whitespace-nowrap">
                            <span className={`inline-block mr-1.5 text-ink-4 transition-transform ${offen ? 'rotate-90' : ''}`}>›</span>
                            {monatLabel(r.monat)}
                          </td>
                          <td className="px-3 py-2.5 border-b border-edge-row text-[12.5px] text-mint-ink text-right tnum">{fmtRp(r.E + r.R)}</td>
                          <td className="px-3 py-2.5 border-b border-edge-row text-[12.5px] text-apricot-ink text-right tnum">{fmtRp(r.A)}</td>
                          <td className={`px-3 py-2.5 border-b border-edge-row text-[12.5px] font-bold text-right tnum ${r.B >= 0 ? 'text-mint-ink' : 'text-blush-ink'}`}>{fmtSig(r.B)}</td>
                          <td className="px-3 py-2.5 border-b border-edge-row text-[12px] text-ink-3 text-right tnum">{oe3 != null ? fmtSig(oe3) : '—'}</td>
                          <td className="px-3 py-2.5 border-b border-edge-row text-[12px] text-ink-3 text-right tnum">{vj != null ? fmtSig(vj) : '—'}</td>
                          <td className="px-3 py-2.5 border-b border-edge-row text-[12px] text-ink-3 text-right tnum"
                            title={`Steuern ${fmtSig(r.S)} · Investitionen ${fmtSig(r.I)} · Finanzierung ${fmtSig(r.F)} · Unklassiert ${fmtSig(r.U)}`}>
                            {einmalig !== 0 ? fmtSig(einmalig) : '—'}
                          </td>
                          <td className={`px-3 py-2.5 border-b border-edge-row text-[12px] text-right tnum ${r.deltaK == null ? 'text-ink-4' : r.deltaK >= 0 ? 'text-mint-ink' : 'text-blush-ink'}`}>
                            {r.deltaK != null ? fmtSigPlus(r.deltaK) : '—'}
                          </td>
                          <td className="px-3 py-2.5 border-b border-edge-row text-[12.5px] font-semibold text-ink text-right tnum">{r.saldoEndeRp != null ? fmtSig(r.saldoEndeRp) : '—'}</td>
                          <td className="px-3 py-2.5 border-b border-edge-row whitespace-nowrap">
                            {statusBadge(r)}
                            {(r.kontrolleOk === false || r.abgleichOk === false) && (
                              <span className="ml-1.5 text-blush-ink cursor-help" title="Kontrollrechnung geht nicht auf — Daten fehlen oder sind doppelt. Am besten den Zeitraum nochmals aus dem E-Banking importieren.">⚠</span>
                            )}
                          </td>
                        </tr>
                        {offen && (
                          <tr>
                            <td colSpan={10} className="border-b border-edge-row bg-surface px-3 sm:px-5 py-4">
                              <MonatsDetails kontoSel={kontoSel} monat={r.monat} reihen={reihen} kategorien={kategorien} />
                            </td>
                          </tr>
                        )}
                      </FragmentRow>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Wohin geht das Geld + Grösste Veränderungen */}
          <div className="grid lg:grid-cols-2 gap-5 items-start">
            <div className="card overflow-hidden">
              <div className="px-6 py-4 border-b border-edge-soft">
                <p className="text-sm font-semibold text-ink">Wohin geht das Geld</p>
                <p className="text-[11.5px] text-ink-4 mt-0.5">Betriebsausgaben nach Kategorie im gewählten Zeitraum</p>
              </div>
              <div className="px-6 py-4 space-y-2.5">
                {wohin.length === 0 && <p className="text-xs text-ink-4">Noch keine Betriebsausgaben im gewählten Zeitraum.</p>}
                {wohin.slice(0, 9).map(p => (
                  <div key={p.kategorieId}>
                    <div className="flex items-baseline justify-between gap-3 text-[12px]">
                      <span className="font-semibold text-ink truncate">{p.name}</span>
                      <span className="tnum text-ink-2 whitespace-nowrap">
                        {fmtRp(p.betragRp)} <span className="text-ink-4">· {Math.round(p.anteil * 100)}%</span>
                        {p.deltaRp != null && Math.abs(p.deltaRp) >= 10000 && (
                          <span className={`ml-1.5 text-[10.5px] font-bold ${p.deltaRp > 0 ? 'text-blush-ink' : 'text-mint-ink'}`}
                            title="Veränderung gegenüber der gleich langen Vorperiode">
                            {p.deltaRp > 0 ? '+' : '−'}{fmtRp(Math.abs(p.deltaRp))}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-edge-row mt-1 overflow-hidden">
                      <div className="h-full rounded-full bg-apricot-mid" style={{ width: `${Math.max(2, p.anteil * 100)}%` }} />
                    </div>
                  </div>
                ))}
                {wohin.length > 9 && (
                  <p className="text-[11.5px] text-ink-4 pt-1">
                    Übrige {wohin.length - 9} Kategorien: {fmtRp(wohin.slice(9).reduce((s, p) => s + p.betragRp, 0))}
                  </p>
                )}
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="px-6 py-4 border-b border-edge-soft">
                <p className="text-sm font-semibold text-ink">Grösste Veränderungen</p>
                <p className="text-[11.5px] text-ink-4 mt-0.5">Letzte 3 vollständige Monate gegenüber den 3 davor</p>
              </div>
              <div className="px-6 py-2">
                {veraend.length === 0 && <p className="text-xs text-ink-4 py-2">Braucht mindestens 6 vollständige Monate.</p>}
                {veraend.map(v => (
                  <div key={v.kategorieId} className="flex items-center justify-between gap-3 py-2.5 border-b border-edge-row last:border-b-0">
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold text-ink truncate">{v.name}</p>
                      <p className="text-[11px] text-ink-4 tnum">{GRUPPEN_META[v.gruppe].label} · {fmtSig(v.vorherRp)} → {fmtSig(v.nachherRp)}</p>
                    </div>
                    <span className={`text-[12px] font-bold tnum whitespace-nowrap px-2 py-1 rounded-lg ${v.deltaRp >= 0 ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}
                      title={v.deltaRp >= 0 ? 'wirkt sich positiv auf den Kontostand aus' : 'wirkt sich negativ auf den Kontostand aus'}>
                      {fmtSigPlus(v.deltaRp)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Reserveziel */}
          <ZielKarte ziel={ziel} zielSt={zielSt} kz={kz} />

          {/* Prüfliste */}
          <Pruefliste kategorien={kategorien} unklassiertOffen={unklassiertOffen} grosseOffen={grosseOffen} />

          {/* Importprotokoll — zugeklappt */}
          {protokoll.length > 0 && (
            <div className="card overflow-hidden">
              <button onClick={() => setProtokollOffen(o => !o)} className="w-full px-6 py-4 flex items-center justify-between hover:bg-hovrow">
                <p className="text-sm font-semibold text-ink">Importprotokoll</p>
                <span className={`text-ink-4 transition-transform ${protokollOffen ? 'rotate-90' : ''}`}>›</span>
              </button>
              {protokollOffen && (
                <div className="px-6 pb-3 border-t border-edge-soft">
                  {protokoll.map(e => (
                    <div key={e.importId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-b border-edge-row last:border-b-0 text-[12px]">
                      <span className="font-semibold text-ink tnum">{fmtZeit(e.am)}</span>
                      <span className="text-ink-3 truncate max-w-[220px]">{e.dateiname}</span>
                      <span className="text-ink-4 tnum">{fmtD(e.von)} – {fmtD(e.bis)}</span>
                      <span className="text-ink-3 tnum">{e.anzahl} Buchungen</span>
                      <span className="text-mint-ink tnum">+{fmtRp(e.einnahmenRp)}</span>
                      <span className="text-apricot-ink tnum">−{fmtRp(e.ausgabenRp)}</span>
                      {abgleichBadge(e.abgleichOk)}
                      <span className="text-ink-4">· {e.importiertVon}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Vorschau-Modal für den CSV-Import */}
      {vorschau && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-lg shadow-xl overflow-hidden rounded-t-card border border-edge max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">Import prüfen</h3>
                <p className="text-xs text-ink-4 mt-0.5">{vorschau.datei.name} · {FORMAT_LABEL[vorschau.parse.format]}</p>
              </div>
              <button onClick={() => setVorschau(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4">✕</button>
            </div>
            <div className="px-6 py-4 space-y-3 overflow-auto text-[12.5px]">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <span className="text-ink-4">Konto</span>
                <span className="font-semibold text-ink tnum">{vorschau.parse.iban || vorschau.parse.kontonummer || '—'}</span>
                <span className="text-ink-4">Zeitraum</span>
                <span className="font-semibold text-ink tnum">{fmtD(vorschau.parse.von)} – {fmtD(vorschau.parse.bis)}</span>
                <span className="text-ink-4">Buchungen</span>
                <span className="font-semibold text-ink tnum">{vorschau.parse.buchungen.length}</span>
                <span className="text-ink-4">Summe Einnahmen</span>
                <span className="font-semibold text-mint-ink tnum">{fmtRp(vorschau.parse.buchungen.reduce((s, b) => s + (b.betragRp > 0 ? b.betragRp : 0), 0))}</span>
                <span className="text-ink-4">Summe Ausgaben</span>
                <span className="font-semibold text-apricot-ink tnum">{fmtRp(vorschau.parse.buchungen.reduce((s, b) => s + (b.betragRp < 0 ? -b.betragRp : 0), 0))}</span>
                <span className="text-ink-4">Anfangssaldo</span>
                <span className="font-semibold text-ink tnum">{vorschau.parse.anfangssaldoRp != null ? fmtRp(vorschau.parse.anfangssaldoRp) : '—'}</span>
                <span className="text-ink-4">Schlusssaldo</span>
                <span className="font-semibold text-ink tnum">{vorschau.parse.schlusssaldoRp != null ? fmtRp(vorschau.parse.schlusssaldoRp) : '—'}</span>
                <span className="text-ink-4">Saldo-Abgleich</span>
                <span>{abgleichBadge(vorschau.parse.saldoAbgleichOk)}</span>
              </div>
              {vorschau.parse.vorgemerkt > 0 && (
                <p className="text-[11.5px] text-ink-3">{vorschau.parse.vorgemerkt} vorgemerkte Buchung(en) nicht übernommen (noch nicht verbucht).</p>
              )}
              {vorschau.parse.warnungen.map((w, i) => (
                <p key={i} className="text-xs px-3 py-2 rounded-ctl bg-apricot-bg text-apricot-ink">⚠ {w}</p>
              ))}
              <div>
                <p className="eyebrow mb-1.5">Betroffene Monate</p>
                <div className="flex flex-wrap gap-1.5">
                  {vorschau.monate.map(m => (
                    <span key={m.monat} className="inline-flex items-center gap-1.5 text-[11px] bg-surface border border-edge-ctl rounded-lg px-2 py-1 tnum">
                      {monatLabel(m.monat)}
                      <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-full ${
                        m.status === 'neu' ? 'bg-mint-bg text-mint-ink'
                        : m.status === 'ersetzt' ? 'bg-steel-bg text-steel-ink'
                        : 'bg-apricot-bg text-apricot-ink'}`}>{m.status}</span>
                    </span>
                  ))}
                </div>
              </div>
              {!vorschau.kontoBekannt && (
                <div>
                  <p className="field-label">Name für dieses Konto</p>
                  <input value={kontoName} onChange={e => setKontoName(e.target.value)} className="input-field w-full" />
                </div>
              )}
              {fehler && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink">⚠ {fehler}</p>}
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={() => setVorschau(null)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={importieren} disabled={laeuft || isPending} className="btn-primary flex-1 disabled:opacity-50">
                {laeuft ? 'Wird importiert…' : 'Importieren'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// React braucht für <tr>-Paare in map() ein Fragment mit key
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

// ── Monatsdetails: Kategorien (anklickbar) + Buchungen je Kategorie (lazy) ──
// Die Kategorien-Liste zeigt pro Kategorie Betrag, 6-Monats-Schnitt und die
// Anzahl Buchungen; ein Klick filtert die Buchungsliste darunter auf diese
// Kategorie. Ohne Filter ist die Liste nach Kategorie gruppiert. In jeder
// Zeile lässt sich die Kategorie direkt umbuchen (manuell gewinnt über die
// Regeln) — Tabelle, Balken und Auswertung rechnen danach neu.

function MonatsDetails({ kontoSel, monat, reihen, kategorien }: {
  kontoSel: string; monat: string; reihen: MonatsReihe[]; kategorien: Kategorie[]
}) {
  const router = useRouter()
  const [buchungen, setBuchungen] = useState<DetailBuchung[] | null>(null)
  const [laden, setLaden] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [hinweis, setHinweis] = useState<string | null>(null)
  const [offeneSammel, setOffeneSammel] = useState<Set<string>>(new Set())
  const [speichert, setSpeichert] = useState<string | null>(null)
  // Kategorie-Filter (Klick auf eine Kategorie) und eingeklappte Gruppen
  const [katFilter, setKatFilter] = useState<string | null>(null)
  const [zugeklappt, setZugeklappt] = useState<Set<string>>(new Set())

  const vergleich = useMemo(() => kategorieVergleich(reihen, monat, kategorien), [reihen, monat, kategorien])
  const maxAbs = Math.max(1, ...vergleich.map(v => Math.abs(v.betragRp)))

  const katName = useCallback(
    (id: string) => kategorien.find(k => k.id === id)?.name ?? (id === UNKLASSIERT_ID ? 'Unklassiert' : id),
    [kategorien],
  )

  // Anzahl geladener Buchungen je Kategorie (für die Kategorien-Liste)
  const anzahlProKat = useMemo(() => {
    const m: Record<string, number> = {}
    for (const b of buchungen ?? []) m[b.kategorieId] = (m[b.kategorieId] ?? 0) + 1
    return m
  }, [buchungen])

  // Buchungen nach Kategorie gruppiert, in der Reihenfolge der Kategorien-Liste
  const gruppen = useMemo(() => {
    if (!buchungen) return []
    const reihenfolge = vergleich.map(v => v.kategorieId)
    const byKat = new Map<string, DetailBuchung[]>()
    for (const b of buchungen) {
      if (katFilter && b.kategorieId !== katFilter) continue
      const list = byKat.get(b.kategorieId) ?? []
      list.push(b)
      byKat.set(b.kategorieId, list)
    }
    return Array.from(byKat.entries())
      .map(([id, bs]) => ({ id, name: katName(id), buchungen: bs, summeRp: bs.reduce((s, b) => s + b.betragRp, 0) }))
      .sort((a, b) => {
        const ia = reihenfolge.indexOf(a.id), ib = reihenfolge.indexOf(b.id)
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || Math.abs(b.summeRp) - Math.abs(a.summeRp)
      })
  }, [buchungen, katFilter, vergleich, katName])

  async function detailsLaden(erste: boolean) {
    if (erste) setLaden(true)
    setFehler(null)
    try {
      const r = await ladeMonatsdetails(kontoSel, monat)
      if ('error' in r && r.error) setFehler(r.error)
      else setBuchungen((r as { buchungen: DetailBuchung[] }).buchungen)
    } catch {
      setFehler('Die Buchungen konnten nicht geladen werden.')
    } finally {
      if (erste) setLaden(false)
    }
  }

  useEffect(() => {
    setKatFilter(null)
    setZugeklappt(new Set())
    setHinweis(null)
    detailsLaden(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kontoSel, monat])

  async function umbuchen(b: DetailBuchung, kategorieId: string) {
    setSpeichert(b.id)
    setFehler(null)
    try {
      const r = await nacheinander(() => setzeKategorieManuell(b.kontoKey, b.id, monat, kategorieId || null))
      if ('error' in r && r.error) { setFehler(r.error); return }
      if (kategorieId) {
        setBuchungen(alt => alt?.map(x => x.id === b.id ? { ...x, kategorieId, quelle: 'manuell' } : x) ?? null)
        const kurz = b.text.length > 48 ? `${b.text.slice(0, 48)}…` : b.text || '(ohne Text)'
        setHinweis(`«${kurz}» (${fmtSig(b.betragRp)}) ist jetzt in «${katName(kategorieId)}»${katFilter && katFilter !== kategorieId ? ' — die Zeile ist aus dieser Kategorie verschwunden' : ''}.`)
        setTimeout(() => setHinweis(null), 7000)
      } else {
        // zurück auf Automatik: neu laden, damit Regel/Intern korrekt erscheint
        await detailsLaden(false)
      }
      router.refresh()
    } catch {
      setFehler(AKTUALISIEREN_HINWEIS)
    } finally {
      setSpeichert(null)
    }
  }

  function gruppeUmschalten(id: string) {
    setZugeklappt(z => { const n = new Set(z); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const filterName = katFilter ? katName(katFilter) : null
  const gefiltert = katFilter ? gruppen.reduce((s, g) => s + g.buchungen.length, 0) : (buchungen?.length ?? 0)

  return (
    <div className="space-y-4">
      {/* Kategorien gegen den 6-Monats-Schnitt — anklickbar als Filter */}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <p className="eyebrow !mb-0">Kategorien im {monatLabel(monat)}</p>
          <p className="text-[11px] text-ink-4">Kategorie anklicken → nur ihre Buchungen anzeigen</p>
        </div>
        <div className="space-y-1 max-w-2xl">
          {vergleich.map(v => {
            const aktiv = katFilter === v.kategorieId
            const n = anzahlProKat[v.kategorieId] ?? 0
            return (
              <button
                key={v.kategorieId}
                type="button"
                onClick={() => setKatFilter(f => (f === v.kategorieId ? null : v.kategorieId))}
                aria-pressed={aktiv}
                title={aktiv ? 'Filter aufheben — alle Buchungen anzeigen' : `Nur die Buchungen in «${v.name}» anzeigen`}
                className={`w-full text-left grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 items-center rounded-lg px-2 py-1.5 -mx-2 transition-colors ${
                  aktiv ? 'bg-active ring-1 ring-edge-strong' : 'hover:bg-hovrow'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12px] font-semibold text-ink truncate">{v.name}</span>
                    {buchungen && <span className="text-[10px] text-ink-4 tnum shrink-0">{n} Buchung{n !== 1 ? 'en' : ''}</span>}
                    {v.auffaellig && <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-blush-bg text-blush-ink shrink-0">auffällig</span>}
                  </div>
                  <div className="h-1.5 rounded-full bg-edge-row mt-1 overflow-hidden">
                    <div className={`h-full rounded-full ${v.betragRp >= 0 ? 'bg-mint-mid' : 'bg-apricot-mid'}`}
                      style={{ width: `${Math.max(2, Math.abs(v.betragRp) / maxAbs * 100)}%` }} />
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-[12px] font-bold tnum ${v.betragRp >= 0 ? 'text-mint-ink' : 'text-apricot-ink'}`}>{fmtSig(v.betragRp)}</p>
                  <p className="text-[10px] text-ink-4 tnum">{v.schnittRp != null ? `Ø 6 Mt. ${fmtSig(v.schnittRp)}` : 'noch kein Schnitt'}</p>
                </div>
              </button>
            )
          })}
          {vergleich.length === 0 && <p className="text-xs text-ink-4">Keine Buchungen in diesem Monat.</p>}
        </div>
      </div>

      {/* Buchungen — gefiltert auf eine Kategorie oder nach Kategorie gruppiert */}
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
          <p className="eyebrow !mb-0">
            Buchungen{filterName ? ` in «${filterName}»` : ' nach Kategorie'}
            {buchungen && !laden && <span className="normal-case tracking-normal font-normal text-ink-4"> · {gefiltert}</span>}
          </p>
          {katFilter && (
            <button type="button" onClick={() => setKatFilter(null)} className="text-[11px] font-semibold text-steel-ink hover:underline">
              Alle Buchungen anzeigen
            </button>
          )}
          <span className="text-[11px] text-ink-4">Falsch zugeordnet? Im Auswahlfeld rechts direkt umbuchen — gilt sofort für Tabelle und Auswertung.</span>
        </div>
        {laden && <p className="text-xs text-ink-4 py-2">Buchungen werden geladen…</p>}
        {fehler && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {fehler}</p>}
        {hinweis && <p className="text-xs px-3 py-2 rounded-ctl bg-mint-bg text-mint-ink inline-block mb-2">✓ {hinweis}</p>}
        {buchungen && buchungen.length === 0 && !laden && <p className="text-xs text-ink-4">Keine Buchungen in diesem Monat.</p>}
        {buchungen && buchungen.length > 0 && gruppen.length === 0 && !laden && (
          <p className="text-xs text-ink-4">Keine Buchungen mehr in dieser Kategorie.</p>
        )}
        {gruppen.length > 0 && (
          <div className="space-y-2">
            {gruppen.map(g => {
              const zu = zugeklappt.has(g.id)
              return (
                <div key={g.id} className="rounded-xl border border-edge-row overflow-hidden">
                  <button
                    type="button"
                    onClick={() => gruppeUmschalten(g.id)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 bg-surface text-left hover:bg-hovrow transition-colors"
                    title={zu ? 'Buchungen dieser Kategorie aufklappen' : 'Buchungen dieser Kategorie zuklappen'}
                  >
                    <span className="text-[12px] font-semibold text-ink min-w-0 truncate">
                      {g.name} <span className="text-ink-4 font-normal tnum">· {g.buchungen.length} Buchung{g.buchungen.length !== 1 ? 'en' : ''}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className={`text-[12px] font-bold tnum ${g.summeRp >= 0 ? 'text-mint-ink' : 'text-apricot-ink'}`}>{fmtSig(g.summeRp)}</span>
                      <span className={`text-ink-4 text-[11px] transition-transform ${zu ? '' : 'rotate-90'}`}>›</span>
                    </span>
                  </button>
                  {!zu && (
                    <div className="divide-y divide-edge-row">
                      {g.buchungen.map(b => (
                        <div key={b.id} className="bg-white px-3 py-2">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            <span className="text-[11.5px] font-semibold text-ink tnum w-11 shrink-0">{fmtDk(b.datum)}</span>
                            <span className="text-[12px] text-ink-2 flex-1 min-w-[140px] break-words">{b.text || '(ohne Text)'}
                              {b.gross && <span className="ml-1.5 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-steel-bg text-steel-ink align-middle">gross</span>}
                            </span>
                            <span className={`text-[12.5px] font-bold tnum ${b.betragRp >= 0 ? 'text-mint-ink' : 'text-ink'}`}>{fmtSig(b.betragRp)}</span>
                            <select
                              value={b.quelle === 'manuell' ? b.kategorieId : b.kategorieId === UNKLASSIERT_ID ? '' : b.kategorieId}
                              onChange={e => umbuchen(b, e.target.value)}
                              disabled={speichert === b.id}
                              onClick={e => e.stopPropagation()}
                              className="select-field text-[11px] py-1 max-w-[190px] disabled:opacity-50"
                              title={b.quelle === 'manuell' ? 'von Hand zugeordnet' : b.quelle === 'regel' ? 'automatisch per Regel' : b.quelle === 'intern' ? 'automatisch als interne Umbuchung erkannt' : 'noch keiner Kategorie zugeordnet'}
                            >
                              <option value="">{b.quelle === 'unklassiert' ? 'Unklassiert' : 'Automatisch'}</option>
                              <KategorieOptionen kategorien={kategorien} />
                            </select>
                            <span className="text-[9.5px] text-ink-4 w-14 shrink-0">
                              {speichert === b.id ? 'speichert…' : b.quelle === 'manuell' ? 'manuell' : b.quelle === 'regel' ? 'Regel' : b.quelle === 'intern' ? 'intern' : ''}
                            </span>
                            {b.details.length > 0 && (
                              <button type="button"
                                onClick={() => setOffeneSammel(s => { const n = new Set(s); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n })}
                                className="text-[10.5px] font-semibold text-steel-ink hover:underline">
                                Sammelbuchung ({b.details.length}) {offeneSammel.has(b.id) ? '▴' : '▾'}
                              </button>
                            )}
                          </div>
                          {offeneSammel.has(b.id) && b.details.length > 0 && (
                            <div className="mt-2 ml-11 pl-3 border-l-2 border-edge-ctl space-y-1">
                              {b.details.map((d, i) => (
                                <div key={i} className="flex justify-between gap-3 text-[11.5px]">
                                  <span className="text-ink-3 break-words">{d.text || '(ohne Text)'}</span>
                                  <span className="tnum text-ink-2 whitespace-nowrap">{fmtSig(d.betragRp)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Reserveziel ─────────────────────────────────────────────────────────

function ZielKarte({ ziel, zielSt, kz }: {
  ziel: FinanzZiel
  zielSt: ReturnType<typeof zielStatus>
  kz: ReturnType<typeof berechneKennzahlen>
}) {
  const router = useRouter()
  const [bearbeiten, setBearbeiten] = useState(false)
  const [zielChf, setZielChf] = useState(ziel.zielRp != null ? String(Math.round(ziel.zielRp / 100)) : '')
  const [zieldatum, setZieldatum] = useState(ziel.zieldatum ?? '')
  const [monate, setMonate] = useState(String(ziel.mindestMonate))
  const [speichert, setSpeichert] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  async function speichern() {
    setSpeichert(true)
    setFehler(null)
    try {
      const chf = zielChf.trim() === '' ? null : parseFloat(zielChf.replace(/['\s]/g, '').replace(',', '.'))
      if (chf != null && (!isFinite(chf) || chf < 0)) { setFehler('Bitte einen gültigen Zielbetrag angeben.'); return }
      const m = parseInt(monate, 10)
      const r = await speichereZiel({
        zielRp: chf != null && chf > 0 ? Math.round(chf * 100) : null,
        zieldatum: zieldatum || null,
        mindestMonate: isFinite(m) && m >= 1 ? m : 3,
      })
      if ('error' in r && r.error) { setFehler(r.error); return }
      setBearbeiten(false)
      router.refresh()
    } catch {
      setFehler(AKTUALISIEREN_HINWEIS)
    } finally {
      setSpeichert(false)
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-6 py-4 border-b border-edge-soft flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">Reserveziel</p>
          <p className="text-[11.5px] text-ink-4 mt-0.5">Polster für ruhige Monate, Steuern und Investitionen</p>
        </div>
        <button onClick={() => setBearbeiten(b => !b)} className="btn-secondary text-xs">{bearbeiten ? 'Abbrechen' : ziel.zielRp != null ? 'Anpassen' : 'Ziel setzen'}</button>
      </div>
      <div className="px-6 py-4 space-y-3">
        {/* Mindestreserve-Check — immer sichtbar */}
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-ink-3">Mindestreserve ({ziel.mindestMonate} Monatsausgaben):</span>
          {zielSt.mindestreserveRp != null ? (
            <>
              <span className="font-semibold text-ink tnum">{fmtRp(zielSt.mindestreserveRp)}</span>
              {zielSt.reserveOk === true && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-mint-bg text-mint-ink">erfüllt</span>}
              {zielSt.reserveOk === false && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blush-bg text-blush-ink">nicht erfüllt</span>}
            </>
          ) : <span className="text-ink-4">braucht mindestens 3 vollständige Monate</span>}
        </div>

        {ziel.zielRp != null && kz.kontostandRp != null && !bearbeiten && (
          <div>
            <div className="flex items-baseline justify-between text-[12px] mb-1">
              <span className="text-ink-3 tnum">Kontostand {fmtRp(kz.kontostandRp)}</span>
              <span className="font-semibold text-ink tnum">Ziel {fmtRp(ziel.zielRp)}{ziel.zieldatum ? ` bis ${fmtD(ziel.zieldatum)}` : ''}</span>
            </div>
            <div className="h-2.5 rounded-full bg-edge-row overflow-hidden">
              <div className={`h-full rounded-full ${zielSt.imPlan === false ? 'bg-blush-ink/70' : 'bg-mint-mid'}`}
                style={{ width: `${Math.round((zielSt.fortschritt ?? 0) * 100)}%` }} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11.5px] text-ink-3">
              {zielSt.noetigeSparrateRp != null && <span className="tnum">Nötig: Ø {fmtRp(zielSt.noetigeSparrateRp)}/Monat</span>}
              {zielSt.tatsaechlichRp != null && <span className="tnum">Tatsächlich: Ø {fmtSig(zielSt.tatsaechlichRp)}/Monat (letzte 3 Monate)</span>}
              {zielSt.imPlan === true && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-mint-bg text-mint-ink">Im Plan</span>}
              {zielSt.imPlan === false && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blush-bg text-blush-ink">Hinter Plan</span>}
            </div>
          </div>
        )}

        {bearbeiten && (
          <div className="grid sm:grid-cols-3 gap-3 max-w-xl">
            <div>
              <p className="field-label">Zielbetrag (CHF)</p>
              <input value={zielChf} onChange={e => setZielChf(e.target.value)} inputMode="numeric" placeholder="z.B. 150000" className="input-field w-full tnum" />
            </div>
            <div>
              <p className="field-label">Zieldatum (optional)</p>
              <input type="date" value={zieldatum} onChange={e => setZieldatum(e.target.value)} className="input-field w-full" />
            </div>
            <div>
              <p className="field-label">Mindestreserve (Monate)</p>
              <input value={monate} onChange={e => setMonate(e.target.value)} inputMode="numeric" className="input-field w-full tnum" />
            </div>
            {fehler && <p className="sm:col-span-3 text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink">⚠ {fehler}</p>}
            <div className="sm:col-span-3">
              <button onClick={speichern} disabled={speichert} className="btn-primary disabled:opacity-50">{speichert ? 'Wird gespeichert…' : 'Speichern'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Prüfliste (lazy — Texte kommen erst beim Aufklappen) ────────────────

type PrueflisteDaten = {
  gruppen: Array<{ vorschlag: string; richtung: 'einnahme' | 'ausgabe'; buchungen: PrueflisteBuchung[] }>
  grosse: Array<PrueflisteBuchung & { kategorieName: string }>
}

function Pruefliste({ kategorien, unklassiertOffen, grosseOffen }: {
  kategorien: Kategorie[]; unklassiertOffen: number; grosseOffen: number
}) {
  const router = useRouter()
  const [offen, setOffen] = useState(false)
  const [daten, setDaten] = useState<PrueflisteDaten | null>(null)
  const [laden, setLaden] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [zugeordnet, setZugeordnet] = useState<Map<string, string>>(new Map())   // buchungId → kategorieId
  const [regelBox, setRegelBox] = useState<{ gruppeIdx: number; suchtext: string; kategorieId: string } | null>(null)
  const [meldung, setMeldung] = useState<string | null>(null)
  const [beschaeftigt, setBeschaeftigt] = useState<string | null>(null)
  // Fehler direkt bei der betroffenen Zeile — oben in der Karte übersieht
  // man ihn auf dem Handy sonst leicht
  const [zeilenFehler, setZeilenFehler] = useState<Record<string, string>>({})

  const gesamt = unklassiertOffen + grosseOffen

  async function laden_() {
    setLaden(true)
    setFehler(null)
    try {
      const r = await ladePruefliste()
      if ('error' in r && (r as { error?: string }).error) setFehler((r as { error: string }).error)
      else setDaten(r as PrueflisteDaten)
    } catch {
      setFehler('Die Prüfliste konnte nicht geladen werden.')
    } finally {
      setLaden(false)
    }
  }

  function aufklappen() {
    const neu = !offen
    setOffen(neu)
    if (neu && !daten && !laden) laden_()
  }

  async function zuordnen(b: PrueflisteBuchung, kategorieId: string, gruppeIdx: number) {
    if (!kategorieId) return
    setBeschaeftigt(b.id)
    setZeilenFehler(f => { const n = { ...f }; delete n[b.id]; return n })
    try {
      const r = await nacheinander(() => setzeKategorieManuell(b.kontoKey, b.id, b.datum.slice(0, 7), kategorieId))
      if ('error' in r && r.error) { setZeilenFehler(f => ({ ...f, [b.id]: r.error! })); return }
      setZugeordnet(m => new Map(m).set(b.id, kategorieId))
      const gruppe = daten?.gruppen[gruppeIdx]
      if (gruppe && gruppe.vorschlag !== 'Ohne Text') {
        setRegelBox({ gruppeIdx, suchtext: gruppe.vorschlag, kategorieId })
      }
      router.refresh()
    } catch {
      setZeilenFehler(f => ({ ...f, [b.id]: AKTUALISIEREN_HINWEIS }))
    } finally {
      setBeschaeftigt(null)
    }
  }

  async function regelSpeichern() {
    if (!regelBox || !daten) return
    setBeschaeftigt('_regel')
    setFehler(null)
    try {
      const gruppe = daten.gruppen[regelBox.gruppeIdx]
      const r = await nacheinander(() => regelAusVorschlag(regelBox.suchtext, gruppe.richtung, regelBox.kategorieId))
      if ('error' in r && r.error) { setFehler(r.error); return }
      const treffer = (r as { treffer?: number }).treffer ?? 0
      setMeldung(treffer > 0
        ? `Regel «${regelBox.suchtext}» gespeichert — ${treffer} weitere Buchung${treffer === 1 ? ' wird' : 'en werden'} automatisch zugeordnet.`
        : `Regel «${regelBox.suchtext}» gespeichert — sie trifft zurzeit keine weiteren offenen Buchungen, gilt aber für alle künftigen.`)
      setRegelBox(null)
      await laden_()
      router.refresh()
    } catch {
      setFehler(AKTUALISIEREN_HINWEIS)
    } finally {
      setBeschaeftigt(null)
    }
  }

  async function geprueft(id: string) {
    setBeschaeftigt(id)
    setZeilenFehler(f => { const n = { ...f }; delete n[id]; return n })
    try {
      const r = await nacheinander(() => markiereGeprueft(id))
      if ('error' in r && r.error) { setZeilenFehler(f => ({ ...f, [id]: r.error! })); return }
      setDaten(d => d ? { ...d, grosse: d.grosse.filter(g => g.id !== id) } : d)
      router.refresh()
    } catch {
      setZeilenFehler(f => ({ ...f, [id]: AKTUALISIEREN_HINWEIS }))
    } finally {
      setBeschaeftigt(null)
    }
  }

  const katName = (id: string) => kategorien.find(k => k.id === id)?.name ?? id

  return (
    <div className="card overflow-hidden">
      <button onClick={aufklappen} className="w-full px-6 py-4 flex items-center justify-between gap-3 hover:bg-hovrow">
        <div className="flex items-center gap-2.5 min-w-0">
          <p className="text-sm font-semibold text-ink">Prüfliste</p>
          {unklassiertOffen > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-apricot-bg text-apricot-ink whitespace-nowrap">{unklassiertOffen} unklassiert</span>}
          {grosseOffen > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-steel-bg text-steel-ink whitespace-nowrap">{grosseOffen} grosse zu prüfen</span>}
          {gesamt === 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-mint-bg text-mint-ink">alles erledigt</span>}
        </div>
        <span className={`text-ink-4 transition-transform ${offen ? 'rotate-90' : ''}`}>›</span>
      </button>

      {offen && (
        <div className="border-t border-edge-soft px-6 py-4 space-y-5">
          {laden && <p className="text-xs text-ink-4">Prüfliste wird geladen…</p>}
          {fehler && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {fehler}</p>}
          {meldung && <p className="text-xs px-3 py-2 rounded-ctl bg-mint-bg text-mint-ink inline-block">✓ {meldung}</p>}

          {daten && daten.gruppen.length === 0 && daten.grosse.length === 0 && !laden && (
            <p className="text-xs text-ink-4">Nichts zu prüfen — alle Buchungen sind zugeordnet. 🎉</p>
          )}

          {daten && daten.gruppen.length > 0 && (
            <div>
              <p className="eyebrow mb-2">Unklassierte Buchungen — Kategorie wählen</p>
              <div className="space-y-3">
                {daten.gruppen.map((g, gi) => (
                  <div key={`${g.vorschlag}|${g.richtung}|${gi}`} className="rounded-ctl border border-edge-row overflow-hidden">
                    <div className="px-3 py-2 bg-surface flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-semibold text-ink">{g.vorschlag}</span>
                      <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-full ${g.richtung === 'einnahme' ? 'bg-mint-bg text-mint-ink' : 'bg-apricot-bg text-apricot-ink'}`}>
                        {g.richtung === 'einnahme' ? 'Einnahme' : 'Ausgabe'}
                      </span>
                      <span className="text-[10.5px] text-ink-4">{g.buchungen.length} Buchung{g.buchungen.length === 1 ? '' : 'en'}</span>
                    </div>
                    <div className="divide-y divide-edge-row">
                      {g.buchungen.map(b => {
                        const erledigtKat = zugeordnet.get(b.id)
                        return (
                          <div key={b.id} className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                              <span className="text-[11.5px] font-semibold text-ink tnum w-16 shrink-0">{fmtD(b.datum).slice(0, 6)}{b.datum.slice(2, 4)}</span>
                              <span className="text-[11.5px] text-ink-3 flex-1 min-w-[140px] break-words">{b.text || '(ohne Text)'}</span>
                              <span className={`text-[12px] font-bold tnum ${b.betragRp >= 0 ? 'text-mint-ink' : 'text-ink'}`}>{fmtSig(b.betragRp)}</span>
                              {erledigtKat
                                ? <span className="text-[10.5px] font-bold px-2 py-1 rounded-lg bg-mint-bg text-mint-ink">✓ {katName(erledigtKat)}</span>
                                : (
                                  <select value="" disabled={beschaeftigt === b.id}
                                    onChange={e => zuordnen(b, e.target.value, gi)}
                                    className="select-field text-[11px] py-1 max-w-[190px] disabled:opacity-50">
                                    <option value="">{beschaeftigt === b.id ? 'Wird gespeichert…' : 'Kategorie wählen…'}</option>
                                    <KategorieOptionen kategorien={kategorien} />
                                  </select>
                                )}
                            </div>
                            {zeilenFehler[b.id] && (
                              <p className="mt-1.5 text-[11px] px-2.5 py-1.5 rounded-ctl bg-blush-bg text-blush-ink">⚠ {zeilenFehler[b.id]}</p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {regelBox?.gruppeIdx === gi && (
                      <div className="px-3 py-2.5 bg-steel-bg/50 border-t border-edge-row">
                        <p className="text-[11.5px] font-semibold text-ink mb-1.5">Für alle ähnlichen Buchungen als Regel speichern?</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <input value={regelBox.suchtext} onChange={e => setRegelBox(rb => rb ? { ...rb, suchtext: e.target.value } : rb)}
                            className="input-field text-[11.5px] py-1 flex-1 min-w-[160px]" />
                          <span className="text-[11px] text-ink-3">→ {katName(regelBox.kategorieId)}</span>
                          <button onClick={regelSpeichern} disabled={beschaeftigt === '_regel'} className="btn-primary text-xs py-1.5 disabled:opacity-50">Als Regel speichern</button>
                          <button onClick={() => setRegelBox(null)} className="btn-secondary text-xs py-1.5">Nein danke</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {daten && daten.grosse.length > 0 && (
            <div>
              <p className="eyebrow mb-2">Grosse Buchungen — einmalig oder laufend?</p>
              <p className="text-[11px] text-ink-4 mb-2">Einzelbuchungen über CHF 5&apos;000 kurz kontrollieren: Stimmt die Kategorie? Mit «Geprüft» verschwindet der Eintrag dauerhaft.</p>
              <div className="divide-y divide-edge-row rounded-ctl border border-edge-row overflow-hidden">
                {daten.grosse.map(b => (
                  <div key={b.id} className="px-3 py-2 bg-white">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="text-[11.5px] font-semibold text-ink tnum w-16 shrink-0">{fmtD(b.datum).slice(0, 6)}{b.datum.slice(2, 4)}</span>
                      <span className="text-[11.5px] text-ink-3 flex-1 min-w-[140px] break-words">{b.text || '(ohne Text)'}</span>
                      <span className="text-[10.5px] text-ink-4">{b.kategorieName}</span>
                      <span className={`text-[12px] font-bold tnum ${b.betragRp >= 0 ? 'text-mint-ink' : 'text-ink'}`}>{fmtSig(b.betragRp)}</span>
                      <button onClick={() => geprueft(b.id)} disabled={beschaeftigt === b.id} className="btn-secondary text-xs py-1 disabled:opacity-50">Geprüft</button>
                    </div>
                    {zeilenFehler[b.id] && (
                      <p className="mt-1.5 text-[11px] px-2.5 py-1.5 rounded-ctl bg-blush-bg text-blush-ink">⚠ {zeilenFehler[b.id]}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
