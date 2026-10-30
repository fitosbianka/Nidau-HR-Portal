// Erinnerungen der Admin-Startseite: dauerhaft ausgeblendete Einträge
// («Nie mehr anzeigen»). «Nur diesmal schliessen» merkt sich der Browser
// für die laufende Sitzung; «Nie mehr anzeigen» landet hier und gilt für
// alle Admins, bis es unten auf der Startseite wieder eingeschaltet wird.
//   __erinnerung_aus__ @ 2000-01-01 → JSON { [key]: { label, am, von } }

import type { SupabaseClient } from '@supabase/supabase-js'

export const ERINNERUNG_AUS_KEY = '__erinnerung_aus__'
export const ERINNERUNG_ANCHOR = '2000-01-01'

export type ErinnerungAus = {
  /** Dauerhaft-Schlüssel der Erinnerung, z.B. «pfaendung:<profileId>» */
  key: string
  /** Lesbare Beschriftung für die Liste «Ausgeblendete Erinnerungen» */
  label: string
  am: string      // ISO
  von: string
}

export function parseErinnerungAus(comment: string | null | undefined): ErinnerungAus[] {
  if (!comment) return []
  try {
    const j = JSON.parse(comment) as Record<string, Partial<ErinnerungAus>>
    if (!j || typeof j !== 'object') return []
    return Object.entries(j)
      .filter(([k, v]) => k && v && typeof v === 'object')
      .map(([key, v]) => ({ key, label: v.label ?? key, am: v.am ?? '', von: v.von ?? '' }))
      .sort((a, b) => b.am.localeCompare(a.am))
  } catch { return [] }
}

export async function ladeErinnerungAus(client: SupabaseClient): Promise<ErinnerungAus[]> {
  const { data } = await client.from('zeiterfassung_comments')
    .select('comment')
    .eq('user_full_name', ERINNERUNG_AUS_KEY)
    .eq('schedule_date', ERINNERUNG_ANCHOR)
    .maybeSingle()
  return parseErinnerungAus((data as { comment: string } | null)?.comment)
}
