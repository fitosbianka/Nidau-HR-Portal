'use client'

// Bestellwesen: offene Bestellliste (nach Firmen gruppiert) mit Empfehlungen,
// Produkt-Stammdaten (Top 10 + Gesamtliste), WhatsApp-Liste für Laura und
// abgeschlossene Bestellungen — alle Berechtigten haben vollen Zugriff,
// jede Änderung landet im Änderungsprotokoll (Knopf oben rechts).

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  addFirma, addProdukt, updateProdukt, deleteProdukt,
  itemHinzufuegen, itemEntfernen, itemMengeAendern,
  empfehlungAblehnen, listeAbschliessen, lauraItemHinzufuegen,
  beobachtenSpeichern, beobachtenEntfernen, beobachtenAufListe,
  beobachtenErinnerungSetzen, beobachtenErinnerungErledigen,
} from '@/actions/bestellungen'
import {
  bestellHeute, empfehlungFaellig, itemsNachFirma,
  ERINNERUNG_RHYTHMEN, erinnerungFaellig, erinnerungTermin, rhythmusKurz,
  type BestellListe, type Produkt, type BeobachtenProdukt, type ErinnerungRhythmus,
} from '@/lib/bestellungen'
import type { BestellungenData } from '@/lib/bestellungen-data'

function fmtD(d: string | null | undefined) {
  return d ? new Date(`${d}T00:00:00`).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
}
function fmtZeit(iso: string) {
  return `${new Date(iso).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })}, ${new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' })}`
}

type ProduktForm = {
  id: string | null           // null = neues Produkt
  name: string
  artikelNr: string
  firma: string               // '__neu__' = neue Firma erfassen
  neueFirma: string
  menge: string
  intervall: string           // Wochen als Text (leer = kein Turnus)
}
const LEERES_PRODUKT: ProduktForm = { id: null, name: '', artikelNr: '', firma: '', neueFirma: '', menge: '', intervall: '' }

type BeobForm = {
  id: string | null           // null = neuer Eintrag
  name: string
  artikelNr: string
  firma: string               // '__neu__' = neue Firma erfassen
  neueFirma: string
  menge: string
}
const LEERES_BEOB: BeobForm = { id: null, name: '', artikelNr: '', firma: '', neueFirma: '', menge: '' }

