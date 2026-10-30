// Aufgaben Zeiterfassung von Bianka auf «Meine Stempeluhr»: Kategorien mit
// Aufgaben, Zeiteinträge pro Tag (Datum, Dauer in Minuten, Notiz) und die
// Auswertung pro Woche, Monat oder Jahr mit einem Text, welche Aufgabe am
// meisten Zeit braucht. Nur für Bianka (darfAufgabenZeit), kein anderer
// Admin. Speicherung in zeiterfassung_comments:
//   __aufgaben_konfig__ @ 2000-01-01 → { kategorien: [{ id, name, aufgaben: [{ id, titel, archiviert }] }] }
//   __aufgaben_zeit__   @ <Datum>    → { eintraege: [{ id, aufgabeId, minuten, notiz, erfasst }] }
// Reine Logik ohne React, damit sie getestet werden kann.

import type { SupabaseClient } from '@supabase/supabase-js'
import { PRAXIS } from '@/config/praxis'

export const AUFGABEN_KONFIG_KEY = '__aufgaben_konfig__'
export const AUFGABEN_KONFIG_ANCHOR = '2000-01-01'
export const AUFGABEN_ZEIT_KEY = '__aufgaben_zeit__'
export const AUFGABEN_INHABERIN = PRAXIS.portalAdmin
export const NOTIZ_MAX = 200
export const NAME_MAX = 60
export const MINUTEN_MAX = 24 * 60

export const darfAufgabenZeit = (role: string | null | undefined, fullName: string | null | undefined) =>
  role === 'admin' && (fullName ?? '') === AUFGABEN_INHABERIN

export type Aufgabe = { id: string; titel: string; archiviert: boolean }
export type AufgabenKategorie = { id: string; name: string; aufgaben: Aufgabe[] }
export type AufgabenKonfig = { kategorien: AufgabenKategorie[] }
export type ZeitEintrag = { id: string; datum: string; aufgabeId: string; minuten: number; notiz: string | null; erfasst: string }

const ID_RE = /^[a-z0-9]{4,24}$/
export const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/
export const istId = (s: unknown): s is string => typeof s === 'string' && ID_RE.test(s)
export const neueId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 20)

// ── Parsen und Bereinigen ───────────────────────────────────────────────

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** Konfiguration aus Benutzereingabe oder Datenbank bereinigen: gültige
 *  Ids, Namen ohne Leerzeichen am Rand, keine Dubletten, Grenzen. null, wenn
 *  die Struktur nicht stimmt. */
export function konfigBereinigen(input: unknown): AufgabenKonfig | null {
  if (!input || typeof input !== 'object') return null
  const roh = (input as { kategorien?: unknown }).kategorien
  if (!Array.isArray(roh)) return null
  const ids = new Set<string>()
  const kategorien: AufgabenKategorie[] = []
  for (const k of roh.slice(0, 40)) {
    if (!k || typeof k !== 'object') continue
    const { id, name, aufgaben } = k as { id?: unknown; name?: unknown; aufgaben?: unknown }
    const kname = text(name, NAME_MAX)
    if (!istId(id) || !kname || ids.has(id)) continue
    ids.add(id)
    const liste: Aufgabe[] = []
    for (const a of (Array.isArray(aufgaben) ? aufgaben : []).slice(0, 80)) {
      if (!a || typeof a !== 'object') continue
      const { id: aid, titel, archiviert } = a as { id?: unknown; titel?: unknown; archiviert?: unknown }
      const t = text(titel, NAME_MAX)
      if (!istId(aid) || !t || ids.has(aid)) continue
      ids.add(aid)
      liste.push({ id: aid, titel: t, archiviert: archiviert === true })
    }
    kategorien.push({ id, name: kname, aufgaben: liste })
  }
  return { kategorien }
}

export function parseKonfig(comment: string | null | undefined): AufgabenKonfig {
  if (!comment) return { kategorien: [] }
  try { return konfigBereinigen(JSON.parse(comment)) ?? { kategorien: [] } } catch { return { kategorien: [] } }
}

