'use server'

// Fotobingo: Einstellungen, Teams und Aufgabentexte (Organisatorin),
// Uploads auf die eigene Karte (signierte Upload Links, direkt vom Browser
// in den privaten Bucket), Löschen eigener Fotos, Vollbildlinks und das
// Löschen der Testdaten. Jede Aktion prüft serverseitig Zugang, Freigabe,
// Zeitfenster, Teamzugehörigkeit und Limiten.

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { zurichToday } from '@/lib/salary-sync'
import { TE_BUCKET, TE_ORDNER_PREFIX, TE_ANCHOR, hatTeameventZugang, parseOrdner, darfOrdnerSehen, parseFotos, fotoPfad } from '@/lib/teamevents'
import { ladeTeam, ladeTeameventRows } from '@/lib/teamevents-data'
import {
  AUFGABE_ID_RE, FOTO_ID_RE, TEAM_ID_RE, BINGO_MAX_BYTES, BINGO_ANCHOR,
  bingoFotoKey, bingoFotoPfad, bingoThumbPfad, bingoLogKey, bingoRolle, darfBingoSehen, uploadErlaubt, bingoPhase, kartenSichtbar,
  aufgabeFuer, hatBingo, lokalZuIso, neueBingoId, parseBingoFotos, teamVon, uploadLimit, bingoWertungKey, bingoJuryKey, parseWertung, parseJury, parseEinstellungen, bingoKey, teamName, aufgabenMit,
  type BingoEinstellungen, type BingoTeam, type BingoFoto, type BingoRolle, type TeamWertung,
} from '@/lib/teamevent-bingo'
import { ladeEinstellungen, speichereEinstellungen, speichereTeams, ladeBingoRows, rowMap, teamsOderSeed, rufnameFuer } from '@/lib/teamevent-bingo-data'

const SLUG_RE = /^[a-z0-9-]{2,60}$/
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/
type Admin = Awaited<ReturnType<typeof createAdminClient>>
type Row = { user_full_name: string; schedule_date: string; comment: string }

const NUR_ORGA = { error: 'Das kann nur die Organisatorin.' }

async function kontext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (!hatTeameventZugang(p?.role, p?.full_name)) throw new Error('Keine Berechtigung')
  const rolle = bingoRolle(p?.role, p?.full_name)
  return { admin: await createAdminClient(), userId: user.id, name: p?.full_name ?? 'Unbekannt', rolle }
}

/** Ordner laden und prüfen, dass die Person ihn sehen darf und er ein Bingo hat. */
async function ordnerOk(admin: Admin, slug: string, userId: string, rolle: BingoRolle): Promise<boolean> {
  if (!SLUG_RE.test(slug) || !hatBingo(slug)) return false
  const { data } = await admin.from('zeiterfassung_comments').select('user_full_name, schedule_date, comment')
    .eq('user_full_name', `${TE_ORDNER_PREFIX}${slug}`).eq('schedule_date', TE_ANCHOR).maybeSingle()
  if (!data) return false
  const o = parseOrdner([data as Row])[0]
  return !!o && darfOrdnerSehen(o, userId, rolle.verwaltet)
}

/** Einstellungen laden und prüfen, dass die Person das Bingo sehen darf. */
async function bingoOk(admin: Admin, slug: string, userId: string, rolle: BingoRolle): Promise<BingoEinstellungen | null> {
  if (!(await ordnerOk(admin, slug, userId, rolle))) return null
  const e = await ladeEinstellungen(admin, slug)
  return darfBingoSehen(e, rolle) ? e : null
}

async function ladeFoto(admin: Admin, slug: string, id: string): Promise<BingoFoto | null> {
  const { data } = await admin.from('zeiterfassung_comments').select('user_full_name, schedule_date, comment')
    .eq('user_full_name', bingoFotoKey(slug, id)).limit(1)
  return parseBingoFotos((data ?? []) as Row[])[0] ?? null
}

