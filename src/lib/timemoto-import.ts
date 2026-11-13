// Import der TimeMoto Monatsexporte (CSV, TSV oder XLSX) als Stempelereignisse.
// Solange das Terminal nicht per Webhook ans Portal sendet, exportiert die
// Praxisleitung die Stempelungen im TimeMoto Portal und lädt die Datei hier
// hoch. Daraus entstehen dieselben Zeilen in attendance_events wie aus dem
// Webhook; Berichte, Konto, PDF und Mitarbeiter Ansicht rechnen danach ohne
// Unterschied.
//
// Erkannt werden drei Formen, jeweils über die Kopfzeile (nie blind nach
// Spaltenposition):
//   · Ereignisse: eine Zeile pro Stempelung mit Name, Datum und Zeit (oder
//     Zeitstempel) und Typ (Ein/Aus, In/Out, Kommen/Gehen, Pause …)
//   · Tage: eine Zeile pro Person und Tag mit Spalten Ein/Aus, Start/Ende,
//     Von/Bis, auch mehrfach (Ein 1, Aus 1, Ein 2, Aus 2 …)
//   · Portal Vorlage: timemoto_event_id, user_full_name, clocking_type,
//     time_logged (attendance_events_template.csv)
//   · Timesheet als PDF: ein Abschnitt «Name:» pro Person, siehe
//     timemoto-timesheet.ts; als CSV oder XLSX gilt dieselbe Abschnittslogik
//     hier (Zeilen ohne Namen gehören der zuletzt genannten Person, Zeilen
//     ohne Datum mit Zeiten dem zuletzt genannten Tag)
// Zeiten sind Zürcher Wandzeit und werden über zurichZuIso in UTC gespeichert.
// Die Ereignis ID ist aus Person, Typ und Zeit abgeleitet, darum ist ein
// zweiter Import derselben Datei ohne Doppelte (Zeit-Sperre wie beim Webhook).

import { zurichZuIso } from './zeitzone'

export type ImportTyp = 'In' | 'Out'

export type ImportZeile = {
  /** Name wie in der Datei (Vorname Nachname oder Nachname Vorname) */
  name: string
  datum: string          // YYYY-MM-DD, Zürcher Wandzeit
  zeit: string           // HH:MM
  typ: ImportTyp
  userId: string | null  // Benutzer ID bei TimeMoto, falls in der Datei
  zeile: number          // Zeilennummer in der Datei (1 = Kopfzeile)
}

export type ImportFormat = 'ereignisse' | 'tage' | 'portal' | 'timesheet'

export type ParseErgebnis = {
  format: ImportFormat | null
  kopf: string[]
  zeilen: ImportZeile[]
  /** Zeilen ohne verwertbare Zeit oder Typ (zum Beispiel Absenzen, Summen) */
  uebersprungen: number
  fehler: string[]
}

// ── Text und Tabelle ─────────────────────────────────────────────────────────

/** Bytes als Text: UTF-8 (mit oder ohne BOM), sonst Windows-1252 (Excel Export). */
export function decodeBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** Trennzeichen aus der Kopfzeile: Semikolon, Tab oder Komma, je nach Häufigkeit. */
export function erkenneTrenner(kopf: string): ';' | '\t' | ',' {
  const n = (c: string) => kopf.split(c).length - 1
  const kandidaten: Array<[';' | '\t' | ',', number]> = [[';', n(';')], ['\t', n('\t')], [',', n(',')]]
  kandidaten.sort((a, b) => b[1] - a[1])
  return kandidaten[0][1] > 0 ? kandidaten[0][0] : ';'
}

/** CSV mit Anführungszeichen (auch über Zeilenumbrüche) in Zeilen und Felder. */
export function parseCsv(text: string, trenner?: ';' | '\t' | ','): string[][] {
  const t = text.replace(/\r\n?/g, '\n')
  const sep = trenner ?? erkenneTrenner(t.split('\n').find(l => l.trim()) ?? '')
  const rows: string[][] = []
  let row: string[] = [], feld = '', inQuote = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (inQuote) {
      if (c === '"') { if (t[i + 1] === '"') { feld += '"'; i++ } else inQuote = false }
      else feld += c
    } else if (c === '"') inQuote = true
    else if (c === sep) { row.push(feld); feld = '' }
    else if (c === '\n') { row.push(feld); rows.push(row); row = []; feld = '' }
    else feld += c
  }
  if (feld !== '' || row.length > 0) { row.push(feld); rows.push(row) }
  return rows.map(r => r.map(f => f.trim()))
}