/** Einträge eines Tages aus dem gespeicherten JSON */
export function parseTag(datum: string, comment: string | null | undefined): ZeitEintrag[] {
  if (!comment) return []
  try {
    const j = JSON.parse(comment) as { eintraege?: unknown }
    if (!Array.isArray(j.eintraege)) return []
    const out: ZeitEintrag[] = []
    for (const e of j.eintraege) {
      if (!e || typeof e !== 'object') continue
      const { id, aufgabeId, minuten, notiz, erfasst } = e as Record<string, unknown>
      if (!istId(id) || !istId(aufgabeId) || typeof minuten !== 'number' || !Number.isFinite(minuten) || minuten <= 0) continue
      out.push({ id, datum, aufgabeId, minuten: Math.round(minuten), notiz: typeof notiz === 'string' && notiz.trim() ? notiz.trim().slice(0, NOTIZ_MAX) : null, erfasst: typeof erfasst === 'string' ? erfasst : '' })
    }
    return out
  } catch { return [] }
}

export function parseZeitRows(rows: Array<{ schedule_date: string; comment: string }>): ZeitEintrag[] {
  return rows.flatMap(r => parseTag(r.schedule_date, r.comment)).sort((a, b) => a.datum.localeCompare(b.datum) || a.erfasst.localeCompare(b.erfasst))
}

/** JSON eines Tages für die Datenbank (ohne das Datum, das steht in der Zeile) */
export const tagZuJson = (eintraege: ZeitEintrag[]) =>
  JSON.stringify({ eintraege: eintraege.map(({ id, aufgabeId, minuten, notiz, erfasst }) => ({ id, aufgabeId, minuten, notiz, erfasst })) })

export async function ladeAufgabenZeit(client: SupabaseClient): Promise<{ konfig: AufgabenKonfig; eintraege: ZeitEintrag[] }> {
  const [{ data: k }, { data: rows }] = await Promise.all([
    client.from('zeiterfassung_comments').select('comment').eq('user_full_name', AUFGABEN_KONFIG_KEY).eq('schedule_date', AUFGABEN_KONFIG_ANCHOR).maybeSingle(),
    client.from('zeiterfassung_comments').select('schedule_date, comment').eq('user_full_name', AUFGABEN_ZEIT_KEY).order('schedule_date', { ascending: true }).limit(5000),
  ])
  return {
    konfig: parseKonfig((k as { comment: string } | null)?.comment),
    eintraege: parseZeitRows((rows ?? []) as Array<{ schedule_date: string; comment: string }>),
  }
}

// ── Datum und Perioden (nur Datumstexte, ohne Zeitzonen) ────────────────

export const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
export const WOCHENTAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
const d2 = (n: number) => String(n).padStart(2, '0')
const utc = (d: string) => new Date(`${d}T00:00:00Z`)

