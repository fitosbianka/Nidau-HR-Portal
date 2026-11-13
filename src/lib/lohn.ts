// Lohnabrechnungen (admin only): Stammdaten, Sätze pro Jahr und erstellte
// Abrechnungen. Die Rechenlogik ist eine 1:1-Nachbildung des bisherigen
// Lohn-Excels der Praxis und wurde rappengenau gegen 7 ausgefüllte
// Beispielabrechnungen verifiziert (Normal Frau/Mann, nicht AHV-pflichtig,
// Stundenlohn 5 Wochen, ALV/NBU-Deckel, 2 Umsatzabrechnungen).
//
// Gespeichert als reservierte zeiterfassung_comments-Zeilen (kein DDL
// möglich — gleiches Muster wie __konto__ / __parkplatz__):
//   __lohn_stamm__<profileId>        @ 1970-01-01   → LohnStamm JSON
//   __lohn_saetze__                  @ <jahr>-01-01 → LohnSaetze JSON
//   __lohn_abr__<profileId>_<id>     @ <monat>-01   → LohnAbrechnung JSON
// Alle bestehenden Loader überspringen __-präfixierte Zeilen.

import type { SupabaseClient } from '@supabase/supabase-js'

export const LOHN_STAMM_PREFIX = '__lohn_stamm__'
export const LOHN_SAETZE_KEY = '__lohn_saetze__'
export const LOHN_ABR_PREFIX = '__lohn_abr__'

export type LohnArt = 'monatslohn' | 'stundenlohn' | 'umsatzlohn' | 'umsatz_akonto' | 'nicht_ahv'

export const LOHN_ART_LABEL: Record<LohnArt, string> = {
  monatslohn: 'Monatslohn',
  stundenlohn: 'Stundenlohn',
  umsatzlohn: 'Umsatzlohn',
  umsatz_akonto: 'Umsatzlohn + Akontolohn',
  nicht_ahv: 'Nicht AHV-pflichtig',
}

export const LOHN_TITEL = ['Lohnabrechnung', 'Umsatzabrechnung', 'Bonus', 'Endabrechnung'] as const

export type LohnSaetze = {
  jahr: number
  ahv: number               // AHV/IV/EO Arbeitnehmeranteil, z.B. 0.053
  alv: number               // ALV Arbeitnehmeranteil, z.B. 0.011
  alvDeckelMonat: number    // ALV/NBU-Deckel pro Monat, z.B. 12'350
  nbu: number               // UVG-NBU Arbeitnehmeranteil, z.B. 0.01696
  ktgStandard: number       // KTG Arbeitnehmerhälfte, z.B. 0.009805 (= 1.961% / 2)
  ktgErhoeht: number        // KTG Arbeitnehmerhälfte erhöht, z.B. 0.01408 (= 2.816% / 2)
  ferienzuschlag: number    // Stundenlohn 5 Wochen Ferien — Praxis-Vorgabe 0.1063 (10.63%)
  kinderzulage: number      // CHF pro Kind und Monat (Kanton Bern)
  ausbildungszulage: number // CHF pro Kind in Ausbildung und Monat
}

export const LOHN_SAETZE_2026: LohnSaetze = {
  jahr: 2026,
  ahv: 0.053,
  alv: 0.011,
  alvDeckelMonat: 12350,
  nbu: 0.01696,
  ktgStandard: 0.019610 / 2,
  ktgErhoeht: 0.028160 / 2,
  ferienzuschlag: 0.1063,
  kinderzulage: 250,
  ausbildungszulage: 310,
}

export type LohnZulage = { name: string; typ: 'kind' | 'ausbildung' }

