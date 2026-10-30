// Geschäftsanalyse — reine Rechenfunktionen auf MONATS-AGGREGATEN.
// Alles in Rappen (ganze Zahlen). Diese Datei enthält und erzeugt KEINE
// Buchungstexte — sie darf deshalb auch im Browser laufen (der Client
// bekommt nur Monatswerte, nie einzelne Buchungen).
//
// Begriffe (aus dem Konzept):
//   E = Einnahmen Betrieb, R = Rückerstattungen, A = Ausgaben Betrieb,
//   B = Betriebsergebnis = E + R − A,
//   S = Steuern, I = Investitionen, F = Finanzierung,
//   U = Unklassiert, N = Interne Umbuchungen,
//   ΔK = Kontostand Monatsende − Vormonat.
// Kontrolle: B + S + I + F + U + N = ΔK (±1 Franken), sonst Warnung.

import type { Buchung, MonatsInfo } from './types'
import { GRUPPEN_REIHENFOLGE, type Gruppe, type Kategorie, type KategorisierKontext, kategorieVon, UNKLASSIERT_ID, INTERN_ID } from './kategorien'

// ── Aggregat pro Konto und Monat (das ist alles, was der Client sieht) ──

export type MonatsAggregat = {
  kontoKey: string
  monat: string                       // YYYY-MM
  /** signierte Rappen-Summe je Gruppe */
  gruppen: Partial<Record<Gruppe, number>>
  /** signierte Rappen-Summe je Kategorie */
  kategorien: Record<string, number>
  anzahl: number
  unklassiert: number                 // Anzahl unklassierter Buchungen
  saldoEndeRp: number | null
  vollstaendig: boolean
  abgleichOk: boolean | null
}

export function aggregiereMonate(
  kontoKey: string,
  buchungen: Buchung[],
  monatsInfos: Record<string, MonatsInfo>,
  ctx: KategorisierKontext,
): MonatsAggregat[] {
  const proMonat = new Map<string, MonatsAggregat>()
  const hol = (monat: string): MonatsAggregat => {
    let a = proMonat.get(monat)
    if (!a) {
      const info = monatsInfos[monat]
      a = {
        kontoKey, monat, gruppen: {}, kategorien: {}, anzahl: 0, unklassiert: 0,
        saldoEndeRp: info?.saldoMonatsendeRp ?? null,
        vollstaendig: info?.vollstaendig ?? false,
        abgleichOk: info?.abgleichOk ?? null,
      }
      proMonat.set(monat, a)
    }
    return a
  }
  // auch Monate ohne Buchungen aufnehmen (Saldo/vollständig sind trotzdem da)
  for (const monat of Object.keys(monatsInfos)) hol(monat)
  for (const b of buchungen) {
    const a = hol(b.buchungsdatum.slice(0, 7))
    const z = kategorieVon(b, ctx)
    a.gruppen[z.gruppe] = (a.gruppen[z.gruppe] ?? 0) + b.betragRp
    a.kategorien[z.kategorieId] = (a.kategorien[z.kategorieId] ?? 0) + b.betragRp
    a.anzahl += 1
    if (z.kategorieId === UNKLASSIERT_ID) a.unklassiert += 1
  }
  return Array.from(proMonat.values()).sort((x, y) => x.monat.localeCompare(y.monat))
}

// ── Konten kombinieren («Alle Konten»: Salden addiert, intern hebt sich auf) ──

export type KombiMonat = {
  monat: string
  gruppen: Partial<Record<Gruppe, number>>
  kategorien: Record<string, number>
  anzahl: number
  unklassiert: number
  saldoEndeRp: number | null
  vollstaendig: boolean
  abgleichOk: boolean | null
}

