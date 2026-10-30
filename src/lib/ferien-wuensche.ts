// Ferienwünsche (vacation wishes) for the Ferienplanung.
//
// Stored in zeiterfassung_comments under reserved keys (no dedicated table
// available — same mechanism as the __konto__ rows):
//   user_full_name = "__ferienwunsch__<employee_id>", schedule_date = <from>,
//     comment = JSON { to, status, createdAt, decidedAt?, decidedBy? }
//   user_full_name = "__ferien_phasen__", schedule_date = <PLAN_YEAR>-01-01,
//     comment = JSON { zahnaerzte, dhpa, da }   (phase deadlines, ISO dates)
//
// Accepting a wish writes the days as «F» into work_schedule (exactly like
// the direct Ferienplanung form), so they appear in Arbeitsplan and Konto.

export const PLAN_YEAR = 2027

export const WUNSCH_PREFIX = '__ferienwunsch__'
export const PHASEN_KEY = '__ferien_phasen__'

export type WunschStatus = 'offen' | 'akzeptiert' | 'abgelehnt'

/** Art des Wunschs — bestimmt den Arbeitsplan-Code beim Akzeptieren:
 *  Ferien → «F» (zählt Ferientage), unbezahlte Ferien → «UF» (Tag zählt
 *  8:30 im Zeitkonto, KEIN Ferienbezug — der Lohnabzug läuft über die
 *  Lohnabrechnung), Weiterbildung → «WB» (zählt als Arbeitszeit 8:30). */
export type WunschArt = 'ferien' | 'unbezahlt' | 'weiterbildung'

export const WUNSCH_ARTEN: Array<{ key: WunschArt; label: string; code: string }> = [
  { key: 'ferien',        label: 'Ferien',            code: 'F'  },
  { key: 'unbezahlt',     label: 'Unbezahlte Ferien', code: 'UF' },
  { key: 'weiterbildung', label: 'Weiterbildung',     code: 'WB' },
]

export function normalizeWunschArt(a: unknown): WunschArt {
  return a === 'unbezahlt' || a === 'weiterbildung' ? a : 'ferien'
}

export function wunschArtLabel(a: WunschArt): string {
  return WUNSCH_ARTEN.find(x => x.key === a)?.label ?? 'Ferien'
}

export function wunschArtCode(a: WunschArt): string {
  return WUNSCH_ARTEN.find(x => x.key === a)?.code ?? 'F'
}

/** Priorität eines Wunsches: 1 = Datum fix (sehr wichtig, genau dieses
 *  Datum), 2 = dazwischen, 3 = flexibel (Standard). */
export type WunschPrio = 1 | 2 | 3

export const PRIO_OPTIONEN: Array<{ value: WunschPrio; label: string }> = [
  { value: 1, label: 'Priorität 1 — Datum fix (sehr wichtig)' },
  { value: 2, label: 'Priorität 2 — wichtig, etwas Spielraum' },
  { value: 3, label: 'Priorität 3 — flexibel' },
]

export function normalizeWunschPrio(p: unknown): WunschPrio {
  return p === 1 || p === 2 ? p : 3
}

export type FerienWunsch = {
  employeeId: string
  from: string          // YYYY-MM-DD (row key together with employeeId)
  to: string            // YYYY-MM-DD
  art: WunschArt
  /** Priorität (1 fix … 3 flexibel); ältere Wünsche ohne Angabe = 3 */
  prio?: WunschPrio
  status: WunschStatus
  createdAt: string     // ISO timestamp — first come, first served
  decidedAt?: string | null
  decidedBy?: string | null
  /** Ferienvertretung (nur ZAZ), beim Akzeptieren gesetzt */
  vertretung?: string | null
  /** Tage (YYYY-MM-DD), an denen die Vertretung kommt; null/fehlend = alle Tage */
  vertretungTage?: string[] | null
  /** Grund bei Ablehnung (für die betroffene Person sichtbar) */
  grund?: string | null
  /** 'woche' = Wochenanmeldung der Ferienplanung 2027 (Montag bis Freitag einer KW) */
  quelle?: 'woche' | null
  kw?: number | null
  /** Doppelwoche: zwei Wochenanmeldungen mit gemeinsamer Gruppe */
  gruppe?: string | null
  /** Bemerkung der Person, wofür sie die Tage braucht */
  bemerkung?: string | null
  /** Gewählte Ferientage (tagesgenau, je ein Ferientag); fehlt bei älteren Einträgen, dann zählt der Zeitraum nach Pensum */
  tage?: string[] | null
}