export type LohnStamm = {
  art: LohnArt
  dreizehnter: boolean
  monatslohn: number | null         // Monatslohn brutto — überschreibt den Wert aus den Mitarbeiter-Standards (leer = von dort)
  stundensatz: number | null        // CHF/h ohne Ferienzuschlag (Stundenlohn)
  grundlohn: number | null          // fixer Monatsbestandteil bei Stundenlohn OHNE Ferienentschädigung (900 → inkl. 10.63% = 995.67)
  /** Stundenlohn: Ferienentschädigung auch auf dem Grundlohn (true =
   *  (Grundlohn + Stunden × Satz) × (1 + Zuschlag), wie in der Lohnvorlage
   *  der Praxis; false = Zuschlag nur auf den Stunden) */
  ferienAufGrundlohn: boolean
  umsatzsatz: number | null         // Umsatzbeteiligung, z.B. 0.3281
  umsatzPeriode: 'quartal' | 'halbjahr' | null
  akontoBetrag: number | null       // Umsatzlohn + Akontolohn: fixer Monatsbetrag (leer = Monatslohn aus dem Profil)
  ahv: boolean
  alv: boolean
  nbu: boolean
  ktg: 'standard' | 'erhoeht' | 'keine'
  pkAbzug: number                   // Pensionskassen-Abzug CHF/Monat (positiv erfassen)
  /** Herkunft des BVG-Abzugs (HR-Seite, Lohn-Stammdaten oder übernommen aus
   *  einer Abrechnung); null = Seed/Standard, noch nie bestätigt */
  pkAbzugStand?: { quelle: 'abrechnung' | 'stammdaten' | 'hr'; monat: string | null; am: string } | null
  qstTarif: string | null           // z.B. 'A0N'
  qstSatz: number | null            // Quellensteuer in % des Bruttolohns, z.B. 11.16
  zulagen: LohnZulage[]
  /** Monatliche AHV-pflichtige Zuschläge/Abzüge VOR den Abzügen (z.B.
   *  Leitungszuschlag; negativ = Abzug) — bei jeder neuen Abrechnung als
   *  Lohnzeile vorbefüllt, dort anpassbar */
  zuschlaege: LohnPos[]
  /** Monatliche Zeilen NACH den Abzügen (nicht AHV-pflichtig; negativ =
   *  Abzug, z.B. Parkplatz-Miete) — bei jeder neuen Abrechnung vorbefüllt */
  nachZeilen: LohnPos[]
  /** R3.7: KTG-Lösung (80% ab Tag 3) schriftlich im Arbeitsvertrag (SSO
   *  Ziff. 3.5.1). false = Berner Skala, Krankheitsfälle manuell rechnen —
   *  das System warnt und sperrt die automatische Phasenrechnung. */
  ktgKlausel: boolean
  /** R5: Lohnpfändung gemäss Verfügung des Betreibungsamts. 'quote' =
   *  Netto minus Existenzminimum (nie unter 0), 'betrag' = fester Betrag. */
  pfaendungArt: 'keine' | 'betrag' | 'quote'
  pfaendungBetrag: number | null            // bei 'betrag': CHF/Monat
  pfaendungExistenzminimum: number | null   // bei 'quote': CHF gemäss Verfügung
  notiz: string | null
  geprueft: boolean                 // false = Vorschlag aus dem Lohn-Excel, noch nicht bestätigt
}

export const LOHN_STAMM_DEFAULT: LohnStamm = {
  art: 'monatslohn', dreizehnter: true,
  monatslohn: null, stundensatz: null, grundlohn: null, ferienAufGrundlohn: true, umsatzsatz: null, umsatzPeriode: null, akontoBetrag: null,
  ahv: true, alv: true, nbu: true, ktg: 'standard', pkAbzug: 0, pkAbzugStand: null,
  qstTarif: null, qstSatz: null, zulagen: [], zuschlaege: [], nachZeilen: [],
  ktgKlausel: true, pfaendungArt: 'keine', pfaendungBetrag: null, pfaendungExistenzminimum: null,
  notiz: null, geprueft: false,
}

/** Vorschlagswerte pro Person (leer: in dieser Installation gibt es keine
 *  übernommenen Lohn Stammdaten, alles wird im Portal erfasst). */
const LOHN_SEED: Record<string, Partial<LohnStamm>> = {}

/** Gespeicherte Stammdaten beim Lesen korrigieren (in dieser Installation
 *  keine Sonderfälle). */
export function korrigiereStamm(_fullName: string, st: LohnStamm): LohnStamm {
  return st
}

/** Seed-Lookup, tolerant gegenüber Namensvarianten: exakter Treffer, sonst
 *  Vor- und ein Nachnamens-Teil identisch. */
export function lohnSeedFor(fullName: string): Partial<LohnStamm> | null {
  if (LOHN_SEED[fullName]) return LOHN_SEED[fullName]
  const norm = (s: string) => s.toLowerCase().split(/[\s-]+/).filter(Boolean)
  const mine = norm(fullName)
  for (const [key, val] of Object.entries(LOHN_SEED)) {
    const theirs = norm(key)
    if (mine[0] === theirs[0] && mine.slice(1).some(t => theirs.slice(1).includes(t))) return val
  }
  return null
}

