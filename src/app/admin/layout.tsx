import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/Sidebar'
import VersionsWaechter from '@/components/layout/VersionsWaechter'
import FerienReminderPopup from '@/components/ferien/FerienReminderPopup'
import { getFerienReminder } from '@/lib/ferien-reminder'
import { PLAN_YEAR } from '@/lib/ferien-wuensche'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .single()

  const p = profile as { role: string; full_name: string } | null
  if (p?.role !== 'admin') redirect('/employee')

  // Best-effort: ein Aussetzer bei diesem Komfort-Hinweis darf nie das
  // ganze Portal auf die Fehlerseite werfen
  const ferienReminder = await getFerienReminder(await createAdminClient(), user.id).catch(() => null)

  return (
    <div className="min-h-screen bg-paper">
      <VersionsWaechter />
      {/* Admins erhalten nur die Eingabe-Erinnerung — den Veröffentlichungs-
          Hinweis brauchen sie nicht (sie veröffentlichen selbst). */}
      {ferienReminder === 'eingabe' && (
        <FerienReminderPopup planYear={PLAN_YEAR} href="/admin/zeiterfassung/ferien/planung" />
      )}
      {/* Sidebar is hidden in print to prevent the mobile fixed header
          from appearing on every printed page and causing blank first page */}
      <div className="print:hidden">
        <Sidebar
          role="admin"
          userName={p?.full_name ?? ''}
        />
      </div>
      <main className="lg:pl-64 pt-16 lg:pt-0 print:!p-0">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 xl:px-10 pt-8 pb-12 print:!p-0 print:max-w-none print:mx-0">
          {children}
        </div>
      </main>
    </div>
  )
}
