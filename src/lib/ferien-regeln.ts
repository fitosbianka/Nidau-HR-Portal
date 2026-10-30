// Zentrale Regeln der Ferienplanung 2027. Alle Zahlen sind Standardwerte,
// Admins und Laura ändern sie im Dialog «Regeln bearbeiten». Ziel der
// Planung: Patienten und Agenda optimal betreuen, jeden Öffnungstag genug
// und nie zu viel Personal in der Praxis.
//
// Ablage als reservierte Zeilen in zeiterfassung_comments (kein DDL):
//   __ferien_regeln__             @ 2027-01-01 → Regeln (Plätze, Grundbedarf, Reserve, Schalter, Platzhalter)
//   __ferien_person__<profileId>  @ 2027-01-01 → PersonRegel (Gültigkeit ab und bis, Anrechnungsfaktor)
//   __ferien_einsatz__            @ Datum      → { liste: Einsatz[] } (feste Vertretungseinsätze mit Uhrzeit)

import { PLAN_YEAR } from './ferien-wuensche'
import { wochen2027, montagVon, type Kategorie, type WochenFarbe } from './ferien-wochen'
import { istFeiertag } from './feiertage'

export const REGELN_KEY = '__ferien_regeln__'
export const PERSON_PREFIX = '__ferien_person__'
export const EINSATZ_KEY = '__ferien_einsatz__'
export const personKey = (profileId: string) => `${PERSON_PREFIX}${profileId}`

export type Schicht = '' | 'f' | 't' | 's' | 'h'
export const SCHICHT_LABEL: Record<Schicht, string> = { '': 'Ganzer Tag', f: 'Frühschicht', t: 'Mittelschicht', s: 'Spätschicht', h: 'Halbtag' }

/** Platzhalter für eine Person ohne Profil, zum Beispiel die neue Zahnärztin
 *  ab Juni 2027 (40 % in der Position von Noah). Zählt für die Kapazität
 *  wie eine echte Person mit dieser Standardwoche. */
export type Platzhalter = {
  id: string
  name: string
  kategorie: Kategorie
  ab: string | null
  bis: string | null
  /** ISO Wochentage 1 (Mo) bis 5 (Fr) */
  tage: number[]
  schicht: Schicht
  raum: number | null
}

export type Regeln = {
  plaetzeZaz: Record<WochenFarbe, number>
  plaetzeDhpa: Record<WochenFarbe, number>
  grundbedarf: { steri: number; empfang: number; tagesleitung: number; spaetSteri: number }
  /** Reserve in Assistenztagen pro Woche, die frei bleiben soll */
  reserve: number
  /** Valérie und Fränzi nie in derselben Woche abwesend (ausser beide vollständig vertreten) */
  valerieFraenzi: boolean
  platzhalter: Platzhalter[]
}

export const PLATZHALTER_STANDARD: Platzhalter = {
  id: 'neue-zaz-2027', name: 'Neue Zahnärztin', kategorie: 'ZAZ', ab: `${PLAN_YEAR}-06-01`, bis: null, tage: [1, 3], schicht: '', raum: null,
}

export const REGELN_STANDARD: Regeln = {
  plaetzeZaz: { dunkelgruen: 2, hellgruen: 2, orange: 1, rot: 0 },
  plaetzeDhpa: { dunkelgruen: 4, hellgruen: 3, orange: 2, rot: 0 },
  grundbedarf: { steri: 1, empfang: 1, tagesleitung: 1, spaetSteri: 1 },
  reserve: 0,
  valerieFraenzi: false,
  platzhalter: [PLATZHALTER_STANDARD],
}

const FARBEN: WochenFarbe[] = ['dunkelgruen', 'hellgruen', 'orange', 'rot']
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/
const ZEIT_RE = /^\d{2}:\d{2}$/
const zahl = (v: unknown, max = 20) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.round(v * 100) / 100) : null)
const datum = (v: unknown) => (typeof v === 'string' && DATUM_RE.test(v) ? v : null)
const istKategorie = (v: unknown): v is Kategorie => v === 'ZAZ' || v === 'DHPA' || v === 'ASSISTENZ'
const istSchicht = (v: unknown): v is Schicht => v === '' || v === 'f' || v === 't' || v === 's' || v === 'h'