// ── Kopfzeile ────────────────────────────────────────────────────────────────

export const normKopf = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9/]+/g, ' ').trim()

const ALIAS = {
  name: ['name', 'mitarbeiter', 'mitarbeiterin', 'mitarbeitende', 'benutzer', 'benutzername', 'user', 'user name', 'username', 'full name', 'fullname', 'employee', 'employee name', 'person', 'userfullname', 'user full name', 'nutzer', 'angestellte', 'angestellter'],
  vorname: ['vorname', 'first name', 'firstname', 'given name'],
  nachname: ['nachname', 'familienname', 'last name', 'lastname', 'surname', 'family name'],
  datum: ['datum', 'date', 'tag', 'day', 'arbeitstag', 'buchungsdatum'],
  zeit: ['zeit', 'uhrzeit', 'time', 'stempelzeit', 'buchungszeit', 'clock time'],
  zeitstempel: ['zeitstempel', 'timestamp', 'datum/zeit', 'datum zeit', 'date/time', 'datetime', 'date time', 'time logged', 'timelogged', 'stempel', 'buchung', 'ereigniszeit', 'event time', 'zeitpunkt', 'gestempelt am', 'gestempelt'],
  typ: ['typ', 'type', 'ein/aus', 'in/out', 'richtung', 'direction', 'clocking type', 'clockingtype', 'art', 'status', 'buchungsart', 'ereignis', 'event', 'event type', 'aktion', 'action', 'kommen/gehen', 'stempelart', 'punch type', 'in out'],
  userId: ['benutzer id', 'benutzerid', 'user id', 'userid', 'timemoto user id', 'personalnummer', 'personal nr', 'personalnr', 'mitarbeiternummer', 'mitarbeiter nr', 'employee id', 'employee number', 'nr', 'nummer', 'id', 'badge', 'badge id', 'kartennummer'],
} as const

const EIN_RE = /^(ein|in|start|von|kommen|beginn|arbeitsbeginn|einstempeln|clock in|check in|anfang)(\s*\d+)?$/
const AUS_RE = /^(aus|out|ende|bis|gehen|arbeitsende|ausstempeln|clock out|check out|stop|schluss)(\s*\d+)?$/

function spalte(kopf: string[], aliase: readonly string[]): number {
  const n = kopf.map(normKopf)
  for (const a of aliase) { const i = n.indexOf(a); if (i >= 0) return i }
  return -1
}

// ── Werte ────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')

/** Excel Seriennummer (Tage seit 30.12.1899) in Datum und Zeit. */
export function excelSerial(n: number): { datum: string; zeit: string } {
  const tage = Math.floor(n)
  const rest = n - tage
  const d = new Date(Date.UTC(1899, 11, 30) + tage * 86400000)
  const minuten = Math.round(rest * 1440)
  return { datum: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, zeit: `${pad(Math.floor(minuten / 60) % 24)}:${pad(minuten % 60)}` }
}

const istZahl = (s: string) => /^\d+(?:[.,]\d+)?$/.test(s)

/** Datum aus dd.mm.yyyy, d.m.yy, yyyy-mm-dd, dd/mm/yyyy oder Excel Seriennummer. */
export function parseDatum(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/)
  if (m) { const j = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return `${j}-${pad(+m[2])}-${pad(+m[1])}` }
  if (istZahl(s) && +s.replace(',', '.') > 20000) return excelSerial(+s.replace(',', '.')).datum
  return null
}