async function protokoll(admin: Admin, slug: string, eintrag: Record<string, unknown>) {
  const am = new Date().toISOString()
  await admin.from('zeiterfassung_comments').insert({
    user_full_name: bingoLogKey(slug, neueBingoId()), schedule_date: zurichToday(),
    comment: JSON.stringify({ ...eintrag, am }), updated_at: am,
  })
}

// ── Organisatorin ───────────────────────────────────────────────────────

export type EinstellungenPatch = Partial<Pick<BingoEinstellungen, 'veroeffentlicht' | 'albumGesperrt' | 'testmodus'>> & {
  /** Zeiten in Schweizer Zeit als YYYY-MM-DDTHH:mm */
  start?: string; ende?: string; sichtbarAb?: string
}

export async function bingoEinstellungenSetzen(slug: string, patch: EinstellungenPatch) {
  const { admin, rolle } = await kontext()
  if (!rolle.verwaltet) return NUR_ORGA
  if (!SLUG_RE.test(slug) || !hatBingo(slug)) return { error: 'Ungültiger Ordner.' }
  const e = await ladeEinstellungen(admin, slug)
  for (const k of ['veroeffentlicht', 'albumGesperrt', 'testmodus'] as const) if (typeof patch[k] === 'boolean') e[k] = patch[k] as boolean
  for (const k of ['start', 'ende', 'sichtbarAb'] as const) {
    if (patch[k] === undefined) continue
    const iso = lokalZuIso(patch[k] as string)
    if (!iso) return { error: 'Bitte gültige Zeiten eingeben.' }
    e[k] = iso
  }
  if (Date.parse(e.start) >= Date.parse(e.ende)) return { error: 'Das Ende muss nach dem Start liegen.' }
  if (Date.parse(e.sichtbarAb) < Date.parse(e.ende)) return { error: 'Die Karten können erst nach dem Ende für alle sichtbar werden.' }
  const err = await speichereEinstellungen(admin, slug, e)
  if (err) return { error: err }
  return { success: true as const, einstellungen: e }
}

/** Titel und Text einer Aufgabe anpassen; beides leer setzt den Standard zurück. */
export async function bingoAufgabeTextSpeichern(slug: string, aufgabeId: string, titel: string, text: string) {
  const { admin, rolle } = await kontext()
  if (!rolle.verwaltet) return NUR_ORGA
  if (!SLUG_RE.test(slug) || !hatBingo(slug) || !AUFGABE_ID_RE.test(aufgabeId) || !aufgabeFuer(aufgabeId)) return { error: 'Ungültige Angaben.' }
  const e = await ladeEinstellungen(admin, slug)
  const t = titel.trim().slice(0, 60), x = text.trim().slice(0, 400)
  if (!t && !x) delete e.texte[aufgabeId]
  else e.texte[aufgabeId] = { ...(t ? { titel: t } : {}), ...(x ? { text: x } : {}) }
  const err = await speichereEinstellungen(admin, slug, e)
  if (err) return { error: err }
  return { success: true as const }
}

export async function bingoTeamsSpeichern(slug: string, teams: Array<{ id: string; mitglieder: string[]; offen?: string[]; ausserKonkurrenz: boolean }>) {
  const { admin, rolle } = await kontext()
  if (!rolle.verwaltet) return NUR_ORGA
  if (!SLUG_RE.test(slug) || !hatBingo(slug)) return { error: 'Ungültiger Ordner.' }
  if (!Array.isArray(teams) || teams.length === 0 || teams.length > 30) return { error: 'Bitte mindestens ein Team angeben.' }
  const konten = new Set((await ladeTeam(admin)).map(p => p.id))
  const vergeben = new Set<string>()
  const sauber: BingoTeam[] = []
  for (const t of teams) {
    if (typeof t.id !== 'string' || !TEAM_ID_RE.test(t.id) || sauber.some(s => s.id === t.id)) return { error: 'Ungültige Team Kennung.' }
    const mitglieder: string[] = []
    for (const m of Array.isArray(t.mitglieder) ? t.mitglieder : []) {
      if (typeof m !== 'string' || !konten.has(m)) return { error: 'Eine gewählte Person gibt es nicht.' }
      if (vergeben.has(m)) return { error: 'Eine Person ist in zwei Teams eingeteilt.' }
      vergeben.add(m); mitglieder.push(m)
    }
    const offen = (Array.isArray(t.offen) ? t.offen : []).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(x => x.trim().slice(0, 40)).slice(0, 10)
    if (mitglieder.length === 0 && offen.length === 0) return { error: 'Ein Team braucht mindestens eine Person.' }
    sauber.push({ id: t.id, mitglieder, offen, ausserKonkurrenz: t.ausserKonkurrenz === true })
  }
  const err = await speichereTeams(admin, slug, sauber)
  if (err) return { error: err }
  return { success: true as const }
}

