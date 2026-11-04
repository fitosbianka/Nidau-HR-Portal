// Kapazität pro Woche für die Ferienplanung 2027, reine Logik ohne
// Datenbank. Grundsatz: jeden Öffnungstag mindestens eine ZAZ, eine DH oder
// PA und genug Assistenz in der Praxis, und nie zu viel Personal.
//
// ZAZ und DH / PA haben Plätze pro Farbe, gerechnet pro Tag: an keinem Tag
// dürfen mehr Personen fehlen, die an diesem Tag arbeiten würden, als die
// Farbe erlaubt. So können zwei Personen in derselben Woche frei nehmen,
// wenn ihre Tage sich nicht überschneiden. Dazu die Tagesregel aus den
// Standardwochen (jeden Tag mindestens eine ZAZ und eine DH oder PA). Die Assistenz hat keine festen
// Plätze, sie wird in Tagen gerechnet: Bedarf pro Tag aus den ZAZ am Stuhl
// plus Steri, Empfang, Tagesleitung und Spät Steri, Angebot aus den
// Praxistagen aller Assistenzpersonen, Frei = Angebot minus Bedarf minus
// Abwesenheiten minus Reserve. Fehlt eine ZAZ ohne Vertretung, sinkt der
// Bedarf und es werden automatisch Plätze frei.
//
// Rote Wochen sind gesperrt. Ausnahme für die Assistenz: ist eine ZAZ an
// einem Tag fest in den Ferien (F im Arbeitsplan oder akzeptierte Anmeldung,
// ohne Vertretung), braucht es an diesem Tag eine Assistenzperson weniger.
// Pro fehlende ZAZ darf dann an genau diesem Tag eine Person der Assistenz
// frei nehmen (Oeffnung), an den anderen Tagen bleibt die Woche zu. Dazu
// gilt weiter die Wochenregel «Frei muss für die eigenen Tage reichen», so
// ist nie zu viel und nie zu wenig Assistenz in der Praxis.

import { round2 } from './ferien'
import { weekdaysBetween, type FerienWunsch } from './ferien-wuensche'
import {
  belegungFuer, kategorieFuer, istLernende, istLeitendeDa, faktorVon, wunschTageListe, KATEGORIE_LABEL,
  type Woche, type Person, type Eintrag, type Kategorie, type Belegt,
} from './ferien-wochen'
import {
  einsatzGanztags, einsatzHalbtage, einsatzTage, faktorAm, gueltigAm, PERSON_LEER,
  type Einsatz, type PersonRegel, type Regeln, type Schicht,
} from './ferien-regeln'

export type StandardWeek = Record<string, string>

export type Kontext = {
  regeln: Regeln
  /** Aktive Mitarbeitende der Planung (ohne Inhaber, Externe, Gäste) */
  personen: Person[]
  /** Zusammengeführte Regel pro Person (personRegelFuer) */
  personRegeln: Record<string, PersonRegel>
  standardwochen: Record<string, StandardWeek>
  /** `${employeeId}|${date}` → Name der Ferienvertretung (ganztags) */
  vertretungen: Record<string, string>
  einsaetze: Einsatz[]
  /** Abwesenheiten im Planungsjahr: F, F:x, UF, WB, KO, ÜK, K, U */
  eintraege: Eintrag[]
  wishes: FerienWunsch[]
}

export const WOCHENTAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
const dowIndex = (tag: string) => (new Date(`${tag}T12:00:00`).getDay() + 6) % 7   // 0 = Montag
export const wochentagName = (tag: string) => WOCHENTAGE[dowIndex(tag)]
const wdKey = (tag: string) => String(dowIndex(tag) + 1)
export const tagKurz = (tag: string) => `${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][dowIndex(tag)]} ${tag.slice(8, 10)}.${tag.slice(5, 7)}.`
const WOCHENTAG_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

// ── Codes der Standardwoche ─────────────────────────────────────────────

export type CodeInfo = { arbeitet: boolean; raum: number | null; schicht: Schicht; ho: boolean; schule: boolean }
const ARBEITET: CodeInfo = { arbeitet: true, raum: null, schicht: '', ho: false, schule: false }
const FEHLT: CodeInfo = { arbeitet: false, raum: null, schicht: '', ho: false, schule: false }

const ABSENZ_CODES = new Set(['%', 'FREI', 'F', 'FERIEN', 'K', 'KRANK', 'U', 'UNFALL', 'WB', 'WEITERBILDUNG', 'ÜK', 'UK', 'KO', 'KOMPENSATION', 'TE', 'TEAMEVENT', 'BF', 'UF', 'ND', 'NOTFALLDIENST'])

/** Code einer Standardwoche lesen: Raum 1 bis 5 mit Schicht (3f, 5t, 2s,
 *  4h), 6 Empfang, 7 Steri, 8 Tagesleitung, ✓ anwesend, HO Home Office,
 *  S Schule. Nur die bekannten Abwesenheitscodes (%, F, K, WB, KO …)
 *  gelten als nicht in der Praxis. Kein Code oder ein leerer Tag heisst
 *  hier: keine Vorgabe, die Person arbeitet. Für Behandler gilt die
 *  Ausnahme in standardInfo: dort ist ein leerer Tag ein freier Tag. */