/** Zeit aus HH:MM, HH:MM:SS, H.MM (Schweizer Schreibweise) oder Excel Bruchteil. */
export function parseZeit(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  let m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?/)
  if (m && +m[1] < 24 && +m[2] < 60) return `${pad(+m[1])}:${m[2]}`
  m = s.match(/^(\d{1,2})\.(\d{2})$/)
  if (m && +m[1] < 24 && +m[2] < 60) return `${pad(+m[1])}:${m[2]}`
  if (istZahl(s)) { const n = +s.replace(',', '.'); if (n >= 0 && n < 1) return excelSerial(n).zeit; if (n >= 20000) return excelSerial(n).zeit }
  return null
}

/** Zeitstempel: Datum und Zeit in einem Feld (auch ISO mit T oder Excel Zahl). */
export function parseZeitstempel(raw: string): { datum: string; zeit: string } | null {
  const s = raw.trim()
  if (!s) return null
  if (istZahl(s) && +s.replace(',', '.') > 20000) return excelSerial(+s.replace(',', '.'))
  const datum = parseDatum(s)
  if (!datum) return null
  const rest = s.replace(/^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./]\d{1,2}[./]\d{2,4})[T\s,]*/, '')
  const zeit = parseZeit(rest)
  return zeit ? { datum, zeit } : null
}

const TYP_EIN = ['in', 'ein', 'kommen', 'arbeitsbeginn', 'start', 'beginn', 'einstempeln', 'clock in', 'check in', 'ankunft', 'arrival', 'come', 'pause ende', 'pausenende', 'break end', 'end break', 'zuruck', 'back', 'return', 'wieder da', 'eingang', 'i', 'e', 'k', '1']
const TYP_AUS = ['out', 'aus', 'gehen', 'arbeitsende', 'ende', 'stop', 'ausstempeln', 'clock out', 'check out', 'leave', 'abgang', 'pause', 'break', 'pausenbeginn', 'pause start', 'break start', 'start break', 'ausgang', 'o', 'a', 'g', '0']

/** Typ einer Stempelung: In oder Out; Pause gilt als Out, Pause Ende als In. */
export function parseTyp(raw: string): ImportTyp | null {
  const s = normKopf(raw)
  if (!s) return null
  if (TYP_EIN.includes(s)) return 'In'
  if (TYP_AUS.includes(s)) return 'Out'
  if (/^(pause|break)\s*(ende|end|zuruck|back)/.test(s)) return 'In'
  if (/^(pause|break)/.test(s)) return 'Out'
  if (/\b(in|ein|kommen|start)\b/.test(s)) return 'In'
  if (/\b(out|aus|gehen|ende|stop)\b/.test(s)) return 'Out'
  return null
}

// ── Tabelle in Zeilen ────────────────────────────────────────────────────────

/** Kopfzeile finden: die erste Zeile, die einen Namen und eine Zeit, einen
 *  Zeitstempel oder Ein/Aus Spalten trägt (TimeMoto schreibt teils Titel
 *  und Zeitraum über die eigentliche Tabelle). */
function findeKopf(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const k = rows[i]
    const hatName = spalte(k, ALIAS.name) >= 0 || (spalte(k, ALIAS.vorname) >= 0 && spalte(k, ALIAS.nachname) >= 0)
      || rows.slice(0, i).some(r => r.some(c => /^name\s*:/i.test(c.trim())))
    const hatZeit = spalte(k, ALIAS.zeit) >= 0 || spalte(k, ALIAS.zeitstempel) >= 0 || k.some(c => EIN_RE.test(normKopf(c)))
    if (hatName && hatZeit) return i
  }
  return -1
}