export function kombiniereMonate(aggregate: MonatsAggregat[], kontoKey: string | 'alle'): KombiMonat[] {
  const relevant = kontoKey === 'alle' ? aggregate : aggregate.filter(a => a.kontoKey === kontoKey)
  if (relevant.length === 0) return []
  const monate = Array.from(new Set(relevant.map(a => a.monat))).sort()
  const kontos = Array.from(new Set(relevant.map(a => a.kontoKey)))
  const proKontoMonat = new Map<string, MonatsAggregat>()
  for (const a of relevant) proKontoMonat.set(`${a.kontoKey}|${a.monat}`, a)

  const out: KombiMonat[] = []
  // Saldo je Konto fortschreiben — hat ein Konto in einem Monat keinen
  // Import, zählt sein letzter bekannter Stand weiter
  const letzterSaldo = new Map<string, number>()
  for (const monat of monate) {
    const k: KombiMonat = {
      monat, gruppen: {}, kategorien: {}, anzahl: 0, unklassiert: 0,
      saldoEndeRp: null, vollstaendig: true, abgleichOk: null,
    }
    let saldoSumme = 0
    let saldoBekannt = false
    for (const konto of kontos) {
      const a = proKontoMonat.get(`${konto}|${monat}`)
      if (a) {
        for (const g of Object.keys(a.gruppen) as Gruppe[]) k.gruppen[g] = (k.gruppen[g] ?? 0) + (a.gruppen[g] ?? 0)
        for (const id of Object.keys(a.kategorien)) k.kategorien[id] = (k.kategorien[id] ?? 0) + a.kategorien[id]
        k.anzahl += a.anzahl
        k.unklassiert += a.unklassiert
        if (!a.vollstaendig) k.vollstaendig = false
        if (a.abgleichOk === false) k.abgleichOk = false
        else if (a.abgleichOk === true && k.abgleichOk === null) k.abgleichOk = true
        if (a.saldoEndeRp != null) letzterSaldo.set(konto, a.saldoEndeRp)
      }
      const s = letzterSaldo.get(konto)
      if (s != null) { saldoSumme += s; saldoBekannt = true }
    }
    k.saldoEndeRp = saldoBekannt ? saldoSumme : null
    out.push(k)
  }
  return out
}

// ── Monatsreihe mit Kennwerten E R A B S I F U N ΔK ─────────────────────

export type MonatsStatus2 = 'ok' | 'laufend' | 'unvollstaendig'

export type MonatsReihe = {
  monat: string
  E: number   // Einnahmen Betrieb, positiv dargestellt
  R: number   // Rückerstattungen, positiv dargestellt
  A: number   // Ausgaben Betrieb, positiv dargestellt
  B: number   // Betriebsergebnis, signiert
  S: number; I: number; F: number; U: number; N: number   // signiert
  kategorien: Record<string, number>
  anzahl: number
  unklassiert: number
  saldoEndeRp: number | null
  deltaK: number | null
  kontrolleOk: boolean | null
  status: MonatsStatus2
  abgleichOk: boolean | null
}

/** Vormonat als YYYY-MM. */
export function vormonat(monat: string): string {
  const j = parseInt(monat.slice(0, 4), 10)
  const m = parseInt(monat.slice(5, 7), 10)
  return m === 1 ? `${j - 1}-12` : `${j}-${String(m - 1).padStart(2, '0')}`
}

export function baueReihen(kombi: KombiMonat[], heuteMonat: string): MonatsReihe[] {
  const proMonat = new Map(kombi.map(k => [k.monat, k]))
  return kombi.map(k => {
    const g = (x: Gruppe) => k.gruppen[x] ?? 0
    const E = g('EINNAHMEN_BETRIEB')
    const R = g('RUECKERSTATTUNGEN')
    const Aers = g('AUSGABEN_BETRIEB')      // signiert (negativ)
    const B = E + R + Aers
    const S = g('STEUERN'), I = g('INVESTITIONEN'), F = g('FINANZIERUNG')
    const U = g('UNKLASSIERT'), N = g('INTERN')
    const vor = proMonat.get(vormonat(k.monat))
    const deltaK = (k.saldoEndeRp != null && vor?.saldoEndeRp != null)
      ? k.saldoEndeRp - vor.saldoEndeRp : null
    const kontrolleOk = deltaK == null ? null : Math.abs((B + S + I + F + U + N) - deltaK) <= 100
    const status: MonatsStatus2 = k.monat === heuteMonat ? 'laufend' : (k.vollstaendig ? 'ok' : 'unvollstaendig')
    return {
      monat: k.monat, E, R, A: -Aers, B, S, I, F, U, N,
      kategorien: k.kategorien, anzahl: k.anzahl, unklassiert: k.unklassiert,
      saldoEndeRp: k.saldoEndeRp, deltaK, kontrolleOk, status, abgleichOk: k.abgleichOk,
    }
  })
}