/** Alle Testfotos (hochgeladen im Testmodus) samt Dateien und Protokoll
 *  der Testphase entfernen, damit das Spiel bei null beginnt. */
export async function bingoTestdatenLoeschen(slug: string, bestaetigung: string) {
  const { admin, rolle, name } = await kontext()
  if (!rolle.verwaltet) return NUR_ORGA
  if (!SLUG_RE.test(slug) || !hatBingo(slug)) return { error: 'Ungültiger Ordner.' }
  if (bestaetigung !== 'löschen') return { error: 'Bitte zum Bestätigen «löschen» eingeben.' }
  const rows = await ladeBingoRows(admin, slug)
  const fotos = parseBingoFotos(rows).filter(f => f.slug === slug && f.test)
  const pfade = fotos.flatMap(f => [bingoFotoPfad(slug, f.team, f.aufgabe, f.id), bingoThumbPfad(slug, f.team, f.aufgabe, f.id)])
  for (let i = 0; i < pfade.length; i += 100) await admin.storage.from(TE_BUCKET).remove(pfade.slice(i, i + 100))
  const keys = fotos.map(f => bingoFotoKey(slug, f.id))
  const testLogs = rows.filter(r => r.user_full_name.startsWith(bingoLogKey(slug, '')) && (() => { try { return (JSON.parse(r.comment) as { test?: boolean }).test === true } catch { return false } })())
  keys.push(...testLogs.map(r => r.user_full_name))
  for (let i = 0; i < keys.length; i += 100) {
    const { error } = await admin.from('zeiterfassung_comments').delete().in('user_full_name', keys.slice(i, i + 100))
    if (error) return { error: error.message }
  }
  await protokoll(admin, slug, { aktion: 'testdaten-geloescht', von: name, fotos: fotos.length })
  return { success: true as const, geloescht: fotos.length }
}

// ── Uploads ─────────────────────────────────────────────────────────────

/** Zielteam eines Uploads: das eigene Team; im Testmodus dürfen Admins
 *  und die Jury auf jede Karte laden. */
async function zielTeam(admin: Admin, slug: string, rows: Map<string, Row>, userId: string, rolle: BingoRolle, e: BingoEinstellungen, teamId: string | undefined): Promise<BingoTeam | { error: string }> {
  const teams = await teamsOderSeed(admin, slug, rows, await ladeTeam(admin))
  const mein = teamVon(teams, userId)
  if (teamId && TEAM_ID_RE.test(teamId) && teamId !== mein?.id) {
    if (!(e.testmodus && (rolle.admin || rolle.jury))) return { error: 'Fotos können nur auf die eigene Karte geladen werden.' }
    const t = teams.find(x => x.id === teamId)
    return t ?? { error: 'Team nicht gefunden.' }
  }
  return mein ?? { error: 'Du bist noch keinem Team zugeteilt. Bitte melde dich bei Bianka.' }
}

