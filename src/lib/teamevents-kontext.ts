// Gemeinsame Zugangsprüfung der Teamevent Seiten (Admin und Mitarbeiter
// Bereich). Zugriff siehe TE_FREIGABE in src/lib/teamevents.ts; die
// Layouts prüfen zusätzlich die Rolle.

import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { hatTeameventZugang, istOrganisatorin } from '@/lib/teamevents'

export type TeBasis = '/admin/teamevents' | '/employee/teamevents'
export const TE_SLUG_RE = /^[a-z0-9-]{2,60}$/

export async function teameventKontext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (!hatTeameventZugang(p?.role, p?.full_name)) redirect(p?.role === 'admin' ? '/admin' : '/employee')
  const verwaltet = istOrganisatorin(p?.full_name)
  return { user, name: p?.full_name ?? '', role: p?.role ?? null, verwaltet, viewer: { id: user.id, verwaltet }, admin: await createAdminClient() }
}