export function addTage(d: string, n: number): string {
  const t = utc(d); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10)
}
/** 0 = Montag … 6 = Sonntag */
export const wochentagIndex = (d: string) => (utc(d).getUTCDay() + 6) % 7
export const montagVon = (d: string) => addTage(d, -wochentagIndex(d))
export function isoKw(d: string): number {
  const t = utc(d)
  t.setUTCDate(t.getUTCDate() - wochentagIndex(d) + 3)
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((t.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)
}
export const fmtDatum = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`
export const fmtKurz = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`
export const fmtDatumLang = (d: string) => `${WOCHENTAGE[wochentagIndex(d)]}, ${fmtDatum(d)}`

export type PeriodeArt = 'woche' | 'monat' | 'jahr'
export const PERIODE_LABEL: Record<PeriodeArt, string> = { woche: 'Woche', monat: 'Monat', jahr: 'Jahr' }
export type Periode = { art: PeriodeArt; von: string; bis: string; label: string; satzanfang: string }

export function periodeFuer(datum: string, art: PeriodeArt): Periode {
  const y = parseInt(datum.slice(0, 4), 10), m = parseInt(datum.slice(5, 7), 10)
  if (art === 'woche') {
    const von = montagVon(datum), bis = addTage(von, 6), kw = isoKw(von)
    return { art, von, bis, label: `KW ${kw}, ${fmtKurz(von)} bis ${fmtDatum(bis)}`, satzanfang: `In der KW ${kw} (${fmtKurz(von)} bis ${fmtDatum(bis)})` }
  }
  if (art === 'monat') {
    const von = `${y}-${d2(m)}-01`
    const bis = addTage(m === 12 ? `${y + 1}-01-01` : `${y}-${d2(m + 1)}-01`, -1)
    return { art, von, bis, label: `${MONATE[m - 1]} ${y}`, satzanfang: `Im ${MONATE[m - 1]} ${y}` }
  }
  return { art, von: `${y}-01-01`, bis: `${y}-12-31`, label: String(y), satzanfang: `Im Jahr ${y}` }
}

/** Bezugsdatum um delta Perioden verschieben (Woche, Monat oder Jahr) */
export function periodeVerschieben(datum: string, art: PeriodeArt, delta: number): string {
  const y = parseInt(datum.slice(0, 4), 10), m = parseInt(datum.slice(5, 7), 10)
  if (art === 'woche') return addTage(montagVon(datum), 7 * delta)
  if (art === 'monat') { const idx = y * 12 + (m - 1) + delta; return `${Math.floor(idx / 12)}-${d2((idx % 12) + 1)}-01` }
  return `${y + delta}-01-01`
}

// ── Dauer ───────────────────────────────────────────────────────────────

/** «45 Min.», «2 Std.», «2 Std. 15 Min.» */
export function fmtDauer(minuten: number): string {
  const m = Math.max(0, Math.round(minuten))
  const h = Math.floor(m / 60), r = m % 60
  if (h === 0) return `${r} Min.`
  return r === 0 ? `${h} Std.` : `${h} Std. ${r} Min.`
}
/** «2:15» für Tabellen */
export const fmtDauerKurz = (minuten: number) => `${Math.floor(Math.max(0, minuten) / 60)}:${d2(Math.max(0, Math.round(minuten)) % 60)}`

// ── Auswertung ──────────────────────────────────────────────────────────

export type AufgabeInfo = { id: string; titel: string; archiviert: boolean; kategorieId: string; kategorie: string }
export const GELOESCHT_ID = 'geloescht'

/** Aufgabe-Id → Titel und Kategorie */
export function aufgabenIndex(konfig: AufgabenKonfig): Map<string, AufgabeInfo> {
  const m = new Map<string, AufgabeInfo>()
  for (const k of konfig.kategorien) for (const a of k.aufgaben) m.set(a.id, { id: a.id, titel: a.titel, archiviert: a.archiviert, kategorieId: k.id, kategorie: k.name })
  return m
}

export type AuswertungAufgabe = { id: string; titel: string; kategorie: string; kategorieId: string; minuten: number; anteil: number; anzahl: number }
export type AuswertungKategorie = { id: string; name: string; minuten: number; anteil: number; aufgaben: AuswertungAufgabe[] }
export type Auswertung = {
  von: string; bis: string
  total: number
  anzahl: number
  /** Tage mit mindestens einem Eintrag */
  tage: number
  kategorien: AuswertungKategorie[]
  /** Alle Aufgaben, grösste zuerst */
  top: AuswertungAufgabe[]
  /** Minuten pro Tag im Zeitraum (nur Tage mit Einträgen) */
  proTag: Array<{ datum: string; minuten: number }>
}

const anteilVon = (teil: number, ganz: number) => (ganz > 0 ? Math.round((teil / ganz) * 100) : 0)

export function auswerten(eintraege: ZeitEintrag[], konfig: AufgabenKonfig, von: string, bis: string): Auswertung {
  const index = aufgabenIndex(konfig)
  const drin = eintraege.filter(e => e.datum >= von && e.datum <= bis)
  const total = drin.reduce((s, e) => s + e.minuten, 0)
  const proAufgabe = new Map<string, AuswertungAufgabe>()
  const proTagMap = new Map<string, number>()
  for (const e of drin) {
    const info = index.get(e.aufgabeId)
    const a = proAufgabe.get(e.aufgabeId) ?? {
      id: e.aufgabeId, titel: info?.titel ?? 'Gelöschte Aufgabe', kategorie: info?.kategorie ?? 'Gelöschte Aufgaben', kategorieId: info?.kategorieId ?? GELOESCHT_ID,
      minuten: 0, anteil: 0, anzahl: 0,
    }
    a.minuten += e.minuten; a.anzahl++
    proAufgabe.set(e.aufgabeId, a)
    proTagMap.set(e.datum, (proTagMap.get(e.datum) ?? 0) + e.minuten)
  }
  const top = Array.from(proAufgabe.values()).map(a => ({ ...a, anteil: anteilVon(a.minuten, total) })).sort((a, b) => b.minuten - a.minuten || a.titel.localeCompare(b.titel))
  const kat = new Map<string, AuswertungKategorie>()
  for (const a of top) {
    const k = kat.get(a.kategorieId) ?? { id: a.kategorieId, name: a.kategorie, minuten: 0, anteil: 0, aufgaben: [] }
    k.minuten += a.minuten; k.aufgaben.push(a)
    kat.set(a.kategorieId, k)
  }
  const kategorien = Array.from(kat.values()).map(k => ({ ...k, anteil: anteilVon(k.minuten, total) })).sort((a, b) => b.minuten - a.minuten || a.name.localeCompare(b.name))
  const proTag = Array.from(proTagMap.entries()).map(([datum, minuten]) => ({ datum, minuten })).sort((a, b) => a.datum.localeCompare(b.datum))
  return { von, bis, total, anzahl: drin.length, tage: proTag.length, kategorien, top, proTag }
}

/** Der Absatz über der Auswertung: welche Aufgabe am meisten Zeit nimmt */
export function zusammenfassung(a: Auswertung, periode: Periode): string {
  if (a.total === 0) return `${periode.satzanfang} hast du noch keine Zeit erfasst.`
  const [t1, t2, t3] = a.top
  const teile: string[] = []
  teile.push(`${periode.satzanfang} hast du insgesamt ${fmtDauer(a.total)} an ${a.tage} ${a.tage === 1 ? 'Tag' : 'Tagen'} mit ${a.anzahl} ${a.anzahl === 1 ? 'Eintrag' : 'Einträgen'} erfasst.`)
  teile.push(`Am meisten Zeit nimmt «${t1.titel}» (${t1.kategorie}) mit ${fmtDauer(t1.minuten)}, das sind ${t1.anteil} % der erfassten Zeit.`)
  if (t2) {
    const w = (t: AuswertungAufgabe) => `«${t.titel}» mit ${fmtDauer(t.minuten)} (${t.anteil} %)`
    teile.push(t3 ? `Danach folgen ${w(t2)} und ${w(t3)}.` : `Danach folgt ${w(t2)}.`)
  }
  if (a.kategorien.length > 1) {
    const k = a.kategorien[0]
    teile.push(`Nach Kategorien liegt «${k.name}» mit ${fmtDauer(k.minuten)} (${k.anteil} %) vorne.`)
  }
  if (a.tage > 1) teile.push(`Im Schnitt sind das ${fmtDauer(a.total / a.tage)} pro Tag mit Einträgen.`)
  return teile.join(' ')
}

/** Summe eines Tages */
export const tagesSumme = (eintraege: ZeitEintrag[], datum: string) => eintraege.filter(e => e.datum === datum).reduce((s, e) => s + e.minuten, 0)

/** Zuletzt erfasste Aufgaben, neueste zuerst, ohne Dubletten */
export function zuletztVerwendet(eintraege: ZeitEintrag[], n: number): string[] {
  const out: string[] = []
  for (const e of [...eintraege].sort((a, b) => b.erfasst.localeCompare(a.erfasst) || b.datum.localeCompare(a.datum))) {
    if (!out.includes(e.aufgabeId)) out.push(e.aufgabeId)
    if (out.length >= n) break
  }
  return out
}

/** Die am häufigsten erfassten Aufgaben (Anzahl Einträge, bei Gleichstand
 *  mehr Minuten zuerst), für die Schnellknöpfe */
export function haeufigsteAufgaben(eintraege: ZeitEintrag[], n: number): Array<{ id: string; anzahl: number; minuten: number }> {
  const m = new Map<string, { id: string; anzahl: number; minuten: number }>()
  for (const e of eintraege) {
    const x = m.get(e.aufgabeId) ?? { id: e.aufgabeId, anzahl: 0, minuten: 0 }
    x.anzahl++; x.minuten += e.minuten
    m.set(e.aufgabeId, x)
  }
  return Array.from(m.values()).sort((a, b) => b.anzahl - a.anzahl || b.minuten - a.minuten || a.id.localeCompare(b.id)).slice(0, n)
}

/** Einträge pro Aufgabe (für den Löschschutz in der Verwaltung) */
export function anzahlProAufgabe(eintraege: ZeitEintrag[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of eintraege) m.set(e.aufgabeId, (m.get(e.aufgabeId) ?? 0) + 1)
  return m
}