/** Schritt 1: Prüfung und signierte Upload Links für Bild und Vorschaubild. */
export async function bingoUploadVorbereiten(slug: string, aufgabeId: string, bytes: number, teamId?: string) {
  const { admin, userId, rolle } = await kontext()
  const e = await bingoOk(admin, slug, userId, rolle)
  if (!e) return { error: 'Das Bingo ist nicht verfügbar.' }
  if (!AUFGABE_ID_RE.test(aufgabeId)) return { error: 'Ungültiges Feld.' }
  const aufgabe = aufgabeFuer(aufgabeId)
  if (!aufgabe) return { error: 'Ungültiges Feld.' }
  if (!(bytes > 0) || bytes > BINGO_MAX_BYTES) return { error: 'Das Foto ist zu gross, höchstens 12 MB.' }
  const jetzt = new Date().toISOString()
  const ok = uploadErlaubt(e, jetzt, rolle)
  if (!ok.ok) return { error: ok.grund }
  const rows = await ladeBingoRows(admin, slug)
  const team = await zielTeam(admin, slug, rowMap(rows), userId, rolle, e, teamId)
  if ('error' in team) return team
  const vorhanden = parseBingoFotos(rows).filter(f => f.slug === slug && f.team === team.id && f.aufgabe === aufgabeId)
  const limit = uploadLimit(aufgabe, vorhanden, userId)
  if (limit.frei <= 0) return { error: limit.proPerson ? `Du hast für dieses Feld schon ${limit.max} Fotos hochgeladen.` : `Für dieses Feld sind schon ${limit.max} Fotos hochgeladen.` }
  const id = neueBingoId()
  const datum = zurichToday()
  const [{ data: orig, error: e1 }, { data: thumb }] = await Promise.all([
    admin.storage.from(TE_BUCKET).createSignedUploadUrl(bingoFotoPfad(slug, team.id, aufgabeId, id)),
    admin.storage.from(TE_BUCKET).createSignedUploadUrl(bingoThumbPfad(slug, team.id, aufgabeId, id)),
  ])
  if (e1 || !orig) return { error: `Upload konnte nicht vorbereitet werden, bitte nochmals versuchen (${e1?.message ?? 'unbekannt'}).` }
  return { id, datum, team: team.id, orig: { path: orig.path, token: orig.token }, thumb: thumb ? { path: thumb.path, token: thumb.token } : null }
}

/** Schritt 2: nach dem Upload das Foto registrieren. Der Server prüft, dass
 *  die Datei im erwarteten Pfad liegt; doppelte Registrierungen desselben
 *  Fotos sind harmlos (Upsert auf denselben Schlüssel). */
export async function bingoFotoRegistrieren(e0: { slug: string; id: string; aufgabeId: string; teamId: string; datum: string; mime: string; bytes: number; thumb: boolean }) {
  const { admin, userId, name, rolle } = await kontext()
  if (!SLUG_RE.test(e0.slug) || !FOTO_ID_RE.test(e0.id) || !AUFGABE_ID_RE.test(e0.aufgabeId) || !TEAM_ID_RE.test(e0.teamId) || !DATUM_RE.test(e0.datum)) return { error: 'Ungültige Angaben.' }
  const e = await bingoOk(admin, e0.slug, userId, rolle)
  if (!e) return { error: 'Das Bingo ist nicht verfügbar.' }
  if (!aufgabeFuer(e0.aufgabeId)) return { error: 'Ungültiges Feld.' }
  const jetzt = new Date().toISOString()
  const ok = uploadErlaubt(e, jetzt, rolle)
  if (!ok.ok) return { error: ok.grund }
  const rows = await ladeBingoRows(admin, e0.slug)
  const team = await zielTeam(admin, e0.slug, rowMap(rows), userId, rolle, e, e0.teamId)
  if ('error' in team) return team
  if (team.id !== e0.teamId) return { error: 'Fotos können nur auf die eigene Karte geladen werden.' }
  const pfad = bingoFotoPfad(e0.slug, team.id, e0.aufgabeId, e0.id)
  const dir = pfad.slice(0, pfad.lastIndexOf('/'))
  const { data: list } = await admin.storage.from(TE_BUCKET).list(dir, { search: e0.id, limit: 10 })
  const namen = new Set((list ?? []).map(f => f.name))
  if (!namen.has(`${e0.id}.jpg`)) return { error: 'Das Foto ist im Speicher nicht angekommen, bitte nochmals versuchen.' }
  const thumb = e0.thumb && namen.has(`${e0.id}_thumb.jpg`)
  const am = new Date().toISOString()
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    {
      user_full_name: bingoFotoKey(e0.slug, e0.id), schedule_date: e0.datum,
      comment: JSON.stringify({
        team: team.id, aufgabe: e0.aufgabeId, am, von: name, vonId: userId,
        mime: (e0.mime || 'image/jpeg').slice(0, 80), bytes: Math.round(e0.bytes), thumb,
        status: 'offen', test: e.testmodus,
      }),
      updated_at: am,
    },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  return { success: true as const }
}