export type LohnPos = {
  label: string
  betrag: number
  /** true = Taggeld-Ersatz (UVG ab Tag 4, KTG ab Tag 31): zählt zum Brutto,
   *  ist aber NICHT abzugspflichtig (R4.2) — AHV/ALV/NBU/KTG rechnen auf der
   *  Basis ohne diese Positionen (R6.3). QST-Basis bleibt voll (R4.5). */
  frei?: boolean
  /** Betrag von Hand überschrieben (wie eine überschriebene Zelle im Excel) */
  manuell?: boolean
}

/** Abzüge, die sich auf einer Abrechnung von Hand überschreiben lassen */
export const ABZUG_KEYS = ['ahv', 'alv', 'nbu', 'ktg', 'qst'] as const
export type AbzugKey = typeof ABZUG_KEYS[number]
/** Von Hand überschriebene Werte eines Abzugs: Basis in CHF, Satz als Anteil
 *  (0.053 = 5.3 %), Betrag in CHF positiv. Fehlt ein Wert, rechnet das
 *  Portal ihn wie gewohnt. */
export type AbzugManuell = { basis?: number; satz?: number; betrag?: number }
export type LohnManuell = Partial<Record<AbzugKey, AbzugManuell>>

export type LohnAbrechnung = {
  id: string
  titel: string             // Lohnabrechnung / Umsatzabrechnung / Bonus / Endabrechnung
  periode: string           // Anzeige, z.B. «September 2026» oder «2. Quartal 2026»
  monat: string             // YYYY-MM (Ablage-Anker)
  lines: LohnPos[]          // Lohnbestandteile = AHV-Basis (negative erlaubt, z.B. Akonto)
  zulagen: LohnPos[]        // Kinder-/Ausbildungszulagen (nicht AHV-pflichtig)
  nach: LohnPos[]           // nach den Abzügen, z.B. «Bereits ausbezahlt» (Endabrechnung)
  ahv: boolean
  alv: boolean
  nbu: boolean
  ktg: 'standard' | 'erhoeht' | 'keine'
  pkAbzug: number
  qstSatz: number | null
  /** Monate, die die Abrechnung umfasst (Standard 1). Skaliert den
   *  ALV/NBU-Deckel: eine halbjährliche Umsatzabrechnung deckelt bei
   *  6 × 12'350, nicht beim Monatswert (verifiziert am Excel 1. Hj. 2026). */
  deckelMonate?: number
  /** Audit-Spur unbezahlte Ferien: verwendete UF-/Plantage samt den
   *  automatischen Arbeitsplan-Werten; `manuell` = vom Plan abweichend.
   *  `von`/`am` setzt der Server beim Speichern. */
  ufAudit?: {
    tage: number
    planTage: number
    tageAuto: number | null
    planTageAuto: number | null
    manuell: boolean
    von?: string
    am?: string
  }
  /** Audit-Spur Ein-/Austritts-Pro-rata (Fall C): Solltage innerhalb der
   *  Anstellung samt Arbeitsplan-Stand; `von`/`am` setzt der Server. */
  prorataAudit?: {
    tage: number
    planTage: number
    tageAuto: number | null
    datum: string | null
    manuell: boolean
    von?: string
    am?: string
  }
  /** Von Hand überschriebene Abzüge (Basis, Satz oder Betrag) */
  manuell?: LohnManuell
  erstelltAm: string        // YYYY-MM-DD
  von: string | null
}

/** Versicherungsabzug mit ausgewiesener Basis und Satz (R4.3) — die
 *  PDF-Spalten «Basis» und «Satz» kommen direkt von hier, damit angezeigte
 *  Basis × Satz immer den angezeigten Betrag ergibt (ausser der Betrag ist
 *  von Hand überschrieben). `auto` hält die berechneten Werte fest. */
export type LohnAbzug = LohnPos & {
  key?: AbzugKey | 'pk'
  basis?: number
  satz?: number
  auto?: { basis: number; satz: number; betrag: number }
}