function parsePlatzhalter(v: unknown): Platzhalter | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 60) : ''
  if (!name) return null
  const tage = Array.isArray(o.tage) ? Array.from(new Set(o.tage.filter((t): t is number => typeof t === 'number' && t >= 1 && t <= 5))).sort() : []
  return {
    id: typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : `ph-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name, kategorie: istKategorie(o.kategorie) ? o.kategorie : 'ZAZ',
    ab: datum(o.ab), bis: datum(o.bis), tage,
    schicht: istSchicht(o.schicht) ? o.schicht : '',
    raum: typeof o.raum === 'number' && o.raum >= 1 && o.raum <= 5 ? Math.round(o.raum) : null,
  }
}

/** Gespeicherte Regeln tolerant lesen; fehlende Teile kommen aus dem Standard. */
export function parseRegeln(comment: string | null | undefined): Regeln {
  const r: Regeln = {
    plaetzeZaz: { ...REGELN_STANDARD.plaetzeZaz }, plaetzeDhpa: { ...REGELN_STANDARD.plaetzeDhpa },
    grundbedarf: { ...REGELN_STANDARD.grundbedarf }, reserve: REGELN_STANDARD.reserve,
    valerieFraenzi: REGELN_STANDARD.valerieFraenzi, platzhalter: REGELN_STANDARD.platzhalter.map(p => ({ ...p, tage: [...p.tage] })),
  }
  if (!comment) return r
  try {
    const j = JSON.parse(comment) as Record<string, unknown>
    for (const [key, ziel] of [['plaetzeZaz', r.plaetzeZaz], ['plaetzeDhpa', r.plaetzeDhpa]] as Array<[string, Record<WochenFarbe, number>]>) {
      const o = j[key]
      if (o && typeof o === 'object') for (const f of FARBEN) { const z = zahl((o as Record<string, unknown>)[f]); if (z != null) ziel[f] = Math.round(z) }
    }
    const g = j.grundbedarf
    if (g && typeof g === 'object') for (const k of ['steri', 'empfang', 'tagesleitung', 'spaetSteri'] as const) { const z = zahl((g as Record<string, unknown>)[k], 10); if (z != null) r.grundbedarf[k] = z }
    const res = zahl(j.reserve, 50); if (res != null) r.reserve = res
    if (typeof j.valerieFraenzi === 'boolean') r.valerieFraenzi = j.valerieFraenzi
    if (Array.isArray(j.platzhalter)) r.platzhalter = j.platzhalter.map(parsePlatzhalter).filter((p): p is Platzhalter => p !== null)
  } catch { /* Standard */ }
  // Rot bleibt überall gesperrt
  r.plaetzeZaz.rot = 0; r.plaetzeDhpa.rot = 0
  return r
}

// ── Personenregeln ──────────────────────────────────────────────────────

export type PersonRegel = {
  /** Für die Kapazität zählt die Person nur zwischen ab und bis */
  ab: string | null
  bis: string | null
  /** Anrechnungsfaktor (Lernende), 1 = voll; null = Standard */
  faktor: number | null
  /** Ab dem Tag nach faktorBis gilt faktorDanach */
  faktorBis: string | null
  faktorDanach: number | null
}
export const PERSON_LEER: PersonRegel = { ab: null, bis: null, faktor: null, faktorBis: null, faktorDanach: null }

/** Standardwerte nach Vornamen (Stand Oktober 2026), gelten bis ein Admin
 *  etwas anderes speichert: Noah zählt bis Ende Juli 2027, Amanda 50 %
 *  bis 31. Juli 2027 und danach 100 %, Katarina 100 %. */
export const PERSON_STANDARD: Record<string, Partial<PersonRegel>> = {
  Noah: { bis: `${PLAN_YEAR}-07-31` },
  Amanda: { faktor: 0.5, faktorBis: `${PLAN_YEAR}-07-31`, faktorDanach: 1 },
  Katarina: { faktor: 1 },
}

export function parsePersonRows(rows: Array<{ user_full_name: string; comment: string }>): Record<string, PersonRegel> {
  const out: Record<string, PersonRegel> = {}
  for (const r of rows) {
    if (!r.user_full_name.startsWith(PERSON_PREFIX)) continue
    try {
      const j = JSON.parse(r.comment) as Record<string, unknown>
      const f = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 100) / 100 : null)
      out[r.user_full_name.slice(PERSON_PREFIX.length)] = { ab: datum(j.ab), bis: datum(j.bis), faktor: f(j.faktor), faktorBis: datum(j.faktorBis), faktorDanach: f(j.faktorDanach) }
    } catch { /* überspringen */ }
  }
  return out
}

/** Regel einer Person: gespeicherte Zeile vor Namensstandard vor Profil
 *  (Eintrittsdatum als ab). */
export function personRegelFuer(person: { id: string; full_name: string; eintrittsdatum?: string | null }, gespeichert?: PersonRegel): PersonRegel & { gespeichert: boolean } {
  const vorname = person.full_name.split(/\s+/)[0] ?? ''
  const std = PERSON_STANDARD[vorname] ?? {}
  const basis: PersonRegel = { ...PERSON_LEER, ab: datum(person.eintrittsdatum ?? null), ...std }
  if (!gespeichert) return { ...basis, gespeichert: false }
  return { ...gespeichert, gespeichert: true }
}

export const gueltigAm = (r: PersonRegel, tag: string) => (!r.ab || tag >= r.ab) && (!r.bis || tag <= r.bis)
export const gueltigInWoche = (r: PersonRegel, arbeitstage: string[]) => arbeitstage.some(t => gueltigAm(r, t))

/** Anrechnungsfaktor an einem Tag: nur Lernende haben einen Faktor unter 1. */
export function faktorAm(r: PersonRegel, tag: string, lernende: boolean): number {
  if (!lernende) return 1
  if (r.faktorBis && tag > r.faktorBis) return r.faktorDanach ?? 1
  return r.faktor ?? 1
}

// ── Feste Vertretungseinsätze ───────────────────────────────────────────

export type Einsatz = {
  id: string
  datum: string
  name: string
  kategorie: 'ZAZ'
  /** HH:MM */
  von: string
  bis: string
  /** Braucht eine Assistenz am Stuhl */
  assistenz: boolean
}

const minuten = (hhmm: string) => parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(3, 5), 10)
const MITTAG = 12 * 60 + 30

/** Welche Halbtage ein Einsatz belegt (Grenze 12.30 Uhr). */
export function einsatzHalbtage(e: { von: string; bis: string }): { vm: boolean; nm: boolean } {
  return { vm: minuten(e.von) < MITTAG, nm: minuten(e.bis) > MITTAG }
}
/** Ein Einsatz zählt pro Halbtag 0.5 Tage (13 bis 17 Uhr = halber Tag). */
export function einsatzTage(e: { von: string; bis: string }): number {
  const h = einsatzHalbtage(e)
  return (h.vm ? 0.5 : 0) + (h.nm ? 0.5 : 0)
}
/** Ganztägig: beide Halbtage und mindestens sieben Stunden. */
export function einsatzGanztags(e: { von: string; bis: string }): boolean {
  const h = einsatzHalbtage(e)
  return h.vm && h.nm && minuten(e.bis) - minuten(e.von) >= 7 * 60
}

export function parseEinsatzRows(rows: Array<{ user_full_name: string; schedule_date: string; comment: string }>): Einsatz[] {
  const out: Einsatz[] = []
  for (const r of rows) {
    if (r.user_full_name !== EINSATZ_KEY) continue
    const tag = r.schedule_date.slice(0, 10)
    try {
      const j = JSON.parse(r.comment) as { liste?: unknown }
      if (!Array.isArray(j.liste)) continue
      for (const v of j.liste) {
        if (!v || typeof v !== 'object') continue
        const o = v as Record<string, unknown>
        const name = typeof o.name === 'string' ? o.name.trim().slice(0, 60) : ''
        const von = typeof o.von === 'string' && ZEIT_RE.test(o.von) ? o.von : ''
        const bis = typeof o.bis === 'string' && ZEIT_RE.test(o.bis) ? o.bis : ''
        if (!name || !von || !bis || bis <= von) continue
        out.push({ id: typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : `${tag}-${name}`, datum: tag, name, kategorie: 'ZAZ', von, bis, assistenz: o.assistenz !== false })
      }
    } catch { /* überspringen */ }
  }
  return out.sort((a, b) => a.datum.localeCompare(b.datum) || a.von.localeCompare(b.von))
}

export const FRITZ = 'Fritz Fahrländer'

/** Ab 2027 arbeitet Fritz nur in Wochen, in denen er Ferienvertretung ist:
 *  Dienstag und Donnerstag 13 bis 17 Uhr mit Assistenz. */
export const VERTRETUNGSWOCHE = { wochentage: [2, 4], von: '13:00', bis: '17:00' } as const

const addTage = (datum: string, n: number) => {
  const d = new Date(`${datum}T12:00:00`); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Einsätze in den Wochen der angegebenen Vertretungstage: pro Woche Dienstag
 *  und Donnerstag 13 bis 17 Uhr, Feiertage fallen weg, nach Datum sortiert. */
export function vertretungsEinsaetze(name: string, vertretungsTage: string[]): Einsatz[] {
  const montage = Array.from(new Set(vertretungsTage.map(montagVon))).sort()
  const out: Einsatz[] = []
  for (const montag of montage) {
    for (const wt of VERTRETUNGSWOCHE.wochentage) {
      const tag = addTage(montag, wt - 1)
      if (istFeiertag(tag)) continue
      out.push({ id: `vt-${tag}`, datum: tag, name, kategorie: 'ZAZ', von: VERTRETUNGSWOCHE.von, bis: VERTRETUNGSWOCHE.bis, assistenz: true })
    }
  }
  return out
}
