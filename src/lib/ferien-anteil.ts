// Ferienanteil pro Wochentag: wie viel eines ganzen Arbeitstags eine Person
// an einem Wochentag arbeitet (zum Beispiel Mo 0.5, Di 0.5, Mi 0.5, Do 1,
// Fr 0 bei 50 Prozent). Ein glattes «F» an einem solchen Tag zählt dann den
// Anteil als Ferientag und bekommt 8.30 Stunden mal Anteil gutgeschrieben,
// statt immer einen ganzen Tag. Explizit gewichtete Einträge (F:x) behalten
// ihr Gewicht. Ohne Regel bleibt alles wie bisher (F = 1 Tag).
//
// Dieselbe Regel gilt überall: Arbeitszeit- und Ferienkonto, Zeiterfassung
// (Bericht und PDF), Ferienplanung (Kosten einer Anmeldung, Zählung der
// eingetragenen Tage) und Kapazität (Praxistage, Abwesenheiten).
//
// Ablage als reservierte Zeile in zeiterfassung_comments (kein DDL):
//   __ferien_anteil__<profileId> @ 2000-01-01 → { perioden: [{ ab, bis, anteile }] }
// Eine gespeicherte Zeile ersetzt den Namensstandard, auch mit leeren
// Perioden (dann gilt bewusst keine Regel). Reine Logik ohne Datenbank.

import { ferienWeight, round2 } from './ferien'

export const ANTEIL_PREFIX = '__ferien_anteil__'
export const ANTEIL_ANCHOR = '2000-01-01'
export const anteilKey = (profileId: string) => `${ANTEIL_PREFIX}${profileId}`

export type Wochentag = '1' | '2' | '3' | '4' | '5'
export const WOCHENTAG_KEYS: Wochentag[] = ['1', '2', '3', '4', '5']
export const WOCHENTAG_KURZ: Record<Wochentag, string> = { '1': 'Mo', '2': 'Di', '3': 'Mi', '4': 'Do', '5': 'Fr' }
/** Anteil eines ganzen Tags pro ISO Wochentag Montag bis Freitag, 0 bis 1 */
export type Anteile = Record<Wochentag, number>
export type AnteilPeriode = { ab: string; bis: string | null; anteile: Anteile }
export type AnteilRegel = { perioden: AnteilPeriode[] }
/** Regeln nach Profil-ID und nach vollem Namen (beides als Schlüssel) */
export type AnteilKarte = Record<string, AnteilRegel>

/** Standard nach Namen, gilt bis ein Admin etwas anderes speichert. Im
 *  Prototyp Nidau niemand; Regeln werden in der Personalakte gepflegt. */
export const ANTEIL_STANDARD: Record<string, AnteilRegel> = {}

const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/
const istDatum = (v: unknown): v is string => typeof v === 'string' && DATUM_RE.test(v)

export const anteilSumme = (a: Anteile) => round2(WOCHENTAG_KEYS.reduce((s, k) => s + (a[k] ?? 0), 0))
/** «Mo 0,5 · Di 0,5 · Mi 0,5 · Do 1 · Fr 0» */
export const anteilText = (a: Anteile) => WOCHENTAG_KEYS.map(k => `${WOCHENTAG_KURZ[k]} ${String(a[k] ?? 0).replace('.', ',')}`).join(' · ')

/** ISO Wochentag 1 (Montag) bis 7 (Sonntag) eines Datums YYYY-MM-DD. */
export const isoWochentag = (datum: string) => (new Date(`${datum}T12:00:00`).getDay() + 6) % 7 + 1

function anteileLesen(v: unknown): Anteile | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const out = {} as Anteile
  for (const k of WOCHENTAG_KEYS) {
    const z = o[k]
    out[k] = typeof z === 'number' && Number.isFinite(z) && z >= 0 && z <= 1 ? round2(z) : 0
  }
  return out
}

/** Perioden prüfen und ordnen: gültiges Datum «ab», «bis» leer oder nach
 *  «ab», Anteile 0 bis 1. Fehlerhafte Eingaben geben einen Text zurück. */
export function normalisierePerioden(input: unknown): { perioden: AnteilPeriode[] } | { error: string } {
  if (!Array.isArray(input)) return { error: 'Ungültige Angaben.' }
  const perioden: AnteilPeriode[] = []
  for (const p of input) {
    if (!p || typeof p !== 'object') return { error: 'Ungültige Angaben.' }
    const o = p as Record<string, unknown>
    if (!istDatum(o.ab)) return { error: 'Bitte bei jeder Periode ein gültiges Datum «gültig ab» angeben.' }
    const bis = o.bis == null || o.bis === '' ? null : istDatum(o.bis) ? o.bis : undefined
    if (bis === undefined) return { error: 'Das Datum «bis» ist ungültig.' }
    if (bis && bis < o.ab) return { error: 'Das Datum «bis» liegt vor «gültig ab».' }
    const anteile = anteileLesen(o.anteile)
    if (!anteile) return { error: 'Bitte die Anteile pro Wochentag angeben.' }
    perioden.push({ ab: o.ab, bis, anteile })
  }
  perioden.sort((a, b) => a.ab.localeCompare(b.ab))
  for (let i = 1; i < perioden.length; i++) {
    const vor = perioden[i - 1]
    if (!vor.bis || vor.bis >= perioden[i].ab) return { error: 'Die Perioden überschneiden sich. Bitte die frühere Periode mit «bis» abschliessen.' }
  }
  return { perioden }
}

