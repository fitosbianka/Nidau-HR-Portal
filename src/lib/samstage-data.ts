import { ohneGaesteErgebnis } from '@/lib/gaeste'
// Serverseitiges Laden der Samstagsöffnungen samt Anmeldungen.

import type { SupabaseClient } from '@supabase/supabase-js'
import { SAMSTAG_PREFIX, SAMSTAG_ANMELDUNG_PREFIX, SAMSTAG_LIKE, parseSamstagRow, parseAnmeldungRow, type Samstag, type SamstagAnmeldung } from './samstage'

export type SamstagPerson = { id: string; full_name: string; job_title: string | null }

/** Samstage ab einem Datum (z. B. Jahresbeginn), chronologisch. */
export async function ladeSamstage(client: SupabaseClient, abDatum: string): Promise<Samstag[]> {
  const [{ data: rows }, { data: profs }] = await Promise.all([
    client.from('zeiterfassung_comments').select('user_full_name, schedule_date, comment')
      .like('user_full_name', SAMSTAG_LIKE).gte('schedule_date', abDatum).order('schedule_date'),
    client.from('profiles').select('id, full_name, job_title').in('role', ['employee', 'admin']).then(ohneGaesteErgebnis),
  ])
  const personen = new Map(((profs ?? []) as SamstagPerson[]).map(p => [p.id, p]))
  const samstage = new Map<string, Samstag>()
  const anmeldungen: Array<{ datum: string; a: SamstagAnmeldung }> = []
  for (const r of (rows ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>) {
    const datum = r.schedule_date.slice(0, 10)
    if (r.user_full_name === SAMSTAG_PREFIX) {
      const { notiz, bedarf } = parseSamstagRow(r.comment)
      samstage.set(datum, { datum, notiz, bedarf, anmeldungen: [] })
    } else if (r.user_full_name.startsWith(SAMSTAG_ANMELDUNG_PREFIX)) {
      const profileId = r.user_full_name.slice(SAMSTAG_ANMELDUNG_PREFIX.length)
      const p = personen.get(profileId)
      const a = parseAnmeldungRow(r.comment, p?.job_title)
      if (!p || !a) continue
      anmeldungen.push({ datum, a: { profileId, name: p.full_name, jobTitle: p.job_title, rolle: a.rolle, am: a.am, durchAdmin: a.durchAdmin } })
    }
  }
  for (const { datum, a } of anmeldungen) samstage.get(datum)?.anmeldungen.push(a)
  return Array.from(samstage.values())
    .map(s => ({ ...s, anmeldungen: s.anmeldungen.sort((x, y) => x.rolle.localeCompare(y.rolle) || x.name.localeCompare(y.name, 'de-CH')) }))
    .sort((a, b) => a.datum.localeCompare(b.datum))
}

/** Aktive Personen für das manuelle Eintragen durch Admins. */
export async function ladeSamstagTeam(client: SupabaseClient): Promise<SamstagPerson[]> {
  const { data } = await client.from('profiles').select('id, full_name, job_title')
    .in('role', ['employee', 'admin']).eq('is_active', true).order('full_name')
    .then(ohneGaesteErgebnis)
  return (data ?? []) as SamstagPerson[]
}