/** Eigenes Foto löschen (bis zum Ende des Spiels); Jury und Organisatorin jedes. */
export async function bingoFotoLoeschen(slug: string, id: string) {
  const { admin, userId, name, rolle } = await kontext()
  if (!SLUG_RE.test(slug) || !FOTO_ID_RE.test(id)) return { error: 'Ungültige Angaben.' }
  const e = await bingoOk(admin, slug, userId, rolle)
  if (!e) return { error: 'Das Bingo ist nicht verfügbar.' }
  const foto = await ladeFoto(admin, slug, id)
  if (!foto) return { error: 'Foto nicht gefunden.' }
  const jetzt = new Date().toISOString()
  const darf = rolle.jury || rolle.verwaltet || (foto.vonId === userId && (bingoPhase(e, jetzt) !== 'vorbei' || (e.testmodus && rolle.admin)))
  if (!darf) return { error: foto.vonId === userId ? 'Das Bingo ist vorbei, Fotos können nicht mehr gelöscht werden.' : 'Es können nur eigene Fotos gelöscht werden.' }
  await admin.storage.from(TE_BUCKET).remove([bingoFotoPfad(slug, foto.team, foto.aufgabe, id), bingoThumbPfad(slug, foto.team, foto.aufgabe, id)])
  const { error } = await admin.from('zeiterfassung_comments').delete().eq('user_full_name', bingoFotoKey(slug, id))
  if (error) return { error: error.message }
  if (foto.vonId !== userId) await protokoll(admin, slug, { aktion: 'foto-geloescht', von: name, foto: id, team: foto.team, aufgabe: foto.aufgabe, hochgeladenVon: foto.von, test: foto.test || e.testmodus })
  return { success: true as const }
}

/** Signierter Link (10 Minuten) zum Öffnen oder Herunterladen eines Fotos.
 *  Eigenes Team immer, Jury und Organisatorin immer, alle anderen erst ab
 *  dem Zeitpunkt, an dem die Karten für alle sichtbar sind. */
export async function bingoFotoLink(slug: string, id: string, modus: 'ansicht' | 'download' = 'ansicht') {
  const { admin, userId, rolle } = await kontext()
  if (!SLUG_RE.test(slug) || !FOTO_ID_RE.test(id)) return { error: 'Ungültige Angaben.' }
  const e = await bingoOk(admin, slug, userId, rolle)
  if (!e) return { error: 'Das Bingo ist nicht verfügbar.' }
  const foto = await ladeFoto(admin, slug, id)
  if (!foto) return { error: 'Foto nicht gefunden.' }
  const jetzt = new Date().toISOString()
  if (!(rolle.jury || rolle.verwaltet || kartenSichtbar(e, jetzt))) {
    const rows = await ladeBingoRows(admin, slug)
    const teams = await teamsOderSeed(admin, slug, rowMap(rows), await ladeTeam(admin))
    const mein = teamVon(teams, userId)
    if (!mein || mein.id !== foto.team) {
      if (!(e.testmodus && rolle.admin)) return { error: 'Dieses Foto ist noch nicht freigegeben.' }
    }
  }
  const { data, error } = await admin.storage.from(TE_BUCKET)
    .createSignedUrl(bingoFotoPfad(slug, foto.team, foto.aufgabe, id), 600, modus === 'download' ? { download: `${foto.aufgabe}_${id}.jpg` } : undefined)
  if (error || !data) return { error: error?.message ?? 'Link konnte nicht erstellt werden.' }
  return { url: data.signedUrl }
}

