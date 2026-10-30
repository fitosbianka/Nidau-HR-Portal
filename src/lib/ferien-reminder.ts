// Login reminder for the Ferienplanung: as soon as the planning phase of the
// signed-in person is ACTIVE (their phase deadline is set and reached, and no
// earlier phase is still running) and they have not yet entered a wish or any
// PLAN_YEAR vacation, they see a popup after signing in (once per browser
// session, until they enter one).

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  PLAN_YEAR, PHASEN_KEY, WUNSCH_PREFIX, EMPTY_PHASEN,
  phaseKeyForTitle, phaseStateFor, parsePhasenComment, parseWunschRows, zurichNow,
  type PhasenDeadlines,
} from '@/lib/ferien-wuensche'
import { kategorieFuer, wochen2027, type Eintrag } from '@/lib/ferien-wochen'
import { zweiWochenAmStueck } from '@/lib/ferien-kapazitaet'

/** Read the phase deadlines for PLAN_YEAR (EMPTY_PHASEN when none are set). */
export async function getPhasenDeadlines(client: SupabaseClient): Promise<PhasenDeadlines> {
  const { data: phasenRow } = await client
    .from('zeiterfassung_comments')
    .select('comment')
    .eq('user_full_name', PHASEN_KEY)
    .eq('schedule_date', `${PLAN_YEAR}-01-01`)
    .maybeSingle()
  if (!phasenRow) return { ...EMPTY_PHASEN }
  return parsePhasenComment((phasenRow as { comment: string }).comment)
}

/** Welcher Login-Hinweis gezeigt wird:
 *  · 'eingabe' — die eigene Phase ist AKTIV und die Person hat noch nichts
 *    eingegeben (einmal pro Browser-Sitzung, bis etwas erfasst ist)
 *  · 'veroeffentlichung' — die Planung ist veröffentlicht (mindestens eine
 *    Frist gesetzt): alle anderen sehen EINMALIG den Hinweis, dass der
 *    Kalender mit den bereits akzeptierten Ferien einsehbar ist
 *  · null — kein Hinweis */
export type FerienReminderKind = 'eingabe' | 'veroeffentlichung'

/** Hinweis «noch keine zwei Wochen am Stück» (Art. 329c OR): sobald die
 *  Eingabephase der Person in zwei Wochen endet oder abgelaufen ist und
 *  ihre akzeptierten und offenen Einträge PLAN_YEAR keine zwei
 *  aufeinanderfolgenden vollen Ferienwochen enthalten. Nicht für Valérie
 *  und nicht für Personen ohne Wochenanmeldung. */
export async function getZweiWochenHinweis(
  client: SupabaseClient,
  userId: string,
  fullName: string | null | undefined,
  jobTitle: string | null | undefined,
): Promise<boolean> {
  if (!kategorieFuer(jobTitle) || (fullName ?? '').startsWith('Valérie')) return false
  const phasen = await getPhasenDeadlines(client)
  const frist = phasen[phaseKeyForTitle(jobTitle ?? null)]
  if (!frist) return false
  const heute = zurichNow().slice(0, 10)
  const inZwei = new Date(`${heute}T12:00:00`); inZwei.setDate(inZwei.getDate() + 14)
  if (frist > inZwei.toISOString().slice(0, 10)) return false
  const [wunsch, vac] = await Promise.all([
    client.from('zeiterfassung_comments').select('user_full_name, schedule_date, comment').eq('user_full_name', `${WUNSCH_PREFIX}${userId}`),
    client.from('work_schedule').select('employee_id, schedule_date, entry').eq('employee_id', userId).or('entry.eq.F,entry.like.F:*')
      .gte('schedule_date', `${PLAN_YEAR}-01-01`).lte('schedule_date', `${PLAN_YEAR}-12-31`),
  ])
  const wishes = parseWunschRows((wunsch.data ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>)
  return !zweiWochenAmStueck(userId, wochen2027(), (vac.data ?? []) as Eintrag[], wishes).ok
}

export async function getFerienReminder(
  client: SupabaseClient,
  userId: string,
  jobTitle?: string | null,
): Promise<FerienReminderKind | null> {
  const phasen = await getPhasenDeadlines(client)
  const veroeffentlicht = Boolean(phasen.zahnaerzte || phasen.dhpa || phasen.da)

  let title = jobTitle ?? null
  if (jobTitle === undefined) {
    const { data } = await client.from('profiles').select('job_title').eq('id', userId).maybeSingle()
    title = (data as { job_title: string | null } | null)?.job_title ?? null
  }

  if (phaseStateFor(phasen, phaseKeyForTitle(title), zurichNow()) !== 'aktiv') {
    return veroeffentlicht ? 'veroeffentlichung' : null
  }

  const [wunsch, vac] = await Promise.all([
    client
      .from('zeiterfassung_comments')
      .select('schedule_date')
      .eq('user_full_name', `${WUNSCH_PREFIX}${userId}`)
      .limit(1),
    client
      .from('work_schedule')
      .select('schedule_date')
      .eq('employee_id', userId)
      .or('entry.eq.F,entry.like.F:*')
      .gte('schedule_date', `${PLAN_YEAR}-01-01`)
      .lte('schedule_date', `${PLAN_YEAR}-12-31`)
      .limit(1),
  ])
  if (!(wunsch.data?.length || vac.data?.length)) return 'eingabe'
  return veroeffentlicht ? 'veroeffentlichung' : null
}