export type LohnBerechnet = {
  brutto: number
  /** Abzugspflichtige Basis = Brutto minus Taggeld-Ersatz-Positionen (R6.3) */
  basis: number
  /** Summe der abgabefreien Taggeld-Ersatz-Positionen (R4.2) */
  freiTotal: number
  zulagenTotal: number
  abzuege: LohnAbzug[]      // Versicherungsabzüge inkl. PK (negativ)
  abzugTotal: number
  qstBetrag: number         // negativ (0 wenn keine QST)
  /** Quellensteuer: Basis, Satz in Prozent, berechnete Werte und ob von Hand überschrieben */
  qst: { basis: number; satzPct: number | null; manuell: boolean; auto: { basis: number; satzPct: number | null; betrag: number } }
  nachTotal: number
  auszahlung: number
}

/** Kaufmännisch auf den Rappen runden wie Excel: halbe Rappen weg von null,
 *  ohne Gleitkomma Fehler (1.005 → 1.01, 775.125 → 775.13, -1.005 → -1.01). */
export function rundRappen(n: number): number {
  if (!Number.isFinite(n)) return 0
  const cents = Math.round(Number((Math.abs(n) * 100).toFixed(6)))
  return n < 0 ? -cents / 100 : cents / 100
}

/** Anteil 13. Monatslohn exakt als Monatslohn ÷ 12, wie im Lohn-Excel.
 *  Zwischen dem 19. und 20.10.2026 gespeicherte Abrechnungen enthalten ihn
 *  auf den Rappen gerundet (zum Beispiel 426.67 statt 426.666…); hier wird
 *  er wieder exakt, sobald die Abrechnung genau eine Zeile «Monatslohn» und
 *  eine Zeile «Anteil 13. Monatslohn» (ohne Pro rata) mit Monatslohn ÷ 12
 *  auf den Rappen enthält. Andere Zeilen bleiben unverändert. */
export function zeilenWieExcel(lines: LohnPos[]): LohnPos[] {
  const ml = lines.filter(l => l.label === 'Monatslohn')
  const th = lines.filter(l => l.label === 'Anteil 13. Monatslohn')
  if (ml.length !== 1 || th.length !== 1 || th[0].manuell) return lines
  const exakt = ml[0].betrag / 12
  if (th[0].betrag === exakt || Math.abs(th[0].betrag - rundRappen(exakt)) > 1e-9) return lines
  return lines.map(l => (l === th[0] ? { ...l, betrag: exakt } : l))
}

/** Lohnrechnung gemäss «Regeln Lohnabrechnung bei Krankheit und Unfall»
 *  (Stand 21.09.2026): AHV/ALV/NBU/KTG rechnen auf der abzugspflichtigen
 *  Basis = Brutto minus Taggeld-Ersatz (R4.1/R4.2/R6.3) und tragen Basis
 *  und Satz für den Ausweis (R4.3). ALV und NBU sind bei `alvDeckelMonat`
 *  gedeckelt. Quellensteuer-Basis: Bruttoeinkommen inkl. Taggeld-Ersatz
 *  und Familienzulagen (R4.5).
 *
 *  RUNDUNG WIE IM LOHN-EXCEL, NICHT ÄNDERN: Anteil 13. Monatslohn exakt
 *  Monatslohn ÷ 12, alle Abzüge exakt und NICHT einzeln gerundet; gerundet
 *  wird erst bei der Darstellung (fmtLohnChf). Belegt durch echte
 *  Excel-Abrechnungen (AHV 775.125 als 775.13, Total Abzüge 2'273.501 als
 *  2'273.50; 13. 426.666… als 426.67). Jede Zwischenrundung kostete schon
 *  einmal einen Rappen. */