export function codeInfo(code: string | undefined): CodeInfo {
  if (code === undefined) return ARBEITET
  // Legacy «Teil1|Teil2» (zweite Zeile), nur der erste Teil zählt; Leerzeichen entfernen
  const v = code.split('|')[0].replace(/\s+/g, '')
  if (!v) return ARBEITET
  const u = v.toUpperCase()
  if (u === 'HO' || /^HO[FTSH]$/.test(u)) return { ...FEHLT, ho: true }
  if (u === 'S' || u === 'SCHULE') return { ...FEHLT, schule: true }
  if (ABSENZ_CODES.has(u) || /^F:\d*\.?\d+$/.test(u)) return FEHLT
  // Positionen, auch kombiniert (6/8t, Stern/7s, 3/7f, 2t/3s): der erste Raum
  // 1 bis 5 zählt für die Zimmer, die Schicht ist die letzte angegebene
  const m = v.match(/^(\*|\d{1,2}|PA|HO)([ftsh])?(?:\/(\*|\d{1,2}|PA|HO)([ftsh])?)?$/i)
  if (m) {
    const raum = [m[1], m[3]].map(x => parseInt(x ?? '', 10)).find(n => n >= 1 && n <= 5) ?? null
    return { arbeitet: true, raum, schicht: ((m[4] ?? m[2])?.toLowerCase() ?? '') as Schicht, ho: false, schule: false }
  }
  return ARBEITET
}

/** Welche Halbtage eine Schicht belegt (Frühschicht bis 13.30 reicht in den Nachmittag). */
export function schichtHalbtage(s: Schicht): { vm: boolean; nm: boolean } {
  if (s === 's') return { vm: false, nm: true }
  if (s === 'h') return { vm: true, nm: false }
  return { vm: true, nm: true }
}

export const istAbsenz = (entry: string) => entry === 'F' || entry.startsWith('F:') || ['UF', 'WB', 'KO', 'ÜK', 'K', 'U'].includes(entry)

// ── Abwesenheiten ───────────────────────────────────────────────────────

/** Pro Person die Tage der Woche, an denen sie fehlt, mit Gewicht in
 *  Tagen: Einträge im Arbeitsplan (F:x mit seinem Gewicht, sonst 1) sowie
 *  nicht abgelehnte Wünsche und Wochenanmeldungen (gewählte Tage je 1,
 *  ältere Einträge ohne Tagesauswahl nach Pensum). */
export function abwesendTage(ctx: Kontext, woche: Woche): Map<string, Map<string, number>> {
  const tage = new Set(woche.arbeitstage)
  const pensumVon = new Map(ctx.personen.map(p => [p.id, faktorVon(p.pensum)]))
  const out = new Map<string, Map<string, number>>()
  const add = (id: string, t: string, g: number, eintrag: boolean) => {
    if (!tage.has(t)) return
    const m = out.get(id) ?? new Map<string, number>()
    if (eintrag || !m.has(t)) m.set(t, g)
    out.set(id, m)
  }
  for (const e of ctx.eintraege) if (istAbsenz(e.entry)) add(e.employee_id, e.schedule_date, e.entry.startsWith('F:') ? (parseFloat(e.entry.slice(2)) || 1) : 1, true)
  for (const w of ctx.wishes) {
    if (w.status === 'abgelehnt') continue
    if (w.to < woche.montag || w.from > woche.freitag) continue
    const tagesgenau = !!(w.tage && w.tage.length > 0)
    for (const t of wunschTageListe(w)) add(w.employeeId, t, tagesgenau ? 1 : (pensumVon.get(w.employeeId) ?? 1), false)
  }
  return out
}

/** Behandler sind ZAZ und DH / PA. */
export const istBehandler = (jobTitle: string | null | undefined) => {
  const k = kategorieFuer(jobTitle)
  return k === 'ZAZ' || k === 'DHPA'
}

/** Standardwoche einer Person an einem Wochentag lesen. Regel seit Oktober
 *  2026 (Bianka): Behandler führen ihre freien Tage im Arbeitsplan und in
 *  der Standardwoche LEER, ohne % — ein leerer Tag einer Behandlerin ist
 *  also ein freier Tag. Für die Assistenz bleibt leer «keine Vorgabe, die
 *  Person arbeitet». Fehlt die Standardwoche ganz (oder ist sie komplett
 *  leer), gibt es keine Vorgabe und die Person gilt als anwesend. */
export function standardInfo(ctx: Kontext, p: Pick<Person, 'id' | 'job_title'>, tagOderWochentag: string | number): CodeInfo {
  const woche = ctx.standardwochen[p.id]
  const key = typeof tagOderWochentag === 'number' ? String(tagOderWochentag) : wdKey(tagOderWochentag)
  const code = woche?.[key]
  if (woche && istBehandler(p.job_title) && !(code ?? '').split('|')[0].trim()) {
    const hatVorgaben = Object.values(woche).some(v => (v ?? '').trim())
    if (hatVorgaben) return FEHLT
  }
  return codeInfo(code)
}

