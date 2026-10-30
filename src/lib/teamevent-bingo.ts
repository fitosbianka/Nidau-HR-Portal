// Fotobingo eines Teamevents (Ordner Spiele). Reine Logik ohne Datenbank:
// Aufgaben, Kartenlayout, Punkte, Teams, Fristen, Zugriff. Die Ablage
// erfolgt als reservierte Zeilen in zeiterfassung_comments (kein DDL), alle
// Schlüssel enthalten den Slug des Anlasses:
//   __teamevent_bingo__<slug>                @ 1970-01-01   → Einstellungen (Schalter, Zeiten, Texte)
//   __teamevent_bingoteams__<slug>           @ 1970-01-01   → { teams: BingoTeam[] }
//   __teamevent_bingofoto__<slug>__<fotoId>  @ Upload Datum → BingoFoto (Status offen, akzeptiert, abgelehnt)
//   __teamevent_bingowertung__<slug>__<team> @ 1970-01-01   → TeamWertung (Buchstaben, Bonus, Korrektur), nur Jury
//   __teamevent_bingolog__<slug>__<id>       @ Datum        → Protokoll jeder Juryentscheidung
// Textregeln für alles, was das Team sieht: Schweizer Schreibweise ohne
// scharfes s, keine Binde oder Gedankenstriche, keine Doppelpunkte, Zeiten
// als 7.00 Uhr, Du Form, kurz und freundlich.

import { TE_ANCHOR, istOrganisatorin } from './teamevents'

export const BINGO_PREFIX = '__teamevent_bingo__'
export const BINGO_TEAMS_PREFIX = '__teamevent_bingoteams__'
export const BINGO_FOTO_PREFIX = '__teamevent_bingofoto__'
export const BINGO_WERTUNG_PREFIX = '__teamevent_bingowertung__'
export const BINGO_LOG_PREFIX = '__teamevent_bingolog__'
/** Gemeinsamer Anfang aller Bingo Zeilen (für eine LIKE Abfrage). */
export const BINGO_LIKE_PREFIX = '__teamevent_bingo'
export const BINGO_ANCHOR = TE_ANCHOR

export const bingoKey = (slug: string) => `${BINGO_PREFIX}${slug}`
export const bingoTeamsKey = (slug: string) => `${BINGO_TEAMS_PREFIX}${slug}`
export const bingoFotoKey = (slug: string, fotoId: string) => `${BINGO_FOTO_PREFIX}${slug}__${fotoId}`
export const bingoWertungKey = (slug: string, teamId: string) => `${BINGO_WERTUNG_PREFIX}${slug}__${teamId}`
export const bingoLogKey = (slug: string, id: string) => `${BINGO_LOG_PREFIX}${slug}__${id}`

/** Speicherpfade im privaten Bucket employee-documents. */
export const bingoFotoPfad = (slug: string, teamId: string, aufgabeId: string, fotoId: string) => `_teamevents/${slug}/bingo/${teamId}/${aufgabeId}/${fotoId}.jpg`
export const bingoThumbPfad = (slug: string, teamId: string, aufgabeId: string, fotoId: string) => `_teamevents/${slug}/bingo/${teamId}/${aufgabeId}/${fotoId}_thumb.jpg`

export const BINGO_MAX_BYTES = 12 * 1024 * 1024

// ── Jury und Zugriff ────────────────────────────────────────────────────

/** Jury des Fotobingos: prüft die Fotos, sieht Live Resultate und die
 *  Siegerehrung. Peter ist Admin, spielt aber mit, darum bewusst nicht dabei. */
export const BINGO_JURY = ['Bianka Fitos', 'Noah Diserens']
export const istJury = (fullName: string | null | undefined) => BINGO_JURY.includes(fullName ?? '')

export type BingoRolle = {
  /** Organisatorin: Schalter, Zeiten, Teams, Texte, Testdaten */
  verwaltet: boolean
  /** Jury: Fotokontrolle, Resultate, Siegerehrung */
  jury: boolean
  /** Admin Rolle (Vorschau vor der Freigabe, Testmodus Uploads) */
  admin: boolean
}
export function bingoRolle(role: string | null | undefined, fullName: string | null | undefined): BingoRolle {
  return { verwaltet: istOrganisatorin(fullName), jury: istJury(fullName), admin: role === 'admin' }
}
/** Darf die Person den Ordner Spiele überhaupt sehen? Vor der Veröffentlichung
 *  nur Admins (Vorschau) und die Organisatorin. Die Jury (Noah ist kein
 *  Admin) sieht ihn wie alle Mitarbeitenden erst nach der Veröffentlichung:
 *  kein Mitarbeiterkonto bekommt das Bingo, bevor Bianka es ausdrücklich
 *  veröffentlicht. Es gibt keine zeitgesteuerte Veröffentlichung; Start,
 *  Ende und «Karten sichtbar ab» wirken erst innerhalb des veröffentlichten
 *  Spiels. */