export default function BestellungenClient({ data }: { data: BestellungenData }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const heute = bestellHeute()
  const { produkte, beobachten, firmen, offen, lauraOffen, geschlossene, logs } = data

  const [msg, setMsg] = useState<string | null>(null)
  const [produktModal, setProduktModal] = useState<ProduktForm | null>(null)
  const [modalErr, setModalErr] = useState<string | null>(null)
  const [alleProdukte, setAlleProdukte] = useState(false)
  const [produktSuche, setProduktSuche] = useState('')
  const [beobModal, setBeobModal] = useState<BeobForm | null>(null)
  const [beobModalErr, setBeobModalErr] = useState<string | null>(null)
  const [alleBeobachten, setAlleBeobachten] = useState(false)
  const [beobSuche, setBeobSuche] = useState('')
  // Erinnerung für ein «Im Auge behalten»-Produkt setzen / ändern
  const [erinnerungModal, setErinnerungModal] = useState<{ b: BeobachtenProdukt; ab: string; rhythmus: ErinnerungRhythmus } | null>(null)
  const [erinnerungErr, setErinnerungErr] = useState<string | null>(null)
  const [protokoll, setProtokoll] = useState(false)
  const [alleGeschlossenen, setAlleGeschlossenen] = useState(false)
  const [detail, setDetail] = useState<BestellListe | null>(null)

  // Hinzufügen-Zeile der Bestellliste
  const [wahlProdukt, setWahlProdukt] = useState('')
  const [wahlMenge, setWahlMenge] = useState('')

  // Laura-Zeile
  const [lauraText, setLauraText] = useState('')
  const [lauraMenge, setLauraMenge] = useState('')

  const produktById = useMemo(() => new Map(produkte.map(p => [p.id, p])), [produkte])

  // Empfehlungen: fällige Produkte, die noch nicht auf der offenen Liste stehen
  const empfehlungen = useMemo(() => {
    const aufListe = new Set((offen?.items ?? []).map(it => it.produktId).filter(Boolean))
    return produkte.filter(p => empfehlungFaellig(p, heute) && !aufListe.has(p.id))
  }, [produkte, offen, heute])

  // Top 10 nach Bestellhäufigkeit (dann alphabetisch)
  const topProdukte = useMemo(() =>
    [...produkte].sort((a, b) => b.bestellCount - a.bestellCount || a.name.localeCompare(b.name, 'de-CH')).slice(0, 10),
  [produkte])

  const gefiltert = useMemo(() => {
    const q = produktSuche.trim().toLowerCase()
    if (!q) return produkte
    return produkte.filter(p =>
      p.name.toLowerCase().includes(q) || p.firma.toLowerCase().includes(q) || p.artikelNr.toLowerCase().includes(q))
  }, [produkte, produktSuche])

  // «Im Auge behalten»: fällige Erinnerungen zuerst (rot, älteste oben),
  // danach die 10 zuletzt hinzugefügten (Liste kommt sortiert)
  const beobFaellig = useMemo(() =>
    beobachten.filter(b => erinnerungFaellig(b, heute))
      .sort((a, b) => (a.erinnerung?.naechste ?? '').localeCompare(b.erinnerung?.naechste ?? '') || a.name.localeCompare(b.name, 'de-CH')),
  [beobachten, heute])
  const beobNeuste = useMemo(() => {
    const faellig = new Set(beobFaellig.map(b => b.id))
    return [...beobFaellig, ...beobachten.filter(b => !faellig.has(b.id)).slice(0, 10)]
  }, [beobachten, beobFaellig])
  const beobGefiltert = useMemo(() => {
    const q = beobSuche.trim().toLowerCase()
    if (!q) return beobachten
    return beobachten.filter(b =>
      b.name.toLowerCase().includes(q) || b.firma.toLowerCase().includes(q) || b.artikelNr.toLowerCase().includes(q))
  }, [beobachten, beobSuche])

  const offenGruppen = useMemo(() => offen ? itemsNachFirma(offen.items, firmen) : [], [offen, firmen])

  function run(fn: () => Promise<{ error?: string } | undefined | { success?: boolean }>, after?: () => void) {
    setMsg(null)
    startTransition(async () => {
      let r: { error?: string } | undefined
      try { r = await fn() as { error?: string } | undefined } catch { r = { error: 'Netzwerkfehler — bitte erneut versuchen.' } }
      if (r?.error) setMsg(r.error)
      else { after?.(); router.refresh() }
    })
  }

  /** PDF öffnen — auch in der installierten Tablet-/Handy-App: wird das
   *  neue Tab unterdrückt, öffnet sich stattdessen das native Teilen-Menü
   *  (Vorschau, «In Dateien sichern», Drucken) statt einer Sackgasse. */
  function openPdf(id: string, datum: string) {
    const url = `/api/bestellliste-pdf?id=${id}`
    const w = window.open(url, '_blank', 'noopener')
    if (w) return
    startTransition(async () => {
      try {
        const nav = navigator as Navigator & {
          canShare?: (d?: { files?: File[] }) => boolean
          share?: (d: { files?: File[]; title?: string }) => Promise<void>
        }
        const res = await fetch(url)
        if (!res.ok) throw new Error('http')
        const blob = await res.blob()
        const file = new File([blob], `Bestellliste_${datum}.pdf`, { type: 'application/pdf' })
        if (nav.share && nav.canShare?.({ files: [file] })) {
          try { await nav.share({ files: [file] }) } catch (e) { if ((e as Error)?.name !== 'AbortError') throw e }
          return
        }
        window.location.assign(url)
      } catch {
        setMsg('PDF konnte nicht geöffnet werden — bitte erneut versuchen.')
      }
    })
  }

  // ── Produkt-Modal speichern ──
  function speichereProduktModal() {
    if (!produktModal) return
    setModalErr(null)
    startTransition(async () => {
      let firma = produktModal.firma
      if (firma === '__neu__') {
        if (!produktModal.neueFirma.trim()) { setModalErr('Bitte den Namen der neuen Firma eingeben.'); return }
        const rf = await addFirma(produktModal.neueFirma)
        if ('error' in rf && rf.error) { setModalErr(rf.error); return }
        // kanonische Schreibweise übernehmen (existierte die Firma schon,
        // kommt der gespeicherte Name zurück — so bleibt die Gruppierung sauber)
        firma = ('firma' in rf && rf.firma) ? rf.firma : produktModal.neueFirma.trim()
      }
      if (!firma) { setModalErr('Bitte eine Firma wählen.'); return }
      const intervall = produktModal.intervall.trim() === '' ? null : parseInt(produktModal.intervall, 10)
      if (intervall != null && (!Number.isFinite(intervall) || intervall <= 0)) { setModalErr('Turnus: bitte eine Zahl in Wochen angeben.'); return }
      const eingabe = {
        name: produktModal.name,
        artikelNr: produktModal.artikelNr,
        firma,
        menge: produktModal.menge || null,
        intervallWochen: intervall,
      }
      const r = produktModal.id ? await updateProdukt(produktModal.id, eingabe) : await addProdukt(eingabe)
      if ('error' in r && r.error) { setModalErr(r.error); return }
      setProduktModal(null)
      router.refresh()
    })
  }

  function bearbeiten(p: Produkt) {
    setModalErr(null)
    setProduktModal({
      id: p.id, name: p.name, artikelNr: p.artikelNr,
      firma: firmen.includes(p.firma) ? p.firma : '__neu__',
      neueFirma: firmen.includes(p.firma) ? '' : p.firma,
      menge: p.menge ?? '', intervall: p.intervallWochen ? String(p.intervallWochen) : '',
    })
  }

  // ── «Im Auge behalten»-Modal speichern ──
  function speichereBeobModal() {
    if (!beobModal) return
    setBeobModalErr(null)
    startTransition(async () => {
      let firma = beobModal.firma
      if (firma === '__neu__') {
        if (!beobModal.neueFirma.trim()) { setBeobModalErr('Bitte den Namen der neuen Firma eingeben.'); return }
        const rf = await addFirma(beobModal.neueFirma)
        if ('error' in rf && rf.error) { setBeobModalErr(rf.error); return }
        firma = ('firma' in rf && rf.firma) ? rf.firma : beobModal.neueFirma.trim()
      }
      if (!firma) { setBeobModalErr('Bitte eine Firma wählen.'); return }
      const r = await beobachtenSpeichern(beobModal.id, {
        name: beobModal.name, artikelNr: beobModal.artikelNr, firma, menge: beobModal.menge || null,
      })
      if ('error' in r && r.error) { setBeobModalErr(r.error); return }
      setBeobModal(null)
      router.refresh()
    })
  }

  function beobBearbeiten(b: BeobachtenProdukt) {
    setBeobModalErr(null)
    setBeobModal({
      id: b.id, name: b.name, artikelNr: b.artikelNr,
      firma: firmen.includes(b.firma) ? b.firma : '__neu__',
      neueFirma: firmen.includes(b.firma) ? '' : b.firma,
      menge: b.menge ?? '',
    })
  }

  // ── Erinnerung setzen / ändern / entfernen ──
  function erinnerungOeffnen(b: BeobachtenProdukt) {
    setErinnerungErr(null)
    setErinnerungModal({ b, ab: b.erinnerung?.ab ?? heute, rhythmus: b.erinnerung?.rhythmus ?? 'm1' })
  }
  function speichereErinnerung(entfernen = false) {
    const m = erinnerungModal
    if (!m) return
    if (!entfernen && !m.ab) { setErinnerungErr('Bitte ein Datum wählen.'); return }
    setErinnerungErr(null)
    startTransition(async () => {
      let r: { error?: string } | undefined
      try {
        r = await beobachtenErinnerungSetzen(m.b.id, entfernen ? null : { ab: m.ab, rhythmus: m.rhythmus }) as { error?: string }
      } catch { r = { error: 'Netzwerkfehler — bitte erneut versuchen.' } }
      if (r?.error) { setErinnerungErr(r.error); return }
      setErinnerungModal(null)
      router.refresh()
    })
  }

  const badgeTyp = (l: BestellListe) => l.typ === 'laura'
    ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-lilac-bg text-lilac-ink">WhatsApp Bestellung</span>
    : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-mint-bg text-mint-ink">Bestellung</span>

  function ProduktZeile({ p, kompakt = false }: { p: Produkt; kompakt?: boolean }) {
    const aufListe = (offen?.items ?? []).some(it => it.produktId === p.id)
    return (
      <tr className="hover:bg-hovrow">
        <td className="px-3 py-2 border-b border-edge-row">
          <p className="text-[12.5px] font-semibold text-ink">{p.name}</p>
          {!kompakt && p.menge && <p className="text-[10.5px] text-ink-4">übliche Menge: {p.menge}</p>}
        </td>
        <td className="px-3 py-2 border-b border-edge-row text-[12px] text-ink-2">{p.firma}</td>
        <td className="px-3 py-2 border-b border-edge-row text-[12px] text-ink-3 tnum">{p.artikelNr || '—'}</td>
        <td className="px-3 py-2 border-b border-edge-row text-[12px] text-ink-3">{p.intervallWochen ? `alle ${p.intervallWochen} Wo.` : '—'}</td>
        <td className="px-3 py-2 border-b border-edge-row text-[12px] text-ink-3 tnum">{fmtD(p.zuletztBestellt)}</td>
        <td className="px-3 py-2 border-b border-edge-row text-center">
          <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-full bg-edge-row text-ink-3 tnum">{p.bestellCount}×</span>
        </td>
        <td className="px-3 py-2 border-b border-edge-row text-right whitespace-nowrap">
          <button disabled={isPending || aufListe}
            onClick={() => run(() => itemHinzufuegen({ produktId: p.id }))}
            className="text-[11px] font-semibold px-2 py-1 rounded-md bg-mint-bg text-mint-ink hover:opacity-80 disabled:opacity-40"
            title={aufListe ? 'Steht bereits auf der Bestellliste' : 'Auf die Bestellliste setzen'}>
            {aufListe ? 'auf Liste ✓' : '＋ Liste'}
          </button>
          <button onClick={() => bearbeiten(p)} className="ml-1.5 text-ink-4 hover:text-ink px-1" title="Bearbeiten">✎</button>
        </td>
      </tr>
    )
  }

  const produktTabelleKopf = (
    <tr>
      {['Produkt', 'Firma', 'Artikel-Nr.', 'Turnus', 'Zuletzt bestellt', 'Bestellt', ''].map((h, i) => (
        <th key={i} className={`px-3 py-2 border-b-[1.5px] border-edge-ctl text-[10px] font-semibold uppercase tracking-[.1em] text-ink-4 ${i === 5 ? 'text-center' : 'text-left'}`}>{h}</th>
      ))}
    </tr>
  )

  const GlockeIcon = ({ className = '' }: { className?: string }) => (
    <svg className={`w-3.5 h-3.5 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9" />
    </svg>
  )

  // Fällige Erinnerung: Zeile rot, statt «＋ Liste» die zwei Knöpfe
  // «Auf die Liste» / «Überspringen» — beide rücken die Erinnerung weiter.
  function BeobZeile({ b }: { b: BeobachtenProdukt }) {
    const aufListe = (offen?.items ?? []).some(it =>
      it.name.trim().toLowerCase() === b.name.trim().toLowerCase() && it.firma === b.firma)
    const e = b.erinnerung
    const faellig = erinnerungFaellig(b, heute)
    const zelle = `px-3 py-2 border-b ${faellig ? 'border-red-100' : 'border-edge-row'}`
    return (
      <tr className={faellig ? 'bg-red-50' : 'hover:bg-hovrow'}>
        <td className={zelle}>
          <p className={`text-[12.5px] font-semibold ${faellig ? 'text-red-700' : 'text-ink'}`}>{b.name}</p>
          {b.menge && <p className={`text-[10.5px] ${faellig ? 'text-red-700/70' : 'text-ink-4'}`}>übliche Menge: {b.menge}</p>}
        </td>
        <td className={`${zelle} text-[12px] ${faellig ? 'text-red-700' : 'text-ink-2'}`}>{b.firma}</td>
        <td className={`${zelle} text-[12px] ${faellig ? 'text-red-700' : 'text-ink-3'} tnum`}>{b.artikelNr || '—'}</td>
        <td className={`${zelle} text-[12px] ${faellig ? 'text-red-700' : 'text-ink-3'} tnum`}>{fmtD(b.erstellt.slice(0, 10))}</td>
        <td className={`${zelle} text-[12px] tnum whitespace-nowrap`}>
          {e ? (
            <>
              <p className={faellig ? 'text-red-700 font-semibold' : 'text-ink-2'}>
                {faellig && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 mr-1.5 align-middle">fällig</span>}
                {fmtD(e.naechste)}
              </p>
              <p className={`text-[10.5px] ${faellig ? 'text-red-700/70' : 'text-ink-4'}`}>{rhythmusKurz(e.rhythmus)}</p>
            </>
          ) : <span className="text-ink-5">—</span>}
        </td>
        <td className={`${zelle} text-right whitespace-nowrap`}>
          {faellig ? (
            <>
              <button disabled={isPending}
                onClick={() => run(() => beobachtenErinnerungErledigen(b.id, 'liste'))}
                className="text-[11px] font-semibold px-2 py-1 rounded-md bg-mint-bg text-mint-ink hover:opacity-80 disabled:opacity-40"
                title={aufListe ? 'Steht bereits auf der Bestellliste — Erinnerung auf den nächsten Termin schieben' : 'Auf die Bestellliste setzen und die Erinnerung auf den nächsten Termin schieben'}>
                {aufListe ? 'auf Liste ✓' : 'Auf die Liste'}
              </button>
              <button disabled={isPending}
                onClick={() => run(() => beobachtenErinnerungErledigen(b.id, 'ueberspringen'))}
                className="ml-1.5 text-[11px] font-semibold px-2 py-1 rounded-md bg-white border border-red-200 text-red-700 hover:bg-red-100 disabled:opacity-40"
                title="Diesmal nicht bestellen — Erinnerung auf den nächsten Termin schieben">
                Überspringen
              </button>
            </>
          ) : (
            <button disabled={isPending || aufListe}
              onClick={() => run(() => beobachtenAufListe(b.id))}
              className="text-[11px] font-semibold px-2 py-1 rounded-md bg-mint-bg text-mint-ink hover:opacity-80 disabled:opacity-40"
              title={aufListe ? 'Steht bereits auf der Bestellliste' : 'Auf die Bestellliste setzen'}>
              {aufListe ? 'auf Liste ✓' : '＋ Liste'}
            </button>
          )}
          <button onClick={() => erinnerungOeffnen(b)}
            className={`ml-1.5 px-1 align-middle ${e ? 'text-apricot-ink hover:text-apricot-mid' : 'text-ink-4 hover:text-ink'}`}
            title={e ? `Erinnerung ${rhythmusKurz(e.rhythmus)}, nächste am ${fmtD(e.naechste)} — ändern` : 'Erinnerung setzen'}
            aria-label={e ? 'Erinnerung ändern' : 'Erinnerung setzen'}>
            <GlockeIcon className="inline-block" />
          </button>
          <button onClick={() => beobBearbeiten(b)} className={`ml-1 px-1 ${faellig ? 'text-red-700/70 hover:text-red-700' : 'text-ink-4 hover:text-ink'}`} title="Bearbeiten">✎</button>
        </td>
      </tr>
    )
  }

  const beobTabelleKopf = (
    <tr>
      {['Produkt', 'Firma', 'Artikel-Nr.', 'Hinzugefügt', 'Erinnerung', ''].map((h, i) => (
        <th key={i} className="px-3 py-2 border-b-[1.5px] border-edge-ctl text-[10px] font-semibold uppercase tracking-[.1em] text-ink-4 text-left">{h}</th>
      ))}
    </tr>
  )

  return (
    <div className="space-y-6">
      {msg && (
        <p className="text-xs px-3.5 py-2.5 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {msg}</p>
      )}

      <div className="flex justify-end -mb-2">
        <button onClick={() => setProtokoll(true)} className="btn-secondary !px-3.5 !py-2 !text-xs"
          title="Alle Änderungen auf dieser Seite — was, wann und von wem">
          🕐 Änderungsprotokoll{logs.length > 0 ? ` (${logs.length})` : ''}
        </button>
      </div>

      {/* ── 1 · Nächste Bestellung ────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-edge-soft flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">Nächste Bestellung</p>
            <p className="text-[11.5px] text-ink-4 mt-0.5">
              Produkte auswählen und sammeln — die Liste ist nach Firmen gruppiert. Abschliessen, sobald alles beisammen ist.
            </p>
          </div>
          {offen && offen.items.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button onClick={() => openPdf(offen.id, offen.erstellt)} className="btn-secondary !px-3 !py-1.5 !text-xs" title="PDF ansehen / drucken">PDF / Drucken</button>
              <a href={`/api/bestellliste-excel?id=${offen.id}`} className="btn-secondary !px-3 !py-1.5 !text-xs" title="Für Excel herunterladen (CSV)">Excel</a>
              <button disabled={isPending}
                onClick={() => { if (confirm(`Bestellung mit ${offen.items.length} Position(en) abschliessen?\n\nDie Liste wandert zu den abgeschlossenen Bestellungen; bei allen Produkten wird «zuletzt bestellt» auf heute gesetzt.`)) run(() => listeAbschliessen(offen.id)) }}
                className="btn-primary !px-3.5 !py-1.5 !text-xs">✓ Bestellung abschliessen</button>
            </div>
          )}
        </div>

        {/* Empfehlungen */}
        {empfehlungen.length > 0 && (
          <div className="px-6 py-3.5 border-b border-edge-soft bg-apricot-bg/40">
            <p className="text-[11px] font-semibold uppercase tracking-[.1em] text-apricot-mid mb-2">
              Empfehlungen — Turnus erreicht ({empfehlungen.length})
            </p>
            <div className="space-y-1.5">
              {empfehlungen.map(p => (
                <div key={p.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-ink">{p.name}</span>
                  <span className="text-[11px] text-ink-4">
                    {p.firma} · alle {p.intervallWochen} Wo. · zuletzt {fmtD(p.zuletztBestellt)}
                  </span>
                  <span className="flex-1" />
                  <button disabled={isPending}
                    onClick={() => run(() => itemHinzufuegen({ produktId: p.id, quelle: 'empfehlung' }))}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-mint-bg text-mint-ink hover:opacity-80">＋ Annehmen</button>
                  <button disabled={isPending}
                    onClick={() => run(() => empfehlungAblehnen(p.id))}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-edge-row text-ink-3 hover:text-ink"
                    title={`Diesmal nicht bestellen — die nächste Erinnerung kommt in ${p.intervallWochen} Wochen`}>Ablehnen</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Hinzufügen */}
        <div className="px-6 py-4 border-b border-edge-soft flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Produkt</label>
            <select value={wahlProdukt}
              onChange={e => {
                setWahlProdukt(e.target.value)
                // Menge immer aus dem gewählten Produkt vorbelegen — auch
                // leeren, damit keine Menge des vorherigen Produkts kleben bleibt
                setWahlMenge(produktById.get(e.target.value)?.menge ?? '')
              }}
              className="input-field text-sm w-72">
              <option value="">Produkt wählen…</option>
              {itemsNachFirma(produkte.map(p => ({ produktId: p.id, name: p.name, artikelNr: p.artikelNr, firma: p.firma, menge: '', quelle: 'manuell' as const })), firmen).map(g => (
                <optgroup key={g.firma} label={g.firma}>
                  {g.items.map(it => <option key={it.produktId} value={it.produktId ?? ''}>{it.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Menge</label>
            <input value={wahlMenge} onChange={e => setWahlMenge(e.target.value)} placeholder="z.B. 2 Pack"
              className="input-field text-sm w-32" />
          </div>
          <button disabled={isPending || !wahlProdukt}
            onClick={() => run(() => itemHinzufuegen({ produktId: wahlProdukt, menge: wahlMenge }), () => { setWahlProdukt(''); setWahlMenge('') })}
            className="btn-primary !px-3.5 !py-2 !text-xs disabled:opacity-50">＋ Auf die Liste</button>
          <button onClick={() => { setModalErr(null); setProduktModal({ ...LEERES_PRODUKT }) }}
            className="btn-secondary !px-3.5 !py-2 !text-xs">＋ Neues Produkt</button>
        </div>

        {/* Liste nach Firmen */}
        {!offen || offen.items.length === 0 ? (
          <p className="px-6 py-5 text-[12.5px] text-ink-3">
            Die nächste Bestellliste ist noch leer — oben Produkte auswählen oder Empfehlungen annehmen.
          </p>
        ) : (
          <div className="px-6 py-4 space-y-4">
            {offenGruppen.map(g => (
              <div key={g.firma || '—'}>
                <p className="inline-flex items-center px-2.5 py-[3px] rounded-md text-[10px] font-bold uppercase tracking-[.1em] bg-mint-bg text-mint-ink mb-1.5">
                  {g.firma || 'Ohne Firma'} · {g.items.length}
                </p>
                <table className="w-full">
                  <tbody>
                    {g.items.map(it => {
                      const idx = offen.items.indexOf(it)
                      return (
                        <tr key={`${it.name}-${idx}`} className="hover:bg-hovrow">
                          <td className="px-2 py-1.5 border-b border-edge-row">
                            <span className="text-[12.5px] font-semibold text-ink">{it.name}</span>
                            {it.quelle === 'empfehlung' && (
                              <span className="ml-2 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-apricot-bg text-apricot-ink">Empfehlung</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 border-b border-edge-row text-[11.5px] text-ink-3 tnum w-32">{it.artikelNr || '—'}</td>
                          <td className="px-2 py-1.5 border-b border-edge-row w-32">
                            <input defaultValue={it.menge} placeholder="Menge"
                              onBlur={e => { if (e.target.value.trim() !== it.menge) run(() => itemMengeAendern(offen.id, idx, e.target.value, it.name)) }}
                              className="input-field !py-1 text-[12px] w-28" />
                          </td>
                          <td className="px-2 py-1.5 border-b border-edge-row text-right w-10">
                            <button disabled={isPending} onClick={() => run(() => itemEntfernen(offen.id, idx, it.name))}
                              className="text-ink-5 hover:text-red-500 px-1" title="Von der Liste entfernen">✕</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 2 · Produkte ──────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-edge-soft flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">Produkte</p>
            <p className="text-[11.5px] text-ink-4 mt-0.5">Die 10 am häufigsten bestellten — alle Angaben jederzeit anpassbar.</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => { setProduktSuche(''); setAlleProdukte(true) }} className="btn-secondary !px-3 !py-1.5 !text-xs">
              Alle Produkte ({produkte.length})
            </button>
            <button onClick={() => { setModalErr(null); setProduktModal({ ...LEERES_PRODUKT }) }} className="btn-primary !px-3 !py-1.5 !text-xs">＋ Neues Produkt</button>
          </div>
        </div>
        {topProdukte.length === 0 ? (
          <p className="px-6 py-5 text-[12.5px] text-ink-3">Noch keine Produkte erfasst — mit «＋ Neues Produkt» beginnen.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>{produktTabelleKopf}</thead>
              <tbody>{topProdukte.map(p => <ProduktZeile key={p.id} p={p} kompakt />)}</tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Im Auge behalten ──────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-edge-soft flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">Im Auge behalten</p>
            <p className="text-[11.5px] text-ink-4 mt-0.5">
              Kein fester Turnus — bei jeder Bestellung kurz prüfen, ob noch Vorrat da ist. Mit der Glocke lässt sich
              pro Produkt eine Erinnerung setzen; am Stichtag erscheint es rot. Fällige zuerst, danach die 10 zuletzt hinzugefügten.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => { setBeobSuche(''); setAlleBeobachten(true) }} className="btn-secondary !px-3 !py-1.5 !text-xs">
              Alle anzeigen ({beobachten.length})
            </button>
            <button onClick={() => { setBeobModalErr(null); setBeobModal({ ...LEERES_BEOB }) }} className="btn-primary !px-3 !py-1.5 !text-xs">＋ Produkt hinzufügen</button>
          </div>
        </div>
        {beobNeuste.length === 0 ? (
          <p className="px-6 py-5 text-[12.5px] text-ink-3">
            Noch keine Produkte zum Beobachten — mit «＋ Produkt hinzufügen» erfassen, was ohne festen Turnus regelmässig kontrolliert werden soll.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead>{beobTabelleKopf}</thead>
              <tbody>{beobNeuste.map(b => <BeobZeile key={b.id} b={b} />)}</tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 3 · Bestellung per WhatsApp ───────────────── */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-edge-soft flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">Bestellung per WhatsApp</p>
            <p className="text-[11.5px] text-ink-4 mt-0.5">
              Hier sammeln, was per WhatsApp bestellt wird. Nach dem Bestellen auf «Erledigt» — die Liste wandert
              als «WhatsApp Bestellung» zu den abgeschlossenen Bestellungen.
            </p>
          </div>
          {lauraOffen && lauraOffen.items.length > 0 && (
            <button disabled={isPending}
              onClick={() => { if (confirm(`Die WhatsApp Liste mit ${lauraOffen.items.length} Position(en) als erledigt/bestellt markieren?`)) run(() => listeAbschliessen(lauraOffen.id)) }}
              className="btn-primary !px-3.5 !py-1.5 !text-xs">✓ Erledigt — bestellt</button>
          )}
        </div>
        <div className="px-6 py-4 flex flex-wrap items-end gap-3 border-b border-edge-soft">
          <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
            <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Was soll bestellt werden?</label>
            <input value={lauraText} onChange={e => setLauraText(e.target.value)} placeholder="z.B. Druckerpapier A4"
              className="input-field text-sm w-full" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Menge</label>
            <input value={lauraMenge} onChange={e => setLauraMenge(e.target.value)} placeholder="optional"
              className="input-field text-sm w-28" />
          </div>
          <button disabled={isPending || !lauraText.trim()}
            onClick={() => run(() => lauraItemHinzufuegen(lauraText, lauraMenge), () => { setLauraText(''); setLauraMenge('') })}
            className="btn-primary !px-3.5 !py-2 !text-xs disabled:opacity-50">＋ Hinzufügen</button>
        </div>
        {!lauraOffen || lauraOffen.items.length === 0 ? (
          <p className="px-6 py-4 text-[12.5px] text-ink-3">Zurzeit nichts per WhatsApp zu bestellen.</p>
        ) : (
          <div className="px-6 py-3">
            {lauraOffen.items.map((it, idx) => (
              <div key={`${it.name}-${idx}`} className="flex items-center gap-2 py-1.5 border-b border-edge-row last:border-b-0">
                <span className="text-[12.5px] font-semibold text-ink">{it.name}</span>
                {it.menge && <span className="text-[11.5px] text-ink-3">({it.menge})</span>}
                <span className="flex-1" />
                <button disabled={isPending} onClick={() => run(() => itemEntfernen(lauraOffen.id, idx, it.name))}
                  className="text-ink-5 hover:text-red-500 px-1" title="Entfernen">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 4 · Abgeschlossene Bestellungen ───────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-edge-soft flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">Abgeschlossene Bestellungen</p>
            <p className="text-[11.5px] text-ink-4 mt-0.5">Die letzten 5 — die vollständige Historie über «Alle anzeigen».</p>
          </div>
          {geschlossene.length > 5 && (
            <button onClick={() => setAlleGeschlossenen(true)} className="btn-secondary !px-3 !py-1.5 !text-xs">
              Alle anzeigen ({geschlossene.length})
            </button>
          )}
        </div>
        {geschlossene.length === 0 ? (
          <p className="px-6 py-5 text-[12.5px] text-ink-3">Noch keine abgeschlossenen Bestellungen.</p>
        ) : (
          <div className="px-6 py-3">
            {geschlossene.slice(0, 5).map(l => (
              <div key={l.id} className="flex flex-wrap items-center gap-2 py-2 border-b border-edge-row last:border-b-0">
                <span className="text-[12.5px] font-bold text-ink tnum">{fmtD(l.geschlossenAm)}</span>
                {badgeTyp(l)}
                <span className="text-[11.5px] text-ink-3">{l.items.length} Position{l.items.length === 1 ? '' : 'en'}</span>
                {l.geschlossenVon && <span className="text-[11px] text-ink-4">· {l.geschlossenVon}</span>}
                <span className="flex-1" />
                <button onClick={() => setDetail(l)} className="text-[11px] font-semibold px-2 py-1 rounded-md bg-edge-row text-ink-2 hover:text-ink">Ansehen</button>
                <button onClick={() => openPdf(l.id, l.geschlossenAm ?? l.erstellt)} className="text-[11px] font-semibold px-2 py-1 rounded-md bg-edge-row text-ink-2 hover:text-ink">PDF</button>
                <a href={`/api/bestellliste-excel?id=${l.id}`} className="text-[11px] font-semibold px-2 py-1 rounded-md bg-edge-row text-ink-2 hover:text-ink">Excel</a>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══ Modals ═══ */}

      {/* Produkt anlegen / bearbeiten */}
      {produktModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <h3 className="text-sm font-bold text-ink">{produktModal.id ? 'Produkt bearbeiten' : 'Neues Produkt'}</h3>
              <button onClick={() => setProduktModal(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4">✕</button>
            </div>
            <div className="px-6 py-4 space-y-3.5">
              <div>
                <p className="field-label">Produktname *</p>
                <input value={produktModal.name} onChange={e => setProduktModal(m => m ? { ...m, name: e.target.value } : m)}
                  className="input-field w-full" placeholder="z.B. Handschuhe Nitril M" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="field-label">Artikel-Nr.</p>
                  <input value={produktModal.artikelNr} onChange={e => setProduktModal(m => m ? { ...m, artikelNr: e.target.value } : m)}
                    className="input-field w-full" />
                </div>
                <div>
                  <p className="field-label">Firma *</p>
                  <select value={produktModal.firma} onChange={e => setProduktModal(m => m ? { ...m, firma: e.target.value } : m)}
                    className="input-field w-full">
                    <option value="">Firma wählen…</option>
                    {firmen.map(f => <option key={f} value={f}>{f}</option>)}
                    <option value="__neu__">＋ Neue Firma…</option>
                  </select>
                </div>
              </div>
              {produktModal.firma === '__neu__' && (
                <div>
                  <p className="field-label">Neue Firma</p>
                  <input value={produktModal.neueFirma} onChange={e => setProduktModal(m => m ? { ...m, neueFirma: e.target.value } : m)}
                    className="input-field w-full" placeholder="Firmenname" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="field-label">Übliche Menge (optional)</p>
                  <input value={produktModal.menge} onChange={e => setProduktModal(m => m ? { ...m, menge: e.target.value } : m)}
                    className="input-field w-full" placeholder="z.B. 2 Pack" />
                </div>
                <div>
                  <p className="field-label">Turnus in Wochen (optional)</p>
                  <input value={produktModal.intervall} inputMode="numeric"
                    onChange={e => setProduktModal(m => m ? { ...m, intervall: e.target.value.replace(/[^0-9]/g, '') } : m)}
                    className="input-field w-full" placeholder="z.B. 4" />
                  <p className="text-[10.5px] text-ink-4 mt-1">Steuert die Bestell-Empfehlungen auf der Liste.</p>
                </div>
              </div>
              {modalErr && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {modalErr}</p>}
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              {produktModal.id && (
                <button disabled={isPending}
                  onClick={() => { if (confirm(`Produkt «${produktModal.name}» wirklich löschen?`)) run(() => deleteProdukt(produktModal.id!), () => setProduktModal(null)) }}
                  className="btn-secondary !text-red-600">Löschen</button>
              )}
              <button onClick={() => setProduktModal(null)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={speichereProduktModal} disabled={isPending} className="btn-primary flex-1">
                {isPending ? 'Wird gespeichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alle Produkte */}
      {alleProdukte && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-4xl shadow-xl overflow-hidden rounded-t-card border border-edge max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-edge-soft bg-surface">
              <h3 className="text-sm font-bold text-ink">Alle Produkte ({produkte.length})</h3>
              <div className="flex items-center gap-2">
                <input value={produktSuche} onChange={e => setProduktSuche(e.target.value)} placeholder="Suchen…"
                  className="input-field !py-1.5 text-sm w-48" />
                <button onClick={() => setAlleProdukte(false)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4">✕</button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full min-w-[680px]">
                <thead className="sticky top-0 bg-white">{produktTabelleKopf}</thead>
                <tbody>
                  {gefiltert.map(p => <ProduktZeile key={p.id} p={p} />)}
                  {gefiltert.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-[12.5px] text-ink-3">Keine Produkte gefunden.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Im Auge behalten: anlegen / bearbeiten */}
      {beobModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">{beobModal.id ? 'Eintrag bearbeiten' : 'Im Auge behalten — neues Produkt'}</h3>
                <p className="text-xs text-ink-4 mt-0.5">Ohne festen Turnus — erscheint nie als Empfehlung, nur zur Kontrolle.</p>
              </div>
              <button onClick={() => setBeobModal(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4">✕</button>
            </div>
            <div className="px-6 py-4 space-y-3.5">
              <div>
                <p className="field-label">Produktname *</p>
                <input value={beobModal.name} onChange={e => setBeobModal(m => m ? { ...m, name: e.target.value } : m)}
                  className="input-field w-full" placeholder="z.B. Ersatzlampe Polymerisation" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="field-label">Artikel-Nr.</p>
                  <input value={beobModal.artikelNr} onChange={e => setBeobModal(m => m ? { ...m, artikelNr: e.target.value } : m)}
                    className="input-field w-full" />
                </div>
                <div>
                  <p className="field-label">Firma *</p>
                  <select value={beobModal.firma} onChange={e => setBeobModal(m => m ? { ...m, firma: e.target.value } : m)}
                    className="input-field w-full">
                    <option value="">Firma wählen…</option>
                    {firmen.map(f => <option key={f} value={f}>{f}</option>)}
                    <option value="__neu__">＋ Neue Firma…</option>
                  </select>
                </div>
              </div>
              {beobModal.firma === '__neu__' && (
                <div>
                  <p className="field-label">Neue Firma</p>
                  <input value={beobModal.neueFirma} onChange={e => setBeobModal(m => m ? { ...m, neueFirma: e.target.value } : m)}
                    className="input-field w-full" placeholder="Firmenname" />
                </div>
              )}
              <div>
                <p className="field-label">Übliche Menge (optional)</p>
                <input value={beobModal.menge} onChange={e => setBeobModal(m => m ? { ...m, menge: e.target.value } : m)}
                  className="input-field w-full" placeholder="z.B. 1 Stück" />
              </div>
              {beobModalErr && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {beobModalErr}</p>}
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              {beobModal.id && (
                <button disabled={isPending}
                  onClick={() => { if (confirm(`«${beobModal.name}» aus «Im Auge behalten» löschen?`)) run(() => beobachtenEntfernen(beobModal.id!), () => setBeobModal(null)) }}
                  className="btn-secondary !text-red-600">Löschen</button>
              )}
              <button onClick={() => setBeobModal(null)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={speichereBeobModal} disabled={isPending} className="btn-primary flex-1">
                {isPending ? 'Wird gespeichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Erinnerung setzen / ändern */}
      {erinnerungModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">Erinnerung — {erinnerungModal.b.name}</h3>
                <p className="text-xs text-ink-4 mt-0.5">
                  Am Stichtag erscheint das Produkt hier rot, und die Bestellverantwortliche sieht beim Anmelden und beim Öffnen der
                  Bestellseite ein Fenster mit allen fälligen Produkten.
                </p>
              </div>
              <button onClick={() => setErinnerungModal(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4">✕</button>
            </div>
            <div className="px-6 py-4 space-y-3.5">
              <div>
                <p className="field-label">Wie oft</p>
                <select value={erinnerungModal.rhythmus}
                  onChange={e => setErinnerungModal(m => m ? { ...m, rhythmus: e.target.value as ErinnerungRhythmus } : m)}
                  className="input-field w-full">
                  {ERINNERUNG_RHYTHMEN.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <p className="field-label">{erinnerungModal.rhythmus === 'einmalig' ? 'Datum' : 'Erinnern ab'}</p>
                <input type="date" value={erinnerungModal.ab}
                  onChange={e => setErinnerungModal(m => m ? { ...m, ab: e.target.value } : m)}
                  className="input-field w-full" />
                {erinnerungModal.rhythmus !== 'einmalig' && erinnerungModal.ab && (
                  <p className="text-[11px] text-ink-4 mt-1.5 tnum">
                    Danach {rhythmusKurz(erinnerungModal.rhythmus)}:{' '}
                    {[1, 2, 3].map(k => fmtD(erinnerungTermin(erinnerungModal.ab, erinnerungModal.rhythmus, k))).join(', ')} …
                  </p>
                )}
              </div>
              {erinnerungErr && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {erinnerungErr}</p>}
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              {erinnerungModal.b.erinnerung && (
                <button disabled={isPending} onClick={() => speichereErinnerung(true)} className="btn-secondary !text-red-600">Entfernen</button>
              )}
              <button onClick={() => setErinnerungModal(null)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={() => speichereErinnerung()} disabled={isPending} className="btn-primary flex-1">
                {isPending ? 'Wird gespeichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alle «Im Auge behalten» */}
      {alleBeobachten && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-3xl shadow-xl overflow-hidden rounded-t-card border border-edge max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-edge-soft bg-surface">
              <h3 className="text-sm font-bold text-ink">Im Auge behalten — alle ({beobachten.length})</h3>
              <div className="flex items-center gap-2">
                <input value={beobSuche} onChange={e => setBeobSuche(e.target.value)} placeholder="Suchen…"
                  className="input-field !py-1.5 text-sm w-48" />
                <button onClick={() => setAlleBeobachten(false)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4">✕</button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full min-w-[680px]">
                <thead className="sticky top-0 bg-white">{beobTabelleKopf}</thead>
                <tbody>
                  {beobGefiltert.map(b => <BeobZeile key={b.id} b={b} />)}
                  {beobGefiltert.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-[12.5px] text-ink-3">Keine Einträge gefunden.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Änderungsprotokoll */}
      {protokoll && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-2xl shadow-xl overflow-hidden rounded-t-card border border-edge max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">Änderungsprotokoll</h3>
                <p className="text-xs text-ink-4 mt-0.5">Jede Änderung auf dieser Seite — was, wann und von wem (neuste zuerst).</p>
              </div>
              <button onClick={() => setProtokoll(false)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4">✕</button>
            </div>
            <div className="overflow-auto px-6 py-3">
              {logs.length === 0 ? (
                <p className="py-4 text-[12.5px] text-ink-3">Noch keine Änderungen protokolliert.</p>
              ) : logs.map((l, i) => (
                <div key={i} className="py-2 border-b border-edge-row last:border-b-0">
                  <p className="text-[12.5px] text-ink">{l.text}</p>
                  <p className="text-[10.5px] text-ink-4 mt-0.5 tnum">{fmtZeit(l.am)} · {l.von}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Alle abgeschlossenen Bestellungen */}
      {alleGeschlossenen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-2xl shadow-xl overflow-hidden rounded-t-card border border-edge max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <h3 className="text-sm font-bold text-ink">Alle abgeschlossenen Bestellungen ({geschlossene.length})</h3>
              <button onClick={() => setAlleGeschlossenen(false)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4">✕</button>
            </div>
            <div className="overflow-auto px-6 py-3">
              {geschlossene.map(l => (
                <div key={l.id} className="flex flex-wrap items-center gap-2 py-2 border-b border-edge-row last:border-b-0">
                  <span className="text-[12.5px] font-bold text-ink tnum">{fmtD(l.geschlossenAm)}</span>
                  {badgeTyp(l)}
                  <span className="text-[11.5px] text-ink-3">{l.items.length} Position{l.items.length === 1 ? '' : 'en'}</span>
                  {l.geschlossenVon && <span className="text-[11px] text-ink-4">· {l.geschlossenVon}</span>}
                  <span className="flex-1" />
                  <button onClick={() => setDetail(l)} className="text-[11px] font-semibold px-2 py-1 rounded-md bg-edge-row text-ink-2 hover:text-ink">Ansehen</button>
                  <button onClick={() => openPdf(l.id, l.geschlossenAm ?? l.erstellt)} className="text-[11px] font-semibold px-2 py-1 rounded-md bg-edge-row text-ink-2 hover:text-ink">PDF</button>
                  <a href={`/api/bestellliste-excel?id=${l.id}`} className="text-[11px] font-semibold px-2 py-1 rounded-md bg-edge-row text-ink-2 hover:text-ink">Excel</a>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Detail einer abgeschlossenen Bestellung */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-lg shadow-xl overflow-hidden rounded-t-card border border-edge max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-ink">{detail.typ === 'laura' ? 'WhatsApp Bestellung' : 'Bestellung'} vom {fmtD(detail.geschlossenAm)}</h3>
                {badgeTyp(detail)}
              </div>
              <button onClick={() => setDetail(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4">✕</button>
            </div>
            <div className="overflow-auto px-6 py-4 space-y-3">
              {(detail.typ === 'laura'
                ? [{ firma: 'WhatsApp (Andrea Willen)', items: detail.items }]
                : itemsNachFirma(detail.items, firmen)).map(g => (
                <div key={g.firma || '—'}>
                  <p className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-4 mb-1">{g.firma || 'Ohne Firma'}</p>
                  {g.items.map((it, i) => (
                    <p key={i} className="text-[12.5px] text-ink py-0.5">
                      {it.name}
                      {it.artikelNr && <span className="text-ink-4"> · Art.-Nr. {it.artikelNr}</span>}
                      {it.menge && <span className="text-ink-3"> · {it.menge}</span>}
                    </p>
                  ))}
                </div>
              ))}
              {detail.geschlossenVon && (
                <p className="text-[11px] text-ink-4 pt-2 border-t border-edge-soft">
                  Abgeschlossen am {fmtD(detail.geschlossenAm)} von {detail.geschlossenVon}
                </p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={() => openPdf(detail.id, detail.geschlossenAm ?? detail.erstellt)} className="btn-secondary flex-1">PDF</button>
              <a href={`/api/bestellliste-excel?id=${detail.id}`} className="btn-secondary flex-1 text-center">Excel</a>
              <button onClick={() => setDetail(null)} className="btn-primary flex-1">Schliessen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
