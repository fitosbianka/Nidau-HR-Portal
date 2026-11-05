// Ferienplanung 2027 mit Wochenfarben: jede Kalenderwoche hat eine Farbe.
// Mitarbeitende melden sich für ganze Wochen an (first come first served),
// Admins und Laura akzeptieren oder lehnen ab. Wie viele gleichzeitig gehen
// können, rechnet ferien-kapazitaet.ts aus den Regeln in ferien-regeln.ts.
// Hier: Wochen, Farben, Kategorien, Belegung, Ferientage in Tagen. Reine
// Logik ohne Datenbank; Ablage der Anpassungen als reservierte Zeilen in
// zeiterfassung_comments (kein DDL):
//   __ferien_wochenfarbe__          @ Montag der Woche → { farbe }
//   __ferien_anspruch__<profileId>  @ 2027-01-01      → { tage } (Admin Anpassung des Anspruchs)
// Texte für Mitarbeitende: Schweizer Schreibweise ohne scharfes s.

import { PLAN_YEAR, weekdaysBetween, type FerienWunsch } from './ferien-wuensche'
import { arbeitstageBetween, istFeiertag } from './feiertage'
import { round2 } from './ferien'
import { anteilAm, anteilAus, anteileFuerTage, type AnteilKarte, type AnteilRegel } from './ferien-anteil'

export const WOCHENFARBE_KEY = '__ferien_wochenfarbe__'
export const ANSPRUCH_PREFIX = '__ferien_anspruch__'
export const KONFIG_ANCHOR = `${PLAN_YEAR}-01-01`
export const anspruchKey = (profileId: string) => `${ANSPRUCH_PREFIX}${profileId}`

export type WochenFarbe = 'dunkelgruen' | 'hellgruen' | 'orange' | 'rot'
export const FARBEN_REIHENFOLGE: WochenFarbe[] = ['dunkelgruen', 'hellgruen', 'orange', 'rot']
export const istFarbe = (v: unknown): v is WochenFarbe => typeof v === 'string' && (FARBEN_REIHENFOLGE as string[]).includes(v)

export const FARBEN: Record<WochenFarbe, { label: string; titel: string; text: string; bg: string; fg: string }> = {
  dunkelgruen: { label: 'Dunkelgrün', titel: 'Ruhigste Wochen', text: 'Etwa halb so viele Patienten pro Tag. Ferien sind hier ausdrücklich erwünscht.', bg: '#CFE5DC', fg: '#3F6B62' },
  hellgruen: { label: 'Hellgrün', titel: 'Schulferien', text: 'Ferien empfohlen. Die Patienten kommen fast wie in einer normalen Woche, darum sind die Plätze begrenzt.', bg: '#E8F2EE', fg: '#5F8F86' },
  orange: { label: 'Orange', titel: 'Normale Wochen', text: 'Ferien möglich, pro Kategorie gibt es wenige Plätze.', bg: '#F7EAD9', fg: '#96703F' },
  rot: { label: 'Rot', titel: 'Vollste Wochen', text: 'Direkt vor und nach den Sommer und Herbstferien. Keine Ferien, Ausnahmen nur nach Absprache mit Bianka. Ist eine Zahnärztin an einem Tag fest in den Ferien, ist dieser Tag für die Assistenz offen, pro fehlende Zahnärztin eine Person.', bg: '#F6DFE3', fg: '#A85B6B' },
}
export const FARBEN_HINWEIS = 'Plane mindestens zwei deiner Ferienwochen in grünen Wochen, davon mindestens eine dunkelgrüne (KW 30, 40 oder 52).'
export const FARBEN_HINWEIS_2 = 'Plane mindestens einmal zwei Wochen am Stück.'

const DUNKELGRUEN = new Set([30, 40, 52])
const HELLGRUEN = new Set([1, 6, 15, 16, 18, 27, 28, 29, 31, 32, 39, 41])
const ROT = new Set([26, 33, 34, 38, 42, 43])

