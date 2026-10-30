import { PRAXIS } from '@/config/praxis'
// Verfügbarkeit für den Arbeitsplan: Personen mit flexiblem Einsatz (zurzeit
// Emese) tragen pro Monat die Tage ein, an denen sie arbeiten könnten. Die
// Liste sehen die Admins unter dem Arbeitsplan und planen danach. Ablage als
// reservierte Zeile in zeiterfassung_comments (kein DDL):
//   __verfuegbar__<profileId> @ YYYY-MM-01 → { tage: ['YYYY-MM-DD', …], notiz, aktualisiertAm }
// Einsatzanfragen (Admins tragen Tage und Positionen ein, die Person sagt
// pro Tag zu oder ab und darf ihre Antwort jederzeit ändern), eigene Zeile,
// damit das Speichern der Verfügbarkeit die Anfragen nie überschreibt:
//   __verfuegbar_bedarf__<profileId> @ YYYY-MM-01 → { anfragen: [EinsatzAnfrage, …] }

import { PLAN_POSITION_RE, PLAN_SHIFT_RE } from './plan-meta'

export const VERFUEGBARKEIT_PERSONEN: string[] = PRAXIS.verfuegbarkeitPersonen
export const istVerfuegbarkeitPerson = (fullName: string | null | undefined) => VERFUEGBARKEIT_PERSONEN.includes(fullName ?? '')

export const VERFUEGBAR_PREFIX = '__verfuegbar__'
export const verfuegbarKey = (profileId: string) => `${VERFUEGBAR_PREFIX}${profileId}`
export const monatAnker = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-01`

export type Verfuegbarkeit = { tage: string[]; notiz: string; aktualisiertAm: string | null }
export const leereVerfuegbarkeit = (): Verfuegbarkeit => ({ tage: [], notiz: '', aktualisiertAm: null })

export const MONATSNAMEN = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const WOCHENTAGE_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

/** Alle Tage eines Monats als YYYY-MM-DD. */
export function tageImMonat(year: number, month: number): string[] {
  const n = new Date(year, month, 0).getDate()
  return Array.from({ length: n }, (_, i) => `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)
}
export const wochentag = (ds: string) => new Date(`${ds}T12:00:00`).getDay()   // 0 = Sonntag
export const istWochenende = (ds: string) => { const w = wochentag(ds); return w === 0 || w === 6 }
/** «Mo 03.11.» */
export const tagKurz = (ds: string) => `${WOCHENTAGE_KURZ[wochentag(ds)]} ${ds.slice(8, 10)}.${ds.slice(5, 7)}.`

export function parseVerfuegbarkeit(comment: string | null | undefined, year: number, month: number): Verfuegbarkeit {
  const leer = leereVerfuegbarkeit()
  if (!comment) return leer
  try {
    const j = JSON.parse(comment) as Partial<Verfuegbarkeit>
    const gueltig = new Set(tageImMonat(year, month))
    return {
      tage: Array.isArray(j.tage) ? Array.from(new Set(j.tage.filter((t): t is string => typeof t === 'string' && gueltig.has(t)))).sort() : [],
      notiz: typeof j.notiz === 'string' ? j.notiz.trim().slice(0, 500) : '',
      aktualisiertAm: typeof j.aktualisiertAm === 'string' ? j.aktualisiertAm : null,
    }
  } catch { return leer }
}

// ── Einsatzanfragen ──────────────────────────────────────────────────────

export const BEDARF_PREFIX = '__verfuegbar_bedarf__'
export const bedarfKey = (profileId: string) => `${BEDARF_PREFIX}${profileId}`

export type AnfrageStatus = 'offen' | 'zugesagt' | 'abgesagt'
export type EinsatzAnfrage = {
  id: string
  datum: string            // YYYY-MM-DD
  /** Plan-Code wie im Arbeitsplan: 3f, 6, 7, 8, Stern, ✓ (Position offen) */
  position: string
  /** frei, z.B. «8.00 bis 12.00 Uhr» */
  zeit: string
  status: AnfrageStatus
  /** Bemerkung der Person zu ihrer Antwort, z.B. «erst ab 8.30 Uhr» */
  bemerkung: string
  entschiedenAm: string | null
  entschiedenVon: string | null
  erstelltAm: string
  erstelltVon: string
}

export const POSITIONEN: Array<{ code: string; label: string }> = [
  { code: '✓', label: 'Anwesend, Position offen' },
  { code: '1', label: 'Zimmer 1' }, { code: '2', label: 'Zimmer 2' }, { code: '3', label: 'Zimmer 3' },
  { code: '4', label: 'Zimmer 4' }, { code: '5', label: 'Zimmer 5' },
  { code: '6', label: 'Empfang' }, { code: '7', label: 'Steri' }, { code: '8', label: 'Tagesleitung' },
  { code: '*', label: 'Joker / Aufträge' },
]
export const SCHICHTEN: Array<{ code: '' | 'f' | 't' | 's' | 'h'; label: string }> = [
  { code: '', label: 'ohne Schicht' }, { code: 'f', label: 'Frühschicht' }, { code: 't', label: 'Mittelschicht' },
  { code: 's', label: 'Spätschicht' }, { code: 'h', label: 'Halbtagsschicht' },
]