export function parseTabelle(rows: string[][]): ParseErgebnis {
  const leer: ParseErgebnis = { format: null, kopf: [], zeilen: [], uebersprungen: 0, fehler: [] }
  const ki = findeKopf(rows)
  if (ki < 0) return { ...leer, fehler: ['Keine Kopfzeile mit Name und Zeit gefunden. Erwartet wird ein TimeMoto Export der Stempelungen (Name, Datum, Zeit, Ein/Aus) oder eine Tagesliste mit Spalten Ein und Aus.'] }
  const kopf = rows[ki]
  const iName = spalte(kopf, ALIAS.name), iVor = spalte(kopf, ALIAS.vorname), iNach = spalte(kopf, ALIAS.nachname)
  const iDatum = spalte(kopf, ALIAS.datum), iZeit = spalte(kopf, ALIAS.zeit), iStempel = spalte(kopf, ALIAS.zeitstempel)
  const iTyp = spalte(kopf, ALIAS.typ), iUser = spalte(kopf, ALIAS.userId)
  const einSpalten = kopf.map((c, i) => (EIN_RE.test(normKopf(c)) ? i : -1)).filter(i => i >= 0)
  const ausSpalten = kopf.map((c, i) => (AUS_RE.test(normKopf(c)) ? i : -1)).filter(i => i >= 0)
  const portal = normKopf(kopf[iName] ?? '') === 'user full name' || kopf.map(normKopf).includes('clocking type')

  // Abschnittszeilen «Name: Vorname Nachname» (Timesheet Export mit einem
  // Block pro Person): die folgenden Zeilen ohne Namen gehören dieser Person
  const abschnittVon = (r: string[]): string | null => {
    const i = r.findIndex(c => /^name\s*:\s*\S*/i.test(c.trim()) && !/^name\s*:?$/i.test(c.trim()) || /^name\s*:$/i.test(c.trim()))
    if (i < 0) return null
    const inline = r[i].trim().match(/^name\s*:\s*(.+)$/i)
    const wert = inline ? inline[1] : (r.slice(i + 1).find(c => c.trim()) ?? '')
    const n = wert.replace(/\s+(department|abteilung|schedule|employee|mitarbeiter)\b.*$/i, '').replace(/\s+/g, ' ').trim()
    return n || null
  }
  let abschnitt = ''
  let letzterName = ''
  let letztesDatum = ''
  const kopfNorm = kopf.map(normKopf).join('|')
  const nameVon = (r: string[]) => {
    const direkt = iName >= 0 ? (r[iName] ?? '').trim() : ''
    if (direkt) return direkt.replace(/\s+/g, ' ')
    const v = iVor >= 0 ? (r[iVor] ?? '').trim() : '', n = iNach >= 0 ? (r[iNach] ?? '').trim() : ''
    return `${v} ${n}`.replace(/\s+/g, ' ').trim() || abschnitt
  }
  const userVon = (r: string[]) => (iUser >= 0 ? (r[iUser] ?? '').trim() || null : null)
  /** Abschnittszeile oder wiederholte Kopfzeile (neue Seite): verarbeitet, true = überspringen */
  const struktur = (r: string[]): boolean => {
    const neu = abschnittVon(r)
    if (neu) { abschnitt = neu; letzterName = neu; letztesDatum = ''; return true }
    return r.map(normKopf).join('|') === kopfNorm
  }

  // Abschnittszeilen über der Kopfzeile (Timesheet: «Name:» steht vor der Tabelle)
  for (let i = 0; i < ki; i++) { const n = abschnittVon(rows[i]); if (n) { abschnitt = n; letzterName = n } }

  const zeilen: ImportZeile[] = []
  let uebersprungen = 0
  const fehler: string[] = []
  let format: ImportFormat

  if (iTyp >= 0 && (iStempel >= 0 || (iDatum >= 0 && iZeit >= 0))) {
    format = portal ? 'portal' : 'ereignisse'
    for (let i = ki + 1; i < rows.length; i++) {
      const r = rows[i]
      if (r.every(c => !c)) continue
      if (struktur(r)) continue
      const name = nameVon(r) || letzterName
      if (name) letzterName = name
      const typ = parseTyp(r[iTyp] ?? '')
      const dz = iStempel >= 0 ? parseZeitstempel(r[iStempel] ?? '') : (() => { const d = parseDatum(r[iDatum] ?? ''), z = parseZeit(r[iZeit] ?? ''); return d && z ? { datum: d, zeit: z } : null })()
      if (!name || !typ || !dz) { uebersprungen++; continue }
      zeilen.push({ name, datum: dz.datum, zeit: dz.zeit, typ, userId: userVon(r), zeile: i + 1 })
    }
  } else if (iDatum >= 0 && einSpalten.length > 0) {
    format = 'tage'
    const paare = einSpalten.map((e, idx) => [e, ausSpalten[idx] ?? -1] as const)
    for (let i = ki + 1; i < rows.length; i++) {
      const r = rows[i]
      if (r.every(c => !c)) continue
      if (struktur(r)) continue
      const name = nameVon(r) || letzterName
      if (name !== letzterName) { letztesDatum = ''; letzterName = name }
      const zeiten = paare.map(([e, a]) => [parseZeit(r[e] ?? ''), a >= 0 ? parseZeit(r[a] ?? '') : null] as const)
      const hatZeit = zeiten.some(([e, a]) => e || a)
      // Absenz: in der IN Spalte steht ein Text (Ferien, Krank …), die OUT Spalte trägt dann nur die Sollstunden
      const absenz = paare.some(([e]) => (r[e] ?? '').trim() !== '' && !parseZeit(r[e] ?? ''))
      let datum = parseDatum(r[iDatum] ?? '')
      if (!datum) {
        // Fortsetzung desselben Tags (weiteres Paar, beginnt mit IN) oder
        // Summenzeile: eine Zeit nur in der OUT Spalte ist nie eine Stempelung
        if (!zeiten.some(([e]) => e) || !letztesDatum) continue
        datum = letztesDatum
      } else letztesDatum = datum
      if (!name) { uebersprungen++; continue }
      if (absenz || !hatZeit) { uebersprungen++; continue }   // Absenz oder Tag ohne Stempel
      for (const [ein, aus] of zeiten) {
        if (ein) zeilen.push({ name, datum, zeit: ein, typ: 'In', userId: userVon(r), zeile: i + 1 })
        if (aus) zeilen.push({ name, datum, zeit: aus, typ: 'Out', userId: userVon(r), zeile: i + 1 })
      }
    }
  } else {
    return { ...leer, kopf, fehler: ['Die Kopfzeile ist unvollständig: es braucht Name, Datum und Zeit (oder einen Zeitstempel) und die Spalte Ein/Aus, oder eine Tagesliste mit Datum und Spalten Ein und Aus.'] }
  }
  if (zeilen.length === 0) fehler.push('In der Datei wurden keine Stempelungen gefunden.')
  return { format, kopf, zeilen, uebersprungen, fehler }
}