const GRUENDE: Record<number, string> = {
  1: 'Winterferien der Schule bis 10. Januar',
  2: 'Erste Schulwoche nach den Winterferien',
  6: 'Sportferien der Schulen',
  7: 'Nach der Februarwoche, sehr voll',
  8: 'In Köniz zum Teil Sportferien',
  12: 'Karfreitag 26. März',
  13: 'Ostermontag 29. März',
  14: 'Woche vor den Frühlingsferien',
  15: 'Frühlingsferien', 16: 'Frühlingsferien',
  17: 'Erste Woche nach den Frühlingsferien',
  18: 'Auffahrt 6. Mai, ruhiger als normal',
  20: 'Pfingstmontag 17. Mai',
  26: 'Letzte Schulwoche vor den Sommerferien, voller als normal',
  27: 'Sommerferien, erste von sechs Wochen',
  28: 'Sommerferien', 29: 'Sommerferien', 31: 'Sommerferien',
  30: 'Sommerferien, ruhigste Zeit',
  32: 'Letzte Woche der Sommerferien',
  33: 'Erste Schulwoche, eine der vollsten Wochen des Jahres',
  34: 'Zweite Woche nach den Sommerferien',
  38: 'Woche vor den Herbstferien, voller als normal',
  39: 'Herbstferien', 41: 'Herbstferien',
  40: 'Herbstferien, ruhigste Zeit',
  42: 'Erste Schulwoche nach den Herbstferien',
  43: 'Zweite Woche nach den Herbstferien',
  51: 'Heiligabend am Freitag 24. Dezember',
  52: 'Zwischen Weihnachten und Neujahr, ruhigste Zeit',
}
export const NORMALE_WOCHE = 'Normale Woche'

export type Woche = {
  kw: number
  montag: string
  freitag: string
  /** Standardfarbe aus der Jahresplanung */
  standardFarbe: WochenFarbe
  /** Gültige Farbe (Anpassung durch Admin oder Standard) */
  farbe: WochenFarbe
  grund: string
  /** Mo bis Fr ohne Feiertage */
  arbeitstage: string[]
  feiertage: number
}

export function standardFarbe(kw: number): WochenFarbe {
  if (DUNKELGRUEN.has(kw)) return 'dunkelgruen'
  if (HELLGRUEN.has(kw)) return 'hellgruen'
  if (ROT.has(kw)) return 'rot'
  return 'orange'
}

const addTage = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Montag der ISO Kalenderwoche 1 eines Jahres (Woche mit dem 4. Januar). */
export function montagKw1(jahr: number): string {
  const jan4 = new Date(`${jahr}-01-04T00:00:00`)
  return addTage(`${jahr}-01-04`, -((jan4.getDay() + 6) % 7))
}

/** Alle ISO Kalenderwochen des Planungsjahres (52 für 2027), mit optionalen
 *  Farbanpassungen (Schlüssel Montag). */
export function wochenFuer(jahr: number, anpassungen: Record<string, WochenFarbe> = {}): Woche[] {
  const out: Woche[] = []
  let montag = montagKw1(jahr)
  for (let kw = 1; kw <= 53; kw++) {
    const donnerstag = addTage(montag, 3)
    if (donnerstag.slice(0, 4) !== String(jahr)) break
    const freitag = addTage(montag, 4)
    const arbeitstage = arbeitstageBetween(montag, freitag)
    const sf = standardFarbe(kw)
    out.push({ kw, montag, freitag, standardFarbe: sf, farbe: anpassungen[montag] ?? sf, grund: GRUENDE[kw] ?? NORMALE_WOCHE, arbeitstage, feiertage: 5 - arbeitstage.length })
    montag = addTage(montag, 7)
  }
  return out
}
export const wochen2027 = (anpassungen: Record<string, WochenFarbe> = {}) => wochenFuer(PLAN_YEAR, anpassungen)
export const montagVon = (datum: string) => addTage(datum, -((new Date(`${datum}T00:00:00`).getDay() + 6) % 7))
export const samstagVon = (montag: string) => addTage(montag, 5)

// ── Kategorien ──────────────────────────────────────────────────────────

export type Kategorie = 'ZAZ' | 'DHPA' | 'ASSISTENZ'
export const KATEGORIEN: Kategorie[] = ['ZAZ', 'DHPA', 'ASSISTENZ']
export const KATEGORIE_LABEL: Record<Kategorie, string> = { ZAZ: 'ZAZ', DHPA: 'DH / PA', ASSISTENZ: 'Assistenz' }

/** Kategorie aus profiles.job_title, wie PLAN_GROUP_DEFS. Lernende zählen
 *  zur Assistenz. Admin und alle anderen können sich nicht anmelden (null). */
export function kategorieFuer(jobTitle: string | null | undefined): Kategorie | null {
  const t = (jobTitle ?? '').trim()
  if (t === 'ZAZ') return 'ZAZ'
  if (t === 'DH / PA' || t === 'DH' || t === 'PA') return 'DHPA'
  if (t === 'DA' || t === 'Leitende DA' || t === 'Lernende') return 'ASSISTENZ'
  return null
}
export const istLernende = (jobTitle: string | null | undefined) => (jobTitle ?? '').trim() === 'Lernende'
export const istLeitendeDa = (jobTitle: string | null | undefined) => (jobTitle ?? '').trim() === 'Leitende DA'