/** Vollständige Monate (weder laufend noch lückenhaft) — nur diese fliessen
 *  in Durchschnitte, Vergleiche und Trends. */
const vollstaendige = (reihen: MonatsReihe[]) => reihen.filter(r => r.status === 'ok')

const summe = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
const schnitt = (xs: number[]) => (xs.length === 0 ? null : Math.round(summe(xs) / xs.length))

// ── Kennzahlen für die vier Kacheln ──────────────────────────────────────

export type Kennzahlen = {
  kontostandRp: number | null
  kontostandMonat: string | null
  /** Veränderung des Kontostands gegenüber vor 3 Monaten */
  delta3Rp: number | null
  /** Ø Betriebsergebnis der letzten 3 vollständigen Monate */
  oeB3Rp: number | null
  oeB3Monate: string[]
  /** Ø Betriebsergebnis derselben 3 Monate im Vorjahr */
  oeB3VorjahrRp: number | null
  /** Einnahmen (E+R) seit Jahresbeginn, nur vollständige Monate */
  ytdRp: number | null
  ytdVorjahrRp: number | null
  ytdProzent: number | null
  ytdMonate: string[]
  /** Reserve in Monaten = Kontostand / Ø Ausgaben der letzten 6 vollst. Monate */
  reserveMonate: number | null
  oeA6Rp: number | null
}

export function berechneKennzahlen(reihen: MonatsReihe[], heuteMonat: string): Kennzahlen {
  const mitSaldo = reihen.filter(r => r.saldoEndeRp != null)
  const letzte = mitSaldo[mitSaldo.length - 1] ?? null
  const kontostandRp = letzte?.saldoEndeRp ?? null
  const kontostandMonat = letzte?.monat ?? null

  let delta3Rp: number | null = null
  if (letzte) {
    let m = letzte.monat
    for (let i = 0; i < 3; i++) m = vormonat(m)
    const basis = reihen.find(r => r.monat === m && r.saldoEndeRp != null)
    if (basis?.saldoEndeRp != null && letzte.saldoEndeRp != null) delta3Rp = letzte.saldoEndeRp - basis.saldoEndeRp
  }

  const voll = vollstaendige(reihen)
  const b3 = voll.slice(-3)
  const oeB3Rp = b3.length === 3 ? schnitt(b3.map(r => r.B)) : null
  const oeB3Monate = b3.map(r => r.monat)
  const vjMonate = oeB3Monate.map(m => `${parseInt(m.slice(0, 4), 10) - 1}${m.slice(4)}`)
  const vjReihen = voll.filter(r => vjMonate.includes(r.monat))
  const oeB3VorjahrRp = vjReihen.length === 3 ? schnitt(vjReihen.map(r => r.B)) : null

  // Seit Jahresbeginn: vollständige Monate des laufenden Jahres, verglichen
  // mit DENSELBEN Monaten des Vorjahres (nur wenn dort ebenfalls vollständig)
  const jahr = heuteMonat.slice(0, 4)
  const ytdReihen = voll.filter(r => r.monat.startsWith(jahr))
  const ytdMonate = ytdReihen.map(r => r.monat)
  const ytdRp = ytdReihen.length > 0 ? summe(ytdReihen.map(r => r.E + r.R)) : null
  const vjKeys = ytdMonate.map(m => `${parseInt(m.slice(0, 4), 10) - 1}${m.slice(4)}`)
  const ytdVj = voll.filter(r => vjKeys.includes(r.monat))
  const ytdVorjahrRp = (ytdMonate.length > 0 && ytdVj.length === ytdMonate.length)
    ? summe(ytdVj.map(r => r.E + r.R)) : null
  const ytdProzent = (ytdRp != null && ytdVorjahrRp != null && ytdVorjahrRp !== 0)
    ? Math.round(((ytdRp - ytdVorjahrRp) / Math.abs(ytdVorjahrRp)) * 1000) / 10 : null

  const a6 = voll.slice(-6)
  const oeA6Rp = a6.length >= 3 ? schnitt(a6.map(r => r.A)) : null
  const reserveMonate = (kontostandRp != null && oeA6Rp != null && oeA6Rp > 0)
    ? Math.round((kontostandRp / oeA6Rp) * 10) / 10 : null

  return { kontostandRp, kontostandMonat, delta3Rp, oeB3Rp, oeB3Monate, oeB3VorjahrRp, ytdRp, ytdVorjahrRp, ytdProzent, ytdMonate, reserveMonate, oeA6Rp }
}

