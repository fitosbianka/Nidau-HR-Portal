import { ohneGaesteErgebnis } from '@/lib/gaeste'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadKontoEmployees } from '@/lib/konto-data'
import { KONTO_YEAR } from '@/data/arbeitszeit-konto-2026'
import { round2 } from '@/lib/ferien'
import {
  PLAN_YEAR, WUNSCH_PREFIX, PHASEN_KEY, EMPTY_PHASEN,
  parseWunschRows, parsePhasenComment,
  type FerienWunsch, type PhasenDeadlines,
} from '@/lib/ferien-wuensche'
import { VERTRETUNG_PREFIX, parseVertretungRows, vertretungMap } from '@/lib/ferien-vertretung'
import { ladeExterne } from '@/lib/externe'
import { PRAXIS } from '@/config/praxis'

export type FerienplanungEmployee = { id: string; full_name: string; job_title: string | null; schedule_order: number | null; pensum: number | null; eintrittsdatum?: string | null }

/** No Ferieneingabe for these people — they stay out of the Ferienplanung
 *  (Praxisinhaber sowie Externe wie die selbständige Ferienvertretung). */
export const FERIEN_EXCLUDED = new Set(PRAXIS.ferienAusgeschlossen)
export type FerienplanungVacation = { employee_id: string; schedule_date: string; entry: string }
/** Ferien-Bestand from the Arbeitszeit- und Ferienkonto (KONTO_YEAR). */
export type FerienBestand = { bezogen: number; rest: number | null }

export type FerienplanungData = {
  employees: FerienplanungEmployee[]
  /** All F / F:x entries from KONTO_YEAR-01-01 through PLAN_YEAR-12-31. */
  vacations: FerienplanungVacation[]
  wishes: FerienWunsch[]
  phasen: PhasenDeadlines
  bestand: Record<string, FerienBestand>
  kontoYear: number
}

export type FerienVertretungsDaten = {
  /** `${employeeId}|${date}` → Name der Vertretung */
  vertretungen: Record<string, string>
  /** Wählbare Vertretungen: alle aktiven ZAZ (inkl. externe) */
  kandidaten: string[]
}

/** Ferienvertretungen der ZAZ — NUR für die Planungsseiten von Admins und
 *  der Ferien-Editorin; die Mitarbeiter-Ferienplanung lädt das nicht. */
export async function ladeFerienVertretungen(client: SupabaseClient): Promise<FerienVertretungsDaten> {
  const [{ data: rows }, { data: zaz }] = await Promise.all([
    client.from('zeiterfassung_comments')
      .select('user_full_name, schedule_date, comment')
      .like('user_full_name', `${VERTRETUNG_PREFIX.replace(/_/g, '\\_')}%`),
    client.from('profiles')
      .select('full_name')
      .eq('is_active', true).eq('job_title', 'ZAZ')
      .order('full_name'),
  ])
  return {
    vertretungen: vertretungMap(parseVertretungRows((rows ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>)),
    kandidaten: ((zaz ?? []) as Array<{ full_name: string }>).map(z => z.full_name),
  }
}

/** Server data for the Ferienplanung (admin page and the Ferien Editorin's team page). */
export async function loadFerienplanungData(client: SupabaseClient): Promise<FerienplanungData> {
  const [{ data: employees }, { data: wunschRows }, { data: phasenRow }, konto] = await Promise.all([
    client.from('profiles')
      .select('id, full_name, job_title, schedule_order, pensum, eintrittsdatum')
      .eq('role', 'employee').eq('is_active', true)
      .order('schedule_order', { ascending: true, nullsFirst: false })
      .order('full_name')
      .then(ohneGaesteErgebnis),
    client.from('zeiterfassung_comments')
      .select('user_full_name, schedule_date, comment')
      .like('user_full_name', `${WUNSCH_PREFIX.replace(/_/g, '\\_')}%`),
    client.from('zeiterfassung_comments')
      .select('comment')
      .eq('user_full_name', PHASEN_KEY)
      .eq('schedule_date', `${PLAN_YEAR}-01-01`)
      .maybeSingle(),
    loadKontoEmployees(client),
  ])

  // Ferien-/UF-/WB-/Notfalldienst-Einträge über zwei Jahre — PAGINIERT:
  // ein einzelner Request liefert höchstens 1000 Zeilen, sonst fehlt ein
  // Teil der geplanten Ferien in Kalender und Listen.
  const vac: FerienplanungVacation[] = []
  for (let fromIdx = 0; ; fromIdx += 1000) {
    const { data } = await client.from('work_schedule')
      .select('employee_id, schedule_date, entry')
      .or('entry.eq.F,entry.like.F:*,entry.eq.UF,entry.eq.WB,entry.eq.ND')
      .gte('schedule_date', `${KONTO_YEAR}-01-01`).lte('schedule_date', `${PLAN_YEAR}-12-31`)
      .order('schedule_date', { ascending: true })
      .range(fromIdx, fromIdx + 999)
    if (!data || data.length === 0) break
    vac.push(...(data as FerienplanungVacation[]))
    if (data.length < 1000) break
  }

  const phasen: PhasenDeadlines = phasenRow
    ? parsePhasenComment((phasenRow as { comment: string }).comment)
    : { ...EMPTY_PHASEN }

  // Bestand per employee from the Konto: days taken (sum of the completed
  // months) and remaining vacation (last known "Bleibende Ferien" value).
  const bestand: Record<string, FerienBestand> = {}
  for (const k of konto.employees) {
    let bezogen = 0
    let rest: number | null = null
    for (const m of k.months) {
      if (m.empty) continue
      bezogen += m.ferien ?? 0
      if (m.restFerien != null) rest = m.restFerien
    }
    bestand[k.id] = { bezogen: round2(bezogen), rest }
  }

  // Externe (selbständig) haben keine Ferienplanung: feste Liste und Markierung
  const externeIds = await ladeExterne(client)
  return {
    employees: ((employees ?? []) as FerienplanungEmployee[]).filter(e => !FERIEN_EXCLUDED.has(e.full_name) && !externeIds.has(e.id)),
    vacations: (vac ?? []) as FerienplanungVacation[],
    wishes: parseWunschRows((wunschRows ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>),
    phasen,
    bestand,
    kontoYear: KONTO_YEAR,
  }
}
