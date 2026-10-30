// Serverseitiges Laden der Verfügbarkeiten, Einsatzanfragen, Rückmeldungen
// und Plan Einträge (Admin Client oder Admin Session).

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  VERFUEGBARKEIT_PERSONEN, verfuegbarKey, bedarfKey, antwortKey, monatAnker, tageImMonat, parseVerfuegbarkeit, parseAnfragen, parseEntscheidungen,
  type Verfuegbarkeit, type EinsatzAnfrage, type Entscheidungen,
} from './verfuegbarkeit'

export type PlanEintrag = { datum: string; position: string }
export type VerfuegbarkeitEintrag = { profileId: string; name: string; verfuegbarkeit: Verfuegbarkeit; anfragen: EinsatzAnfrage[]; entscheidungen: Entscheidungen }

/** Verfügbarkeit, Einsatzanfragen und Rückmeldungen aller Personen mit flexiblem Einsatz für einen Monat (Admins). */
export async function ladeVerfuegbarkeiten(client: SupabaseClient, year: number, month: number): Promise<VerfuegbarkeitEintrag[]> {
  const { data: profile } = await client.from('profiles').select('id, full_name').in('full_name', VERFUEGBARKEIT_PERSONEN).eq('is_active', true)
  const personen = (profile ?? []) as Array<{ id: string; full_name: string }>
  if (personen.length === 0) return []
  const keys = personen.flatMap(p => [verfuegbarKey(p.id), bedarfKey(p.id), antwortKey(p.id)])
  const { data: rows } = await client.from('zeiterfassung_comments').select('user_full_name, comment')
    .in('user_full_name', keys).eq('schedule_date', monatAnker(year, month))
  const byKey = new Map(((rows ?? []) as Array<{ user_full_name: string; comment: string }>).map(r => [r.user_full_name, r.comment]))
  return personen
    .map(p => ({
      profileId: p.id, name: p.full_name,
      verfuegbarkeit: parseVerfuegbarkeit(byKey.get(verfuegbarKey(p.id)), year, month),
      anfragen: parseAnfragen(byKey.get(bedarfKey(p.id)), year, month),
      entscheidungen: parseEntscheidungen(byKey.get(antwortKey(p.id)), year, month),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de-CH'))
}

/** Eigene Verfügbarkeit einer Person für einen Monat. */
export async function ladeVerfuegbarkeit(client: SupabaseClient, profileId: string, year: number, month: number): Promise<Verfuegbarkeit> {
  const { data } = await client.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', verfuegbarKey(profileId)).eq('schedule_date', monatAnker(year, month)).maybeSingle()
  return parseVerfuegbarkeit((data as { comment: string } | null)?.comment, year, month)
}

/** Einsatzanfragen an eine Person für einen Monat. */
export async function ladeAnfragen(client: SupabaseClient, profileId: string, year: number, month: number): Promise<EinsatzAnfrage[]> {
  const { data } = await client.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', bedarfKey(profileId)).eq('schedule_date', monatAnker(year, month)).maybeSingle()
  return parseAnfragen((data as { comment: string } | null)?.comment, year, month)
}

/** Rückmeldungen der Admins (angenommen, abgelehnt) zu den Tagen einer Person. */
export async function ladeEntscheidungen(client: SupabaseClient, profileId: string, year: number, month: number): Promise<Entscheidungen> {
  const { data } = await client.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', antwortKey(profileId)).eq('schedule_date', monatAnker(year, month)).maybeSingle()
  return parseEntscheidungen((data as { comment: string } | null)?.comment, year, month)
}

/** Einträge einer Person im Arbeitsplan eines Monats (roh, inklusive Abwesenheitscodes). */
export async function ladePlanEintraege(client: SupabaseClient, profileId: string, year: number, month: number): Promise<PlanEintrag[]> {
  const tage = tageImMonat(year, month)
  const { data } = await client.from('work_schedule').select('schedule_date, entry').eq('employee_id', profileId)
    .gte('schedule_date', tage[0]).lte('schedule_date', tage[tage.length - 1])
  return ((data ?? []) as Array<{ schedule_date: string; entry: string | null }>).map(r => ({ datum: r.schedule_date, position: r.entry ?? '' }))
}