export const darfBingoSehen = (e: BingoEinstellungen, r: BingoRolle) => e.veroeffentlicht || r.admin || r.verwaltet

// ── Einstellungen ───────────────────────────────────────────────────────

export type BingoTextUeberlagerung = { titel?: string; text?: string }
export type BingoEinstellungen = {
  /** Für Mitarbeitende veröffentlicht (Schalter der Organisatorin). Neuer
   *  Schlüssel seit 20.10.2026: der frühere Schlüssel «freigabe» wird
   *  bewusst nicht mehr gelesen, damit das Bingo nach dem Entscheid gegen
   *  das Spiel garantiert für alle Mitarbeitenden aus ist, unabhängig vom
   *  gespeicherten Stand, bis Bianka den Schalter neu setzt. */
  veroeffentlicht: boolean
  /** Fotoalbum für Mitarbeitende gesperrt (Schalter der Organisatorin).
   *  Neuer Schlüssel seit 22.10.2026: das Album ist für alle offen, solange
   *  es nicht gesperrt ist; der frühere Schlüssel «albumFreigabe» und das
   *  Zeitfenster albumStart/albumEnde werden nicht mehr gelesen. */
  albumGesperrt: boolean
  testmodus: boolean
  /** ISO Zeitpunkte mit Zeitzone (Schweizer Zeit) */
  start: string
  ende: string
  sichtbarAb: string
  resultate: boolean
  texte: Record<string, BingoTextUeberlagerung>
}

export const BINGO_STANDARD: BingoEinstellungen = {
  veroeffentlicht: false,
  albumGesperrt: false,
  testmodus: false,
  start: '2026-10-23T07:00:00+02:00',
  ende: '2026-10-24T16:00:00+02:00',
  sichtbarAb: '2026-10-24T21:00:00+02:00',
  resultate: false,
  texte: {},
}

const istIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))

export function parseEinstellungen(comment: string | null | undefined): BingoEinstellungen {
  const e: BingoEinstellungen = { ...BINGO_STANDARD, texte: {} }
  if (!comment) return e
  try {
    const j = JSON.parse(comment) as Partial<Record<keyof BingoEinstellungen, unknown>>
    for (const k of ['veroeffentlicht', 'albumGesperrt', 'testmodus', 'resultate'] as const) if (typeof j[k] === 'boolean') e[k] = j[k] as boolean
    for (const k of ['start', 'ende', 'sichtbarAb'] as const) if (istIso(j[k])) e[k] = j[k] as string
    if (j.texte && typeof j.texte === 'object') {
      for (const [id, v] of Object.entries(j.texte as Record<string, unknown>)) {
        if (!v || typeof v !== 'object') continue
        const t = v as { titel?: unknown; text?: unknown }
        const u: BingoTextUeberlagerung = {}
        if (typeof t.titel === 'string' && t.titel.trim()) u.titel = t.titel.trim().slice(0, 60)
        if (typeof t.text === 'string' && t.text.trim()) u.text = t.text.trim().slice(0, 400)
        if (u.titel || u.text) e.texte[id] = u
      }
    }
  } catch { /* Standardwerte */ }
  return e
}

export type BingoPhase = 'vor' | 'laeuft' | 'vorbei'
export function bingoPhase(e: BingoEinstellungen, jetztIso: string): BingoPhase {
  const t = Date.parse(jetztIso)
  if (t < Date.parse(e.start)) return 'vor'
  if (t >= Date.parse(e.ende)) return 'vorbei'
  return 'laeuft'
}
export const kartenSichtbar = (e: BingoEinstellungen, jetztIso: string) => Date.parse(jetztIso) >= Date.parse(e.sichtbarAb)
/** Darf jetzt hochgeladen werden? Im Testmodus dürfen Admins immer. */
export function uploadErlaubt(e: BingoEinstellungen, jetztIso: string, r: BingoRolle): { ok: true } | { ok: false; grund: string } {
  if (e.testmodus && (r.admin || r.jury)) return { ok: true }
  const p = bingoPhase(e, jetztIso)
  if (p === 'vor') return { ok: false, grund: `Das Bingo startet am ${wochentagKurz(e.start)} um ${uhrzeit(e.start)} Uhr.` }
  if (p === 'vorbei') return { ok: false, grund: 'Das Bingo ist vorbei, die Siegerehrung ist im Bus.' }
  return { ok: true }
}