// ── Trends (Pillen mit Erklärung) ────────────────────────────────────────

export type Trend = {
  richtung: 'auf' | 'ab' | 'stabil'
  label: string
  erklaerung: string
}

/** Betriebstrend: Ø B der letzten 3 vollständigen Monate gegen die 3 davor;
 *  Schwelle = 2% der durchschnittlichen Einnahmen dieser 6 Monate. */
export function trendBetrieb(reihen: MonatsReihe[], fmtRp: (rp: number) => string): Trend | null {
  const voll = vollstaendige(reihen)
  if (voll.length < 6) return null
  const neu = voll.slice(-3), alt = voll.slice(-6, -3)
  const bNeu = schnitt(neu.map(r => r.B))!, bAlt = schnitt(alt.map(r => r.B))!
  const schwelle = Math.round(summe([...neu, ...alt].map(r => r.E + r.R)) / 6 * 0.02)
  const diff = bNeu - bAlt
  const richtung: Trend['richtung'] = diff > schwelle ? 'auf' : diff < -schwelle ? 'ab' : 'stabil'

  let vjText = ''
  const vjKeys = neu.map(r => `${parseInt(r.monat.slice(0, 4), 10) - 1}${r.monat.slice(4)}`)
  const vj = voll.filter(r => vjKeys.includes(r.monat))
  if (vj.length === 3) {
    const bVj = schnitt(vj.map(r => r.B))!
    vjText = ` Im Vorjahreszeitraum waren es ${fmtRp(bVj)}.`
  }
  return {
    richtung,
    label: richtung === 'auf' ? 'Betrieb: Aufwärts' : richtung === 'ab' ? 'Betrieb: Abwärts' : 'Betrieb: Stabil',
    erklaerung: `Ø Betriebsergebnis der letzten 3 vollständigen Monate: ${fmtRp(bNeu)}, in den 3 Monaten davor: ${fmtRp(bAlt)}.${vjText}`,
  }
}

/** Reserventrend: Veränderung des Kontostands über die letzten 3 Monate mit
 *  ΔK; die Erklärung nennt den Anteil von Investitionen und Steuern. */
export function trendReserven(reihen: MonatsReihe[], fmtRp: (rp: number) => string): Trend | null {
  const mitDelta = reihen.filter(r => r.deltaK != null && r.status !== 'laufend')
  if (mitDelta.length < 3) return null
  const drei = mitDelta.slice(-3)
  const delta = summe(drei.map(r => r.deltaK!))
  const invest = summe(drei.map(r => r.I))
  const steuern = summe(drei.map(r => r.S))
  const einnahmen = summe(drei.map(r => r.E + r.R))
  const schwelle = Math.max(Math.round(einnahmen / 3 * 0.02), 50000)
  const richtung: Trend['richtung'] = delta > schwelle ? 'auf' : delta < -schwelle ? 'ab' : 'stabil'
  let anteil = ''
  if (invest < -100 || steuern < -100) {
    const teile: string[] = []
    if (invest < -100) teile.push(`${fmtRp(-invest)} Investitionen`)
    if (steuern < -100) teile.push(`${fmtRp(-steuern)} Steuern`)
    anteil = ` Darin enthalten: ${teile.join(' und ')}.`
  }
  return {
    richtung,
    label: richtung === 'auf' ? 'Reserven: Wachsend' : richtung === 'ab' ? 'Reserven: Sinkend' : 'Reserven: Stabil',
    erklaerung: `Der Kontostand hat sich über die letzten 3 abgeschlossenen Monate um ${delta >= 0 ? '+' : '−'}${fmtRp(Math.abs(delta))} verändert.${anteil}`,
  }
}

