import { PRAXIS } from '@/config/praxis'
// Externe Mitarbeitende (selbständig, kein Anstellungsverhältnis):
// Sie erscheinen im Arbeitsplan (in ihrer Berufsgruppe) und können
// Lohn-/Honorarabrechnungen erhalten, zählen aber NICHT als Angestellte —
// keine Ferienplanung, keine automatischen Lohn-Erinnerungen, keine
// Geburtstags-/Team-Listen.
// Kennzeichnung auf zwei Wegen: die feste Namensliste unten (historisch)
// und die auf der Mitarbeiterseite gesetzte Markierung, abgelegt als
// reservierte Zeile __extern__<profileId> @ 1970-01-01 in
// zeiterfassung_comments (kein DDL nötig).

import type { SupabaseClient } from '@supabase/supabase-js'

export const EXTERNE_NAMEN = new Set<string>(PRAXIS.externeNamen)

export function istExtern(fullName: string | null | undefined): boolean {
  return EXTERNE_NAMEN.has(fullName ?? '')
}

export const EXTERN_PREFIX = '__extern__'
export const EXTERN_ANCHOR = '1970-01-01'
export const externKey = (profileId: string) => `${EXTERN_PREFIX}${profileId}`

/** Kategorien, die eine externe Person haben kann (kein Admin). */
export const EXTERN_KATEGORIEN = ['ZAZ', 'DH / PA', 'DA', 'Leitende DA', 'Lernende'] as const

/** Profil IDs mit gesetzter Extern Markierung (nur mit Admin Rechten lesbar). */
export async function ladeExterne(client: SupabaseClient): Promise<Set<string>> {
  const { data } = await client.from('zeiterfassung_comments').select('user_full_name')
    .like('user_full_name', `${EXTERN_PREFIX.replace(/_/g, '\\_')}%`)
  return new Set(((data ?? []) as Array<{ user_full_name: string }>).map(r => r.user_full_name.slice(EXTERN_PREFIX.length)))
}

/** Extern per Markierung ODER per Namensliste. */
export const istExternProfil = (p: { id: string; full_name: string | null }, externeIds: Set<string>) =>
  externeIds.has(p.id) || istExtern(p.full_name)

/** Ist diese Person extern? Namensliste zuerst (ohne Abfrage), sonst die Markierung. */
export async function istExternNutzer(client: SupabaseClient, p: { id: string; full_name: string | null | undefined }): Promise<boolean> {
  if (istExtern(p.full_name)) return true
  try { return (await ladeExterne(client)).has(p.id) } catch { return false }
}

/** Seiten im Mitarbeiterbereich, die Externe nicht brauchen: Zeiterfassung und Teamevents. */
export const EXTERN_GESPERRT = ['/employee/zeiterfassung', '/employee/teamevents']