export function berechneLohn(a: Pick<LohnAbrechnung, 'lines' | 'zulagen' | 'nach' | 'ahv' | 'alv' | 'nbu' | 'ktg' | 'pkAbzug' | 'qstSatz' | 'deckelMonate' | 'manuell'>, s: LohnSaetze): LohnBerechnet {
  const lines = zeilenWieExcel(a.lines)
  const brutto = lines.reduce((t, l) => t + l.betrag, 0)
  const freiTotal = lines.reduce((t, l) => t + (l.frei ? l.betrag : 0), 0)
  const basis = brutto - freiTotal
  const zulagenTotal = a.zulagen.reduce((t, l) => t + l.betrag, 0)
  const gedeckelt = Math.min(basis, s.alvDeckelMonat * (a.deckelMonate && a.deckelMonate > 0 ? a.deckelMonate : 1))
  const m = a.manuell ?? {}
  const zahl = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  /** Abzug mit allfällig von Hand überschriebener Basis, Satz oder Betrag */
  const abzug = (key: AbzugKey, label: string, autoBasis: number, autoSatz: number): LohnAbzug => {
    const o = m[key] ?? {}
    const b = zahl(o.basis) ? o.basis : autoBasis
    const sz = zahl(o.satz) ? o.satz : autoSatz
    const betrag = zahl(o.betrag) ? -Math.abs(o.betrag) : -b * sz
    const manuell = zahl(o.basis) || zahl(o.satz) || zahl(o.betrag)
    return { key, label, betrag, basis: b, satz: sz, auto: { basis: autoBasis, satz: autoSatz, betrag: -autoBasis * autoSatz }, ...(manuell ? { manuell: true } : {}) }
  }
  const abzuege: LohnAbzug[] = []
  if (a.ahv) abzuege.push(abzug('ahv', 'AHV/IV/EO-Arbeitnehmerbeitrag', basis, s.ahv))
  if (a.alv) abzuege.push(abzug('alv', `ALV-Arbeitnehmerbeitrag bis Fr. ${fmtLohnChf(s.alvDeckelMonat)}`, gedeckelt, s.alv))
  if (a.nbu) abzuege.push(abzug('nbu', `UVG-NBU-Arbeitnehmerbeitrag bis Fr. ${fmtLohnChf(s.alvDeckelMonat)}`, gedeckelt, s.nbu))
  if (a.ktg !== 'keine') abzuege.push(abzug('ktg', 'Krankentaggeldversicherung', basis, a.ktg === 'erhoeht' ? s.ktgErhoeht : s.ktgStandard))
  if (a.pkAbzug > 0) abzuege.push({ key: 'pk', label: 'Pensionskasse', betrag: -a.pkAbzug })
  const abzugTotal = abzuege.reduce((t, l) => t + l.betrag, 0)
  // Quellensteuer: Satz in Prozent; Basis, Satz und Betrag einzeln überschreibbar
  const q = m.qst ?? {}
  const qstAutoBasis = brutto + zulagenTotal
  const qstAutoSatz = a.qstSatz ?? null
  const qstBasis = zahl(q.basis) ? q.basis : qstAutoBasis
  const qstSatzPct = zahl(q.satz) ? q.satz * 100 : qstAutoSatz
  const qstAutoBetrag = qstAutoSatz ? -(qstAutoSatz / 100) * qstAutoBasis : 0
  const qstBetrag = zahl(q.betrag) ? -Math.abs(q.betrag) : qstSatzPct ? -(qstSatzPct / 100) * qstBasis : 0
  const qstManuell = zahl(q.basis) || zahl(q.satz) || zahl(q.betrag)
  const nachTotal = a.nach.reduce((t, l) => t + l.betrag, 0)
  return {
    brutto, basis, freiTotal, zulagenTotal, abzuege, abzugTotal, qstBetrag, nachTotal,
    qst: { basis: qstBasis, satzPct: qstSatzPct, manuell: qstManuell, auto: { basis: qstAutoBasis, satzPct: qstAutoSatz, betrag: qstAutoBetrag } },
    auszahlung: brutto + zulagenTotal + abzugTotal + qstBetrag + nachTotal,
  }
}

/** Von Hand überschriebene Werte bereinigen: nur endliche Zahlen in
 *  vernünftigen Grenzen, leere Abzüge fallen weg. */