const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const zuerich = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Zurich', hour12: false })
/** «7.00» (Schweizer Zeit) */
export function uhrzeit(iso: string): string {
  const s = zuerich(iso)                      // YYYY-MM-DD HH:mm:ss
  return `${parseInt(s.slice(11, 13), 10)}.${s.slice(14, 16)}`
}
/** «Freitag» (Schweizer Zeit) */
export function wochentagKurz(iso: string): string {
  const s = zuerich(iso)
  return WOCHENTAGE[new Date(`${s.slice(0, 10)}T12:00:00`).getDay()]
}
/** «Freitag, 23. Oktober 2026» */
export function datumLangText(iso: string): string {
  const s = zuerich(iso)
  const d = new Date(`${s.slice(0, 10)}T12:00:00`)
  const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
  return `${WOCHENTAGE[d.getDay()]}, ${d.getDate()}. ${MONATE[d.getMonth()]} ${d.getFullYear()}`
}
/** Für <input type="datetime-local"> in Schweizer Zeit: YYYY-MM-DDTHH:mm */
export const isoZuLokal = (iso: string) => zuerich(iso).slice(0, 16).replace(' ', 'T')
/** Schweizer Zeit zurück in ISO mit korrektem Offset (Sommer oder Winterzeit). */
export function lokalZuIso(lokal: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(lokal)) return null
  // Offset ermitteln: Zürich liegt im Oktober je nach Tag auf +02:00 oder +01:00
  for (const off of ['+02:00', '+01:00']) {
    const kandidat = `${lokal}:00${off}`
    if (isoZuLokal(kandidat) === lokal) return kandidat
  }
  return null
}

// ── Aufgaben und Karte ──────────────────────────────────────────────────

export type BingoAufgabe = {
  id: string
  titel: string
  text: string
  /** Höchstzahl Fotos pro Feld und Team (Buchstabenjagd pro Person) */
  maxFotos: number
  proPerson?: boolean
  /** Bonuswettbewerb, 2 Extrapunkte durch die Jury */
  bonus?: 'kuerbis' | 'schritte'
  /** Zählt erst mit der Jurymarkierung «Alle acht Buchstaben gefunden» */
  buchstaben?: boolean
  /** Zusammenarbeit zweier Teams, beide laden dasselbe Foto hoch */
  zusammen?: boolean
}

export const BINGO_FREI_ID = 'lieblingsmoment'

export const BINGO_AUFGABEN: BingoAufgabe[] = [
  { id: 'zuckerschock', titel: 'Zuckerschock', text: 'Das grösste Dessert im Park, mit einer Hand als Massstab.', maxFotos: 5 },
  { id: 'fahrfoto', titel: 'Fahrfoto', text: 'Euer Fahrfoto, abfotografiert am Bildschirm beim Ausgang.', maxFotos: 5 },
  { id: 'vorher-nachher', titel: 'Vorher Nachher', text: 'Euer Gesicht direkt vor und direkt nach der Bahn, die euch am meisten Respekt macht.', maxFotos: 5 },
  { id: 'drama', titel: 'Drama auf Schienen', text: 'Die langsamste Bahn im Park mit dem dramatischsten Gesicht.', maxFotos: 5 },
  { id: 'kurze-warteschlange', titel: 'Kürzeste Warteschlange', text: '', maxFotos: 5 },
  { id: 'swissness', titel: 'Swissness', text: 'Das Unschweizerischste im Themenbereich Schweiz.', maxFotos: 5 },
  { id: 'buchstaben', titel: 'Buchstabenjagd', text: 'K E H R S A T Z auf Schildern im Park, ein Foto pro Buchstabe.', maxFotos: 20, proPerson: true, buchstaben: true },
  { id: 'kitsch', titel: 'Kitsch Königin', text: 'Das absurdeste Souvenir im Shop.', maxFotos: 5 },
  { id: 'promi', titel: 'Promi Selfie', text: 'Ein Selfie mit Ed Euromaus oder einer Halloween Figur.', maxFotos: 5 },
  { id: 'patient', titel: 'Ein Potenzieller Patient', text: '', maxFotos: 5 },
  { id: 'teller', titel: 'Europa auf dem Teller', text: 'Ein Essen im passenden Land, zum Beispiel Pizza in Italien.', maxFotos: 5 },
  { id: 'kuerbis', titel: 'Kürbismeer', text: 'So viele Kürbisse wie möglich auf einem Foto. Die meisten Kürbisse von allen Teams bringen 2 Extrapunkte.', maxFotos: 5, bonus: 'kuerbis' },
  { id: 'von-oben', titel: 'Rund um die Welt', text: 'Der Park von oben, zum Beispiel aus dem Euro Tower, der Monorail oder der Panoramabahn.', maxFotos: 5 },
  { id: 'kombination', titel: 'Neue Kombination', text: 'Ein Foto mit jemandem, mit dem du im Alltag fast nie zusammenarbeitest.', maxFotos: 5 },
  { id: 'runde', titel: 'Grosse Runde', text: 'Mindestens fünf aus dem Team auf einem spontanen Bild, ohne die offiziellen Gruppenfotos.', maxFotos: 5 },
  { id: 'lachanfall', titel: 'Lachanfall', text: 'Ein echter, ungestellter Lachanfall.', maxFotos: 5 },
  { id: 'bus', titel: 'Bus Selfie', text: 'Ein Selfie im Bus mit der Person, die neben dir sitzt.', maxFotos: 5 },
  { id: 'ruecken', titel: 'Rückenansicht', text: 'Mindestens zwei aus dem Team von hinten, gemeinsam unterwegs.', maxFotos: 5 },
  { id: 'fruehstueck', titel: 'Frühstücksrunde', text: 'Der Frühstückstisch am Samstag mit mindestens zwei Teams.', maxFotos: 5 },
  { id: 'fremdwort', titel: 'Fremdwort', text: 'Ein deutsches Wort auf einem Schild oder einer Karte, das wir in der Schweiz anders sagen.', maxFotos: 5 },
  { id: 'apero', titel: 'Apéro', text: 'Der Moment beim Anstossen.', maxFotos: 5 },
  { id: 'postkarte', titel: 'Postkartenmotiv', text: 'Ein Foto, das als Postkarte durchgeht.', maxFotos: 5 },
  { id: 'schritte', titel: 'Schrittzähler', text: 'Die meisten Schritte im Team an einem der zwei Tage. Das Team mit den meisten Schritten bekommt 2 Extrapunkte.', maxFotos: 5, bonus: 'schritte' },
  { id: 'wetterfest', titel: 'Wetterfest', text: 'Draussen im Regen, nass und trotzdem unterwegs.', maxFotos: 5 },
]