/** Datumsliste bereinigen (nur gültige YYYY-MM-DD); leer → null. */
export function sauberTage(t: unknown): string[] | null {
  if (!Array.isArray(t)) return null
  const out = t.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
  return out.length > 0 ? Array.from(new Set(out)).sort() : null
}

/** Die drei Planungsgruppen (Phasen-Schlüssel). */
export type PhaseKey = 'zahnaerzte' | 'dhpa' | 'da'

export type PhasenDeadlines = {
  zahnaerzte: string | null
  dhpa: string | null
  da: string | null
  /** Optionale STARTDATEN pro Phase: ist eines gesetzt, öffnet die Phase
   *  exakt an diesem Tag (und ersetzt die Kaskade «vorherige Frist
   *  abgelaufen»); ohne Startdatum gilt die bisherige Reihenfolge. */
  zahnaerzteStart?: string | null
  dhpaStart?: string | null
  daStart?: string | null
}

export const PHASE_START_KEY: Record<PhaseKey, 'zahnaerzteStart' | 'dhpaStart' | 'daStart'> = {
  zahnaerzte: 'zahnaerzteStart', dhpa: 'dhpaStart', da: 'daStart',
}

export const EMPTY_PHASEN: PhasenDeadlines = {
  zahnaerzte: null, dhpa: null, da: null,
  zahnaerzteStart: null, dhpaStart: null, daStart: null,
}

/** Tageszeiten der Eingabefenster (Europe/Zurich): eine Phase öffnet am
 *  Starttag um 06:00 und schliesst am Fristtag um 23:55. */
export const PHASE_OPEN_TIME = '06:00'
export const PHASE_CLOSE_TIME = '23:55'