const personVon = (ctx: Kontext, id: string): Pick<Person, 'id' | 'job_title'> =>
  ctx.personen.find(p => p.id === id) ?? { id, job_title: null }

/** Arbeitet die Person laut Standardwoche an diesem Tag? Ohne Vorgabe ja. */
export const arbeitetLautStandardwoche = (ctx: Kontext, id: string, tag: string) => standardInfo(ctx, personVon(ctx, id), tag).arbeitet
/** ISO Wochentage 1 bis 5, an denen die Person laut Standardwoche arbeitet (für die Tagesauswahl). */
export function meineArbeitstage(ctx: Kontext, id: string): number[] {
  const p = personVon(ctx, id)
  return [1, 2, 3, 4, 5].filter(d => standardInfo(ctx, p, d).arbeitet)
}

/** Arbeitstage der Woche, an denen die Person laut Standardwoche in der Praxis ist. */
export function praxisTageVon(ctx: Kontext, p: Person, woche: Woche): string[] {
  const regel = ctx.personRegeln[p.id] ?? PERSON_LEER
  return woche.arbeitstage.filter(t => gueltigAm(regel, t) && standardInfo(ctx, p, t).arbeitet)
}

/** Ist die Abwesenheit einer ZAZ an allen ihren Arbeitstagen der Woche
 *  ganztags vertreten (Ferienvertretung oder ganztägiger Einsatz)? */
export function vollVertreten(ctx: Kontext, p: Person, woche: Woche, abwesend: Map<string, Map<string, number>>): boolean {
  const weg = abwesend.get(p.id)
  if (!weg || weg.size === 0) return false
  const tage = praxisTageVon(ctx, p, woche).filter(t => weg.has(t))
  if (tage.length === 0) return false
  return tage.every(t => !!ctx.vertretungen[`${p.id}|${t}`] || ctx.einsaetze.some(e => e.datum === t && einsatzGanztags(e)))
}

// ── Tagesstand ──────────────────────────────────────────────────────────

export type Anwesend = { name: string; schicht: Schicht; raum: number | null; art: 'person' | 'vertretung' | 'platzhalter' | 'einsatz'; assistenz: boolean }
export type TagesStand = {
  datum: string
  /** ZAZ ganztags in der Praxis (Personen, Vertretungen, Platzhalter, ganztägige Einsätze) */
  zaz: Anwesend[]
  /** Halbtägige feste Einsätze */
  zazHalb: Einsatz[]
  dhpa: Anwesend[]
  /** Abwesende, die an diesem Tag arbeiten würden und einen Platz brauchen (ZAZ ohne volle Vertretung) */
  zazWeg: number
  dhpaWeg: number
  zazWegNamen: string[]
  dhpaWegNamen: string[]
  /** Assistenz Bedarf in Tagen */
  bedarf: number
  raumWarnungen: string[]
}

export function tagesStand(ctx: Kontext, tag: string, abwesend: Map<string, Map<string, number>>): TagesStand {
  const zaz: Anwesend[] = [], dhpa: Anwesend[] = []
  const zazWegNamen: string[] = [], dhpaWegNamen: string[] = []
  const dow = dowIndex(tag) + 1
  const einsatzGanzerTag = ctx.einsaetze.some(e => e.datum === tag && einsatzGanztags(e))
  for (const p of ctx.personen) {
    const kat = kategorieFuer(p.job_title)
    if (kat !== 'ZAZ' && kat !== 'DHPA') continue
    if (!gueltigAm(ctx.personRegeln[p.id] ?? PERSON_LEER, tag)) continue
    const info = standardInfo(ctx, p, tag)
    const weg = abwesend.get(p.id)?.has(tag) ?? false
    const liste = kat === 'ZAZ' ? zaz : dhpa
    if (!weg && info.arbeitet) liste.push({ name: p.full_name, schicht: info.schicht, raum: info.raum, art: 'person', assistenz: true })
    else if (weg && kat === 'ZAZ') {
      const v = ctx.vertretungen[`${p.id}|${tag}`]
      if (v) liste.push({ name: v, schicht: info.arbeitet ? info.schicht : '', raum: info.arbeitet ? info.raum : null, art: 'vertretung', assistenz: true })
      if (info.arbeitet && !v && !einsatzGanzerTag) zazWegNamen.push(p.full_name)
    } else if (weg && info.arbeitet) dhpaWegNamen.push(p.full_name)
  }
  for (const ph of ctx.regeln.platzhalter) {
    if (!ph.tage.includes(dow) || !gueltigAm({ ...PERSON_LEER, ab: ph.ab, bis: ph.bis }, tag)) continue
    const a: Anwesend = { name: ph.name, schicht: ph.schicht, raum: ph.raum, art: 'platzhalter', assistenz: true }
    if (ph.kategorie === 'ZAZ') zaz.push(a); else if (ph.kategorie === 'DHPA') dhpa.push(a)
  }
  const zazHalb: Einsatz[] = []
  for (const e of ctx.einsaetze) {
    if (e.datum !== tag) continue
    if (einsatzGanztags(e)) zaz.push({ name: e.name, schicht: '', raum: null, art: 'einsatz', assistenz: e.assistenz })
    else zazHalb.push(e)
  }
  const g = ctx.regeln.grundbedarf
  const bedarf = round2(
    zaz.filter(a => a.assistenz).length
    + zazHalb.reduce((s, e) => s + (e.assistenz ? einsatzTage(e) : 0), 0)
    + g.steri + g.empfang + g.tagesleitung
    + (zaz.some(a => a.schicht === 's') ? g.spaetSteri : 0),
  )
  // Behandlungszimmer: 5 Räume pro Halbtag, Einsätze brauchen je einen freien Raum
  const raumWarnungen: string[] = []
  const einsaetzeHeute = ctx.einsaetze.filter(e => e.datum === tag)
  if (einsaetzeHeute.length > 0) {
    for (const halb of ['vm', 'nm'] as const) {
      const belegt = new Set(zaz.filter(a => a.raum != null && schichtHalbtage(a.schicht)[halb]).map(a => a.raum))
      const noetig = einsaetzeHeute.filter(e => einsatzHalbtage(e)[halb])
      if (noetig.length > 0 && 5 - belegt.size < noetig.length) {
        raumWarnungen.push(`Am ${tagKurz(tag)} ${halb === 'vm' ? 'vormittags' : 'nachmittags'} ist kein Behandlungszimmer frei (Einsatz ${noetig.map(e => e.name).join(', ')})`)
      }
    }
  }
  return { datum: tag, zaz, zazHalb, dhpa, zazWeg: zazWegNamen.length, dhpaWeg: dhpaWegNamen.length, zazWegNamen, dhpaWegNamen, bedarf, raumWarnungen }
}

