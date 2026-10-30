// Persönliche Notizen auf der Ferienplanung, nur für Bianka (nicht für
// andere Admins, nicht für Laura). Eine reservierte Zeile:
//   __ferien_notiz__ @ 2000-01-01 → { text, am }

import type { SupabaseClient } from '@supabase/supabase-js'
import { PRAXIS } from '@/config/praxis'

export const FERIEN_NOTIZ_KEY = '__ferien_notiz__'
export const FERIEN_NOTIZ_ANCHOR = '2000-01-01'
export const FERIEN_NOTIZ_INHABERIN = PRAXIS.portalAdmin
export const FERIEN_NOTIZ_MAX = 20000

export const darfFerienNotiz = (role: string | null | undefined, fullName: string | null | undefined) =>
  role === 'admin' && (fullName ?? '') === FERIEN_NOTIZ_INHABERIN

export type FerienNotiz = { text: string; am: string | null }

export function parseFerienNotiz(comment: string | null | undefined): FerienNotiz {
  if (!comment) return { text: '', am: null }
  try {
    const j = JSON.parse(comment) as Partial<FerienNotiz>
    return { text: typeof j.text === 'string' ? j.text.slice(0, FERIEN_NOTIZ_MAX) : '', am: typeof j.am === 'string' ? j.am : null }
  } catch { return { text: '', am: null } }
}

export async function ladeFerienNotiz(client: SupabaseClient): Promise<FerienNotiz> {
  const { data } = await client.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', FERIEN_NOTIZ_KEY).eq('schedule_date', FERIEN_NOTIZ_ANCHOR).maybeSingle()
  return parseFerienNotiz((data as { comment: string } | null)?.comment)
}