// ── Wohin geht das Geld (Betriebsausgaben nach Kategorie) ────────────────

export type AusgabenPosten = {
  kategorieId: string
  name: string
  betragRp: number          // positiv
  anteil: number            // 0..1 an den Betriebsausgaben der Periode
  /** Veränderung gegenüber der gleich langen Vorperiode, positiv = mehr ausgegeben */
  deltaRp: number | null
}

export function wohinGehtGeld(
  reihen: MonatsReihe[], vonMonat: string, bisMonat: string, kategorien: Kategorie[],
): AusgabenPosten[] {
  const ausgabenKats = new Set(kategorien.filter(k => k.gruppe === 'AUSGABEN_BETRIEB').map(k => k.id))
  const imBereich = reihen.filter(r => r.monat >= vonMonat && r.monat <= bisMonat)
  if (imBereich.length === 0) return []

  const sumProKat = (rs: MonatsReihe[]) => {
    const m = new Map<string, number>()
    for (const r of rs) {
      for (const [id, rp] of Object.entries(r.kategorien)) {
        if (ausgabenKats.has(id) && rp < 0) m.set(id, (m.get(id) ?? 0) + -rp)
      }
    }
    return m
  }
  const jetzt = sumProKat(imBereich)
  const total = summe(Array.from(jetzt.values()))
  if (total === 0) return []

  // Vorperiode: gleich viele Monate direkt davor (nur wenn ganz vorhanden)
  const laenge = imBereich.length
  let m = vonMonat
  const vorMonate: string[] = []
  for (let i = 0; i < laenge; i++) { m = vormonat(m); vorMonate.unshift(m) }
  const vorReihen = reihen.filter(r => vorMonate.includes(r.monat))
  const vorher = vorReihen.length === laenge ? sumProKat(vorReihen) : null

  return Array.from(jetzt.entries())
    .map(([id, rp]) => ({
      kategorieId: id,
      name: kategorien.find(k => k.id === id)?.name ?? id,
      betragRp: rp,
      anteil: rp / total,
      deltaRp: vorher ? rp - (vorher.get(id) ?? 0) : null,
    }))
    .sort((a, b) => b.betragRp - a.betragRp)
}

// ── Grösste Veränderungen (3 Monate gegen 3 davor, alle Gruppen ausser intern) ──

export type Veraenderung = {
  kategorieId: string
  name: string
  gruppe: Gruppe
  vorherRp: number      // signiert
  nachherRp: number     // signiert
  deltaRp: number       // nachher − vorher, signiert
}

export function groessteVeraenderungen(reihen: MonatsReihe[], kategorien: Kategorie[]): Veraenderung[] {
  const voll = vollstaendige(reihen)
  if (voll.length < 6) return []
  const neu = voll.slice(-3), alt = voll.slice(-6, -3)
  const sumProKat = (rs: MonatsReihe[]) => {
    const m = new Map<string, number>()
    for (const r of rs) for (const [id, rp] of Object.entries(r.kategorien)) m.set(id, (m.get(id) ?? 0) + rp)
    return m
  }
  const a = sumProKat(alt), n = sumProKat(neu)
  const ids = new Set([...Array.from(a.keys()), ...Array.from(n.keys())])
  const out: Veraenderung[] = []
  ids.forEach(id => {
    if (id === INTERN_ID) return
    const kat = kategorien.find(k => k.id === id)
    if (kat?.gruppe === 'INTERN') return
    const vorherRp = a.get(id) ?? 0
    const nachherRp = n.get(id) ?? 0
    const deltaRp = nachherRp - vorherRp
    if (Math.abs(deltaRp) < 10000) return   // unter CHF 100 ist Rauschen
    out.push({ kategorieId: id, name: kat?.name ?? (id === UNKLASSIERT_ID ? 'Unklassiert' : id), gruppe: kat?.gruppe ?? 'UNKLASSIERT', vorherRp, nachherRp, deltaRp })
  })
  return out.sort((x, y) => Math.abs(y.deltaRp) - Math.abs(x.deltaRp)).slice(0, 5)
}

// ── Kategorien eines Monats gegen den 6-Monats-Schnitt (Monatsdetails) ───