/** Aktuelle Zürcher Zeit als 'YYYY-MM-DDTHH:mm' — als String vergleichbar. */
export function zurichNow(): string {
  return new Date()
    .toLocaleString('sv-SE', { timeZone: 'Europe/Zurich', hour12: false })
    .slice(0, 16)
    .replace(' ', 'T')
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Fest vereinbarte Startdaten (Bianka, 23.09.2026): die Eingabe der
 *  Zahnärzte/-innen für 2027 öffnet am 24.09.2026 um 06:00. Der Default
 *  greift nur, solange im Fristen-Dialog noch NIE ein Startdatum für diese
 *  Phase gespeichert wurde (auch ein bewusst geleertes Feld gilt als
 *  gespeichert und übersteuert den Default). */
const DEFAULT_STARTS: Partial<PhasenDeadlines> =
  PLAN_YEAR === 2027 ? { zahnaerzteStart: '2026-09-24' } : {}

/** Gespeicherte Phasen-Zeile parsen — gemeinsamer Pfad für alle Lade-
 *  stellen: fehlende Schlüssel werden mit EMPTY_PHASEN aufgefüllt, für nie
 *  gespeicherte Start-Schlüssel greifen die DEFAULT_STARTS. */
export function parsePhasenComment(comment: string | null | undefined): PhasenDeadlines {
  let parsed: Partial<PhasenDeadlines> = {}
  if (comment) {
    try { parsed = JSON.parse(comment) as Partial<PhasenDeadlines> } catch { /* leere Defaults */ }
  }
  const merged: PhasenDeadlines = { ...EMPTY_PHASEN, ...parsed }
  for (const [k, v] of Object.entries(DEFAULT_STARTS) as Array<['zahnaerzteStart' | 'dhpaStart' | 'daStart', string]>) {
    if (!(k in parsed)) merged[k] = v
  }
  return merged
}

/** The three planning phases, in order. `match` maps a profile job_title. */
export const PHASE_DEFS: Array<{
  key: PhaseKey
  label: string
  short: string
  match: (t: string | null) => boolean
}> = [
  { key: 'zahnaerzte', label: 'Zahnärzte/-innen (ZAZ)', short: 'ZAZ',
    match: t => t === 'ZAZ' },
  { key: 'dhpa', label: 'DH / PA', short: 'DH / PA',
    match: t => t === 'DH / PA' || t === 'DH' || t === 'PA' },
  { key: 'da', label: 'DA, Lernende & weitere', short: 'DA',
    match: t => !(t === 'ZAZ' || t === 'DH / PA' || t === 'DH' || t === 'PA') },
]

export type PhaseState = 'aktiv' | 'abgeschlossen' | 'ausstehend' | 'offen'

/** Which planning phase an employee belongs to, from their job title. */
export function phaseKeyForTitle(t: string | null): PhaseKey {
  const def = PHASE_DEFS.find(p => p.match(t))
  return def ? def.key : 'da'
}

/** State of one phase: no own deadline → 'offen' (not opened yet); ab
 *  Fristtag 23:55 → 'abgeschlossen'. Die Öffnung ist minutengenau um 06:00:
 *  an einem expliziten STARTDATUM (übersteuert die Kaskade), sonst am Tag
 *  nach der letzten früheren Frist (Kaskade). `now` kommt von zurichNow()
 *  ('YYYY-MM-DDTHH:mm'); ein reines Datum wird als 12:00 Uhr gewertet. */
export function phaseStateFor(phasen: PhasenDeadlines, key: PhaseKey, now: string): PhaseState {
  const t = now.length > 10 ? now : `${now}T12:00`
  const idx = PHASE_DEFS.findIndex(p => p.key === key)
  const d = phasen[key]
  if (!d) return 'offen'
  if (t >= `${d}T${PHASE_CLOSE_TIME}`) return 'abgeschlossen'
  const start = phasen[PHASE_START_KEY[key]]
  if (start) return t < `${start}T${PHASE_OPEN_TIME}` ? 'ausstehend' : 'aktiv'
  for (let i = 0; i < idx; i++) {
    const p = phasen[PHASE_DEFS[i].key]
    if (p && t < `${nextDay(p)}T${PHASE_OPEN_TIME}`) return 'ausstehend'
  }
  return 'aktiv'
}

/** List weekdays (Mon–Fri) between two ISO dates, inclusive. */
export function weekdaysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  while (d <= end) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    }
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** Parse raw zeiterfassung_comments rows into wishes (bad rows are skipped). */
export function parseWunschRows(
  rows: Array<{ user_full_name: string; schedule_date: string; comment: string }>,
): FerienWunsch[] {
  const out: FerienWunsch[] = []
  for (const r of rows) {
    if (!r.user_full_name.startsWith(WUNSCH_PREFIX)) continue
    try {
      const meta = JSON.parse(r.comment) as Partial<FerienWunsch>
      if (!meta.to || !meta.createdAt) continue
      // unbekannte Status nie als offen werten
      const status: WunschStatus | null = meta.status === 'akzeptiert' || meta.status === 'abgelehnt' ? meta.status : meta.status === 'offen' || meta.status === undefined ? 'offen' : null
      if (!status) continue
      out.push({
        employeeId: r.user_full_name.slice(WUNSCH_PREFIX.length),
        from: r.schedule_date,
        to: meta.to,
        art: normalizeWunschArt(meta.art),
        prio: normalizeWunschPrio(meta.prio),
        status,
        createdAt: meta.createdAt,
        decidedAt: meta.decidedAt ?? null,
        decidedBy: meta.decidedBy ?? null,
        grund: typeof meta.grund === 'string' && meta.grund.trim() ? meta.grund.trim().slice(0, 300) : null,
        quelle: meta.quelle === 'woche' ? 'woche' : null,
        kw: typeof meta.kw === 'number' ? meta.kw : null,
        gruppe: typeof meta.gruppe === 'string' && meta.gruppe ? meta.gruppe.slice(0, 40) : null,
        bemerkung: typeof meta.bemerkung === 'string' && meta.bemerkung.trim() ? meta.bemerkung.trim().slice(0, 500) : null,
        tage: sauberTage(meta.tage),
        vertretung: typeof meta.vertretung === 'string' && meta.vertretung.trim() ? meta.vertretung.trim() : null,
        vertretungTage: sauberTage(meta.vertretungTage),
      })
    } catch { /* ignore bad rows */ }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}
