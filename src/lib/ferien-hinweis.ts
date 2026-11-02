// «Nicht mehr anzeigen» für die Hinweise der Ferienplanung, pro Person und
// Planjahr, serverseitig gespeichert (gilt damit auf jedem Gerät und in
// jedem Browser). Reservierte Zeile in zeiterfassung_comments (kein DDL):
//   __ferien_hinweis__<profileId> @ <PLAN_YEAR>-01-01
//   → { seite?: ISO, login?: ISO }  (wann die Person den Hinweis abgestellt hat)
//   · seite: Erklärfenster auf der Ferienplanung Seite
//   · login: Anmelde Fenster «Ferienplanung ist offen»

import type { SupabaseClient } from '@supabase/supabase-js'
import { PLAN_YEAR } from './ferien-wuensche'

export const FERIEN_HINWEIS_PREFIX = '__ferien_hinweis__'
export const ferienHinweisKey = (profileId: string) => `${FERIEN_HINWEIS_PREFIX}${profileId}`
export const FERIEN_HINWEIS_ANKER = `${PLAN_YEAR}-01-01`

export type FerienHinweisArt = 'seite' | 'login'
export const FERIEN_HINWEIS_ARTEN: FerienHinweisArt[] = ['seite', 'login']
/** Pro Hinweis: true = die Person will ihn nicht mehr sehen */
export type FerienHinweisStand = Record<FerienHinweisArt, boolean>

export function parseFerienHinweis(comment: string | null | undefined): FerienHinweisStand {
  const aus: FerienHinweisStand = { seite: false, login: false }
  if (!comment) return aus
  try {
    const j = JSON.parse(comment) as Record<string, unknown>
    if (!j || typeof j !== 'object' || Array.isArray(j)) return aus
    for (const art of FERIEN_HINWEIS_ARTEN) aus[art] = typeof j[art] === 'string' && j[art] !== ''
    return aus
  } catch { return aus }
}

/** Welche Hinweise die Person abgestellt hat. */
export async function ladeFerienHinweis(client: SupabaseClient, profileId: string): Promise<FerienHinweisStand> {
  const { data } = await client.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', ferienHinweisKey(profileId)).eq('schedule_date', FERIEN_HINWEIS_ANKER).maybeSingle()
  return parseFerienHinweis((data as { comment: string } | null)?.comment)
}