export function parseWochenfarben(rows: Array<{ user_full_name: string; schedule_date: string; comment: string }>): Record<string, WochenFarbe> {
  const out: Record<string, WochenFarbe> = {}
  for (const r of rows) {
    if (r.user_full_name !== WOCHENFARBE_KEY) continue
    try { const j = JSON.parse(r.comment) as { farbe?: unknown }; if (istFarbe(j.farbe)) out[r.schedule_date.slice(0, 10)] = j.farbe } catch { /* überspringen */ }
  }
  return out
}

/** Admin Anpassungen des Ferienanspruchs in Tagen (null = kein festes Kontingent). */
export function parseAnspruchRows(rows: Array<{ user_full_name: string; comment: string }>): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const r of rows) {
    if (!r.user_full_name.startsWith(ANSPRUCH_PREFIX)) continue
    try {
      const j = JSON.parse(r.comment) as { tage?: unknown }
      if (j.tage === null) out[r.user_full_name.slice(ANSPRUCH_PREFIX.length)] = null
      else if (typeof j.tage === 'number' && Number.isFinite(j.tage) && j.tage >= 0) out[r.user_full_name.slice(ANSPRUCH_PREFIX.length)] = round2(j.tage)
    } catch { /* überspringen */ }
  }
  return out
}

// ── Belegung einer Woche ────────────────────────────────────────────────

export type Belegt = {
  employeeId: string
  /** woche = Wochenanmeldung, wunsch = Ferienwunsch, eingetragen = F oder UF im Arbeitsplan */
  art: 'woche' | 'wunsch' | 'eingetragen'
  status: 'offen' | 'akzeptiert'
  createdAt: string
  /** Startdatum des Wunsches (Schlüssel), bei Einträgen leer */
  from: string
  tage: number
}
export type Person = { id: string; full_name: string; job_title: string | null; pensum: number | null; eintrittsdatum?: string | null }
export type Eintrag = { employee_id: string; schedule_date: string; entry: string }

export const istWochenanmeldung = (w: FerienWunsch) => w.quelle === 'woche'

/** Wer in einer Woche als abwesend zählt: nicht abgelehnte Wochenanmeldung,
 *  oder mindestens drei Arbeitstage der Woche durch F (auch gewichtet), UF
 *  oder einen offenen oder akzeptierten Ferienwunsch abgedeckt. Jede Person
 *  zählt einmal; Einträge gelten als akzeptiert. */
export function belegungFuer(woche: Woche, wishes: FerienWunsch[], eintraege: Eintrag[], personen: Person[], anteile?: AnteilKarte | null): Map<Kategorie, Belegt[]> {
  const tage = new Set(woche.arbeitstage)
  const mindestens = Math.min(3, Math.max(1, woche.arbeitstage.length))
  const proPerson = new Map<string, Belegt>()
  const setze = (b: Belegt) => {
    const alt = proPerson.get(b.employeeId)
    if (!alt || (alt.status === 'offen' && b.status === 'akzeptiert')) proPerson.set(b.employeeId, b)
  }
  // Einträge im Arbeitsplan
  const abgedeckt = new Map<string, number>()
  for (const e of eintraege) {
    if (!tage.has(e.schedule_date)) continue
    if (!(e.entry === 'F' || e.entry.startsWith('F:') || e.entry === 'UF')) continue
    abgedeckt.set(e.employee_id, (abgedeckt.get(e.employee_id) ?? 0) + 1)
  }
  abgedeckt.forEach((n, id) => { if (n >= mindestens) setze({ employeeId: id, art: 'eingetragen', status: 'akzeptiert', createdAt: '', from: '', tage: n }) })
  // Wünsche und Wochenanmeldungen
  for (const w of wishes) {
    if (w.status === 'abgelehnt') continue
    if (w.art !== 'ferien' && w.art !== 'unbezahlt') continue
    const n = wunschTageListe(w).filter(d => tage.has(d)).length
    if (n === 0) continue
    if (!istWochenanmeldung(w) && n < mindestens) continue
    // ein akzeptierter Wunsch steht meist schon als Eintrag im Arbeitsplan: nicht doppelt zählen
    if (proPerson.get(w.employeeId)?.status === 'akzeptiert') continue
    setze({ employeeId: w.employeeId, art: istWochenanmeldung(w) ? 'woche' : 'wunsch', status: w.status === 'akzeptiert' ? 'akzeptiert' : 'offen', createdAt: w.createdAt, from: w.from, tage: n })
  }
  // Angezeigte Tage eines Wunsches: wie gezählt (Teilzeit nach Pensum)
  const pensumVon = new Map(personen.map(p => [p.id, p.pensum]))
  proPerson.forEach(b => {
    if (b.art === 'eingetragen') return
    const w = wishes.find(x => x.employeeId === b.employeeId && x.from === b.from)
    if (!w) return
    const inWoche = wunschTageListe(w).filter(d => tage.has(d))
    const regel = anteilAus(anteile, b.employeeId)
    b.tage = w.tage && w.tage.length > 0
      ? ferientageZaehlen(inWoche.map(datum => ({ datum, gewicht: 1 })), pensumVon.get(b.employeeId), regel)
      : wunschTage(inWoche[0] ?? w.from, inWoche[inWoche.length - 1] ?? w.to, pensumVon.get(b.employeeId), regel)
  })
  const out = new Map<Kategorie, Belegt[]>([['ZAZ', []], ['DHPA', []], ['ASSISTENZ', []]])
  const kat = new Map(personen.map(p => [p.id, kategorieFuer(p.job_title)]))
  proPerson.forEach(b => { const k = kat.get(b.employeeId); if (k) out.get(k)!.push(b) })
  // Reihenfolge der Anmeldung: Einträge (akzeptiert, ohne Zeit) zuerst, dann nach Eingang
  out.forEach(l => l.sort((a, b) => (a.status === b.status ? 0 : a.status === 'akzeptiert' ? -1 : 1) || a.createdAt.localeCompare(b.createdAt)))
  return out
}