export const BINGO_FREI: BingoAufgabe = { id: BINGO_FREI_ID, titel: 'Lieblingsmoment', text: 'Euer schönster Moment vom Ausflug.', maxFotos: 5 }

/** Feste Karte für alle Teams, 5 mal 5, Lieblingsmoment in der Mitte. In
 *  jeder Reihe, Spalte und Diagonale sind leichte und schwere Felder
 *  gemischt, damit keine Reihe geschenkt ist. Die Teamfelder Grosse Runde,
 *  Frühstücksrunde und Neue Kombination liegen in verschiedenen Reihen,
 *  Spalten und Diagonalen. */
export const BINGO_LAYOUT: string[] = [
  'bus',        'runde',      'patient',        'fahrfoto',   'lachanfall',
  'schritte',   'buchstaben', 'zuckerschock',   'wetterfest', 'fruehstueck',
  'kurze-warteschlange', 'ruecken', BINGO_FREI_ID, 'kitsch',   'von-oben',
  'fremdwort',  'vorher-nachher', 'apero',      'kuerbis',    'promi',
  'kombination', 'postkarte', 'drama',          'teller',     'swissness',
]

/** Die 12 Reihen (5 waagrecht, 5 senkrecht, 2 diagonal) als Feldindizes. */
export const BINGO_REIHEN: number[][] = [
  ...[0, 1, 2, 3, 4].map(r => [0, 1, 2, 3, 4].map(c => r * 5 + c)),
  ...[0, 1, 2, 3, 4].map(c => [0, 1, 2, 3, 4].map(r => r * 5 + c)),
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
]

export const PUNKTE = { feld: 1, reihe: 3, karte: 10, bonus: 2, max: 74 } as const

export const alleAufgaben = (): BingoAufgabe[] => [...BINGO_AUFGABEN, BINGO_FREI]
export const aufgabeFuer = (id: string): BingoAufgabe | null => alleAufgaben().find(a => a.id === id) ?? null
export const AUFGABE_ID_RE = /^[a-z0-9-]{2,40}$/

/** Aufgaben mit den von der Organisatorin gespeicherten Texten überlagert. */
export function aufgabenMit(texte: Record<string, BingoTextUeberlagerung>): Array<BingoAufgabe & { angepasst: boolean }> {
  return alleAufgaben().map(a => {
    const t = texte[a.id]
    return t ? { ...a, titel: t.titel ?? a.titel, text: t.text ?? a.text, angepasst: true } : { ...a, angepasst: false }
  })
}

// ── Teams ───────────────────────────────────────────────────────────────