// ── Namen zuordnen ───────────────────────────────────────────────────────────

export type ProfilKurz = { id: string; full_name: string }

/** Namen vergleichbar machen: ohne Akzente, Gross- und Kleinschreibung, Satzzeichen. */
export const normName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Zuordnung eines Dateinamens zu einem Profil: gespeicherte Zuordnung,
 *  exakt, umgekehrte Reihenfolge (Nachname Vorname), gleiche Wörter, sonst
 *  eindeutige Teilmenge der Wörter (Doppelname im Profil). */
export function findeProfil(rawName: string, profile: ProfilKurz[], gespeichert: Record<string, string> = {}): ProfilKurz | null {
  const n = normName(rawName)
  if (!n) return null
  const gesp = gespeichert[n]
  if (gesp) { const p = profile.find(x => x.id === gesp); if (p) return p }
  const exakt = profile.find(p => normName(p.full_name) === n)
  if (exakt) return exakt
  const w = n.split(' ')
  const umgekehrt = [...w].reverse().join(' ')
  const rev = profile.find(p => normName(p.full_name) === umgekehrt)
  if (rev) return rev
  const menge = (s: string) => new Set(normName(s).split(' '))
  const mine = menge(rawName)
  const meine = Array.from(mine)
  const gleich = profile.filter(p => { const t = menge(p.full_name); return t.size === mine.size && meine.every(x => t.has(x)) })
  if (gleich.length === 1) return gleich[0]
  const teil = profile.filter(p => { const t = menge(p.full_name); return meine.every(x => t.has(x)) || Array.from(t).every(x => mine.has(x)) })
  if (teil.length === 1 && mine.size >= 2) return teil[0]
  return null
}

// ── Ereignisse bauen ─────────────────────────────────────────────────────────