// ── Ferientage immer in Tagen ───────────────────────────────────────────

/** Pensumfaktor aus profiles.pensum (Prozent); fehlend = 100 %. */
export const faktorVon = (pensum: number | null | undefined) => (pensum != null && pensum > 0 && pensum <= 100 ? pensum / 100 : 1)
/** Tage mit Ferienanteil pro Wochentag summieren (Summe der Anteile), sonst Anzahl mal Pensum. */
const tageNachAnteil = (tage: string[], pensum: number | null | undefined, regel?: AnteilRegel | null) => {
  const anteile = anteileFuerTage(regel, tage)
  return round2(anteile ? anteile.reduce((s, a) => s + a, 0) : tage.length * faktorVon(pensum))
}
/** Eine Ferienwoche kostet Arbeitstage ohne Feiertage mal Pensum; mit
 *  Ferienanteil pro Wochentag die Summe der Anteile (50 Prozent mit halben
 *  Tagen Mo bis Mi und ganzem Do: 2.5). */
export const wochenTage = (woche: Woche, pensum: number | null | undefined, regel?: AnteilRegel | null) => tageNachAnteil(woche.arbeitstage, pensum, regel)
/** Ein Wunsch ohne Tagesauswahl kostet seine Arbeitstage ohne Feiertage mal Pensum (ältere Einträge), mit Ferienanteil die Summe der Anteile. */
export const wunschTage = (from: string, to: string, pensum: number | null | undefined, regel?: AnteilRegel | null) => tageNachAnteil(arbeitstageBetween(from, to), pensum, regel)
/** Einen Zeitraum in Kalenderwochen aufteilen (Wochentage, pro Woche Von bis
 *  Bis innerhalb des Zeitraums, tage = Arbeitstage ohne Feiertage). So lässt
 *  sich jede Woche eines mehrwöchigen Wunsches einzeln akzeptieren. */
export function wochenTeile(from: string, to: string): Array<{ from: string; to: string; tage: string[] }> {
  const out: Array<{ from: string; to: string; tage: string[] }> = []
  for (const d of weekdaysBetween(from, to)) {
    const montag = montagVon(d)
    const last = out[out.length - 1]
    if (last && montagVon(last.from) === montag) { last.to = d; if (!istFeiertag(d)) last.tage.push(d) }
    else out.push({ from: d, to: d, tage: istFeiertag(d) ? [] : [d] })
  }
  return out
}

/** Tage eines Wunsches: die gewählten Tage (tagesgenau) oder alle Wochentage des Zeitraums. */
export const wunschTageListe = (w: Pick<FerienWunsch, 'from' | 'to' | 'tage'>): string[] => (w.tage && w.tage.length > 0 ? w.tage : weekdaysBetween(w.from, w.to))
/** Ab diesem Datum zählt die Ferienplanung tagesgenau pro Kalenderwoche
 *  (2026 bleibt wie bisher, Wochentage mit manuellem «angerechnet»). */
export const TAGESGENAU_AB = '2027-01-01'

export type FerienTag = { datum: string; gewicht: number }