// ── Jury: Fotokontrolle, Wertung, Favoriten, Jurypreis, Veröffentlichung ─

const NUR_JURY = { error: 'Das kann nur die Jury.' }

/** Teamname (Rufnamen) fürs Protokoll. */
async function teamNameFuer(admin: Admin, slug: string, teamId: string): Promise<string> {
  const konten = await ladeTeam(admin)
  const teams = await teamsOderSeed(admin, slug, rowMap(await ladeBingoRows(admin, slug)), konten)
  const t = teams.find(x => x.id === teamId)
  return t ? teamName(t, rufnameFuer(konten)) : teamId
}
const STATUS_RE = /^(offen|akzeptiert|abgelehnt)$/

/** Ein Foto akzeptieren, ablehnen oder wieder auf offen setzen (Jury,
 *  jederzeit änderbar, auch nach dem Ende des Spiels). Jede Entscheidung
 *  wird protokolliert. */
export async function bingoFotoEntscheiden(slug: string, id: string, status: 'offen' | 'akzeptiert' | 'abgelehnt') {
  const { admin, userId, name, rolle } = await kontext()
  if (!rolle.jury) return NUR_JURY
  if (!SLUG_RE.test(slug) || !FOTO_ID_RE.test(id) || !STATUS_RE.test(status)) return { error: 'Ungültige Angaben.' }
  const e = await bingoOk(admin, slug, userId, rolle)
  if (!e) return { error: 'Das Bingo ist nicht verfügbar.' }
  const { data } = await admin.from('zeiterfassung_comments').select('user_full_name, schedule_date, comment')
    .eq('user_full_name', bingoFotoKey(slug, id)).limit(1)
  const row = ((data ?? []) as Row[])[0]
  const foto = row ? parseBingoFotos([row])[0] : null
  if (!row || !foto) return { error: 'Foto nicht gefunden.' }
  let roh: Record<string, unknown> = {}
  try { roh = JSON.parse(row.comment) as Record<string, unknown> } catch { /* leer */ }
  const am = new Date().toISOString()
  const neu = { ...roh, status, entschiedenVon: status === 'offen' ? null : name, entschiedenAm: status === 'offen' ? null : am }
  const { error } = await admin.from('zeiterfassung_comments').update({ comment: JSON.stringify(neu), updated_at: am })
    .eq('user_full_name', bingoFotoKey(slug, id)).eq('schedule_date', row.schedule_date)
  if (error) return { error: error.message }
  await protokoll(admin, slug, { aktion: 'entscheid', von: name, foto: id, team: foto.team, teamName: await teamNameFuer(admin, slug, foto.team), aufgabe: foto.aufgabe, status, vorher: foto.status, test: foto.test || e.testmodus })
  return { success: true as const }
}

/** Wertung eines Teams: Buchstabenjagd geschafft, Bonus Kürbis, Bonus
 *  Schritte, Korrektur mit Grund (Jury). */