export type KategorieVergleich = {
  kategorieId: string
  name: string
  gruppe: Gruppe
  betragRp: number          // signiert, dieser Monat
  schnittRp: number | null  // signiert, Ø der bis zu 6 vollständigen Monate davor
  /** Betriebsausgabe, die mehr als 20% über ihrem Schnitt liegt (mind. CHF 500) */
  auffaellig: boolean
}

export function kategorieVergleich(reihen: MonatsReihe[], monat: string, kategorien: Kategorie[]): KategorieVergleich[] {
  const zeile = reihen.find(r => r.monat === monat)
  if (!zeile) return []
  const davor = vollstaendige(reihen).filter(r => r.monat < monat).slice(-6)
  const schnittProKat = new Map<string, number>()
  if (davor.length >= 3) {
    const sum = new Map<string, number>()
    for (const r of davor) for (const [id, rp] of Object.entries(r.kategorien)) sum.set(id, (sum.get(id) ?? 0) + rp)
    sum.forEach((rp, id) => schnittProKat.set(id, Math.round(rp / davor.length)))
  }
  return Object.entries(zeile.kategorien)
    .map(([id, betragRp]) => {
      const kat = kategorien.find(k => k.id === id)
      const gruppe = kat?.gruppe ?? 'UNKLASSIERT'
      const schnittRp = schnittProKat.has(id) ? schnittProKat.get(id)! : null
      const auffaellig = gruppe === 'AUSGABEN_BETRIEB' && betragRp < 0 && schnittRp != null && schnittRp < 0
        && -betragRp >= 50000 && -betragRp > -schnittRp * 1.2
      return { kategorieId: id, name: kat?.name ?? (id === UNKLASSIERT_ID ? 'Unklassiert' : id), gruppe, betragRp, schnittRp, auffaellig }
    })
    .sort((x, y) => {
      const gx = GRUPPEN_REIHENFOLGE.indexOf(x.gruppe), gy = GRUPPEN_REIHENFOLGE.indexOf(y.gruppe)
      return gx !== gy ? gx - gy : Math.abs(y.betragRp) - Math.abs(x.betragRp)
    })
}

// ── Reserveziel ──────────────────────────────────────────────────────────

export type FinanzZiel = {
  zielRp: number | null
  zieldatum: string | null       // YYYY-MM-DD
  mindestMonate: number          // Mindestreserve in Monaten, Standard 3
}

export const STANDARD_ZIEL: FinanzZiel = { zielRp: null, zieldatum: null, mindestMonate: 3 }

export type ZielStatus = {
  mindestreserveRp: number | null
  reserveOk: boolean | null
  fortschritt: number | null        // 0..1 Richtung Zielbetrag
  monateBisZiel: number | null
  noetigeSparrateRp: number | null  // pro Monat bis zum Zieldatum
  /** tatsächliche Ø-Veränderung des Kontostands, letzte 3 abgeschlossene Monate */
  tatsaechlichRp: number | null
  imPlan: boolean | null
}

export function zielStatus(ziel: FinanzZiel, kz: Kennzahlen, reihen: MonatsReihe[], heuteMonat: string): ZielStatus {
  const mindestreserveRp = kz.oeA6Rp != null ? kz.oeA6Rp * ziel.mindestMonate : null
  const reserveOk = (mindestreserveRp != null && kz.kontostandRp != null) ? kz.kontostandRp >= mindestreserveRp : null

  const mitDelta = reihen.filter(r => r.deltaK != null && r.status !== 'laufend').slice(-3)
  const tatsaechlichRp = mitDelta.length === 3 ? schnitt(mitDelta.map(r => r.deltaK!)) : null

  let fortschritt: number | null = null
  let monateBisZiel: number | null = null
  let noetigeSparrateRp: number | null = null
  let imPlan: boolean | null = null
  if (ziel.zielRp != null && ziel.zielRp > 0 && kz.kontostandRp != null) {
    fortschritt = Math.max(0, Math.min(1, kz.kontostandRp / ziel.zielRp))
    if (ziel.zieldatum) {
      const zielMonat = ziel.zieldatum.slice(0, 7)
      const [jz, mz] = [parseInt(zielMonat.slice(0, 4), 10), parseInt(zielMonat.slice(5, 7), 10)]
      const [jh, mh] = [parseInt(heuteMonat.slice(0, 4), 10), parseInt(heuteMonat.slice(5, 7), 10)]
      monateBisZiel = Math.max(0, (jz - jh) * 12 + (mz - mh))
      const fehlt = Math.max(0, ziel.zielRp - kz.kontostandRp)
      if (fehlt === 0) { noetigeSparrateRp = 0; imPlan = true }
      else if (monateBisZiel === 0) { noetigeSparrateRp = fehlt; imPlan = false }
      else {
        noetigeSparrateRp = Math.ceil(fehlt / monateBisZiel)
        imPlan = tatsaechlichRp != null ? tatsaechlichRp >= noetigeSparrateRp : null
      }
    }
  }
  return { mindestreserveRp, reserveOk, fortschritt, monateBisZiel, noetigeSparrateRp, tatsaechlichRp, imPlan }
}