export function sauberManuell(x: unknown): LohnManuell {
  const out: LohnManuell = {}
  if (!x || typeof x !== 'object') return out
  for (const k of ABZUG_KEYS) {
    const o = (x as Record<string, unknown>)[k]
    if (!o || typeof o !== 'object') continue
    const r = o as Record<string, unknown>
    const v: AbzugManuell = {}
    const ok = (n: unknown, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max
    if (ok(r.basis, 10_000_000)) v.basis = Math.round(r.basis * 100) / 100
    if (ok(r.satz, 1)) v.satz = Math.round(r.satz * 1_000_000) / 1_000_000
    if (ok(r.betrag, 1_000_000)) v.betrag = Math.round(r.betrag * 100) / 100
    if (Object.keys(v).length > 0) out[k] = v
  }
  return out
}

// Der frühere pauschale Krankheits-/Unfallabzug ist gemäss Regelwerk
// verboten (R1.4, R6.7) — Absenzen laufen über die Phasen-Lohnarten in
// src/lib/absenz-phasen.ts.

/** Abzug für unbezahlte Ferien — EFFEKTIVE METHODE (verbindliche
 *  Praxis-Regel, dokumentiert auch im Sätze-Tab):
 *
 *    Abzug = (Monatslohn + Anteil 13.) × UF-Tage ÷ persönliche Plantage
 *            des KONKRETEN Monats gemäss Arbeitsplan, gerundet auf 0.01.
 *
 *  Plantage = alle Tage des Monats mit einem Arbeitsplan-Eintrag der
 *  Person (Arbeit und Absenzen; «%»/Frei zählt nicht). Nie ein
 *  generischer Divisor wie 21.75. Die Prozentabzüge (AHV/ALV/NBU/KTG)
 *  rechnen auf dem so reduzierten Brutto; die Pensionskasse bleibt fix.
 *  Dasselbe Prinzip gilt sinngemäss für Ein- und Austritte während des
 *  Monats (anteilige Plantage). Halbe Tage (0.5er-Schritte) erlaubt. */
export function unbezahltAbzug(monatslohnInkl13: number, ufTage: number, planTage: number): number {
  if (!(ufTage > 0) || !(planTage > 0)) return 0
  return -Math.round((monatslohnInkl13 * ufTage / planTage) * 100) / 100
}

/** Ein- oder Austritt unter dem Monat (Fall C) — WIE IM LOHN-EXCEL, NICHT
 *  ÄNDERN: Monatslohn und Anteil 13. bleiben voll, der fehlende Teil steht
 *  als eigene Zeile «Eintritt unter dem Monat»:
 *
 *    Abzug = (Monatslohn + Anteil 13.) × fehlende Solltage ÷ Solltage des
 *            Monats, gerundet auf 0.01.
 *
 *  Belegt durch eine echte Abrechnung: (4'604 + 383.67) × 2 ÷ 18 =
 *  554.19, Auszahlung 3'876.57. Verteilt man den Eintritt stattdessen auf
 *  beide Zeilen und rundet jede einzeln, ergibt sich 3'876.58. */
export function eintrittAbzug(monatslohnInkl13: number, innerhalbTage: number, planTage: number): number {
  if (!(planTage > 0) || !(innerhalbTage >= 0) || innerhalbTage >= planTage) return 0
  return -Math.round((monatslohnInkl13 * (planTage - innerhalbTage) / planTage) * 100) / 100
}

/** CHF-Format mit Apostroph-Gruppierung, auf den Rappen gerundet wie Excel
 *  (rundRappen, damit zum Beispiel 1.005 als 1.01 erscheint). */
export function fmtLohnChf(n: number): string {
  const r = rundRappen(n)
  const neg = r < 0
  const [int, dec] = Math.abs(r).toFixed(2).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "'")
  return `${neg ? '-' : ''}${grouped}.${dec}`
}

export function parseLohnSaetze(rows: Array<{ user_full_name: string; schedule_date: string; comment: string }>): Record<number, LohnSaetze> {
  const out: Record<number, LohnSaetze> = {}
  for (const r of rows) {
    if (r.user_full_name !== LOHN_SAETZE_KEY) continue
    try {
      const j = JSON.parse(r.comment) as LohnSaetze
      const jahr = parseInt(r.schedule_date.slice(0, 4), 10)
      out[jahr] = { ...LOHN_SAETZE_2026, ...j, jahr }
    } catch { /* ignore bad rows */ }
  }
  return out
}

export function parseLohnStamm(rows: Array<{ user_full_name: string; schedule_date: string; comment: string }>): Record<string, LohnStamm> {
  const out: Record<string, LohnStamm> = {}
  for (const r of rows) {
    if (!r.user_full_name.startsWith(LOHN_STAMM_PREFIX)) continue
    try {
      const j = JSON.parse(r.comment) as Partial<LohnStamm>
      // geprueft = false nur, wenn die Zeile automatisch entstand (z. B. PK-Abzug
      // aus einer Abrechnung übernommen) und die Stammdaten noch nie bestätigt wurden
      out[r.user_full_name.slice(LOHN_STAMM_PREFIX.length)] = { ...LOHN_STAMM_DEFAULT, ...j, geprueft: j.geprueft !== false }
    } catch { /* ignore bad rows */ }
  }
  return out
}

