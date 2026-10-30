// Serverseitiges Laden und Aufbereiten der Wochenplanung 2027: Farben,
// Anspruch Anpassungen, Regeln, Personenregeln, Einsätze, Standardwochen,
// Vertretungen und Abwesenheiten aus zeiterfassung_comments und
// work_schedule, daraus die Kapazität pro Woche.
// Die Datengrenze für Mitarbeitende liegt in wochenFuerMitarbeiter: nur
// Zahlen und der eigene Status, keine Namen oder IDs anderer Personen.

import type { SupabaseClient } from '@supabase/supabase-js'
import { PLAN_YEAR, type FerienWunsch } from './ferien-wuensche'
import { round2 } from './ferien'
import { arbeitstageBetween } from './feiertage'
import {
  WOCHENFARBE_KEY, ANSPRUCH_PREFIX, parseWochenfarben, parseAnspruchRows, wochen2027, wochenTage, wunschKosten, kategorieFuer,
  type WochenFarbe, type Woche, type Person, type Eintrag, type Kategorie, type Belegt, ferientageZaehlen, type FerienTag,
} from './ferien-wochen'
import {
  REGELN_KEY, PERSON_PREFIX, EINSATZ_KEY, parseRegeln, parsePersonRows, parseEinsatzRows, personRegelFuer,
  type Regeln, type PersonRegel, type Einsatz,
} from './ferien-regeln'
import { kapazitaetFuer, nurAkzeptiert, tagesVerfuegbarkeit, verletzungenFuer, zweiWochenAmStueck, arbeitetLautStandardwoche, type Kontext, type Assistenz, type Personalstand, type StandardWeek, type TagStatus } from './ferien-kapazitaet'
import { getStandardWeeks } from './plan-standards'
import { VERTRETUNG_PREFIX, parseVertretungRows, vertretungMap } from './ferien-vertretung'

const KONFIG_ANCHOR = `${PLAN_YEAR}-01-01`
const escLike = (s: string) => s.replace(/_/g, '\\_')

export type WochenKonfig = { farben: Record<string, WochenFarbe>; anspruch: Record<string, number | null> }