// ── Assistenz in Tagen ──────────────────────────────────────────────────

/** Praxistage einer Assistenzperson in der Woche: Pensum mal gültige
 *  Arbeitstage ohne Feiertage, minus Home Office Tage der Standardwoche
 *  (und Schultage bei vollem Pensum), mal Anrechnungsfaktor der Lernenden. */
export function praxistageAssistenz(ctx: Kontext, p: Person, woche: Woche): number {
  const regel = ctx.personRegeln[p.id] ?? PERSON_LEER
  const tage = woche.arbeitstage.filter(t => gueltigAm(regel, t))
  if (tage.length === 0) return 0
  const lernende = istLernende(p.job_title)
  const pensum = faktorVon(p.pensum)
  let ho = 0, schule = 0
  for (const t of tage) { const i = standardInfo(ctx, p, t); if (i.ho) ho++; if (i.schule) schule++ }
  const basis = Math.max(0, pensum * tage.length - ho - (pensum >= 1 ? schule : 0))
  return round2(basis * faktorAm(regel, tage[0], lernende))
}

export type Assistenz = { bedarf: number; angebot: number; abwesend: number; reserve: number; frei: number; freiPersonen: number; durchschnitt: number; personen: number }

/** Rote Woche, Öffnung für die Assistenz. Pro Arbeitstag: zazWeg = ZAZ, die
 *  an diesem Tag fest fehlen (F im Arbeitsplan oder akzeptierte Anmeldung,
 *  ohne Vertretung und ohne ganztägigen Einsatz), belegt = Assistenz, die an
 *  diesem Tag schon fehlt (in Tagen, offene und akzeptierte Anmeldungen),
 *  frei = Plätze, die an diesem Tag noch frei sind (nur an Tagen mit Lücke). */
export type OeffnungTag = { datum: string; zazWeg: number; belegt: number; frei: number }
export type Oeffnung = {
  tage: OeffnungTag[]
  /** Tage mit mindestens einer fest fehlenden ZAZ */
  offen: string[]
  /** Noch freie Plätze in Personen: höchste Zahl freier Plätze an einem offenen Tag, abgerundet */
  freiPersonen: number
  /** Noch freie Tage insgesamt (Summe der Tage, höchstens das Frei der Woche) */
  freiTage: number
}

/** Erklärung der Öffnung einer roten Woche, zum Beispiel «Eine Zahnärztin
 *  ist am Di und Do fest in den Ferien, eine Person der Assistenz darf dort
 *  frei nehmen». Leer, wenn kein Tag offen ist. */
