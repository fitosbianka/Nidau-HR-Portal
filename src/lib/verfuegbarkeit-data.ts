// Serverseitiges Laden der Verfügbarkeiten und Einsatzanfragen (Admin
// Client oder Admin Session).

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  VERFUEGBARKEIT_PERSONEN, verfuegbarKey, bedarfKey, monatAnker, parseVerfuegbarkeit, parseAnfragen,
  type Verfuegbarkeit, type EinsatzAnfrage,
} from './verfuegbarkeit'

export type VerfuegbarkeitEintrag = { profileId: string; name: string; verfuegbarkeit: Verfuegbarkeit; anfragen: EinsatzAnfrage[] }

/** Verfügbarkeit und Einsatzanfragen aller Personen mit flexiblem Einsatz für einen Monat (Admins). */
export async function ladeVerfuegbarkeiten(client: SupabaseClient, year: number, month: number): Promise<VerfuegbarkeitEintrag[]> {
  const { data: profile } = await client.from('profiles').select('id, full_name').in('full_name', VERFUEGBARKEIT_PERSONEN).eq('is_active', true)
  const personen = (profile ?? []) as Array<{ id: string; full_name: string }>
  if (personen.length === 0) return []
  const keys = personen.flatMap(p => [verfuegbarKey(p.id), bedarfKey(p.id)])
  const { data: rows } = await client.from('zeiterfassung_comments').select('user_full_name, comment')
    .in('user_full_name', keys).eq('schedule_date', monatAnker(year, month))
  const byKey = new Map(((rows ?? []) as Array<{ user_full_name: string; comment: string }>).map(r => [r.user_full_name, r.comment]))
  return personen
    .map(p => ({
      profileId: p.id, name: p.full_name,
      verfuegbarkeit: parseVerfuegbarkeit(byKey.get(verfuegbarKey(p.id)), year, month),
      anfragen: parseAnfragen(byKey.get(bedarfKey(p.id)), year, month),
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