export async function ladeWochenKonfig(client: SupabaseClient): Promise<WochenKonfig> {
  const [{ data: farben }, { data: anspruch }] = await Promise.all([
    client.from('zeiterfassung_comments').select('user_full_name, schedule_date, comment').eq('user_full_name', WOCHENFARBE_KEY),
    client.from('zeiterfassung_comments').select('user_full_name, comment').like('user_full_name', `${escLike(ANSPRUCH_PREFIX)}%`),
  ])
  return {
    farben: parseWochenfarben((farben ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>),
    anspruch: parseAnspruchRows((anspruch ?? []) as Array<{ user_full_name: string; comment: string }>),
  }
}

/** Abwesenheiten im Planungsjahr (F, F:x, UF, WB, KO, ÜK, K, U), paginiert.
 *  Nur für die Kapazitätsrechnung auf dem Server, nie an den Browser. */
export async function ladeAbwesenheiten(client: SupabaseClient): Promise<Eintrag[]> {
  const out: Eintrag[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await client.from('work_schedule').select('employee_id, schedule_date, entry')
      .or('entry.eq.F,entry.like.F:*,entry.eq.UF,entry.eq.WB,entry.eq.KO,entry.eq.ÜK,entry.eq.K,entry.eq.U')
      .gte('schedule_date', `${PLAN_YEAR}-01-01`).lte('schedule_date', `${PLAN_YEAR}-12-31`)
      .order('schedule_date').order('employee_id').range(from, from + 999)
    if (!data || data.length === 0) break
    out.push(...(data as Eintrag[]))
    if (data.length < 1000) break
  }
  return out
}

export type FerienKontext = Kontext & {
  konfig: WochenKonfig
  wochen: Woche[]
  /** Gespeicherte Personenregeln (ohne Standardwerte), für den Dialog */
  personRegelnGespeichert: Record<string, PersonRegel>
}

/** Alles, was die Kapazitätsrechnung braucht. personen = aktive
 *  Mitarbeitende der Planung, wishes = alle Wünsche und Wochenanmeldungen. */
export async function ladeFerienKontext(client: SupabaseClient, personen: Person[], wishes: FerienWunsch[]): Promise<FerienKontext> {
  const [konfig, { data: regelnRow }, { data: personRows }, { data: einsatzRows }, standardwochen, { data: vtRows }, eintraege] = await Promise.all([
    ladeWochenKonfig(client),
    client.from('zeiterfassung_comments').select('comment').eq('user_full_name', REGELN_KEY).eq('schedule_date', KONFIG_ANCHOR).maybeSingle(),
    client.from('zeiterfassung_comments').select('user_full_name, comment').like('user_full_name', `${escLike(PERSON_PREFIX)}%`),
    client.from('zeiterfassung_comments').select('user_full_name, schedule_date, comment').eq('user_full_name', EINSATZ_KEY).gte('schedule_date', `${PLAN_YEAR}-01-01`).lte('schedule_date', `${PLAN_YEAR}-12-31`),
    getStandardWeeks(client),
    client.from('zeiterfassung_comments').select('user_full_name, schedule_date, comment').like('user_full_name', `${escLike(VERTRETUNG_PREFIX)}%`),
    ladeAbwesenheiten(client),
  ])
  const regeln: Regeln = parseRegeln((regelnRow as { comment: string } | null)?.comment)
  const gespeichert = parsePersonRows((personRows ?? []) as Array<{ user_full_name: string; comment: string }>)
  const personRegeln: Record<string, PersonRegel> = {}
  for (const p of personen) personRegeln[p.id] = personRegelFuer(p, gespeichert[p.id])
  const relevante: Record<string, StandardWeek> = {}
  for (const p of personen) if (standardwochen[p.id]) relevante[p.id] = standardwochen[p.id]
  return {
    regeln, personen, personRegeln, standardwochen: relevante,
    vertretungen: vertretungMap(parseVertretungRows((vtRows ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>)),
    einsaetze: parseEinsatzRows((einsatzRows ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>),
    eintraege, wishes,
    konfig, wochen: wochen2027(konfig.farben), personRegelnGespeichert: gespeichert,
  }
}

// ── Admins und Laura: alles mit Namen ───────────────────────────────────

export type BelegtAnsicht = Belegt & { name: string; vertreten: boolean; verletzungen: string[]; gruppe: string | null }
export type TagAnsicht = { datum: string; zaz: string[]; zazHalb: string[]; dhpa: string[]; zazWeg: string[]; dhpaWeg: string[]; bedarf: number }
export type WocheAdmin = Omit<Woche, 'arbeitstage'> & {
  arbeitstage: number
  belegung: Record<Kategorie, BelegtAnsicht[]>
  plaetze: { ZAZ: number; DHPA: number }
  /** Höchste Zahl Abwesender an einem Tag (gegen die Plätze), offene und akzeptierte */
  plaetzeBelegt: { ZAZ: number; DHPA: number }
  /** Dasselbe nur mit akzeptierten Anmeldungen und Einträgen im Arbeitsplan */
  plaetzeAkzeptiert: { ZAZ: number; DHPA: number }
  /** Assistenz in Tagen, offene und akzeptierte Anmeldungen */
  assistenz: Assistenz
  /** Assistenz in Tagen nur mit akzeptierten Anmeldungen */
  assistenzAkzeptiert: Assistenz
  tage: TagAnsicht[]
  einsaetze: Einsatz[]
  warnungen: string[]
  personalstand: Personalstand
}

export function wochenFuerAdmin(ctx: FerienKontext): WocheAdmin[] {
  const nameById = new Map(ctx.personen.map(p => [p.id, p.full_name]))
  const ctxAkzeptiert = nurAkzeptiert(ctx)
  return ctx.wochen.map(w => {
    const k = kapazitaetFuer(ctx, w)
    const kA = kapazitaetFuer(ctxAkzeptiert, w)
    const zaehlend = new Set(k.zazZaehlend.map(b => b.employeeId))
    const belegung = {} as Record<Kategorie, BelegtAnsicht[]>
    for (const kat of ['ZAZ', 'DHPA', 'ASSISTENZ'] as Kategorie[]) {
      belegung[kat] = (k.belegung.get(kat) ?? []).map(b => {
        const wunsch = b.art !== 'eingetragen' ? ctx.wishes.find(x => x.employeeId === b.employeeId && x.from === b.from) : undefined
        return {
          ...b, name: nameById.get(b.employeeId) ?? '',
          vertreten: kat === 'ZAZ' && !zaehlend.has(b.employeeId),
          verletzungen: wunsch && wunsch.status === 'offen' && wunsch.quelle === 'woche' ? verletzungenFuer(ctx, w, wunsch) : [],
          gruppe: wunsch?.gruppe ?? null,
        }
      })
    }
    const { arbeitstage, ...rest } = w
    return {
      ...rest, arbeitstage: arbeitstage.length, belegung, plaetze: k.plaetze, plaetzeBelegt: k.plaetzeBelegt, plaetzeAkzeptiert: kA.plaetzeBelegt, assistenz: k.assistenz, assistenzAkzeptiert: kA.assistenz,
      tage: k.tage.map(t => ({ datum: t.datum, zaz: t.zaz.map(a => a.art === 'person' ? a.name : `${a.name} (${a.art === 'vertretung' ? 'Vertretung' : a.art === 'einsatz' ? 'Einsatz' : 'Platzhalter'})`), zazHalb: t.zazHalb.map(e => `${e.name} ${e.von.replace(':', '.')} bis ${e.bis.replace(':', '.')} Uhr`), dhpa: t.dhpa.map(a => a.art === 'person' ? a.name : `${a.name} (Platzhalter)`), zazWeg: t.zazWegNamen, dhpaWeg: t.dhpaWegNamen, bedarf: t.bedarf })),
      einsaetze: ctx.einsaetze.filter(e => e.datum >= w.montag && e.datum <= w.freitag),
      warnungen: k.warnungen, personalstand: k.personalstand,
    }
  })
}

/** Zwei Wochen am Stück pro Person (alle ausser Valérie), für den Planungsstand. */
export function zweiWochenProPerson(ctx: FerienKontext): Record<string, boolean | null> {
  const out: Record<string, boolean | null> = {}
  for (const p of ctx.personen) {
    out[p.id] = p.full_name.startsWith('Valérie') ? null : zweiWochenAmStueck(p.id, ctx.wochen, ctx.eintraege, ctx.wishes, t => arbeitetLautStandardwoche(ctx, p.id, t)).ok
  }
  return out
}

// ── Mitarbeitende: nur Zahlen und eigene Daten ──────────────────────────

export type MeinWochenStatus = { status: 'offen' | 'akzeptiert' | 'abgelehnt' | 'eingetragen'; art: 'woche' | 'wunsch' | 'eingetragen'; from: string; grund: string | null; gruppe: string | null }
export type Empfehlung = { ja: boolean; grund: string | null }

/** Empfehlung für die Assistenz: Wochen mit viel Spielraum, nach allen
 *  Anmeldungen noch Platz für mindestens zwei weitere Personen. Der Grund
 *  nennt, warum: Behandler abwesend (weniger Assistenz nötig) oder einfach
 *  viel Personal. Die Gegenrichtung (zu viele DA weg, während die
 *  Behandler da sind) sperrt pruefeAnmeldung, sobald das Angebot nicht
 *  mehr reicht. */
export function empfehlungAssistenz(k: ReturnType<typeof kapazitaetFuer>, w: Woche, kat: Kategorie | null): Empfehlung {
  if (kat !== 'ASSISTENZ' || w.farbe === 'rot' || w.arbeitstage.length === 0 || k.assistenz.freiPersonen < 2) return { ja: false, grund: null }
  const behandlerWeg = k.tage.filter(t => t.zazWeg > 0 || t.dhpaWeg > 0).length
  return { ja: true, grund: behandlerWeg > 0 ? `Behandler abwesend an ${behandlerWeg} ${behandlerWeg === 1 ? 'Tag' : 'Tagen'}, weniger Assistenz nötig` : 'Viel Personal in dieser Woche' }
}

export type WocheZahlen = Omit<Woche, 'arbeitstage'> & {
  arbeitstage: number
  /** Plätze pro Kategorie, ohne Namen: ZAZ und DH / PA die Plätze der Farbe
   *  pro Tag, belegt = höchste Zahl Abwesender an einem Tag (offene und
   *  akzeptierte Anmeldungen und Einträge im Arbeitsplan, wer zuerst kommt,
   *  hat den Platz), frei = Plätze minus belegt. Assistenz: belegt =
   *  Personen mit Anmeldung in der Woche, frei = geschätzte weitere Plätze
   *  nach Bedarf und Angebot, plaetze = beides zusammen. */
  zaehler: Record<Kategorie, { plaetze: number; belegt: number; frei: number }>
  /** Assistenz: Woche mit viel Spielraum, Ferien erwünscht */
  empfohlen: Empfehlung
  /** Ferientage, die diese Woche für mich zählt */
  tage: number
  mein: MeinWochenStatus | null
  /** Kann ich mich (nach den Regeln) für mindestens einen Tag dieser Woche anmelden? */
  moeglich: boolean
  /** Erster Grund, wenn nicht */
  nichtMoeglich: string | null
  /** Pro Arbeitstag: ist dieser Tag für mich noch frei? */
  tageStatus: TagStatus[]
  /** Assistenz: freie Tage in dieser Woche (für die Summe der gewählten Tage) */
  assistenzFrei: number | null
}

export function wochenFuerMitarbeiter(ctx: FerienKontext, ich: Person): WocheZahlen[] {
  const kat = kategorieFuer(ich.job_title)
  const eigene = ctx.wishes.filter(w => w.employeeId === ich.id)
  return ctx.wochen.map(w => {
    const k = kapazitaetFuer(ctx, w)
    const platz = (x: 'ZAZ' | 'DHPA') => ({ plaetze: k.plaetze[x], belegt: k.plaetzeBelegt[x], frei: Math.max(0, k.plaetze[x] - k.plaetzeBelegt[x]) })
    const assBelegt = (k.belegung.get('ASSISTENZ') ?? []).length
    const assFrei = w.farbe === 'rot' ? 0 : k.assistenz.freiPersonen
    const zaehler: WocheZahlen['zaehler'] = { ZAZ: platz('ZAZ'), DHPA: platz('DHPA'), ASSISTENZ: { plaetze: assBelegt + assFrei, belegt: assBelegt, frei: assFrei } }
    const empfohlen = empfehlungAssistenz(k, w, kat)
    let mein: MeinWochenStatus | null = null
    for (const l of Array.from(k.belegung.values())) {
      const b = l.find(x => x.employeeId === ich.id)
      if (b) { const wunsch = b.art !== 'eingetragen' ? eigene.find(x => x.from === b.from) : undefined; mein = { status: b.art === 'eingetragen' ? 'eingetragen' : b.status, art: b.art, from: b.from, grund: null, gruppe: wunsch?.gruppe ?? null } }
    }
    if (!mein) {
      const ab = eigene.find(x => x.status === 'abgelehnt' && x.quelle === 'woche' && x.from === w.montag)
      if (ab) mein = { status: 'abgelehnt', art: 'woche', from: ab.from, grund: ab.grund ?? null, gruppe: ab.gruppe ?? null }
    }
    let moeglich = false, nichtMoeglich: string | null = null
    let tageStatus: TagStatus[] = []
    if (kat && (!mein || mein.status === 'abgelehnt')) {
      tageStatus = tagesVerfuegbarkeit(ctx, w, ich)
      moeglich = tageStatus.some(t => t.moeglich)
      nichtMoeglich = moeglich ? null : (tageStatus.find(t => t.grund)?.grund ?? 'Keine Tage frei')
    } else if (!kat) nichtMoeglich = 'Für deine Kategorie gibt es keine Wochenanmeldung'
    const { arbeitstage, ...rest } = w
    return { ...rest, arbeitstage: arbeitstage.length, zaehler, empfohlen, tage: wochenTage(w, ich.pensum), mein, moeglich, nichtMoeglich, tageStatus, assistenzFrei: kat === 'ASSISTENZ' ? Math.max(0, k.assistenz.frei) : null }
  })
}

/** Eigene Ferientage im Planungsjahr: akzeptiert (F im Arbeitsplan, ein
 *  F zählt einen Tag, F:x sein Gewicht), angemeldet (offene
 *  Wochenanmeldungen und offene Ferienwünsche, gewählte Tage je ein Tag). */
export function meineTage(eintraege: Eintrag[], wishes: FerienWunsch[], meinId: string, pensum: number | null | undefined, wochen: Woche[], ausnahme?: (datum: string) => boolean) {
  const fTage: FerienTag[] = []
  for (const e of eintraege) {
    if (e.employee_id !== meinId || !e.schedule_date.startsWith(String(PLAN_YEAR))) continue
    if (!(e.entry === 'F' || e.entry.startsWith('F:'))) continue
    if (ausnahme?.(e.schedule_date)) continue
    fTage.push({ datum: e.schedule_date, gewicht: e.entry.startsWith('F:') ? parseFloat(e.entry.slice(2)) || 1 : 1 })
  }
  // Teilzeit: eine ganze Woche F zählt nach Pensum (40 Prozent = 2 Tage)
  const akzeptiert = ferientageZaehlen(fTage, pensum)
  let angemeldet = 0
  const byMontag = new Map(wochen.map(w => [w.montag, w]))
  for (const w of wishes) {
    if (w.employeeId !== meinId || w.status !== 'offen' || w.art !== 'ferien') continue
    angemeldet += wunschKosten(w, w.quelle === 'woche' ? byMontag.get(w.from) : undefined, pensum)
  }
  return { akzeptiert: round2(akzeptiert), angemeldet: round2(angemeldet) }
}

/** Kategorie einer Person; Admins und andere ohne Kategorie können sich nicht anmelden. */
export const kannWochenAnmelden = (jobTitle: string | null | undefined) => kategorieFuer(jobTitle) !== null