export function oeffnungText(o: Oeffnung | null | undefined): string {
  if (!o || o.offen.length === 0) return ''
  const offen = o.tage.filter(t => t.zazWeg > 0)
  const maxZaz = Math.max(...offen.map(t => t.zazWeg)), minZaz = Math.min(...offen.map(t => t.zazWeg))
  const liste = offen.map(t => WOCHENTAG_KURZ[dowIndex(t.datum)])
  const wann = offen.length === o.tage.length ? 'die ganze Woche' : `am ${liste.length > 1 ? `${liste.slice(0, -1).join(', ')} und ${liste[liste.length - 1]}` : liste[0]}`
  const wer = minZaz === maxZaz ? (maxZaz === 1 ? 'Eine Zahnärztin ist' : `${maxZaz} Zahnärztinnen sind`) : 'Mindestens eine Zahnärztin ist'
  const platz = o.freiPersonen === 0
    ? (maxZaz === 1 ? 'der Platz für die Assistenz ist dort schon belegt' : 'die Plätze für die Assistenz sind dort schon belegt')
    : o.freiPersonen === 1 ? 'eine Person der Assistenz darf dort frei nehmen' : `bis zu ${o.freiPersonen} Personen der Assistenz dürfen dort frei nehmen`
  return `${wer} ${wann} fest in den Ferien, ${platz}`
}

// ── Kapazität einer Woche ───────────────────────────────────────────────

export type Personalstand = 'zuwenig' | 'knapp' | 'ok' | 'reserve'
export const PERSONALSTAND_LABEL: Record<Personalstand, string> = { zuwenig: 'Zu wenig Personal', knapp: 'Knapp', ok: 'Gut besetzt', reserve: 'Viel Personal, Ferien erwünscht' }

export type Kapazitaet = {
  woche: Woche
  tage: TagesStand[]
  belegung: Map<Kategorie, Belegt[]>
  /** ZAZ Abwesenheiten der Woche, die einen Platz brauchen (nicht vollständig vertreten) */
  zazZaehlend: Belegt[]
  plaetze: { ZAZ: number; DHPA: number }
  /** Höchste Zahl Abwesender an einem Tag der Woche (gegen die Plätze der Farbe) */
  plaetzeBelegt: { ZAZ: number; DHPA: number }
  assistenz: Assistenz
  /** Nur in roten Wochen: Öffnung für die Assistenz durch fest fehlende ZAZ, sonst null */
  oeffnung: Oeffnung | null
  warnungen: string[]
  personalstand: Personalstand
}

const vorname = (n: string) => n.split(/\s+/)[0] ?? ''
export const istValerie = (n: string) => vorname(n) === 'Valérie' || vorname(n) === 'Valerie'
export const istFraenzi = (n: string) => vorname(n) === 'Franziska' || vorname(n) === 'Fränzi'

