// Serverseitiges Laden des Fotobingos (Admin Client). Die Datengrenze liegt
// hier: an den Browser gehen während des Spiels nur die eigene Karte mit den
// eigenen Fotos und von den anderen Teams der Teamname und je Feld ein
// Ja oder Nein (Foto vorhanden). Fotos, Punkte und Entscheide anderer Teams
// erhalten nur die Jury, alle Fotos ab dem Zeitpunkt sichtbarAb, die
// Rangliste erst nach «Resultate veröffentlichen».

import type { SupabaseClient } from '@supabase/supabase-js'
import { TE_BUCKET, TE_ORDNER_PREFIX, TE_ANCHOR, escLike, parseOrdner, darfOrdnerSehen, type TeOrdner } from './teamevents'
import { ladeTeam, type TeamPerson, type Row } from './teamevents-data'
import { rufname } from './teamevent-europapark'
import {
  BINGO_ANCHOR, BINGO_LIKE_PREFIX, bingoKey, bingoTeamsKey, bingoWertungKey, bingoJuryKey, bingoThumbPfad, hatBingo,
  parseEinstellungen, parseTeams, parseBingoFotos, parseWertung, parseJury, parseLogs, startTeams, offeneZuordnen, teamName, teamVon,
  aufgabenMit, bingoRolle, darfBingoSehen, bingoPhase, kartenSichtbar, uploadErlaubt, spielregeln, punkteFuer, punkteAnsicht, rangliste,
  BINGO_LAYOUT, BINGO_FREI_ID, LEERE_WERTUNG,
  type BingoEinstellungen, type BingoTeam, type BingoFoto, type BingoRolle, type BingoAufgabe, type TeamWertung, type BingoJury, type LogEintrag, type PunkteAnsicht,
} from './teamevent-bingo'

export type BingoViewer = { id: string; name: string; role: string | null | undefined }

/** Alle Bingo Zeilen eines Anlasses, paginiert (ein Request liefert
 *  höchstens 1000 Zeilen, die Fotos können darüber liegen). */
