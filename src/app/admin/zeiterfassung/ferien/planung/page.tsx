import { createClient } from '@/lib/supabase/server'
import { loadFerienplanungData, ladeFerienVertretungen } from '@/lib/ferienplanung-data'
import { ladeSamstage, ladeSamstagTeam } from '@/lib/samstage-data'
import { samstagRolle } from '@/lib/samstage'
import { ladeNotfalldienste } from '@/lib/notfalldienste-data'
import { ndRolle } from '@/lib/notfalldienste'
import { ladeFerienKontext, wochenFuerAdmin, zweiWochenProPerson } from '@/lib/ferien-wochen-data'
import { personRegelFuer } from '@/lib/ferien-regeln'
import type { Person } from '@/lib/ferien-wochen'
import { zurichToday } from '@/lib/salary-sync'
import { darfFerienNotiz, ladeFerienNotiz } from '@/lib/ferien-notiz'
import FerienplanungClient from './FerienplanungClient'

export const dynamic = 'force-dynamic'

export default async function FerienplanungPage() {
  const supabase = await createClient()
  const heute = zurichToday()
  const jahr = `${heute.slice(0, 4)}-01-01`
  const { data: { user } } = await supabase.auth.getUser()
  const [data, vt, samstage, team, notfalldienste, { data: prof }] = await Promise.all([
    loadFerienplanungData(supabase),
    ladeFerienVertretungen(supabase),
    ladeSamstage(supabase, jahr),
    ladeSamstagTeam(supabase),
    ladeNotfalldienste(supabase, jahr),
    user ? supabase.from('profiles').select('job_title, role, full_name').eq('id', user.id).single() : Promise.resolve({ data: null }),
  ])
  const personen: Person[] = data.employees.map(e => ({ id: e.id, full_name: e.full_name, job_title: e.job_title, pensum: e.pensum, eintrittsdatum: e.eintrittsdatum ?? null }))
  const ctx = await ladeFerienKontext(supabase, personen, data.wishes)
  const wochen = wochenFuerAdmin(ctx)
  const personRegeln = Object.fromEntries(personen.map(p => [p.id, personRegelFuer(p, ctx.personRegelnGespeichert[p.id])]))
  const profil = prof as { job_title: string | null; role: string; full_name: string } | null
  const jobTitle = profil?.job_title
  // Notizen: nur Bianka (nicht andere Admins)
  const notizErlaubt = darfFerienNotiz(profil?.role, profil?.full_name)
  const notiz = notizErlaubt ? await ladeFerienNotiz(supabase).catch(() => ({ text: '', am: null })) : null
  return (
    <FerienplanungClient {...data} vertretungen={vt.vertretungen} kandidaten={vt.kandidaten}
      samstage={samstage} samstageTeam={team} samstageVerwalten meinId={user?.id ?? ''} meineRolle={samstagRolle(jobTitle)} heute={heute}
      wochen={wochen} regeln={ctx.regeln} personRegeln={personRegeln} einsaetze={ctx.einsaetze} zweiWochen={zweiWochenProPerson(ctx)} anspruchAnpassungen={ctx.konfig.anspruch}
      notfalldienste={notfalldienste} meineNdRolle={ndRolle(jobTitle)} istAdmin notiz={notiz} />
  )
}