export type BingoTeam = {
  id: string
  /** Profil IDs der Mitglieder */
  mitglieder: string[]
  /** Vornamen ohne Konto, werden beim Laden erneut zugeordnet (z. B. Odette) */
  offen: string[]
  ausserKonkurrenz: boolean
}

/** Vorbelegung: jedes Hotelzimmer ein Team; die drei Einzelzimmer spielen
 *  zusammen; Noah und Bianka sind die Jury und spielen ausser Konkurrenz. */
export const BINGO_START_TEAMS: Array<{ id: string; vornamen: Array<{ vorname: string; alias?: string[] }>; ausserKonkurrenz?: boolean }> = [
  { id: 't1', vornamen: [{ vorname: 'Valérie' }, { vorname: 'Peter' }] },
  { id: 't2', vornamen: [{ vorname: 'Fränzi', alias: ['Franziska'] }, { vorname: 'Paola' }] },
  { id: 't3', vornamen: [{ vorname: 'Dinusha' }, { vorname: 'Alessandra' }] },
  { id: 't4', vornamen: [{ vorname: 'Daniela' }, { vorname: 'Annegret' }] },
  { id: 't5', vornamen: [{ vorname: 'Neya' }, { vorname: 'Amina' }] },
  { id: 't6', vornamen: [{ vorname: 'Mesi', alias: ['Emese'] }, { vorname: 'Odette' }] },
  { id: 't7', vornamen: [{ vorname: 'Katarina' }, { vorname: 'Amanda' }] },
  { id: 't8', vornamen: [{ vorname: 'Andrea' }, { vorname: 'Anita' }, { vorname: 'Laura' }] },
  { id: 't9', vornamen: [{ vorname: 'Noah' }, { vorname: 'Bianka' }], ausserKonkurrenz: true },
]

export const TEAM_ID_RE = /^[a-z0-9]{1,20}$/
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
/** Profil ID zu einem Vornamen (mit Kurzformen); null, wenn nicht eindeutig. */
export function idFuerVorname(team: Array<{ id: string; full_name: string }>, vorname: string, alias?: string[]): string | null {
  const k = [vorname, ...(alias ?? [])].map(normal)
  const t = team.filter(p => k.includes(normal(p.full_name.split(/\s+/)[0] ?? '')))
  return t.length === 1 ? t[0].id : null
}

/** Startteams den Konten zuordnen; Vornamen ohne Konto bleiben offen. */
export function startTeams(team: Array<{ id: string; full_name: string }>): BingoTeam[] {
  return BINGO_START_TEAMS.map(t => {
    const mitglieder: string[] = []
    const offen: string[] = []
    for (const v of t.vornamen) {
      const id = idFuerVorname(team, v.vorname, v.alias)
      if (id) mitglieder.push(id); else offen.push(v.vorname)
    }
    return { id: t.id, mitglieder, offen, ausserKonkurrenz: !!t.ausserKonkurrenz }
  })
}

/** Offene Vornamen erneut zuordnen (z. B. sobald Odettes Konto besteht). */
export function offeneZuordnen(teams: BingoTeam[], team: Array<{ id: string; full_name: string }>): { teams: BingoTeam[]; geaendert: boolean } {
  let geaendert = false
  const vergeben = new Set(teams.flatMap(t => t.mitglieder))
  const out = teams.map(t => {
    if (t.offen.length === 0) return t
    const mitglieder = [...t.mitglieder]
    const offen: string[] = []
    for (const v of t.offen) {
      const alias = BINGO_START_TEAMS.flatMap(s => s.vornamen).find(x => x.vorname === v)?.alias
      const id = idFuerVorname(team, v, alias)
      if (id && !vergeben.has(id)) { mitglieder.push(id); vergeben.add(id); geaendert = true } else offen.push(v)
    }
    return { ...t, mitglieder, offen }
  })
  return { teams: out, geaendert }
}

export function parseTeams(comment: string | null | undefined): BingoTeam[] | null {
  if (!comment) return null
  try {
    const j = JSON.parse(comment) as { teams?: unknown }
    if (!Array.isArray(j.teams)) return null
    const out: BingoTeam[] = []
    for (const t of j.teams as Array<Partial<BingoTeam>>) {
      if (typeof t.id !== 'string' || !TEAM_ID_RE.test(t.id)) continue
      out.push({
        id: t.id,
        mitglieder: Array.isArray(t.mitglieder) ? t.mitglieder.filter((x): x is string => typeof x === 'string').slice(0, 10) : [],
        offen: Array.isArray(t.offen) ? t.offen.filter((x): x is string => typeof x === 'string').slice(0, 10) : [],
        ausserKonkurrenz: t.ausserKonkurrenz === true,
      })
    }
    return out
  } catch { return null }
}