export async function ladeBingoRows(admin: SupabaseClient, slug: string): Promise<Row[]> {
  const muster = `${escLike(BINGO_LIKE_PREFIX)}%${escLike(slug)}%`
  const out: Row[] = []
  for (let von = 0; ; von += 1000) {
    const { data, error } = await admin.from('zeiterfassung_comments')
      .select('user_full_name, schedule_date, comment')
      .like('user_full_name', muster)
      .order('user_full_name').order('schedule_date').range(von, von + 999)
    if (error) throw new Error(`Bingo konnte nicht geladen werden: ${error.message}`)
    const rows = (data ?? []) as Row[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

export async function ladeEinstellungen(admin: SupabaseClient, slug: string): Promise<BingoEinstellungen> {
  const { data } = await admin.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', bingoKey(slug)).eq('schedule_date', BINGO_ANCHOR).maybeSingle()
  return parseEinstellungen((data as { comment: string } | null)?.comment)
}

export async function speichereEinstellungen(admin: SupabaseClient, slug: string, e: BingoEinstellungen): Promise<string | null> {
  const am = new Date().toISOString()
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: bingoKey(slug), schedule_date: BINGO_ANCHOR, comment: JSON.stringify(e), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error?.message ?? null
}

export async function speichereTeams(admin: SupabaseClient, slug: string, teams: BingoTeam[]): Promise<string | null> {
  const am = new Date().toISOString()
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: bingoTeamsKey(slug), schedule_date: BINGO_ANCHOR, comment: JSON.stringify({ teams }), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error?.message ?? null
}

/** Teams laden; beim ersten Aufruf aus der Vorbelegung anlegen, offene
 *  Vornamen bei jedem Aufruf erneut zuordnen (ohne erneutes Lesen). */
export async function teamsOderSeed(admin: SupabaseClient, slug: string, rowsByKey: Map<string, Row>, team: TeamPerson[]): Promise<BingoTeam[]> {
  const vorhanden = parseTeams(rowsByKey.get(bingoTeamsKey(slug))?.comment)
  if (!vorhanden) {
    const neu = startTeams(team)
    await speichereTeams(admin, slug, neu)
    return neu
  }
  const { teams, geaendert } = offeneZuordnen(vorhanden, team)
  if (geaendert) await speichereTeams(admin, slug, teams)
  return teams
}

export const rowMap = (rows: Row[]) => {
  const m = new Map<string, Row>()
  for (const r of rows) m.set(r.user_full_name, r)
  return m
}

async function signiere(admin: SupabaseClient, pfade: string[], sekunden = 3600): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (let i = 0; i < pfade.length; i += 100) {
    const { data } = await admin.storage.from(TE_BUCKET).createSignedUrls(pfade.slice(i, i + 100), sekunden)
    for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl
  }
  return out
}

async function ladeOrdner(admin: SupabaseClient, slug: string): Promise<TeOrdner | undefined> {
  const { data } = await admin.from('zeiterfassung_comments').select('user_full_name, schedule_date, comment')
    .eq('user_full_name', `${TE_ORDNER_PREFIX}${slug}`).eq('schedule_date', TE_ANCHOR).maybeSingle()
  return data ? parseOrdner([data as Row]).find(o => o.slug === slug) : undefined
}

export function rufnameFuer(team: TeamPerson[]): (id: string) => string | null {
  const m = new Map(team.map(p => [p.id, p.full_name]))
  return (id: string) => { const n = m.get(id); return n ? rufname(n) : null }
}

export type FotoAnsicht = BingoFoto & { vorschauUrl: string | null; rufname: string; eigenes: boolean }
export type TeamAnsicht = { id: string; name: string; ausserKonkurrenz: boolean; mitglieder: string[]; offen: string[]; haken: string[]; anzahl: number }
export type RangAnsicht = { rang: number; teamId: string; name: string; punkte: PunkteAnsicht }
export type PreisAnsicht = { foto: FotoAnsicht; teamName: string; aufgabeTitel: string }

export type BingoDaten = {
  ordner: TeOrdner
  slug: string
  einstellungen: BingoEinstellungen
  rolle: BingoRolle
  jetzt: string
  phase: 'vor' | 'laeuft' | 'vorbei'
  kartenSichtbar: boolean
  uploadOk: { ok: true } | { ok: false; grund: string }
  aufgaben: Array<BingoAufgabe & { angepasst: boolean }>
  layout: string[]
  regeln: string[]
  meinTeam: TeamAnsicht | null
  /** Eigene Fotos (eigenes Team), mit Vorschaulinks */
  meineFotos: FotoAnsicht[]
  /** Alle Fotos aller Teams: Jury, Organisatorin, Admins im Testmodus und alle ab sichtbarAb */
  alleFotos: FotoAnsicht[] | null
  andere: TeamAnsicht[]
  /** Nur Organisatorin: alle Konten für die Teamzuteilung */
  team: TeamPerson[]
  /** Anzahl Testfotos (für den Knopf Testdaten löschen) */
  testfotos: number
  /** Nur Jury: noch zu prüfende Fotos */
  offenFotos: number | null
  /** Nach «Resultate veröffentlichen» für alle: Rangliste und Jurypreis */
  resultate: { rangliste: RangAnsicht[]; preis: PreisAnsicht | null } | null
}

function teamAnsicht(t: BingoTeam, fotos: BingoFoto[], ruf: (id: string) => string | null): TeamAnsicht {
  const haken = Array.from(new Set(fotos.filter(f => f.team === t.id).map(f => f.aufgabe))).filter(a => BINGO_LAYOUT.includes(a))
  return { id: t.id, name: teamName(t, ruf), ausserKonkurrenz: t.ausserKonkurrenz, mitglieder: t.mitglieder, offen: t.offen, haken, anzahl: haken.filter(a => a !== BINGO_FREI_ID).length }
}

function wertungen(rows: Map<string, Row>, slug: string, teams: BingoTeam[]): Map<string, TeamWertung> {
  return new Map(teams.map(t => [t.id, parseWertung(rows.get(bingoWertungKey(slug, t.id))?.comment)]))
}

function nachTeam(fotos: BingoFoto[]): Map<string, BingoFoto[]> {
  const m = new Map<string, BingoFoto[]>()
  for (const f of fotos) m.set(f.team, [...(m.get(f.team) ?? []), f])
  return m
}

function ranglisteAnsicht(teams: BingoTeam[], fotos: BingoFoto[], w: Map<string, TeamWertung>, ruf: (id: string) => string | null): RangAnsicht[] {
  return rangliste(teams, nachTeam(fotos), w).map(z => ({ rang: z.rang, teamId: z.team.id, name: teamName(z.team, ruf), punkte: punkteAnsicht(z.punkte) }))
}

/** Seite Spiele für eine Person. null = Ordner fehlt oder nicht sichtbar;
 *  { gesperrt: true } = Bingo noch nicht freigegeben. */
export async function ladeBingoSeite(admin: SupabaseClient, slug: string, viewer: BingoViewer): Promise<BingoDaten | { gesperrt: true } | null> {
  if (!hatBingo(slug)) return null
  const rolle = bingoRolle(viewer.role, viewer.name)
  const ordner = await ladeOrdner(admin, slug)
  if (!ordner || !darfOrdnerSehen(ordner, viewer.id, rolle.verwaltet)) return null
  const [rows, team] = await Promise.all([ladeBingoRows(admin, slug), ladeTeam(admin)])
  const byKey = rowMap(rows)
  const einstellungen = parseEinstellungen(byKey.get(bingoKey(slug))?.comment)
  if (!darfBingoSehen(einstellungen, rolle)) return { gesperrt: true }

  const teams = await teamsOderSeed(admin, slug, byKey, team)
  const ruf = rufnameFuer(team)
  const fotos = parseBingoFotos(rows).filter(f => f.slug === slug)
  const jetzt = new Date().toISOString()
  const offen = kartenSichtbar(einstellungen, jetzt)
  const mein = teamVon(teams, viewer.id)
  // Datengrenze: alle Fotos für Jury, Organisatorin, Admins im Testmodus und alle ab sichtbarAb
  const alleSichtbar = rolle.jury || rolle.verwaltet || (einstellungen.testmodus && rolle.admin) || offen
  const roh = alleSichtbar ? fotos : mein ? fotos.filter(f => f.team === mein.id) : []
  const urls = await signiere(admin, roh.filter(f => f.thumb).map(f => bingoThumbPfad(slug, f.team, f.aufgabe, f.id)))
  const ansicht = (f: BingoFoto): FotoAnsicht => ({
    ...f,
    vorschauUrl: f.thumb ? (urls[bingoThumbPfad(slug, f.team, f.aufgabe, f.id)] ?? null) : null,
    rufname: ruf(f.vonId) ?? f.von.split(/\s+/)[0] ?? '',
    eigenes: f.vonId === viewer.id,
  })
  const alleFotos = alleSichtbar ? roh.map(ansicht) : null
  const meineFotos: FotoAnsicht[] = mein ? roh.filter(f => f.team === mein.id).map(ansicht) : []

  let resultate: BingoDaten['resultate'] = null
  if (einstellungen.resultate) {
    const w = wertungen(byKey, slug, teams)
    const jury = parseJury(byKey.get(bingoJuryKey(slug))?.comment)
    const preisFoto = jury.preis ? fotos.find(f => f.id === jury.preis) : undefined
    const aufgaben = aufgabenMit(einstellungen.texte)
    let preis: PreisAnsicht | null = null
    if (preisFoto) {
      const pt = teams.find(t => t.id === preisFoto.team)
      const purl = preisFoto.thumb ? (urls[bingoThumbPfad(slug, preisFoto.team, preisFoto.aufgabe, preisFoto.id)] ?? (await signiere(admin, [bingoThumbPfad(slug, preisFoto.team, preisFoto.aufgabe, preisFoto.id)]))[bingoThumbPfad(slug, preisFoto.team, preisFoto.aufgabe, preisFoto.id)] ?? null) : null
      preis = { foto: { ...ansicht(preisFoto), vorschauUrl: purl }, teamName: pt ? teamName(pt, ruf) : '', aufgabeTitel: aufgaben.find(a => a.id === preisFoto.aufgabe)?.titel ?? preisFoto.aufgabe }
    }
    resultate = { rangliste: ranglisteAnsicht(teams, fotos, w, ruf), preis }
  }

  return {
    ordner, slug, einstellungen, rolle, jetzt,
    phase: bingoPhase(einstellungen, jetzt),
    kartenSichtbar: offen,
    uploadOk: uploadErlaubt(einstellungen, jetzt, rolle),
    aufgaben: aufgabenMit(einstellungen.texte),
    layout: BINGO_LAYOUT,
    regeln: spielregeln(einstellungen),
    meinTeam: mein ? teamAnsicht(mein, fotos, ruf) : null,
    meineFotos,
    alleFotos,
    andere: teams.filter(t => t.id !== mein?.id).map(t => teamAnsicht(t, fotos, ruf)),
    team: rolle.verwaltet ? team : [],
    testfotos: fotos.filter(f => f.test).length,
    offenFotos: rolle.jury ? fotos.filter(f => f.status === 'offen').length : null,
    resultate,
  }
}

// ── Jury ────────────────────────────────────────────────────────────────

export type JuryFoto = FotoAnsicht & { teamName: string; aufgabeTitel: string }
export type JuryTeam = { id: string; name: string; ausserKonkurrenz: boolean; mitglieder: string[]; wertung: TeamWertung; punkte: PunkteAnsicht; rang: number | null }
export type JuryDaten = {
  ordner: TeOrdner
  slug: string
  einstellungen: BingoEinstellungen
  rolle: BingoRolle
  jetzt: string
  phase: 'vor' | 'laeuft' | 'vorbei'
  aufgaben: Array<BingoAufgabe & { angepasst: boolean }>
  layout: string[]
  teams: JuryTeam[]
  fotos: JuryFoto[]
  offen: number
  jury: BingoJury
  log: LogEintrag[]
}

/** Jurybereich (nur Bianka und Noah): alle Fotos, Wertungen, Punkte und das Protokoll. */
export async function ladeJury(admin: SupabaseClient, slug: string, viewer: BingoViewer): Promise<JuryDaten | null> {
  if (!hatBingo(slug)) return null
  const rolle = bingoRolle(viewer.role, viewer.name)
  if (!rolle.jury) return null
  const ordner = await ladeOrdner(admin, slug)
  if (!ordner || !darfOrdnerSehen(ordner, viewer.id, rolle.verwaltet)) return null
  const [rows, team] = await Promise.all([ladeBingoRows(admin, slug), ladeTeam(admin)])
  const byKey = rowMap(rows)
  const einstellungen = parseEinstellungen(byKey.get(bingoKey(slug))?.comment)
  // auch der Jurybereich erst nach der Veröffentlichung (Noah ist kein Admin)
  if (!darfBingoSehen(einstellungen, rolle)) return null
  const teams = await teamsOderSeed(admin, slug, byKey, team)
  const ruf = rufnameFuer(team)
  const fotos = parseBingoFotos(rows).filter(f => f.slug === slug)
  const aufgaben = aufgabenMit(einstellungen.texte)
  const titel = new Map(aufgaben.map(a => [a.id, a.titel]))
  const namen = new Map(teams.map(t => [t.id, teamName(t, ruf)]))
  const urls = await signiere(admin, fotos.filter(f => f.thumb).map(f => bingoThumbPfad(slug, f.team, f.aufgabe, f.id)))
  const w = wertungen(byKey, slug, teams)
  const proTeam = nachTeam(fotos)
  const rang = new Map(rangliste(teams, proTeam, w).map(z => [z.team.id, z.rang]))
  const jetzt = new Date().toISOString()
  return {
    ordner, slug, einstellungen, rolle, jetzt, phase: bingoPhase(einstellungen, jetzt), aufgaben, layout: BINGO_LAYOUT,
    teams: teams.map(t => ({
      id: t.id, name: namen.get(t.id) ?? t.id, ausserKonkurrenz: t.ausserKonkurrenz, mitglieder: t.mitglieder,
      wertung: w.get(t.id) ?? { ...LEERE_WERTUNG },
      punkte: punkteAnsicht(punkteFuer(proTeam.get(t.id) ?? [], w.get(t.id) ?? LEERE_WERTUNG)),
      rang: rang.get(t.id) ?? null,
    })),
    fotos: fotos.map(f => ({
      ...f,
      vorschauUrl: f.thumb ? (urls[bingoThumbPfad(slug, f.team, f.aufgabe, f.id)] ?? null) : null,
      rufname: ruf(f.vonId) ?? f.von.split(/\s+/)[0] ?? '',
      eigenes: f.vonId === viewer.id,
      teamName: namen.get(f.team) ?? f.team,
      aufgabeTitel: titel.get(f.aufgabe) ?? f.aufgabe,
    })),
    offen: fotos.filter(f => f.status === 'offen').length,
    jury: parseJury(byKey.get(bingoJuryKey(slug))?.comment),
    log: parseLogs(rows, slug).slice(0, 300),
  }
}