/** FNV-1a 64 Bit als 16 Hex Zeichen, für stabile Ereignis IDs. */
export function hash64(s: string): string {
  let h = BigInt('0xcbf29ce484222325')
  const prime = BigInt('0x100000001b3'), maske = BigInt('0xffffffffffffffff')
  const bytes = new TextEncoder().encode(s)
  for (let i = 0; i < bytes.length; i++) { h ^= BigInt(bytes[i]); h = (h * prime) & maske }
  return h.toString(16).padStart(16, '0')
}

export const importEventId = (employeeId: string, typ: ImportTyp, iso: string) => `import_${hash64(`${employeeId}|${typ}|${iso}`)}`

export type ImportEvent = {
  timemoto_event_id: string
  timemoto_user_id: string | null
  employee_id: string
  user_full_name: string
  clocking_type: ImportTyp
  time_logged: string
  time_inserted: null
  clocking_pair_id: string
  department_name: null
  location_name: string
  raw_payload: { source: 'import_timemoto'; datei: string; zeile: number; name: string }
  deleted_at: null
}

/** Stempelzeilen einer Person in attendance_events Zeilen: pro Tag der Reihe
 *  nach gepaart (In öffnet ein Paar, Out schliesst es; ein Out ohne In
 *  bildet ein eigenes Paar), Zeiten als UTC aus Zürcher Wandzeit, IDs stabil. */
export function baueEvents(zeilen: ImportZeile[], profil: ProfilKurz, datei: string, ort: string): ImportEvent[] {
  const sortiert = [...zeilen].sort((a, b) => a.datum.localeCompare(b.datum) || a.zeit.localeCompare(b.zeit) || (a.typ === 'In' ? -1 : 1))
  const out: ImportEvent[] = []
  const gesehen = new Set<string>()
  let tag = '', n = 0, offen = false
  for (const z of sortiert) {
    const iso = zurichZuIso(z.datum, z.zeit)
    const id = importEventId(profil.id, z.typ, iso)
    if (gesehen.has(id)) continue   // dieselbe Stempelung zweimal in der Datei
    gesehen.add(id)
    if (z.datum !== tag) { tag = z.datum; n = 0; offen = false }
    if (z.typ === 'In' || !offen) n++
    offen = z.typ === 'In'
    out.push({
      timemoto_event_id: id,
      timemoto_user_id: z.userId,
      employee_id: profil.id,
      user_full_name: profil.full_name,
      clocking_type: z.typ,
      time_logged: iso,
      time_inserted: null,
      clocking_pair_id: `importpair_${profil.id.slice(0, 8)}_${z.datum}_${n}`,
      department_name: null,
      location_name: ort,
      raw_payload: { source: 'import_timemoto', datei, zeile: z.zeile, name: z.name },
      deleted_at: null,
    })
  }
  return out
}

/** Zusammenfassung pro Dateiname für die Vorschau. */
export type NamenStand = { name: string; anzahl: number; tage: number; von: string; bis: string; profil: ProfilKurz | null }

export function namenStand(zeilen: ImportZeile[], profile: ProfilKurz[], gespeichert: Record<string, string> = {}): NamenStand[] {
  const map = new Map<string, NamenStand>()
  const tage = new Map<string, Set<string>>()
  for (const z of zeilen) {
    const k = normName(z.name)
    const s = map.get(k) ?? { name: z.name, anzahl: 0, tage: 0, von: z.datum, bis: z.datum, profil: findeProfil(z.name, profile, gespeichert) }
    const t = tage.get(k) ?? new Set<string>()
    t.add(z.datum); tage.set(k, t); s.tage = t.size
    s.anzahl++
    if (z.datum < s.von) s.von = z.datum
    if (z.datum > s.bis) s.bis = z.datum
    map.set(k, s)
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

/** Erste Zeile der Datei mit Inhalt ist «PK»: ein XLSX (Zip). */
export const istXlsx = (bytes: Uint8Array, name = '') => (bytes[0] === 0x50 && bytes[1] === 0x4b) || /\.xlsx$/i.test(name)
