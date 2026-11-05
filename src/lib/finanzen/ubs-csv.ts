// UBS-Kontoauszug (CSV) parsen — NUR reine Funktionen ohne Supabase, damit
// derselbe Code im Browser (Vorschau) und auf dem Server (Import, das
// massgebende Ergebnis) läuft.
//
// Erkannte Formate:
//  · «aktuell»            seit 2022: Semikolon, Spalten fix (Abschlussdatum,
//                         Abschlusszeit, Buchungsdatum, Valutadatum, Währung,
//                         Belastung, Gutschrift, Einzelbetrag, Saldo,
//                         Transaktions-Nr., Beschreibung1-3, Fussnoten)
//  · «transaktionsbetrag» 13 Spalten mit einer vorzeichenbehafteten Spalte
//                         Transaktionsbetrag
//  · «alt21»              altes Format mit 21 Spalten, erste Spalte
//                         Bewertungsdatum, Datum TT.MM.JJJJ, Komma oder
//                         Semikolon als Trennzeichen
//
// Wichtigste Regel gegen doppelte Beträge: Detailzeilen (kein Datum, keine
// Belastung/Gutschrift, aber Einzelbetrag + gleiche Transaktionsnummer wie
// die Buchung davor) landen NUR in details der Sammelbuchung.

import type { Buchung, Jahresdatei, MonatsInfo } from './types'
import { arbeitstageBetween } from '../feiertage'

export class FinanzCsvError extends Error {}

export type ParseMonat = {
  einnahmenRp: number
  ausgabenRp: number          // positiv dargestellt
  summeRp: number
  anzahl: number
  saldoEndeRp: number | null
  vollstaendig: boolean
}

export type ParseErgebnis = {
  format: 'aktuell' | 'transaktionsbetrag' | 'alt21'
  kontoKey: string
  iban: string
  kontonummer: string
  waehrung: string
  von: string | null
  bis: string | null
  anfangssaldoRp: number | null
  schlusssaldoRp: number | null
  buchungen: Buchung[]        // kategorieManuell null, importId '' (setzt der Import)
  vorgemerkt: number
  warnungen: string[]
  /** Anfangssaldo + Summe = Schlusssaldo (±1 Rp); null = nicht prüfbar */
  saldoAbgleichOk: boolean | null
  monate: Record<string, ParseMonat>   // YYYY-MM
}

// ── Kodierung ────────────────────────────────────────────────────────────

/** Zuerst streng als UTF-8, bei Fehler als windows-1252; BOM entfernen. */
export function decodeCsvBytes(bytes: Uint8Array): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes)
  }
  return text.replace(/^﻿/, '')
}

// ── CSV-Tokenizer (Anführungszeichen, "" als Escape, \r\n) ───────────────

function parseCsv(text: string, sep: ';' | ','): string[][] {
  const zeilen: string[][] = []
  let feld = ''
  let zeile: string[] = []
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { feld += '"'; i++ } else inQuote = false
      } else feld += c
    } else if (c === '"') {
      inQuote = true
    } else if (c === sep) {
      zeile.push(feld); feld = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      zeile.push(feld); feld = ''
      zeilen.push(zeile); zeile = []
    } else {
      feld += c
    }
  }
  if (feld !== '' || zeile.length > 0) { zeile.push(feld); zeilen.push(zeile) }
  return zeilen
}

// ── Werte-Helfer ─────────────────────────────────────────────────────────

/** Betrag → Rappen. Standard: Punkt als Dezimaltrenner, Apostroph als
 *  Tausender (1'234.50). Zusätzlich verstanden: Komma als Dezimaltrenner
 *  (1234,50), Komma als Tausender (1,234.50), Punkt als Tausender mit
 *  Komma-Dezimale (1.234,50) sowie ein vorangestelltes «CHF». */
