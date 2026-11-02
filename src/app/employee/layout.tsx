import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/Sidebar'
import VersionsWaechter from '@/components/layout/VersionsWaechter'
import FerienReminderPopup from '@/components/ferien/FerienReminderPopup'
import BestellErinnerungPopup from '@/components/bestellungen/BestellErinnerungPopup'
import { LEITENDE_TITLE, FERIEN_EDITORS } from '@/lib/leitende'
import { hatBestellZugang, BESTELLER_NAME } from '@/lib/bestellungen'
import { ladeFaelligeErinnerungen } from '@/lib/bestellungen-data'
import { getFerienReminder, getZweiWochenHinweis } from '@/lib/ferien-reminder'
import { ladeFerienHinweis } from '@/lib/ferien-hinweis'
import { PLAN_YEAR } from '@/lib/ferien-wuensche'
import { istGast } from '@/lib/gaeste'
import { istExternNutzer } from '@/lib/externe'

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, job_title')
    .eq('id', user.id)
    .single()

  const p = profile as { role: string; full_name: string; job_title: string | null } | null
  if (p?.role === 'admin') redirect('/admin')

  const isFerienEditor = FERIEN_EDITORS.includes(p?.full_name ?? '')
  const gast = istGast(p?.job_title)
  // Best-effort: ein Aussetzer bei diesem Komfort-Hinweis darf nie das
  // ganze Portal auf die Fehlerseite werfen
  const adminClient = gast ? null : await createAdminClient()
  // Externe (zum Beispiel Fritz) haben keine Ferienplanung, keine Zeiterfassung und keine Teamevents
  const extern = adminClient ? await istExternNutzer(adminClient, { id: user.id, full_name: p?.full_name }) : false
  const [ferienReminderRoh, zweiWochen, ferienHinweis] = adminClient && !extern
    ? await Promise.all([
        getFerienReminder(adminClient, user.id, p?.job_title ?? null).catch(() => null),
        getZweiWochenHinweis(adminClient, user.id, p?.full_name, p?.job_title).catch(() => false),
        ladeFerienHinweis(adminClient, user.id).catch(() => ({ seite: false, login: false })),
      ])
    : [null, false, { seite: false, login: false }]
  // «Nicht mehr anzeigen»: der Eingabe Hinweis bleibt für diese Person weg
  const ferienReminder = ferienReminderRoh === 'eingabe' && ferienHinweis.login ? null : ferienReminderRoh
  const reminderKind = ferienReminder ?? (zweiWochen ? 'zweiwochen' as const : null)
  // Fällige Bestell-Erinnerungen («Im Auge behalten») — das Fenster bekommt
  // NUR die Bestell-Verantwortliche (Neya), nie Admins oder andere Berechtigte
  const bestellFaellig = adminClient && p?.full_name === BESTELLER_NAME
    ? await ladeFaelligeErinnerungen(adminClient).catch(() => [])
    : []

  return (
    <div className="min-h-screen bg-paper">
      <VersionsWaechter />
      {reminderKind && (
        <FerienReminderPopup planYear={PLAN_YEAR} kind={reminderKind} zweiWochen={zweiWochen} nieMehr
          href={isFerienEditor ? '/employee/team/ferien' : '/employee/ferien'} />
      )}
      {bestellFaellig.length > 0 && (
        <BestellErinnerungPopup faellig={bestellFaellig} href="/employee/bestellungen" />
      )}
      <Sidebar
        role="employee"
        userName={p?.full_name ?? ''}
        isLeitende={p?.job_title === LEITENDE_TITLE}
        isFerienEditor={isFerienEditor}
        isBesteller={hatBestellZugang(p?.role, p?.job_title, p?.full_name, LEITENDE_TITLE)}
        isGast={gast}
        isExtern={extern}
      />
      <main className="lg:pl-64 pt-16 lg:pt-0">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 xl:px-10 pt-8 pb-12">
          {children}
        </div>
      </main>
    </div>
  )
}