export async function bingoWertungSetzen(slug: string, teamId: string, patch: Partial<TeamWertung>) {
  const { admin, userId, name, rolle } = await kontext()
  if (!rolle.jury) return NUR_JURY
  if (!SLUG_RE.test(slug) || !TEAM_ID_RE.test(teamId)) return { error: 'Ungültige Angaben.' }
  const e = await bingoOk(admin, slug, userId, rolle)
  if (!e) return { error: 'Das Bingo ist nicht verfügbar.' }
  const { data } = await admin.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', bingoWertungKey(slug, teamId)).eq('schedule_date', BINGO_ANCHOR).maybeSingle()
  const w = parseWertung((data as { comment: string } | null)?.comment)
  const was: string[] = []
  for (const k of ['buchstabenOk', 'bonusKuerbis', 'bonusSchritte'] as const) {
    if (typeof patch[k] === 'boolean' && patch[k] !== w[k]) { w[k] = patch[k] as boolean; was.push(`${k} ${patch[k] ? 'an' : 'aus'}`) }
  }
  if (patch.korrektur !== undefined) {
    const k = Number(patch.korrektur)
    if (!Number.isFinite(k) || Math.abs(k) > 99 || Math.round(k) !== k) return { error: 'Die Korrektur muss eine ganze Zahl zwischen minus 99 und 99 sein.' }
    const grund = typeof patch.korrekturGrund === 'string' ? patch.korrekturGrund.trim().slice(0, 200) : w.korrekturGrund
    if (k !== 0 && !grund) return { error: 'Bitte einen Grund für die Korrektur angeben.' }
    if (k !== w.korrektur || grund !== w.korrekturGrund) { w.korrektur = k; w.korrekturGrund = k === 0 ? '' : grund; was.push(`Korrektur ${k > 0 ? '+' : ''}${k}${grund ? ` (${grund})` : ''}`) }
  }
  if (was.length === 0) return { success: true as const }
  const am = new Date().toISOString()
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: bingoWertungKey(slug, teamId), schedule_date: BINGO_ANCHOR, comment: JSON.stringify(w), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  await protokoll(admin, slug, { aktion: 'wertung', von: name, team: teamId, teamName: await teamNameFuer(admin, slug, teamId), was: was.join(', '), test: e.testmodus })
  return { success: true as const }
}

async function ladeJuryRow(admin: Admin, slug: string) {
  const { data } = await admin.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', bingoJuryKey(slug)).eq('schedule_date', BINGO_ANCHOR).maybeSingle()
  return parseJury((data as { comment: string } | null)?.comment)
}
async function speichereJury(admin: Admin, slug: string, j: { favoriten: string[]; preis: string | null }) {
  const am = new Date().toISOString()
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: bingoJuryKey(slug), schedule_date: BINGO_ANCHOR, comment: JSON.stringify(j), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error?.message ?? null
}

/** Favorit für den Jurypreis setzen oder entfernen (Jury). */
export async function bingoFavoritSetzen(slug: string, fotoId: string, favorit: boolean) {
  const { admin, userId, name, rolle } = await kontext()
  if (!rolle.jury) return NUR_JURY
  if (!SLUG_RE.test(slug) || !FOTO_ID_RE.test(fotoId)) return { error: 'Ungültige Angaben.' }
  if (!(await bingoOk(admin, slug, userId, rolle))) return { error: 'Das Bingo ist nicht verfügbar.' }
  const j = await ladeJuryRow(admin, slug)
  const set = new Set(j.favoriten)
  if (favorit) set.add(fotoId); else set.delete(fotoId)
  const err = await speichereJury(admin, slug, { favoriten: Array.from(set), preis: j.preis })
  if (err) return { error: err }
  await protokoll(admin, slug, { aktion: 'favorit', von: name, foto: fotoId, favorit })
  return { success: true as const }
}

/** Jurypreis vergeben (ein Foto) oder zurücknehmen (Jury). */
export async function bingoJurypreisSetzen(slug: string, fotoId: string | null) {
  const { admin, userId, name, rolle } = await kontext()
  if (!rolle.jury) return NUR_JURY
  if (!SLUG_RE.test(slug) || (fotoId !== null && !FOTO_ID_RE.test(fotoId))) return { error: 'Ungültige Angaben.' }
  if (!(await bingoOk(admin, slug, userId, rolle))) return { error: 'Das Bingo ist nicht verfügbar.' }
  if (fotoId && !(await ladeFoto(admin, slug, fotoId))) return { error: 'Foto nicht gefunden.' }
  const j = await ladeJuryRow(admin, slug)
  const err = await speichereJury(admin, slug, { favoriten: j.favoriten, preis: fotoId })
  if (err) return { error: err }
  await protokoll(admin, slug, { aktion: 'jurypreis', von: name, foto: fotoId })
  return { success: true as const }
}

