import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { FERIEN_EDITORS } from '@/lib/leitende'
import { loadFerienplanungData, ladeFerienVertretungen } from '@/lib/ferienplanung-data'
import { ladeSamstage, ladeSamstagTeam } from '@/lib/samstage-data'
import { samstagRolle } from '@/lib/samstage'
import { ladeNotfalldienste } from '@/lib/notfalldienste-data'
import { ndRolle } from '@/lib/notfalldienste'
import { ladeFerienKontext, wochenFuerAdmin, zweiWochenProPerson } from '@/lib/ferien-wochen-data'
import { personRegelFuer } from '@/lib/ferien-regeln'
import type { Person } from '@/lib/ferien-wochen'
import { zurichToday } from '@/lib/salary-sync'
import { maskUfEntries, maskUfWuensche } from '@/lib/plan-privacy'
import FerienplanungClient from '@/app/admin/zeiterfassung/ferien/planung/FerienplanungClient'

export const dynamic = 'force-dynamic'

/** Ferienplanung for designated editors — identical to the
 *  admin page (same data, same editing rights, also for Samstage and
 *  Notfalldienste). Only the Admin Anspruch Anpassung stays with Admins. */
export default async function TeamFerienPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('full_name, job_title').eq('id', user.id).single()
  const p = profile as { full_name: string; job_title: string | null } | null
  if (!FERIEN_EDITORS.includes(p?.full_name ?? '')) redirect('/employee')

  const adminClient = await createAdminClient()
  const heute = zurichToday()
  const jahr = `${heute.slice(0, 4)}-01-01`
  const [data, vt, samstage, team, notfalldienste] = await Promise.all([
    loadFerienplanungData(adminClient),
    ladeFerienVertretungen(adminClient),
    ladeSamstage(adminClient, jahr),
    ladeSamstagTeam(adminClient),
    ladeNotfalldienste(adminClient, jahr),
  ])
  // Auch die Ferien-Editorin sieht fremde unbezahlte Ferien nur als Ferien —
  // «UF» sehen ausschliesslich Admins und die betroffene Person. Das Annehmen
  // bleibt korrekt: der Server schreibt beim Akzeptieren immer die ECHTE Art
  // des gespeicherten Wunsches in den Arbeitsplan, nie die maskierte Ansicht.
  data.vacations = maskUfEntries(data.vacations, user.id, false)
  data.wishes = maskUfWuensche(data.wishes, user.id, false)
  const personen: Person[] = data.employees.map(e => ({ id: e.id, full_name: e.full_name, job_title: e.job_title, pensum: e.pensum, eintrittsdatum: e.eintrittsdatum ?? null }))
  const ctx = await ladeFerienKontext(adminClient, personen, data.wishes)
  const wochen = wochenFuerAdmin(ctx)
  const personRegeln = Object.fromEntries(personen.map(q => [q.id, personRegelFuer(q, ctx.personRegelnGespeichert[q.id])]))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Ferienplanung</h1>
        <p className="page-subtitle">Wochenanmeldungen, Wünsche, Ferienkalender, Samstage und Notfalldienste</p>
      </div>
      <FerienplanungClient {...data} vertretungen={vt.vertretungen} kandidaten={vt.kandidaten}
        samstage={samstage} samstageTeam={team} samstageVerwalten meinId={user.id} meineRolle={samstagRolle(p?.job_title)} heute={heute}
        wochen={wochen} regeln={ctx.regeln} personRegeln={personRegeln} einsaetze={ctx.einsaetze} zweiWochen={zweiWochenProPerson(ctx)} anspruchAnpassungen={ctx.konfig.anspruch} anteile={ctx.anteile}
        notfalldienste={notfalldienste} meineNdRolle={ndRolle(p?.job_title)} istAdmin={false} />
    </div>
  )
}
