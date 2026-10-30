// Serverseitiges Laden der Notfalldienste samt Anmeldungen. ND Tage, die
// direkt im Arbeitsplan stehen (zum Beispiel über «Notfalldienst eintragen»
// oder von Hand), erscheinen ebenfalls: als Anmeldung beim passenden Dienst
// oder als eigener Dienst «aus Arbeitsplan».

import type { SupabaseClient } from '@supabase/supabase-js'
import { ND_PREFIX, ND_ANMELDUNG_PREFIX, ND_LIKE, ND_BEDARF_STANDARD, ndRolle, parseNdRow, parseNdAnmeldungRow, type Notfalldienst, type NdAnmeldung } from './notfalldienste'
import { ohneGaeste } from './gaeste'

type Person = { id: string; full_name: string; job_title: string | null }

const tageDiff = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000)

/** ND Tage pro Person zu Perioden zusammenfassen (Wochenenden überbrückt). */
export function ndPerioden(rows: Array<{ employee_id: string; schedule_date: string }>): Array<{ profileId: string; von: string; bis: string }> {
  const sortiert = [...rows].sort((a, b) => a.employee_id.localeCompare(b.employee_id) || a.schedule_date.localeCompare(b.schedule_date))
  const out: Array<{ profileId: string; von: string; bis: string }> = []
  for (const r of sortiert) {
    const last = out[out.length - 1]
    if (last && last.profileId === r.employee_id && tageDiff(last.bis, r.schedule_date) <= 3) last.bis = r.schedule_date
    else out.push({ profileId: r.employee_id, von: r.schedule_date, bis: r.schedule_date })
  }
  return out
}

/** Notfalldienste ab einem Datum (Von), chronologisch. */
export async function ladeNotfalldienste(client: SupabaseClient, abDatum: string): Promise<Notfalldienst[]> {
  const [{ data: rows }, { data: profs }, { data: ndRows }] = await Promise.all([
    client.from('zeiterfassung_comments').select('user_full_name, schedule_date, comment')
      .like('user_full_name', ND_LIKE).gte('schedule_date', abDatum).order('schedule_date'),
    client.from('profiles').select('id, full_name, job_title').in('role', ['employee', 'admin']),
    client.from('work_schedule').select('employee_id, schedule_date').eq('entry', 'ND').gte('schedule_date', abDatum).order('schedule_date'),
  ])
  const personen = new Map(ohneGaeste((profs ?? []) as Person[]).map(p => [p.id, p]))
  const dienste = new Map<string, Notfalldienst>()
  const anmeldungen: Array<{ von: string; a: NdAnmeldung }> = []
  for (const r of (rows ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>) {
    const von = r.schedule_date.slice(0, 10)
    if (r.user_full_name === ND_PREFIX) {
      const d = parseNdRow(von, r.comment)
      if (d) dienste.set(von, { ...d, anmeldungen: [] })
    } else if (r.user_full_name.startsWith(ND_ANMELDUNG_PREFIX)) {
      const profileId = r.user_full_name.slice(ND_ANMELDUNG_PREFIX.length)
      const p = personen.get(profileId)
      const a = parseNdAnmeldungRow(r.comment)
      if (!p || !a) continue
      anmeldungen.push({ von, a: { profileId, name: p.full_name, jobTitle: p.job_title, ...a } })
    }
  }
  for (const { von, a } of anmeldungen) dienste.get(von)?.anmeldungen.push(a)

  // ND Tage aus dem Arbeitsplan: passender Dienst (gleicher Start oder
  // Zeitraum umfasst die Periode) oder eigener Dienst «aus Arbeitsplan».
  for (const p of ndPerioden((ndRows ?? []) as Array<{ employee_id: string; schedule_date: string }>)) {
    const person = personen.get(p.profileId)
    if (!person) continue
    let d = dienste.get(p.von) ?? Array.from(dienste.values()).find(x => x.von <= p.von && x.bis >= p.bis)
    if (!d) {
      d = { von: p.von, bis: p.bis, notiz: '', bedarf: { ...ND_BEDARF_STANDARD }, anmeldungen: [], ausArbeitsplan: true }
      dienste.set(p.von, d)
    }
    const a = d.anmeldungen.find(x => x.profileId === p.profileId)
    if (a) a.status = 'bestaetigt'
    else d.anmeldungen.push({ profileId: p.profileId, name: person.full_name, jobTitle: person.job_title, rolle: ndRolle(person.job_title) ?? 'zahnarzt', am: '', status: 'bestaetigt', durchAdmin: true, ausArbeitsplan: true })
  }
  return Array.from(dienste.values())
    .map(d => ({ ...d, anmeldungen: d.anmeldungen.sort((x, y) => x.rolle.localeCompare(y.rolle) || x.am.localeCompare(y.am)) }))
    .sort((a, b) => a.von.localeCompare(b.von))
}
