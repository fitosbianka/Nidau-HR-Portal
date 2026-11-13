// Zeiterfassungs-Kontrolle: configurable shift rules used by the admin
// "Kontrolle Vormonat" page to spot days whose stamped times look like a
// standard shift and should be corrected to the credited 8:30.
// Rules are stored as ONE reserved zeiterfassung_comments row (no DDL):
//   user_full_name = "__kontroll_regeln__", schedule_date = 1970-01-01,
//   comment = JSON KontrollRegel[].

import type { SupabaseClient } from '@supabase/supabase-js'

// v2: time criteria are OR-ed (start OR end window hitting marks the day),
// Pause only matters where the rule says so. Old v1 rows are ignored.
export const KONTROLL_REGELN_KEY  = '__kontroll_regeln_v2__'
export const KONTROLL_REGELN_DATE = '1970-01-01'

export type KontrollRegel = {
  id: string
  name: string          // shift name — written into the day note on accept
  aktiv: boolean
  startVon?: string     // 'HH:MM' — first clock-in window (empty = no limit)
  startBis?: string
  endeVon?: string      // 'HH:MM' — last clock-out window
  endeBis?: string
  dauerVonH?: number    // stamped total in hours (e.g. 7)
  dauerBisH?: number
  ohnePause: boolean    // true = only days stamped in one piece (no break)
}

// Startwerte der Praxis; editierbar unter Zeiterfassung → Kontroll-Regeln.
// Pause is irrelevant for Früh-/Spätschicht; only the Durchgehende Schicht
// requires the day to be stamped in one piece.
export const DEFAULT_REGELN: KontrollRegel[] = [
  { id: 'spaet', name: 'Spätschicht',          aktiv: true, startVon: '11:30', startBis: '12:30', endeVon: '19:00', endeBis: '20:00', ohnePause: false },
  { id: 'frueh', name: 'Frühschicht',          aktiv: true, startVon: '06:00', startBis: '07:00', endeVon: '13:00', endeBis: '14:00', ohnePause: false },
  { id: 'durch', name: 'Durchgehende Schicht', aktiv: true, dauerVonH: 7, dauerBisH: 8, ohnePause: true },
]

export function parseRegeln(raw: string | null | undefined): KontrollRegel[] | null {
  if (!raw) return null
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    return arr
      .filter(r => r && typeof r.name === 'string')
      .map((r, i) => ({
        id: typeof r.id === 'string' && r.id ? r.id : `regel-${i}`,
        name: r.name,
        aktiv: r.aktiv !== false,
        startVon: r.startVon || undefined,
        startBis: r.startBis || undefined,
        endeVon: r.endeVon || undefined,
        endeBis: r.endeBis || undefined,
        dauerVonH: typeof r.dauerVonH === 'number' ? r.dauerVonH : undefined,
        dauerBisH: typeof r.dauerBisH === 'number' ? r.dauerBisH : undefined,
        ohnePause: r.ohnePause === true,
      }))
  } catch {
    return null
  }
}

/** Stored rules, or the defaults when none were saved yet. */
export async function getKontrollRegeln(client: SupabaseClient): Promise<KontrollRegel[]> {
  const { data } = await client
    .from('zeiterfassung_comments')
    .select('comment')
    .eq('user_full_name', KONTROLL_REGELN_KEY)
    .eq('schedule_date', KONTROLL_REGELN_DATE)
    .maybeSingle()
  return parseRegeln((data as { comment?: string } | null)?.comment) ?? DEFAULT_REGELN
}

// ── Matching ─────────────────────────────────────────────────────────────────

export type KontrollTag = {
  startMin: number   // first clock-in, minutes since midnight (Zurich)
  endMin: number     // last clock-out
  totalMin: number   // stamped total of complete pairs
  pairs: number      // number of complete pairs (1 = no break)
}

export function hhmmToMin(v: string | undefined): number | null {
  if (!v || !/^\d{1,2}:\d{2}$/.test(v)) return null
  const [h, m] = v.split(':').map(Number)
  return h * 60 + m
}

/** Does a day's stamped shape match a rule?
 *  The time criteria are OR-ed: hitting the start window OR the end window
 *  OR the duration range marks the day — one is enough. "Nur ohne Pause"
 *  (when set) is a hard requirement on top. */
export function regelPasst(r: KontrollRegel, tag: KontrollTag): boolean {
  if (!r.aktiv) return false
  if (r.ohnePause && tag.pairs !== 1) return false

  const sv = hhmmToMin(r.startVon), sb = hhmmToMin(r.startBis)
  const ev = hhmmToMin(r.endeVon),  eb = hhmmToMin(r.endeBis)
  const hasStart = sv != null || sb != null
  const hasEnd   = ev != null || eb != null
  const hasDauer = r.dauerVonH != null || r.dauerBisH != null

  const startHit = hasStart
    && (sv == null || tag.startMin >= sv)
    && (sb == null || tag.startMin <= sb)
  const endHit = hasEnd
    && (ev == null || tag.endMin >= ev)
    && (eb == null || tag.endMin <= eb)
  const dauerHit = hasDauer
    && (r.dauerVonH == null || tag.totalMin >= Math.round(r.dauerVonH * 60))
    && (r.dauerBisH == null || tag.totalMin <= Math.round(r.dauerBisH * 60))

  // no time constraint at all → never match (would flag every day)
  if (!hasStart && !hasEnd && !hasDauer) return false
  return startHit || endHit || dauerHit
}