/** Gespeicherte Zeilen lesen (Schlüssel = Profil-ID). Eine Zeile mit leeren
 *  Perioden bleibt erhalten: sie heisst bewusst «keine Regel». */
export function parseAnteilRows(rows: Array<{ user_full_name: string; comment: string }>): Record<string, AnteilRegel> {
  const out: Record<string, AnteilRegel> = {}
  for (const r of rows) {
    if (!r.user_full_name.startsWith(ANTEIL_PREFIX)) continue
    try {
      const j = JSON.parse(r.comment) as { perioden?: unknown }
      const n = normalisierePerioden(j.perioden ?? [])
      if ('error' in n) continue
      out[r.user_full_name.slice(ANTEIL_PREFIX.length)] = { perioden: n.perioden }
    } catch { /* überspringen */ }
  }
  return out
}

/** Namensvarianten der Stempeluhr («Laura Gerisch» und «Laura Gerisch-Rudin») */
export function passtName(a: string, b: string): boolean {
  if (a === b) return true
  return a.startsWith(`${b}-`) || b.startsWith(`${a}-`)
}

/** Regel einer Person: gespeicherte Zeile vor Namensstandard; ohne beides
 *  null. Leere Perioden heissen «keine Regel». */
export function anteilRegelFuer(fullName: string | null | undefined, gespeichert?: AnteilRegel | null): AnteilRegel | null {
  if (gespeichert) return gespeichert.perioden.length > 0 ? gespeichert : null
  if (!fullName) return null
  const name = Object.keys(ANTEIL_STANDARD).find(n => passtName(n, fullName))
  return name ? ANTEIL_STANDARD[name] : null
}

/** Karte für die Lader: pro Person unter ID und Namen, nur wo eine Regel gilt. */
export function baueAnteilKarte(personen: Array<{ id: string; full_name: string }>, gespeichert: Record<string, AnteilRegel>): AnteilKarte {
  const karte: AnteilKarte = {}
  for (const p of personen) {
    const regel = anteilRegelFuer(p.full_name, gespeichert[p.id])
    if (regel) { karte[p.id] = regel; karte[p.full_name] = regel }
  }
  return karte
}

/** Regel aus einer Karte (ID oder Name, Namensvarianten tolerant). Ohne
 *  Karte gilt der Namensstandard, damit auch Stellen ohne Datenbankzugriff
 *  dieselbe Gewichtung rechnen. */
export function anteilAus(karte: AnteilKarte | null | undefined, schluessel: string | null | undefined): AnteilRegel | null {
  if (!schluessel) return null
  if (!karte) return anteilRegelFuer(schluessel)
  if (karte[schluessel]) return karte[schluessel]
  const name = Object.keys(karte).find(k => passtName(k, schluessel))
  return name ? karte[name] : null
}

/** Anteil eines Tags laut Regel: Montag bis Freitag der Wert der Periode,
 *  Samstag und Sonntag 0; null, wenn keine Periode den Tag abdeckt. */
export function anteilAm(regel: AnteilRegel | null | undefined, datum: string): number | null {
  if (!regel) return null
  const p = regel.perioden.find(x => datum >= x.ab && (!x.bis || datum <= x.bis))
  if (!p) return null
  const wd = isoWochentag(datum)
  if (wd > 5) return 0
  return p.anteile[String(wd) as Wochentag] ?? 0
}

/** Gezähltes Gewicht eines Ferieneintrags an einem Tag: glattes «F» den
 *  Anteil der Regel (ohne Regel 1), F:x sein Gewicht; null = kein Ferientag. */
export function ferienGewicht(entry: string | null | undefined, regel: AnteilRegel | null | undefined, datum: string): number | null {
  const w = ferienWeight(entry)
  if (w == null) return null
  if ((entry ?? '').trim().toUpperCase() !== 'F') return w
  return anteilAm(regel, datum) ?? w
}

/** Anteile für eine Liste von Tagen, oder null, wenn die Regel nicht alle
 *  Tage abdeckt (dann rechnet die Stelle wie ohne Regel weiter). */
export function anteileFuerTage(regel: AnteilRegel | null | undefined, tage: string[]): number[] | null {
  if (!regel || tage.length === 0) return null
  const out: number[] = []
  for (const t of tage) { const a = anteilAm(regel, t); if (a == null) return null; out.push(a) }
  return out
}

export type AnteilAuswirkung = { datum: string; entry: string; alt: number; neu: number; geaendert: boolean }

/** Alle Ferientage im Arbeitsplan mit bisherigem Wert (F = 1 Tag, F:x = x)
 *  und dem Wert nach der Regel; geaendert markiert die Tage, die anders
 *  zählen. Für die Liste «korrigierte Tage» mit Monatssummen. */
export function anteilAuswirkung(eintraege: Array<{ schedule_date: string; entry: string }>, regel: AnteilRegel | null): AnteilAuswirkung[] {
  const out: AnteilAuswirkung[] = []
  for (const e of eintraege) {
    const alt = ferienWeight(e.entry)
    if (alt == null) continue
    const neu = ferienGewicht(e.entry, regel, e.schedule_date) ?? alt
    out.push({ datum: e.schedule_date, entry: e.entry, alt, neu, geaendert: Math.abs(neu - alt) >= 1e-9 })
  }
  return out.sort((a, b) => a.datum.localeCompare(b.datum))
}