// ── Hinweise: wo stehen wir, wo können wir besser werden ─────────────────

export type Hinweis = {
  ton: 'gut' | 'achtung' | 'info'
  titel: string
  text: string
}

export function baueHinweise(args: {
  reihen: MonatsReihe[]
  kennzahlen: Kennzahlen
  kategorien: Kategorie[]
  ziel: FinanzZiel
  zielSt: ZielStatus
  trendB: Trend | null
  unklassiertOffen: number
  grosseOffen: number
  fmtRp: (rp: number) => string
}): Hinweis[] {
  const { reihen, kennzahlen: kz, kategorien, ziel, zielSt, trendB, unklassiertOffen, grosseOffen, fmtRp } = args
  const out: Hinweis[] = []
  const voll = vollstaendige(reihen)

  // 1) Betriebsergebnis
  if (kz.oeB3Rp != null) {
    if (kz.oeB3Rp < 0) {
      out.push({
        ton: 'achtung', titel: 'Betrieb kostet zurzeit Geld',
        text: `Der Betrieb hat in den letzten 3 vollständigen Monaten im Schnitt ${fmtRp(-kz.oeB3Rp)} pro Monat gekostet (Ausgaben höher als Einnahmen). Die Karte «Wohin geht das Geld» zeigt, welche Kategorien am meisten ausmachen.`,
      })
    } else if (trendB?.richtung === 'ab') {
      out.push({
        ton: 'achtung', titel: 'Betriebsergebnis rückläufig',
        text: trendB.erklaerung + ' Ein Blick auf die grössten Veränderungen zeigt, welche Kategorien sich verschoben haben.',
      })
    } else if (trendB?.richtung === 'auf') {
      out.push({ ton: 'gut', titel: 'Betriebsergebnis verbessert sich', text: trendB.erklaerung })
    }
  }

  // 2) Auffällige Ausgaben-Kategorien im letzten vollständigen Monat
  const letzterVoll = voll[voll.length - 1]
  if (letzterVoll) {
    const auffaellige = kategorieVergleich(reihen, letzterVoll.monat, kategorien).filter(k => k.auffaellig)
    for (const k of auffaellige.slice(0, 3)) {
      const mehr = -k.betragRp - -(k.schnittRp ?? 0)
      out.push({
        ton: 'achtung', titel: `${k.name}: deutlich über dem Schnitt`,
        text: `Im ${monatLabel(letzterVoll.monat)} lagen die Ausgaben für «${k.name}» bei ${fmtRp(-k.betragRp)} — rund ${fmtRp(mehr)} über dem Durchschnitt der Monate davor (${fmtRp(-(k.schnittRp ?? 0))}). Einmalige Anschaffung oder neuer Dauerposten? Die Buchungen dazu stehen in den Monatsdetails.`,
      })
    }
  }

  // 3) Reserve
  if (zielSt.reserveOk === false && zielSt.mindestreserveRp != null && kz.kontostandRp != null) {
    out.push({
      ton: 'achtung', titel: 'Reserve unter dem Minimum',
      text: `Der Kontostand (${fmtRp(kz.kontostandRp)}) liegt unter der Mindestreserve von ${ziel.mindestMonate} Monatsausgaben (${fmtRp(zielSt.mindestreserveRp)}). Grössere Ausgaben nach Möglichkeit aufschieben, bis das Polster wieder steht.`,
    })
  } else if (zielSt.reserveOk === true && kz.reserveMonate != null && kz.reserveMonate >= ziel.mindestMonate + 2) {
    out.push({
      ton: 'gut', titel: 'Solide Reserve',
      text: `Die Reserve deckt zurzeit rund ${fmtDe(kz.reserveMonate)} Monatsausgaben — deutlich über dem Minimum von ${ziel.mindestMonate} Monaten.`,
    })
  }

  // 4) Sparziel
  if (zielSt.noetigeSparrateRp != null && zielSt.tatsaechlichRp != null && zielSt.imPlan != null && ziel.zielRp != null) {
    out.push(zielSt.imPlan
      ? { ton: 'gut', titel: 'Sparziel im Plan', text: `Der Kontostand wächst zurzeit um Ø ${fmtRp(zielSt.tatsaechlichRp)} pro Monat — nötig für das Ziel wären ${fmtRp(zielSt.noetigeSparrateRp)}.` }
      : { ton: 'achtung', titel: 'Sparziel hinter Plan', text: `Für das Ziel von ${fmtRp(ziel.zielRp)} wären Ø ${fmtRp(zielSt.noetigeSparrateRp)} pro Monat nötig, tatsächlich sind es zurzeit ${zielSt.tatsaechlichRp < 0 ? '−' : ''}${fmtRp(Math.abs(zielSt.tatsaechlichRp))}.` })
  }

  // 5) Datenqualität — davon hängt die Aussagekraft aller Zahlen ab
  if (unklassiertOffen > 0) {
    out.push({
      ton: 'info', titel: `${unklassiertOffen} Buchung${unklassiertOffen === 1 ? '' : 'en'} noch ohne Kategorie`,
      text: 'In der Prüfliste unten zuordnen — mit «als Regel speichern» werden gleichartige Buchungen künftig automatisch erkannt. Je weniger unklassiert ist, desto genauer stimmen Auswertung und Hinweise.',
    })
  }
  if (grosseOffen > 0) {
    out.push({
      ton: 'info', titel: `${grosseOffen} grosse Buchung${grosseOffen === 1 ? '' : 'en'} zu prüfen`,
      text: 'Einzelbuchungen über CHF 5\'000 kurz bestätigen (einmalig oder laufend?) — sie stehen in der Prüfliste.',
    })
  }
  const abgleichProbleme = reihen.filter(r => r.kontrolleOk === false || r.abgleichOk === false)
  if (abgleichProbleme.length > 0) {
    out.push({
      ton: 'achtung', titel: 'Daten fehlen oder sind doppelt',
      text: `In ${abgleichProbleme.length === 1 ? `einem Monat (${monatLabel(abgleichProbleme[0].monat)})` : `${abgleichProbleme.length} Monaten`} geht die Kontrollrechnung nicht auf — am einfachsten den Zeitraum aus dem UBS E-Banking nochmals als CSV exportieren und importieren.`,
    })
  }

  // 6) Grösster Kostenblock (Information, keine Wertung)
  if (voll.length >= 3) {
    const drei = voll.slice(-3)
    const posten = wohinGehtGeld(drei, drei[0].monat, drei[drei.length - 1].monat, kategorien)
    if (posten.length > 0 && posten[0].anteil >= 0.3) {
      out.push({
        ton: 'info', titel: `Grösster Kostenblock: ${posten[0].name}`,
        text: `«${posten[0].name}» macht rund ${Math.round(posten[0].anteil * 100)}% der Betriebsausgaben der letzten 3 vollständigen Monate aus (${fmtRp(posten[0].betragRp)}).`,
      })
    }
  }

  return out.slice(0, 6)
}

// ── Formatierung ─────────────────────────────────────────────────────────

const MONATE_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const MONATE_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

export function monatLabel(monat: string): string {
  const m = parseInt(monat.slice(5, 7), 10)
  return `${MONATE_DE[m - 1] ?? monat} ${monat.slice(0, 4)}`
}

export function monatKurz(monat: string): string {
  const m = parseInt(monat.slice(5, 7), 10)
  return MONATE_KURZ[m - 1] ?? monat
}

function fmtDe(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',')
}