export function parseBetragRp(raw: string | undefined): number | null {
  let s = (raw ?? '').replace(/CHF/gi, '').replace(/['\s ’]/g, '')
  if (!s) return null
  if (s.includes(',') && s.includes('.')) {
    // das letzte Trennzeichen ist das Dezimaltrennzeichen
    s = s.lastIndexOf('.') > s.lastIndexOf(',') ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.')
  } else if (s.includes(',')) {
    s = s.replace(',', '.')
  }
  const m = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return null
  const rp = parseInt(m[2], 10) * 100 + (m[3] ? parseInt(m[3].padEnd(2, '0'), 10) : 0)
  return m[1] === '-' ? -rp : rp
}

/** YYYY-MM-DD oder TT.MM.JJJJ → ISO, sonst null. */
function isoDatum(raw: string | undefined): string | null {
  const s = (raw ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

const norm = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

function monatVon(datum: string) { return datum.slice(0, 7) }

function letzterTag(monat: string): string {
  const [j, m] = monat.split('-').map(n => parseInt(n, 10))
  return `${monat}-${String(new Date(j, m, 0).getDate()).padStart(2, '0')}`
}

/** Deckt ein Zeitraum (Von bis Bis) den Monat ab? Massgebend sind die
 *  Bankarbeitstage: Von spätestens am ersten, Bis frühestens am letzten
 *  Arbeitstag des Monats (Mo bis Fr ohne Feiertage). Ein Export vom 1. bis
 *  30. Oktober 2026 ist vollständig, weil der 31. ein Samstag ist und die
 *  Bank den Zeitraum mit der letzten Buchung enden lässt. */
export function monatAbgedeckt(von: string | null | undefined, bis: string | null | undefined, monat: string): boolean {
  if (!von || !bis) return false
  const tage = arbeitstageBetween(`${monat}-01`, letzterTag(monat))
  const erster = tage[0] ?? `${monat}-01`
  const letzter = tage[tage.length - 1] ?? letzterTag(monat)
  return von <= erster && bis >= letzter
}

/** Gespeicherte Monate nachträglich als vollständig werten, wenn ein Import
 *  laut Protokoll den Monat ganz abgedeckt hat. Frühere Importe wurden am
 *  Kalendermonatsende gemessen, darum galt der Oktober 2026 (Export bis
 *  Freitag, 30.10.) als unvollständig. */
export function vollstaendigAusProtokoll(infos: Record<string, MonatsInfo>, eintraege: Array<{ von: string | null; bis: string | null }>): Record<string, MonatsInfo> {
  const out: Record<string, MonatsInfo> = {}
  for (const [m, info] of Object.entries(infos)) {
    out[m] = info.vollstaendig || !eintraege.some(e => monatAbgedeckt(e.von, e.bis, m)) ? info : { ...info, vollstaendig: true }
  }
  return out
}

// ── Metadaten (mehrsprachig) ─────────────────────────────────────────────

const META_KEYS: Record<string, string[]> = {
  kontonummer: ['kontonummer', 'numéro de compte', 'numero de compte', 'account number', 'numero di conto'],
  iban: ['iban'],
  von: ['von', 'du', 'from', 'da'],
  bis: ['bis', 'au', 'until', 'to', 'a', 'al'],
  anfangssaldo: ['anfangssaldo', 'solde initial', 'opening balance', 'saldo iniziale'],
  schlusssaldo: ['schlusssaldo', 'solde final', 'closing balance', 'saldo finale'],
  waehrung: ['bewertet in', 'évalué en', 'evalue en', 'evaluated in', 'valutato in'],
}

const BUCHUNGSDATUM_NAMEN = [
  'buchungsdatum', 'booking date', 'date de comptabilisation',
  'data di contabilizzazione', 'data di registrazione',
]
const ALT21_ERSTE = ['bewertungsdatum', 'valuation date', "date d'évaluation", "date d'evaluation", 'data di valutazione']
const TRXBETRAG_NAMEN = ['transaktionsbetrag', 'transaction amount', 'montant de la transaction']

// ── Hash für stabile Buchungs-IDs ────────────────────────────────────────

function hash36(s: string): string {
  // FNV-1a, 32 Bit — stabil und ohne Abhängigkeiten
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

// ── Hauptfunktion ────────────────────────────────────────────────────────

export function parseUbsCsv(text: string): ParseErgebnis {
  if (norm(text.slice(0, 4000)).includes('card center')) {
    throw new FinanzCsvError('Das ist ein Kreditkarten-Export (UBS Card Center) — bitte den Kontoauszug des Geschäftskontos aus dem Online Banking exportieren.')
  }

  // Trennzeichen/Format finden: zuerst Semikolon, für das alte Format auch Komma
  let rows = parseCsv(text, ';')
  let headerIdx = -1
  let format: ParseErgebnis['format'] | null = null
  const findeHeader = (rs: string[][]) => {
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i]
      if (r.length >= 20 && ALT21_ERSTE.includes(norm(r[0]))) return { i, f: 'alt21' as const }
      if (r.length >= 13 && BUCHUNGSDATUM_NAMEN.includes(norm(r[2]))) {
        const f = r.some(c => TRXBETRAG_NAMEN.includes(norm(c))) ? 'transaktionsbetrag' as const : 'aktuell' as const
        return { i, f }
      }
    }
    return null
  }
  let treffer = findeHeader(rows)
  if (!treffer) {
    const kommaRows = parseCsv(text, ',')
    const kommaTreffer = findeHeader(kommaRows)
    if (kommaTreffer) { rows = kommaRows; treffer = kommaTreffer }
  }
  if (!treffer) {
    throw new FinanzCsvError('Dieses CSV-Format wird nicht erkannt. Bitte den Kontoauszug (Kontotransaktionen) aus dem UBS Online Banking exportieren und die Datei vorher nicht in Excel speichern.')
  }
  headerIdx = treffer.i
  format = treffer.f

  // Metadaten vor der Kopfzeile (fehlen sie, trotzdem weiterarbeiten)
  const meta: Record<string, string> = {}
  for (let i = 0; i < headerIdx; i++) {
    const key = norm(rows[i][0]).replace(/:$/, '').trim()
    const wert = (rows[i][1] ?? '').trim()
    if (!key || !wert) continue
    for (const [ziel, namen] of Object.entries(META_KEYS)) {
      if (namen.includes(key)) meta[ziel] = wert
    }
  }
  const iban = (meta.iban ?? '').replace(/\s+/g, '')
  const kontonummer = (meta.kontonummer ?? '').trim()
  const kontoKey = iban || kontonummer.replace(/\s+/g, '') || 'unbekannt'
  const von = isoDatum(meta.von)
  const bis = isoDatum(meta.bis)
  const anfangssaldoRp = parseBetragRp(meta.anfangssaldo)
  const schlusssaldoRp = parseBetragRp(meta.schlusssaldo)
  const waehrungMeta = (meta.waehrung ?? 'CHF').trim() || 'CHF'

  // Spalten-Zuordnung
  const header = rows[headerIdx].map(norm)
  const spalte = (namen: string[], fallback: number | null): number => {
    for (let i = 0; i < header.length; i++) if (namen.includes(header[i])) return i
    return fallback ?? -1
  }
  let idxAbschluss: number, idxBuchung: number, idxValuta: number, idxWaehrung: number
  let idxBelastung: number, idxGutschrift: number, idxEinzel: number, idxSaldo: number
  let idxTrx: number, idxT1: number, idxT2: number, idxT3: number, idxTrxBetrag = -1
  if (format === 'alt21') {
    // altes Format: Spalten über die (übersetzten) Namen finden
    idxAbschluss = spalte(['abschluss', 'abschlussdatum'], 0)
    idxBuchung = spalte(BUCHUNGSDATUM_NAMEN, 0)
    idxValuta = spalte(['valuta', 'valutadatum', 'value date', 'date valeur'], idxBuchung)
    idxWaehrung = spalte(['währung', 'waehrung', 'currency', 'monnaie', 'ccy'], -1)
    idxBelastung = spalte(['belastung', 'debit', 'débit'], -1)
    idxGutschrift = spalte(['gutschrift', 'credit', 'crédit'], -1)
    idxEinzel = spalte(['einzelbetrag', 'individual amount', 'montant individuel'], -1)
    idxSaldo = spalte(['saldo', 'balance', 'solde'], -1)
    idxTrx = spalte(['transaktions-nr.', 'transaktions-nr', 'transaction no.', 'transaction no', 'no de transaction'], -1)
    idxT1 = spalte(['beschreibung 1', 'beschreibung1', 'description 1', 'description1'], -1)
    idxT2 = spalte(['beschreibung 2', 'beschreibung2', 'description 2', 'description2'], -1)
    idxT3 = spalte(['beschreibung 3', 'beschreibung3', 'description 3', 'description3'], -1)
  } else {
    // aktuelles Format: Spalten über die Namen der Kopfzeile finden, die
    // festen Positionen nur als Rückfall. Ein neuer Export der Bank mit
    // anderer Spaltenreihenfolge darf nie stillschweigend falsche Spalten
    // lesen (Einzelbetrag als Belastung und ähnliches).
    idxAbschluss = spalte(['abschlussdatum', 'closing date', 'date de clôture', 'date de cloture', 'data di chiusura'], 0)
    idxBuchung = spalte(BUCHUNGSDATUM_NAMEN, 2)
    idxValuta = spalte(['valutadatum', 'value date', 'date valeur', 'data valuta'], 3)
    idxWaehrung = spalte(['währung', 'waehrung', 'currency', 'monnaie', 'ccy'], 4)
    idxBelastung = spalte(['belastung', 'debit', 'débit', 'addebito'], 5)
    idxGutschrift = spalte(['gutschrift', 'credit', 'crédit', 'accredito'], 6)
    idxEinzel = spalte(['einzelbetrag', 'individual amount', 'montant individuel', 'importo singolo'], 7)
    idxSaldo = spalte(['saldo', 'balance', 'solde'], 8)
    idxTrx = spalte(['transaktions-nr.', 'transaktions-nr', 'transaction no.', 'transaction no', 'no de transaction', 'n. transazione'], 9)
    idxT1 = spalte(['beschreibung1', 'beschreibung 1', 'description1', 'description 1', 'descrizione1', 'descrizione 1'], 10)
    idxT2 = spalte(['beschreibung2', 'beschreibung 2', 'description2', 'description 2', 'descrizione2', 'descrizione 2'], 11)
    idxT3 = spalte(['beschreibung3', 'beschreibung 3', 'description3', 'description 3', 'descrizione3', 'descrizione 3'], 12)
    if (format === 'transaktionsbetrag') {
      idxTrxBetrag = spalte(TRXBETRAG_NAMEN, -1)
      // die Spalte «Belastung/Gutschrift» trägt nur B oder G, keinen Betrag
      idxBelastung = -1; idxGutschrift = -1
    }
  }

  type Roh = Omit<Buchung, 'id' | 'kategorieManuell' | 'importId'> & { fileIndex: number }
  const roh: Roh[] = []
  const warnungen: string[] = []
  let vorgemerkt = 0
  let unlesbar = 0

  const feld = (r: string[], i: number) => (i >= 0 && i < r.length ? (r[i] ?? '').trim() : '')

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    if (r.every(c => !c || !c.trim())) continue
    const buchungsdatum = isoDatum(feld(r, idxBuchung))
    const abschluss = feld(r, idxAbschluss)
    const belastungRp = parseBetragRp(feld(r, idxBelastung))
    const gutschriftRp = parseBetragRp(feld(r, idxGutschrift))
    const trxBetragRp = idxTrxBetrag >= 0 ? parseBetragRp(feld(r, idxTrxBetrag)) : null
    const einzelRp = parseBetragRp(feld(r, idxEinzel))
    const trx = feld(r, idxTrx)

    // Betrag: immer −|Belastung| bzw. +|Gutschrift|, damit auch ältere
    // Formate mit positiver Belastung stimmen; Variante: Vorzeichen-Spalte
    const betragRp = trxBetragRp != null
      ? trxBetragRp
      : belastungRp != null ? -Math.abs(belastungRp)
      : gutschriftRp != null ? Math.abs(gutschriftRp)
      : null

    if (!buchungsdatum) {
      if (abschluss && betragRp != null) { vorgemerkt++; continue }   // vorgemerkt, nicht verbucht
      if (einzelRp != null && roh.length > 0 && trx && roh[roh.length - 1].transaktionsNr === trx) {
        roh[roh.length - 1].details.push({ betragRp: einzelRp, text1: feld(r, idxT1), text3: feld(r, idxT3) })
        continue
      }
      continue
    }
    if (betragRp == null) {
      // Zeile mit Datum, aber ohne Betrag: als Detail zur letzten Buchung,
      // falls Einzelbetrag + gleiche Transaktionsnummer, sonst überspringen
      if (einzelRp != null && roh.length > 0 && trx && roh[roh.length - 1].transaktionsNr === trx) {
        roh[roh.length - 1].details.push({ betragRp: einzelRp, text1: feld(r, idxT1), text3: feld(r, idxT3) })
      } else if (feld(r, idxBelastung) || feld(r, idxGutschrift) || (idxTrxBetrag >= 0 && feld(r, idxTrxBetrag))) {
        // Betragszelle vorhanden, aber nicht lesbar — nie stillschweigend
        // weglassen, sonst fehlen Einnahmen oder Ausgaben in der Analyse
        unlesbar++
      }
      continue
    }

    roh.push({
      fileIndex: i,
      kontoKey,
      buchungsdatum,
      valutadatum: isoDatum(feld(r, idxValuta)),
      betragRp,
      waehrung: feld(r, idxWaehrung) || waehrungMeta,
      saldoRp: parseBetragRp(feld(r, idxSaldo)),
      transaktionsNr: trx,
      text1: feld(r, idxT1),
      text2: feld(r, idxT2),
      text3: feld(r, idxT3),
      details: [],
    })
  }

  if (roh.length === 0) {
    throw new FinanzCsvError('Im CSV wurden keine verbuchten Transaktionen gefunden.')
  }
  if (unlesbar > 0) {
    warnungen.push(`${unlesbar} Zeile${unlesbar === 1 ? '' : 'n'} mit nicht lesbarem Betrag wurde${unlesbar === 1 ? '' : 'n'} übersprungen — bitte die Datei unverändert aus dem E-Banking exportieren (nicht in Excel öffnen und speichern) und erneut importieren.`)
  }

  // Nicht auf die Dateisortierung verlassen: Buchungsdatum aufsteigend, bei
  // gleichem Datum die Dateireihenfolge umgekehrt (Datei ist neueste zuerst)
  roh.sort((a, b) => a.buchungsdatum.localeCompare(b.buchungsdatum) || b.fileIndex - a.fileIndex)

  // Stabile IDs: Hash + laufender Zähler für identische Zeilen am selben Tag
  const zaehler = new Map<string, number>()
  const buchungen: Buchung[] = roh.map(r => {
    const basis = [r.kontoKey, r.buchungsdatum, r.betragRp, r.transaktionsNr, r.text1, r.text2, r.text3].join('|')
    const n = (zaehler.get(basis) ?? 0) + 1
    zaehler.set(basis, n)
    const { fileIndex, ...rest } = r
    void fileIndex
    return { ...rest, id: `${hash36(basis)}_${n}`, kategorieManuell: null, importId: '' }
  })

  // Saldo-Abgleich und Saldo je Monatsende
  const summeRp = buchungen.reduce((s, b) => s + b.betragRp, 0)
  let saldoAbgleichOk: boolean | null = null
  if (anfangssaldoRp != null && schlusssaldoRp != null) {
    saldoAbgleichOk = Math.abs(anfangssaldoRp + summeRp - schlusssaldoRp) <= 1
  }
  // wo die Bank pro Zeile einen Saldo liefert, gegenprüfen
  if (anfangssaldoRp != null) {
    let laufend = anfangssaldoRp
    let abweichungen = 0
    for (const b of buchungen) {
      laufend += b.betragRp
      if (b.saldoRp != null && Math.abs(laufend - b.saldoRp) > 1) abweichungen++
    }
    if (abweichungen > 0) {
      warnungen.push(`Die Saldo-Spalte weicht bei ${abweichungen} Buchung(en) vom gerechneten Saldo ab — möglicherweise fehlen Buchungen im Export.`)
    }
  }

  const vonEff = von ?? buchungen[0].buchungsdatum
  const bisEff = bis ?? buchungen[buchungen.length - 1].buchungsdatum

  const monate: Record<string, ParseMonat> = {}
  let laufend = anfangssaldoRp
  let letzterZeilenSaldo: number | null = null
  let aktMonat = ''
  for (const b of buchungen) {
    const m = monatVon(b.buchungsdatum)
    if (m !== aktMonat) {
      aktMonat = m
      letzterZeilenSaldo = null
      monate[m] = {
        einnahmenRp: 0, ausgabenRp: 0, summeRp: 0, anzahl: 0, saldoEndeRp: null,
        vollstaendig: monatAbgedeckt(vonEff, bisEff, m),
      }
    }
    const mi = monate[m]
    mi.anzahl++
    mi.summeRp += b.betragRp
    if (b.betragRp >= 0) mi.einnahmenRp += b.betragRp
    else mi.ausgabenRp += -b.betragRp
    if (laufend != null) laufend += b.betragRp
    if (b.saldoRp != null) letzterZeilenSaldo = b.saldoRp
    mi.saldoEndeRp = laufend != null ? laufend : letzterZeilenSaldo
  }

  if (saldoAbgleichOk === false) {
    warnungen.push('Saldo-Abgleich: Anfangssaldo plus Summe der Buchungen ergibt nicht den Schlusssaldo. Import ist möglich, bitte die Zahlen prüfen.')
  }

  return {
    format, kontoKey, iban, kontonummer,
    waehrung: waehrungMeta, von, bis,
    anfangssaldoRp, schlusssaldoRp,
    buchungen, vorgemerkt, warnungen, saldoAbgleichOk, monate,
  }
}

// ── Zusammenführen mit dem gespeicherten Bestand ─────────────────────────

export type MonatsStatus = 'neu' | 'ersetzt' | 'ergaenzt'

/** Import in eine (evtl. bestehende) Jahresdatei einarbeiten.
 *  Vollständig abgedeckte Monate ersetzen den Bestand ganz (kategorieManuell
 *  bleibt über die id erhalten); teilweise abgedeckte werden über die id
 *  zusammengeführt und sind vollstaendig = false. */
export function fuehreJahrZusammen(
  bestehend: Jahresdatei | null,
  kontoKey: string,
  jahr: number,
  parse: ParseErgebnis,
  importId: string,
): { datei: Jahresdatei; status: Record<string, MonatsStatus> } {
  const datei: Jahresdatei = bestehend
    ? { ...bestehend, monate: { ...bestehend.monate }, buchungen: [...bestehend.buchungen] }
    : { kontoKey, jahr, monate: {}, buchungen: [] }
  const status: Record<string, MonatsStatus> = {}

  const parseMonate = Object.keys(parse.monate).filter(m => m.startsWith(String(jahr))).sort()
  for (const m of parseMonate) {
    const pm = parse.monate[m]
    const neue = parse.buchungen
      .filter(b => monatVon(b.buchungsdatum) === m)
      .map(b => ({ ...b, importId }))
    const alte = datei.buchungen.filter(b => monatVon(b.buchungsdatum) === m)
    const uebrige = datei.buchungen.filter(b => monatVon(b.buchungsdatum) !== m)
    const alteInfo: MonatsInfo | undefined = datei.monate[m]

    if (pm.vollstaendig) {
      // ganz ersetzen, manuelle Kategorien über die id retten
      const manuell = new Map(alte.filter(b => b.kategorieManuell).map(b => [b.id, b.kategorieManuell]))
      const ersetzt = neue.map(b => (manuell.has(b.id) ? { ...b, kategorieManuell: manuell.get(b.id)! } : b))
      datei.buchungen = [...uebrige, ...ersetzt]
      datei.monate[m] = { saldoMonatsendeRp: pm.saldoEndeRp, vollstaendig: true, abgleichOk: parse.saldoAbgleichOk }
      status[m] = alte.length > 0 || alteInfo ? 'ersetzt' : 'neu'
    } else {
      const vorhandene = new Set(alte.map(b => b.id))
      const zusaetzliche = neue.filter(b => !vorhandene.has(b.id))
      datei.buchungen = [...uebrige, ...alte, ...zusaetzliche]
      // Ein bereits vollständiger Monat bleibt vollständig, solange der
      // Teilimport nichts Neues bringt (reine Überschneidung)
      const bleibtVollstaendig = (alteInfo?.vollstaendig ?? false) && zusaetzliche.length === 0
      datei.monate[m] = {
        saldoMonatsendeRp: pm.saldoEndeRp ?? alteInfo?.saldoMonatsendeRp ?? null,
        vollstaendig: bleibtVollstaendig,
        abgleichOk: alteInfo?.abgleichOk ?? parse.saldoAbgleichOk,
      }
      status[m] = alte.length > 0 || alteInfo ? 'ergaenzt' : 'neu'
    }
  }

  datei.buchungen.sort((a, b) => a.buchungsdatum.localeCompare(b.buchungsdatum) || a.id.localeCompare(b.id))
  return { datei, status }
}