/** Ferientage zählen, pro Kalenderwoche, Teilzeit nie mehr als ihr Pensum:
 *  - 100 Prozent: jeder Tag zählt mit seinem Gewicht (F = 1, F:x = x).
 *  - Teilzeit, ganze Woche frei (alle Arbeitstage Mo bis Fr ohne Feiertage):
 *    Arbeitstage mal Pensum, bei 40 Prozent also 2 Tage, nicht 5.
 *  - Teilzeit, einzelne Tage: die Tage selbst, höchstens so viele, wie sie
 *    in einer Woche arbeitet (aufgerundet, 40 Prozent 2, 50 Prozent 3).
 *  - Mit Ferienanteil pro Wochentag (regel): ein Tag mit Gewicht 1 zählt
 *    den Anteil des Wochentags, die Woche wird nicht mehr gedeckelt (die
 *    Anteile ergeben das Pensum), auch vor TAGESGENAU_AB.
 *  Feiertage zählen nie. Tage vor TAGESGENAU_AB zählen sonst unverändert. */
export function ferientageZaehlen(tage: FerienTag[], pensum: number | null | undefined, regel?: AnteilRegel | null): number {
  const faktor = faktorVon(pensum)
  const proWoche = new Map<string, Map<string, number>>()
  const mitAnteil = new Set<string>()
  let summe = 0
  for (const t of tage) {
    const a = anteilAm(regel, t.datum)
    const gewicht = a != null && t.gewicht === 1 ? a : t.gewicht
    if (t.datum < TAGESGENAU_AB) { summe += gewicht; continue }
    if (istFeiertag(t.datum)) continue
    const m = montagVon(t.datum)
    const w = proWoche.get(m) ?? new Map<string, number>()
    w.set(t.datum, Math.max(w.get(t.datum) ?? 0, gewicht))
    proWoche.set(m, w)
    if (a != null) mitAnteil.add(m)
  }
  proWoche.forEach((tageDerWoche, montag) => {
    const roh = Array.from(tageDerWoche.values()).reduce((s, g) => s + g, 0)
    if (faktor >= 1 || mitAnteil.has(montag)) { summe += roh; return }
    const arbeitstage = arbeitstageBetween(montag, addTage(montag, 4))
    const ganzeWoche = arbeitstage.length > 0 && arbeitstage.every(d => tageDerWoche.has(d))
    const grenze = ganzeWoche ? arbeitstage.length * faktor : Math.ceil(arbeitstage.length * faktor - 1e-9)
    summe += Math.min(roh, grenze)
  })
  return round2(summe)
}

/** Ferientage eines Wunsches oder einer Wochenanmeldung: gewählte Tage nach
 *  ferientageZaehlen (Teilzeit höchstens nach Pensum), ältere Einträge ohne
 *  Tagesauswahl nach Pensum. Teilzeit wählt die konkreten Tage, bei 50
 *  Prozent also zwei Tage in der einen und drei in der anderen Woche. */
export function wunschKosten(w: Pick<FerienWunsch, 'from' | 'to' | 'tage' | 'quelle'>, woche: Woche | undefined, pensum: number | null | undefined, regel?: AnteilRegel | null): number {
  if (w.tage && w.tage.length > 0) return ferientageZaehlen(w.tage.map(datum => ({ datum, gewicht: 1 })), pensum, regel)
  if (w.quelle === 'woche' && woche) return wochenTage(woche, pensum, regel)
  return wunschTage(w.from, w.to, pensum, regel)
}

/** Regelcheck: mindestens zwei grüne Wochen, davon eine dunkelgrüne. */
export function gruenRegel(wochen: Woche[], belegteMontage: string[]): { gruen: number; dunkelgruen: number; ok: boolean } {
  const byMontag = new Map(wochen.map(w => [w.montag, w]))
  let gruen = 0, dunkel = 0
  for (const m of belegteMontage) {
    const w = byMontag.get(m)
    if (!w) continue
    if (w.farbe === 'dunkelgruen') { gruen++; dunkel++ } else if (w.farbe === 'hellgruen') gruen++
  }
  return { gruen, dunkelgruen: dunkel, ok: gruen >= 2 && dunkel >= 1 }
}

/** «26. bis 30. Juli 2027» */
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
export function wocheText(w: Woche): string {
  const a = new Date(`${w.montag}T12:00:00`), b = new Date(`${w.freitag}T12:00:00`)
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}. bis ${b.getDate()}. ${MONATE[b.getMonth()]} ${b.getFullYear()}`
    : `${a.getDate()}. ${MONATE[a.getMonth()]} bis ${b.getDate()}. ${MONATE[b.getMonth()]} ${b.getFullYear()}`
}
export const kurzDatum = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`
