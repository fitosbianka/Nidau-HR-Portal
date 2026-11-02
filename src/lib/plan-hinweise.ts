// Hinweise für das Team: Notizen zum Arbeitsplan, die ALLE sehen, die den
// Plan sehen (Mitarbeitende im Portal und im PDF Export), ohne Kürzel.
// Getrennt von den internen Notizen (plan-notes.ts), die nur Admin und
// Leitende sehen und die nie exportiert werden.
//   __plan_team_tag__   + Datum  → Hinweis für einen Tag oder Zeitraum (to)
//   __plan_team_woche__ + Montag → Hinweis für eine oder mehrere Wochen
// Gleiche Speicherform wie die Notizen (Einträge), das Kürzel wird nur
// nicht angezeigt.

import type { SupabaseClient } from '@supabase/supabase-js'
import { monthAnchor } from './leitende'
import { parseNoteComment, sundayOf, type PlanPeriodNote } from './plan-notes'

export const TEAM_TAG_KEY   = '__plan_team_tag__'
export const TEAM_WOCHE_KEY = '__plan_team_woche__'

export type TeamHinweise = { tage: PlanPeriodNote[]; wochen: PlanPeriodNote[] }
export const leereTeamHinweise = (): TeamHinweise => ({ tage: [], wochen: [] })

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Hinweise eines Monats (auch solche, die in einem Vormonat beginnen und in
 *  diesen Monat hineinreichen). */
export async function getTeamHinweise(client: SupabaseClient, year: number, month: number): Promise<TeamHinweise> {
  const monthStart = monthAnchor(year, month)
  const lastDay    = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const monthEnd   = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  const { data } = await client
    .from('zeiterfassung_comments')
    .select('user_full_name, schedule_date, comment')
    .in('user_full_name', [TEAM_TAG_KEY, TEAM_WOCHE_KEY])
    .gte('schedule_date', addDays(monthStart, -34))
    .lte('schedule_date', monthEnd)
  const out = leereTeamHinweise()
  for (const r of (data ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>) {
    const val = parseNoteComment(r.comment ?? '')
    if (val.eintraege.length === 0) continue
    const item: PlanPeriodNote = { anchor: r.schedule_date, note: val.text, by: val.by, to: val.to, eintraege: val.eintraege }
    if (r.user_full_name === TEAM_TAG_KEY) { if ((val.to ?? r.schedule_date) >= monthStart) out.tage.push(item) }
    else if ((val.to ?? sundayOf(r.schedule_date)) >= monthStart) out.wochen.push(item)
  }
  out.tage.sort((a, b) => a.anchor.localeCompare(b.anchor))
  out.wochen.sort((a, b) => a.anchor.localeCompare(b.anchor))
  return out
}

/** Text eines Hinweises ohne Kürzel: alle Einträge, durch · getrennt. */
export const hinweisText = (n: PlanPeriodNote) => n.eintraege.map(e => e.text).join(' · ')

/** Bänder für die Tagesspalten eines Monats (PDF): Tag 1 bis n, auf den
 *  Monat beschnitten, Wochen zuerst, dann Tage, nach Start sortiert. */
export function teamBaender(h: TeamHinweise, year: number, month: number): Array<{ start: number; end: number; note: string; woche: boolean }> {
  const mm = String(month).padStart(2, '0')
  const tage = new Date(year, month, 0).getDate()
  const firstDay = `${year}-${mm}-01`, lastDay = `${year}-${mm}-${String(tage).padStart(2, '0')}`
  const monthKey = `${year}-${mm}`
  const clamp = (from: string, to: string) => {
    const a = from <= firstDay ? 1 : from.slice(0, 7) === monthKey ? Number(from.slice(8)) : null
    const b = to >= lastDay ? tage : to.slice(0, 7) === monthKey ? Number(to.slice(8)) : null
    if (a === null && from > lastDay) return null
    if (b === null && to < firstDay) return null
    const start = a ?? 1, end = b ?? tage
    return start <= end ? { start, end } : null
  }
  const out: Array<{ start: number; end: number; note: string; woche: boolean }> = []
  for (const n of h.wochen) { const r = clamp(n.anchor, n.to ?? sundayOf(n.anchor)); if (r) out.push({ ...r, note: hinweisText(n), woche: true }) }
  for (const n of h.tage)   { const r = clamp(n.anchor, n.to ?? n.anchor);           if (r) out.push({ ...r, note: hinweisText(n), woche: false }) }
  return out.sort((a, b) => a.start - b.start || Number(b.woche) - Number(a.woche))
}