export function kapazitaetFuer(ctx: Kontext, woche: Woche): Kapazitaet {
  const abwesend = abwesendTage(ctx, woche)
  const tage = woche.arbeitstage.map(t => tagesStand(ctx, t, abwesend))
  const belegung = belegungFuer(woche, ctx.wishes, ctx.eintraege.filter(e => e.entry === 'F' || e.entry.startsWith('F:') || e.entry === 'UF'), ctx.personen)
  const byId = new Map(ctx.personen.map(p => [p.id, p]))
  const zazZaehlend = (belegung.get('ZAZ') ?? []).filter(b => { const p = byId.get(b.employeeId); return !p || !vollVertreten(ctx, p, woche, abwesend) })
  const plaetze = { ZAZ: ctx.regeln.plaetzeZaz[woche.farbe], DHPA: ctx.regeln.plaetzeDhpa[woche.farbe] }

  // Assistenz
  let angebot = 0, abw = 0, personen = 0
  for (const p of ctx.personen) {
    if (kategorieFuer(p.job_title) !== 'ASSISTENZ') continue
    const pt = praxistageAssistenz(ctx, p, woche)
    if (pt <= 0) continue
    angebot += pt; personen++
    const regel = ctx.personRegeln[p.id] ?? PERSON_LEER
    // Abwesend höchstens so viele Tage, wie die Person in dieser Woche in der
    // Praxis wäre (Teilzeit mit einer ganzen Woche F zählt nach Pensum)
    let weg = 0
    for (const [t, g] of Array.from(abwesend.get(p.id) ?? [])) weg += g * faktorAm(regel, t, istLernende(p.job_title))
    abw += Math.min(weg, pt)
  }
  const bedarf = round2(tage.reduce((s, t) => s + t.bedarf, 0))
  angebot = round2(angebot); abw = round2(abw)
  const frei = round2(angebot - bedarf - abw - ctx.regeln.reserve)
  const durchschnitt = personen > 0 ? round2(angebot / personen) : 0
  const freiPersonen = durchschnitt > 0 ? Math.max(0, Math.floor(frei / durchschnitt + 1e-9)) : 0
  const assistenz: Assistenz = { bedarf, angebot, abwesend: abw, reserve: ctx.regeln.reserve, frei, freiPersonen, durchschnitt, personen }

  // Rote Woche: pro Tag so viele Plätze für die Assistenz, wie ZAZ fest fehlen
  // (nur F im Arbeitsplan und akzeptierte Anmeldungen, offene ZAZ Wünsche
  // öffnen nichts); belegt zählt alle Anmeldungen der Assistenz an diesem Tag
  let oeffnung: Oeffnung | null = null
  if (woche.farbe === 'rot') {
    const abwesendFest = abwesendTage(nurAkzeptiert(ctx), woche)
    const tageO: OeffnungTag[] = tage.map(t => {
      const zazWeg = tagesStand(ctx, t.datum, abwesendFest).zazWeg
      let belegt = 0
      for (const p of ctx.personen) {
        if (kategorieFuer(p.job_title) !== 'ASSISTENZ') continue
        const g = abwesend.get(p.id)?.get(t.datum)
        if (g) belegt += g * faktorAm(ctx.personRegeln[p.id] ?? PERSON_LEER, t.datum, istLernende(p.job_title))
      }
      belegt = round2(belegt)
      return { datum: t.datum, zazWeg, belegt, frei: zazWeg > 0 ? Math.max(0, round2(zazWeg - belegt)) : 0 }
    })
    oeffnung = {
      tage: tageO,
      offen: tageO.filter(t => t.zazWeg > 0).map(t => t.datum),
      freiPersonen: Math.max(0, ...tageO.map(t => Math.floor(t.frei + 1e-9))),
      freiTage: Math.max(0, Math.min(frei, round2(tageO.reduce((s, t) => s + t.frei, 0)))),
    }
  }

  // Plätze pro Tag: an keinem Tag mehr Abwesende als die Farbe erlaubt
  const plaetzeBelegt = { ZAZ: Math.max(0, ...tage.map(t => t.zazWeg)), DHPA: Math.max(0, ...tage.map(t => t.dhpaWeg)) }

  // Warnungen
  const warnungen: string[] = []
  for (const t of tage) {
    if (t.zazWeg > plaetze.ZAZ) warnungen.push(`ZAZ über den Plätzen am ${wochentagName(t.datum)} (${t.zazWeg} von ${plaetze.ZAZ})`)
    if (t.dhpaWeg > plaetze.DHPA) warnungen.push(`DH / PA über den Plätzen am ${wochentagName(t.datum)} (${t.dhpaWeg} von ${plaetze.DHPA})`)
  }
  for (const t of tage) {
    if (t.zaz.length === 0) warnungen.push(`Am ${wochentagName(t.datum)} keine Zahnärztin in der Praxis`)
    if (t.dhpa.length === 0) warnungen.push(`Am ${wochentagName(t.datum)} keine DH oder PA in der Praxis`)
  }
  if (ctx.regeln.valerieFraenzi) {
    const t = tage.find(x => x.zazWegNamen.some(istValerie) && x.zazWegNamen.some(istFraenzi))
    if (t) warnungen.push(`Valérie und Fränzi gleichzeitig weg am ${wochentagName(t.datum)}, ohne volle Vertretung`)
  }
  if (frei < -0.005) warnungen.push(`Assistenz fehlt (${round2(-frei)} Tage über dem Angebot)`)
  const leitendeWeg = (belegung.get('ASSISTENZ') ?? []).filter(b => istLeitendeDa(byId.get(b.employeeId)?.job_title))
  if (leitendeWeg.length > 1) warnungen.push(`Mehr als eine Leitende DA weg (${leitendeWeg.map(b => vorname(byId.get(b.employeeId)?.full_name ?? '')).join(', ')})`)
  for (const t of tage) warnungen.push(...t.raumWarnungen)

  let personalstand: Personalstand = 'ok'
  if (frei < -0.005) personalstand = 'zuwenig'
  else if (durchschnitt > 0 && frei < durchschnitt) personalstand = 'knapp'
  else if (durchschnitt > 0 && frei >= 2 * durchschnitt && abw === 0) personalstand = 'reserve'

  return { woche, tage, belegung, zazZaehlend, plaetze, plaetzeBelegt, assistenz, oeffnung, warnungen, personalstand }
}

// ── Prüfung einer Anmeldung ─────────────────────────────────────────────

/** Kontext mit einer zusätzlichen, noch nicht gespeicherten Wochenanmeldung
 *  (tage = gewählte Tage bei Teilzeit, sonst die ganze Woche). */
export function mitAnmeldung(ctx: Kontext, person: Person, woche: Woche, tage?: string[] | null): Kontext {
  const neu: FerienWunsch = { employeeId: person.id, from: woche.montag, to: woche.freitag, art: 'ferien', prio: 3, status: 'offen', createdAt: new Date().toISOString(), quelle: 'woche', kw: woche.kw, tage: tage && tage.length > 0 ? tage : null }
  return { ...ctx, wishes: [...ctx.wishes, neu] }
}

/** Kontext ohne die Anmeldung einer Person für eine Woche (zum Nachrechnen). */
export function ohneAnmeldung(ctx: Kontext, employeeId: string, from: string): Kontext {
  return { ...ctx, wishes: ctx.wishes.filter(w => !(w.employeeId === employeeId && w.from === from)) }
}

/** Kontext nur mit akzeptierten Wünschen und Wochenanmeldungen (plus
 *  Einträge im Arbeitsplan): zeigt, was in einer Woche schon fest ist.
 *  Offene Anmeldungen zählen hier nicht, sie werden separat ausgewiesen. */
export function nurAkzeptiert(ctx: Kontext): Kontext {
  return { ...ctx, wishes: ctx.wishes.filter(w => w.status === 'akzeptiert') }
}