export function parseLohnAbrechnungen(rows: Array<{ user_full_name: string; schedule_date: string; comment: string }>): Record<string, LohnAbrechnung[]> {
  // profileId → Abrechnungen (neuste zuerst)
  const out: Record<string, LohnAbrechnung[]> = {}
  for (const r of rows) {
    if (!r.user_full_name.startsWith(LOHN_ABR_PREFIX)) continue
    const rest = r.user_full_name.slice(LOHN_ABR_PREFIX.length)
    const sep = rest.lastIndexOf('_')
    if (sep <= 0) continue
    const profileId = rest.slice(0, sep)
    try {
      const j = JSON.parse(r.comment) as LohnAbrechnung
      j.id = rest.slice(sep + 1)
      j.monat = r.schedule_date.slice(0, 7)
      ;(out[profileId] ??= []).push(j)
    } catch { /* ignore bad rows */ }
  }
  for (const list of Object.values(out)) {
    list.sort((a, b) => b.monat.localeCompare(a.monat) || b.erstelltAm.localeCompare(a.erstelltAm))
  }
  return out
}

export async function loadLohnData(admin: SupabaseClient) {
  const { data } = await admin
    .from('zeiterfassung_comments')
    .select('user_full_name, schedule_date, comment')
    .like('user_full_name', '\\_\\_lohn%')
  const rows = (data ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>
  return {
    saetze: parseLohnSaetze(rows),
    stamm: parseLohnStamm(rows),
    abrechnungen: parseLohnAbrechnungen(rows),
  }
}

// ── R5.4: Lohnpfändung, Meldung ans Betreibungsamt (Startseite) ──────────

/** Pfändungsbetrag einer gespeicherten Abrechnung aus der Zeile
 *  «Lohnpfändung …» (positiv; 0 = Zeile mit 0.00, null = keine Zeile). */
export function pfaendungsBetrag(a: Pick<LohnAbrechnung, 'nach'>): number | null {
  const z = (a.nach ?? []).find(l => l.label.startsWith('Lohnpfändung'))
  return z ? Math.abs(z.betrag) : null
}

export type PfaendungHinweis =
  | { art: 'erstmals'; betrag: number }
  | { art: 'keine-ueberweisung'; bisher: { monat: string; betrag: number } | null }
  | { art: 'anders'; betrag: number; bisher: { monat: string; betrag: number } }

/** Vergleicht den Pfändungsbetrag des laufenden Monats mit dem zuletzt
 *  tatsächlich überwiesenen Betrag (jüngster früherer Monat mit Betrag > 0).
 *  Monate ohne Überweisung, weil das Netto unter dem Existenzminimum lag
 *  (Unfall, Krankheit), sind KEIN Massstab: ist der Betrag danach wieder
 *  derselbe wie vor dem Ausfall, gibt es nichts zu melden. Gemeldet wird
 *  nur: erstmals eine Überweisung, in diesem Monat keine Überweisung, oder
 *  ein anderer Betrag als bisher. Die Auszahlung selbst spielt keine Rolle;
 *  sie schwankt auch ohne Einkommensänderung (Stunden, Zulagen). */
export function pfaendungHinweis(
  aktuell: Pick<LohnAbrechnung, 'monat' | 'nach'>,
  fruehere: Array<Pick<LohnAbrechnung, 'monat' | 'nach'>>,
): PfaendungHinweis | null {
  const jetzt = pfaendungsBetrag(aktuell) ?? 0
  const mitZeile = fruehere
    .filter(a => a.monat < aktuell.monat)
    .sort((a, b) => b.monat.localeCompare(a.monat))
    .map(a => ({ monat: a.monat, betrag: pfaendungsBetrag(a) }))
    .filter((x): x is { monat: string; betrag: number } => x.betrag != null)
  const bisher = mitZeile.find(x => x.betrag > 0) ?? null
  if (jetzt <= 0.005) return { art: 'keine-ueberweisung', bisher }
  if (!bisher) return { art: 'erstmals', betrag: jetzt }
  if (Math.abs(jetzt - bisher.betrag) > 0.05) return { art: 'anders', betrag: jetzt, bisher }
  return null
}