/** «Fränzi + Paola» aus den Rufnamen; offene Vornamen werden angehängt. */
export function teamName(t: BingoTeam, rufnameFuer: (profileId: string) => string | null): string {
  const namen = [...t.mitglieder.map(rufnameFuer).filter((n): n is string => !!n), ...t.offen]
  return namen.length > 0 ? namen.join(' + ') : `Team ${t.id.replace(/^t/, '')}`
}
export const teamVon = (teams: BingoTeam[], profileId: string): BingoTeam | null => teams.find(t => t.mitglieder.includes(profileId)) ?? null

// ── Fotos ───────────────────────────────────────────────────────────────

export type FotoStatus = 'offen' | 'akzeptiert' | 'abgelehnt'
export type BingoFoto = {
  id: string
  slug: string
  team: string
  aufgabe: string
  datum: string            // Upload Datum YYYY-MM-DD (Zürich)
  am: string               // ISO
  von: string              // Name
  vonId: string
  mime: string
  bytes: number
  thumb: boolean
  status: FotoStatus
  entschiedenVon: string | null
  entschiedenAm: string | null
  test: boolean
}

export const FOTO_ID_RE = /^[a-z0-9]{8,24}$/
export const neueBingoId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

export function parseBingoFotos(rows: Array<{ user_full_name: string; schedule_date: string; comment: string }>): BingoFoto[] {
  const out: BingoFoto[] = []
  for (const r of rows) {
    if (!r.user_full_name.startsWith(BINGO_FOTO_PREFIX)) continue
    const rest = r.user_full_name.slice(BINGO_FOTO_PREFIX.length)
    const sep = rest.lastIndexOf('__')
    if (sep <= 0) continue
    try {
      const j = JSON.parse(r.comment) as Partial<BingoFoto>
      if (typeof j.team !== 'string' || typeof j.aufgabe !== 'string') continue
      out.push({
        id: rest.slice(sep + 2), slug: rest.slice(0, sep), team: j.team, aufgabe: j.aufgabe,
        datum: r.schedule_date.slice(0, 10), am: typeof j.am === 'string' ? j.am : '',
        von: typeof j.von === 'string' ? j.von : '', vonId: typeof j.vonId === 'string' ? j.vonId : '',
        mime: typeof j.mime === 'string' ? j.mime : 'image/jpeg', bytes: typeof j.bytes === 'number' ? j.bytes : 0,
        thumb: j.thumb !== false,
        status: j.status === 'akzeptiert' || j.status === 'abgelehnt' ? j.status : 'offen',
        entschiedenVon: typeof j.entschiedenVon === 'string' ? j.entschiedenVon : null,
        entschiedenAm: typeof j.entschiedenAm === 'string' ? j.entschiedenAm : null,
        test: j.test === true,
      })
    } catch { /* überspringen */ }
  }
  return out.sort((a, b) => a.am.localeCompare(b.am))
}

/** Höchstzahl Fotos, die eine Person für ein Feld noch hochladen darf. */
export function uploadLimit(aufgabe: BingoAufgabe, vorhanden: BingoFoto[], vonId: string): { frei: number; max: number; proPerson: boolean } {
  const relevant = aufgabe.proPerson ? vorhanden.filter(f => f.vonId === vonId) : vorhanden
  return { frei: Math.max(0, aufgabe.maxFotos - relevant.length), max: aufgabe.maxFotos, proPerson: !!aufgabe.proPerson }
}

// ── Wertung und Punkte ──────────────────────────────────────────────────

export type TeamWertung = {
  buchstabenOk: boolean
  /** Früherer Bonus Wartezeitrekord, wird nicht mehr vergeben und zählt nicht */
  bonusWartezeit: boolean
  bonusKuerbis: boolean
  bonusSchritte: boolean
  korrektur: number
  korrekturGrund: string
}
export const LEERE_WERTUNG: TeamWertung = { buchstabenOk: false, bonusWartezeit: false, bonusKuerbis: false, bonusSchritte: false, korrektur: 0, korrekturGrund: '' }

export function parseWertung(comment: string | null | undefined): TeamWertung {
  if (!comment) return { ...LEERE_WERTUNG }
  try {
    const j = JSON.parse(comment) as Partial<TeamWertung>
    return {
      buchstabenOk: j.buchstabenOk === true,
      bonusWartezeit: j.bonusWartezeit === true,
      bonusKuerbis: j.bonusKuerbis === true,
      bonusSchritte: j.bonusSchritte === true,
      korrektur: typeof j.korrektur === 'number' && Number.isFinite(j.korrektur) ? Math.max(-99, Math.min(99, Math.round(j.korrektur))) : 0,
      korrekturGrund: typeof j.korrekturGrund === 'string' ? j.korrekturGrund.trim().slice(0, 200) : '',
    }
  } catch { return { ...LEERE_WERTUNG } }
}