/** Gültige Position: dieselben Codes wie eine Plan-Zelle, oder ✓. */
export const positionGueltig = (code: string) =>
  code === '✓' || (code.length <= 10 && (PLAN_POSITION_RE.test(code) || PLAN_SHIFT_RE.test(code)))

/** Position in Basis und Schicht zerlegen (für das Bearbeiten): «3f» → 3 + f, «✓» → ✓ ohne Schicht. */
export function positionZerlegen(code: string): { basis: string; schicht: '' | 'f' | 't' | 's' | 'h' } {
  const sm = code.match(PLAN_SHIFT_RE)
  if (sm) return { basis: sm[1], schicht: sm[2].toLowerCase() as 'f' | 't' | 's' | 'h' }
  return { basis: code, schicht: '' }
}

/** «Zimmer 3, Frühschicht», «Empfang», «Joker / Aufträge, dann Steri, Spätschicht» */
export function positionText(code: string): string {
  if (code === '✓') return POSITIONEN[0].label
  const sm = code.match(/^((?:\*|\d{1,2}|PA|HO)(?:\/(?:\*|\d{1,2}|PA|HO))?)([ftsh])?$/i)
  if (!sm) return code
  const teile = sm[1].split('/').map(t => {
    const u = t.toUpperCase()
    return POSITIONEN.find(p => p.code === t)?.label ?? (u === 'HO' ? 'Home Office' : u === 'PA' ? 'PA' : `Position ${t}`)
  })
  const schicht = sm[2] ? SCHICHTEN.find(s => s.code === sm[2]!.toLowerCase())?.label : ''
  return `${teile.join(', dann ')}${schicht ? `, ${schicht}` : ''}`
}

const ANFRAGE_ID_RE = /^[a-z0-9]{6,32}$/i
const istText = (x: unknown): x is string => typeof x === 'string'

export function parseAnfragen(comment: string | null | undefined, year: number, month: number): EinsatzAnfrage[] {
  if (!comment) return []
  try {
    const j = JSON.parse(comment) as { anfragen?: unknown }
    if (!Array.isArray(j.anfragen)) return []
    const gueltig = new Set(tageImMonat(year, month))
    const out: EinsatzAnfrage[] = []
    const ids = new Set<string>()
    for (const x of j.anfragen as Array<Partial<EinsatzAnfrage>>) {
      if (!x || !istText(x.id) || !ANFRAGE_ID_RE.test(x.id) || ids.has(x.id)) continue
      if (!istText(x.datum) || !gueltig.has(x.datum)) continue
      if (!istText(x.position) || !positionGueltig(x.position)) continue
      ids.add(x.id)
      out.push({
        id: x.id, datum: x.datum, position: x.position,
        zeit: istText(x.zeit) ? x.zeit.trim().slice(0, 120) : '',
        status: x.status === 'zugesagt' || x.status === 'abgesagt' ? x.status : 'offen',
        bemerkung: istText(x.bemerkung) ? x.bemerkung.trim().slice(0, 300) : '',
        entschiedenAm: istText(x.entschiedenAm) ? x.entschiedenAm : null,
        entschiedenVon: istText(x.entschiedenVon) ? x.entschiedenVon : null,
        erstelltAm: istText(x.erstelltAm) ? x.erstelltAm : '',
        erstelltVon: istText(x.erstelltVon) ? x.erstelltVon : '',
      })
    }
    return out.sort((a, b) => a.datum.localeCompare(b.datum) || a.erstelltAm.localeCompare(b.erstelltAm))
  } catch { return [] }
}

/** Plan-Zelle, die sich als Einsatz anfragen lässt: eine Position, kein
 *  Abwesenheitscode, kein Home Office. */
export const planPositionAnfragbar = (code: string) => positionGueltig(code) && !/^HO/i.test(code)

/** Einträge aus dem Arbeitsplan als Anfragen übernehmen: nur anfragbare
 *  Positionen, nur Tage des Monats, für die noch keine Anfrage besteht
 *  (bestehende Anfragen und Antworten bleiben unangetastet). Gibt die
 *  ergänzte Liste und die Zahl der neuen Anfragen zurück. */
export function ergaenzeAusPlan(
  liste: EinsatzAnfrage[],
  eintraege: Array<{ datum: string; position: string }>,
  year: number, month: number,
  neueId: () => string, am: string, von: string,
): { liste: EinsatzAnfrage[]; neu: number } {
  const gueltig = new Set(tageImMonat(year, month))
  const belegt = new Set(liste.map(a => a.datum))
  const out = [...liste]
  let neu = 0
  for (const e of [...eintraege].sort((a, b) => a.datum.localeCompare(b.datum))) {
    const position = (e.position ?? '').split('|')[0].trim()
    if (!gueltig.has(e.datum) || belegt.has(e.datum) || !planPositionAnfragbar(position)) continue
    out.push({ id: neueId(), datum: e.datum, position, zeit: '', status: 'offen', bemerkung: '', entschiedenAm: null, entschiedenVon: null, erstelltAm: am, erstelltVon: von })
    belegt.add(e.datum)
    neu++
  }
  out.sort((a, b) => a.datum.localeCompare(b.datum) || a.erstelltAm.localeCompare(b.erstelltAm))
  return { liste: out, neu }
}