/** Gründe, warum eine Wochenanmeldung dieser Person die Regeln verletzen
 *  würde (leer = möglich). ctx ohne die Anmeldung selbst; tage = gewählte
 *  Tage bei Teilzeit. */
export function pruefeAnmeldung(ctx: Kontext, woche: Woche, person: Person, tage?: string[] | null): string[] {
  const kat = kategorieFuer(person.job_title)
  if (!kat) return ['Für diese Kategorie gibt es keine Wochenanmeldung']
  // Rot: für ZAZ und DH / PA immer gesperrt; die Assistenz nur an Tagen mit fest fehlender ZAZ (unten)
  if (woche.farbe === 'rot' && kat !== 'ASSISTENZ') return ['Rote Woche, keine Ferien']
  if (woche.arbeitstage.length === 0) return ['Diese Woche hat keine Arbeitstage']
  const tagesgenau = !!(tage && tage.length > 0)
  const gewaehlt = (tagesgenau ? tage! : woche.arbeitstage).filter(t => woche.arbeitstage.includes(t))
  if (gewaehlt.length === 0) return ['Bitte mindestens einen Tag wählen']
  const gruende: string[] = []
  const basis = kapazitaetFuer(ctx, woche)
  if (woche.farbe === 'rot' && (!basis.oeffnung || basis.oeffnung.offen.length === 0)) return ['Rote Woche, keine Ferien']
  // ohne Tagesauswahl (ältere Einträge, Schätzung) gilt die ganze Woche nach Pensum
  const mit = kapazitaetFuer(mitAnmeldung(ctx, person, woche, tagesgenau ? gewaehlt : null), woche)
  if (kat === 'ZAZ' || kat === 'DHPA') {
    const label = kat === 'ZAZ' ? 'ZAZ' : 'DH / PA'
    const pl = mit.plaetze[kat]
    for (const d of gewaehlt) {
      const tm = mit.tage.find(t => t.datum === d)!, tb = basis.tage.find(t => t.datum === d)!
      const weg = kat === 'ZAZ' ? tm.zazWeg : tm.dhpaWeg, wegBasis = kat === 'ZAZ' ? tb.zazWeg : tb.dhpaWeg
      // nur blockieren, wenn die eigene Abwesenheit den Tag über die Plätze bringt
      if (weg > pl && weg > wegBasis) gruende.push(`Am ${wochentagName(d)} ist für ${label} kein Platz mehr (${pl} ${pl === 1 ? 'Platz' : 'Plätze'})`)
      const da = kat === 'ZAZ' ? tm.zaz.length : tm.dhpa.length, daBasis = kat === 'ZAZ' ? tb.zaz.length : tb.dhpa.length
      if (da === 0 && daBasis > 0) gruende.push(kat === 'ZAZ' ? `Am ${wochentagName(d)} wäre keine Zahnärztin in der Praxis` : `Am ${wochentagName(d)} wäre keine DH oder PA in der Praxis`)
      if (kat === 'ZAZ' && ctx.regeln.valerieFraenzi) {
        const beide = (n: string[]) => n.some(istValerie) && n.some(istFraenzi)
        if (beide(tm.zazWegNamen) && !beide(tb.zazWegNamen)) gruende.push(`Am ${wochentagName(d)} können Valérie und Fränzi nicht gleichzeitig weg`)
      }
    }
  } else {
    const regel = ctx.personRegeln[person.id] ?? PERSON_LEER
    const lernende = istLernende(person.job_title)
    if (basis.oeffnung) {
      // Rote Woche: nur Tage, an denen eine ZAZ fest fehlt, und pro fehlende ZAZ ein Platz
      for (const d of gewaehlt) {
        const o = basis.oeffnung.tage.find(t => t.datum === d)
        if (!o || o.zazWeg === 0) gruende.push(`Rote Woche, am ${wochentagName(d)} ist keine Zahnärztin in den Ferien`)
        else if (o.frei + 0.005 < faktorAm(regel, d, lernende)) gruende.push(`Am ${wochentagName(d)} ist für die Assistenz kein Platz mehr (${o.zazWeg} ${o.zazWeg === 1 ? 'Platz' : 'Plätze'}, weil ${o.zazWeg === 1 ? 'eine Zahnärztin' : `${o.zazWeg} Zahnärztinnen`} in den Ferien ${o.zazWeg === 1 ? 'ist' : 'sind'})`)
      }
    }
    const noetig = tagesgenau ? round2(gewaehlt.length * faktorAm(regel, gewaehlt[0], lernende)) : praxistageAssistenz(ctx, person, woche)
    if (basis.assistenz.frei + 0.005 < noetig) gruende.push(`Für die Assistenz reicht es in dieser Woche nicht (frei ${Math.max(0, basis.assistenz.frei)} Tage, nötig ${noetig})`)
    if (istLeitendeDa(person.job_title)) {
      const byId = new Map(ctx.personen.map(p => [p.id, p]))
      if ((basis.belegung.get('ASSISTENZ') ?? []).some(b => b.employeeId !== person.id && istLeitendeDa(byId.get(b.employeeId)?.job_title))) gruende.push('Von den Leitenden DA ist in dieser Woche schon jemand weg')
    }
  }
  return gruende
}