export type TeamPunkte = {
  /** erledigte Aufgaben (ohne das freie Feld) */
  erledigt: Set<string>
  felder: number
  reihen: number
  volleKarte: boolean
  bonus: number
  korrektur: number
  total: number
  /** Zeitpunkt, an dem das letzte erledigte Feld sein erstes akzeptiertes Foto erhielt */
  letztesFeldAm: string | null
}

/** Die eine zentrale Punkterechnung. Zählt ausschliesslich akzeptierte
 *  Fotos; mehrere akzeptierte Fotos im selben Feld zählen einmal; die
 *  Buchstabenjagd zählt nur mit der Jurymarkierung; das freie Feld gibt
 *  keinen Punkt, zählt aber für Reihen. */
export function punkteFuer(fotos: BingoFoto[], wertung: TeamWertung): TeamPunkte {
  const erstesAkzeptiert = new Map<string, string>()
  for (const f of fotos) {
    if (f.status !== 'akzeptiert') continue
    const a = aufgabeFuer(f.aufgabe)
    if (!a || a.id === BINGO_FREI_ID) continue
    if (a.buchstaben && !wertung.buchstabenOk) continue
    const bisher = erstesAkzeptiert.get(a.id)
    if (!bisher || f.am < bisher) erstesAkzeptiert.set(a.id, f.am)
  }
  const erledigt = new Set(erstesAkzeptiert.keys())
  const feldErledigt = (i: number) => BINGO_LAYOUT[i] === BINGO_FREI_ID || erledigt.has(BINGO_LAYOUT[i])
  const reihen = BINGO_REIHEN.filter(r => r.every(feldErledigt)).length
  const volleKarte = erledigt.size === BINGO_AUFGABEN.length
  // Der frühere Bonus Wartezeitrekord wird nicht mehr vergeben (gespeicherte Werte zählen nicht)
  const bonus = (wertung.bonusKuerbis ? 1 : 0) + (wertung.bonusSchritte ? 1 : 0)
  const total = erledigt.size * PUNKTE.feld + reihen * PUNKTE.reihe + (volleKarte ? PUNKTE.karte : 0) + bonus * PUNKTE.bonus + wertung.korrektur
  let letztesFeldAm: string | null = null
  erstesAkzeptiert.forEach(am => { if (!letztesFeldAm || am > letztesFeldAm) letztesFeldAm = am })
  return { erledigt, felder: erledigt.size, reihen, volleKarte, bonus, korrektur: wertung.korrektur, total, letztesFeldAm }
}

export type RangZeile = { team: BingoTeam; punkte: TeamPunkte; rang: number }

/** Rangliste ohne die Teams ausser Konkurrenz. Gleichstand: mehr erledigte
 *  Felder, dann das früher vollständige Team. */
export function rangliste(teams: BingoTeam[], fotosJeTeam: Map<string, BingoFoto[]>, wertungJeTeam: Map<string, TeamWertung>): RangZeile[] {
  const zeilen = teams
    .filter(t => !t.ausserKonkurrenz)
    .map(t => ({ team: t, punkte: punkteFuer(fotosJeTeam.get(t.id) ?? [], wertungJeTeam.get(t.id) ?? LEERE_WERTUNG), rang: 0 }))
    .sort((a, b) =>
      b.punkte.total - a.punkte.total ||
      b.punkte.felder - a.punkte.felder ||
      (a.punkte.letztesFeldAm ?? '9').localeCompare(b.punkte.letztesFeldAm ?? '9') ||
      a.team.id.localeCompare(b.team.id))
  zeilen.forEach((z, i) => { z.rang = i + 1 })
  return zeilen
}

// ── Spielregeln ─────────────────────────────────────────────────────────

export function spielregeln(e: BingoEinstellungen): string[] {
  return [
    'Jedes Zimmer ist ein Team, ihr teilt euch eine Bingokarte',
    'Ihr müsst nicht zusammen unterwegs sein, jedes Foto von euch zählt fürs Team',
    'Pro Feld 1 Punkt, pro volle Reihe 3 Extrapunkte, für die volle Karte 10 Extrapunkte',
    'Kürbismeer und Schrittzähler bringen dem besten Team je 2 Extrapunkte',
    'Die Jury prüft alle Fotos, es zählen nur Fotos, welche die Aufgabe erfüllen',
    'Das Team mit den meisten Punkten bekommt am Ende einen Preis, dazu gibt es einen Jurypreis für das kreativste Foto',
    `Das Bingo läuft von ${wochentagKurz(e.start)} ${uhrzeit(e.start)} Uhr bis ${wochentagKurz(e.ende)} ${uhrzeit(e.ende)} Uhr, ab ${uhrzeit(e.sichtbarAb)} Uhr seht ihr alle Karten, die Rangliste gibt es im Bus auf der Heimfahrt`,
  ]
}