/** Resultate veröffentlichen oder wieder verbergen (Organisatorin). Danach
 *  sehen alle die Rangliste mit Punkten und den Jurypreis. */
export async function bingoResultateVeroeffentlichen(slug: string, an: boolean) {
  const { admin, name, rolle } = await kontext()
  if (!rolle.verwaltet) return NUR_ORGA
  if (!SLUG_RE.test(slug) || !hatBingo(slug)) return { error: 'Ungültiger Ordner.' }
  const e = await ladeEinstellungen(admin, slug)
  e.resultate = an
  const err = await speichereEinstellungen(admin, slug, e)
  if (err) return { error: err }
  await protokoll(admin, slug, { aktion: 'resultate', von: name, an })
  return { success: true as const }
}

// ── ZIP Export (Organisatorin) ──────────────────────────────────────────

/** Dateiname ohne Umlaute, Leerzeichen und Sonderzeichen. */
function dateiName(s: string): string {
  const map: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue' }
  return s.replace(/[äöüÄÖÜ]/g, c => map[c] ?? c).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s*\+\s*/g, '_und_').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'x'
}

/** Liste aller Fotos (Bingo nach Team und Aufgabe, Fotoalbum nach Tag) mit
 *  signierten Links für eine Stunde. Der Browser der Organisatorin holt
 *  die Dateien und packt das ZIP. */
export async function bingoZipListe(slug: string) {
  const { admin, rolle } = await kontext()
  if (!rolle.verwaltet) return NUR_ORGA
  if (!SLUG_RE.test(slug) || !hatBingo(slug)) return { error: 'Ungültiger Ordner.' }
  const [rows, alleRows, team] = await Promise.all([ladeBingoRows(admin, slug), ladeTeameventRows(admin, slug), ladeTeam(admin)])
  const byKey = rowMap(rows)
  const e = parseEinstellungen(byKey.get(bingoKey(slug))?.comment)
  const teams = await teamsOderSeed(admin, slug, byKey, team)
  const ruf = rufnameFuer(team)
  const titel = new Map(aufgabenMit(e.texte).map(a => [a.id, a.titel]))
  const teamNamen = new Map(teams.map(t => [t.id, dateiName(teamName(t, ruf))]))
  const fotos = parseBingoFotos(rows).filter(f => f.slug === slug)
  const zaehler = new Map<string, number>()
  const eintraege: Array<{ pfad: string; speicher: string }> = []
  for (const f of fotos) {
    const k = `${f.team}/${f.aufgabe}`
    const n = (zaehler.get(k) ?? 0) + 1
    zaehler.set(k, n)
    const status = f.status === 'akzeptiert' ? '' : f.status === 'abgelehnt' ? '_abgelehnt' : '_offen'
    eintraege.push({
      pfad: `Bingo/${teamNamen.get(f.team) ?? f.team}/${dateiName(titel.get(f.aufgabe) ?? f.aufgabe)}/${String(n).padStart(2, '0')}_${dateiName(ruf(f.vonId) ?? f.von)}${status}${f.test ? '_test' : ''}.jpg`,
      speicher: bingoFotoPfad(slug, f.team, f.aufgabe, f.id),
    })
  }
  for (const f of parseFotos(alleRows).filter(f => f.slug === slug)) {
    eintraege.push({ pfad: `Fotoalbum/${f.datum}/${f.id}_${dateiName(f.name)}`, speicher: fotoPfad(slug, f.datum, f.id, f.name) })
  }
  const urls: Record<string, string> = {}
  for (let i = 0; i < eintraege.length; i += 100) {
    const { data } = await admin.storage.from(TE_BUCKET).createSignedUrls(eintraege.slice(i, i + 100).map(x => x.speicher), 3600)
    for (const d of data ?? []) if (d.path && d.signedUrl) urls[d.path] = d.signedUrl
  }
  return { dateien: eintraege.filter(x => urls[x.speicher]).map(x => ({ pfad: x.pfad, url: urls[x.speicher] })) }
}