/** Ist ein Grund aus pruefeAnmeldung ein «voll» (Plätze der Kategorie
 *  belegt, Assistenz reicht nicht, Leitende DA schon weg), im Unterschied
 *  zu Sperren wie der roten Woche oder «niemand in der Praxis»? */
export const grundIstVoll = (g: string | null | undefined) => !!g && (/kein Platz mehr/.test(g) || g.startsWith('Für die Assistenz') || g.startsWith('Von den Leitenden'))

/** Hinweis an Mitarbeitende, wenn die Woche für ihre Kategorie voll ist */
export const VOLL_HINWEIS = 'Diese Woche ist für deine Kategorie schon voll. Bitte gib stattdessen einen Ferienwunsch ein, die Praxisleitung entscheidet dann.'

/** Fehlertext für eine abgelehnte Wochenanmeldung: der erste Grund, bei
 *  einer vollen Woche mit dem Hinweis auf den Wunsch. */
export function anmeldeFehler(gruende: string[], prefix = ''): { error: string; voll: boolean } {
  const g = gruende[0] ?? 'Anmeldung nicht möglich'
  const voll = grundIstVoll(g)
  return { error: `${prefix}${g}.${voll ? ` ${VOLL_HINWEIS}` : ''}`, voll }
}

export type TagStatus = { datum: string; moeglich: boolean; grund: string | null }

/** Pro Arbeitstag der Woche: könnte die Person genau diesen Tag frei nehmen?
 *  Bei der Assistenz gilt pro Tag ein Tag Bedarf; die Summe der gewählten
 *  Tage prüft die Anmeldung. */
export function tagesVerfuegbarkeit(ctx: Kontext, woche: Woche, person: Person): TagStatus[] {
  const kat = kategorieFuer(person.job_title)
  if (!kat) return woche.arbeitstage.map(d => ({ datum: d, moeglich: false, grund: 'Für diese Kategorie gibt es keine Wochenanmeldung' }))
  // Rot: ZAZ und DH / PA gesperrt; die Assistenz prüft pro Tag, ob eine ZAZ fest fehlt
  if (woche.farbe === 'rot' && kat !== 'ASSISTENZ') return woche.arbeitstage.map(d => ({ datum: d, moeglich: false, grund: 'Rote Woche, keine Ferien' }))
  return woche.arbeitstage.map(d => { const g = pruefeAnmeldung(ctx, woche, person, [d]); return { datum: d, moeglich: g.length === 0, grund: g[0] ?? null } })
}

/** Regeln, die das Akzeptieren einer bestehenden offenen Wochenanmeldung
 *  verletzen würde (für den Hinweis an Admins und Laura). */
export function verletzungenFuer(ctx: Kontext, woche: Woche, wunsch: FerienWunsch): string[] {
  const person = ctx.personen.find(p => p.id === wunsch.employeeId)
  if (!person) return []
  return pruefeAnmeldung(ohneAnmeldung(ctx, wunsch.employeeId, wunsch.from), woche, person, wunsch.tage)
}

// ── Zwei Wochen am Stück (Art. 329c OR) ─────────────────────────────────

/** Kalenderwochen, in denen die Person eine Wochenanmeldung hat oder alle
 *  ihre Arbeitstage Ferien sind (F im Arbeitsplan oder nicht abgelehnter
 *  Ferienwunsch, Feiertage gelten als abgedeckt), und ob zwei davon
 *  aufeinander folgen. arbeitstagVon grenzt bei Teilzeit auf die Tage der
 *  Standardwoche ein. */
export function zweiWochenAmStueck(employeeId: string, wochen: Woche[], eintraege: Eintrag[], wishes: FerienWunsch[], arbeitstagVon?: (tag: string) => boolean): { ok: boolean; vollWochen: number[] } {
  const fTage = new Set(eintraege.filter(e => e.employee_id === employeeId && (e.entry === 'F' || e.entry.startsWith('F:'))).map(e => e.schedule_date))
  const eigene = wishes.filter(w => w.employeeId === employeeId && w.status !== 'abgelehnt' && w.art === 'ferien')
  const wunschTage = new Set(eigene.flatMap(w => wunschTageListe(w)))
  const gedeckt = (t: string) => fTage.has(t) || wunschTage.has(t)
  const voll = wochen.filter(w => {
    if (w.arbeitstage.length === 0) return false
    if (eigene.some(x => x.quelle === 'woche' && x.from === w.montag)) return true
    const tage = arbeitstagVon ? w.arbeitstage.filter(arbeitstagVon) : w.arbeitstage
    return tage.length > 0 && tage.every(gedeckt)
  }).map(w => w.kw).sort((a, b) => a - b)
  return { ok: voll.some((kw, i) => voll[i + 1] === kw + 1), vollWochen: voll }
}

export const kategorieLabel = (k: Kategorie) => KATEGORIE_LABEL[k]