/** Kurztext für die Kachel Spiele im Ordner. */
export const spieleBeschreibung = (e: BingoEinstellungen) =>
  `Fotobingo von ${wochentagKurz(e.start)} ${uhrzeit(e.start)} Uhr bis ${wochentagKurz(e.ende)} ${uhrzeit(e.ende)} Uhr, ab ${uhrzeit(e.sichtbarAb)} Uhr alle Karten sichtbar, Rangliste im Bus`

/** Ordner mit Fotobingo. */
export const BINGO_SLUGS = new Set(['europapark-2026'])
export const hatBingo = (slug: string) => BINGO_SLUGS.has(slug)

// ── Jury (Favoriten, Jurypreis) und Protokoll ───────────────────────────

export const BINGO_JURY_PREFIX = '__teamevent_bingojury__'
export const bingoJuryKey = (slug: string) => `${BINGO_JURY_PREFIX}${slug}`

export type BingoJury = { favoriten: string[]; preis: string | null }
export function parseJury(comment: string | null | undefined): BingoJury {
  if (!comment) return { favoriten: [], preis: null }
  try {
    const j = JSON.parse(comment) as { favoriten?: unknown; preis?: unknown }
    return {
      favoriten: Array.isArray(j.favoriten) ? j.favoriten.filter((x): x is string => typeof x === 'string' && FOTO_ID_RE.test(x)).slice(0, 200) : [],
      preis: typeof j.preis === 'string' && FOTO_ID_RE.test(j.preis) ? j.preis : null,
    }
  } catch { return { favoriten: [], preis: null } }
}

export type LogEintrag = { id: string; am: string; von: string; aktion: string; text: string; test: boolean }

const LOG_TEXTE: Record<string, (j: Record<string, unknown>) => string> = {
  entscheid: j => `Foto ${String(j.aufgabe ?? '')} von Team ${String(j.teamName ?? j.team ?? '')} auf «${String(j.status ?? '')}» gesetzt`,
  wertung: j => `Wertung Team ${String(j.teamName ?? j.team ?? '')} geändert (${String(j.was ?? '')})`,
  'foto-geloescht': j => `Foto ${String(j.aufgabe ?? '')} von Team ${String(j.teamName ?? j.team ?? '')} gelöscht (hochgeladen von ${String(j.hochgeladenVon ?? '')})`,
  'testdaten-geloescht': j => `${String(j.fotos ?? 0)} Testfotos gelöscht`,
  favorit: j => `Favorit ${j.favorit ? 'gesetzt' : 'entfernt'} für Foto ${String(j.foto ?? '')}`,
  jurypreis: j => (j.foto ? `Jurypreis an Foto ${String(j.foto)} vergeben` : 'Jurypreis zurückgenommen'),
  resultate: j => (j.an ? 'Resultate veröffentlicht' : 'Veröffentlichung der Resultate zurückgenommen'),
}

export function parseLogs(rows: Array<{ user_full_name: string; schedule_date: string; comment: string }>, slug: string): LogEintrag[] {
  const prefix = bingoLogKey(slug, '')
  const out: LogEintrag[] = []
  for (const r of rows) {
    if (!r.user_full_name.startsWith(prefix)) continue
    try {
      const j = JSON.parse(r.comment) as Record<string, unknown>
      const aktion = typeof j.aktion === 'string' ? j.aktion : 'unbekannt'
      out.push({
        id: r.user_full_name.slice(prefix.length),
        am: typeof j.am === 'string' ? j.am : '',
        von: typeof j.von === 'string' ? j.von : '',
        aktion,
        text: (LOG_TEXTE[aktion] ?? (() => aktion))(j),
        test: j.test === true,
      })
    } catch { /* überspringen */ }
  }
  return out.sort((a, b) => b.am.localeCompare(a.am))
}

/** Punkte als einfache Werte für den Browser (Set wird zur Liste). */
export type PunkteAnsicht = Omit<TeamPunkte, 'erledigt'> & { erledigt: string[] }
export const punkteAnsicht = (p: TeamPunkte): PunkteAnsicht => ({ ...p, erledigt: Array.from(p.erledigt) })
