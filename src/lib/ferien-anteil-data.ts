// Ferienanteil pro Wochentag aus der Datenbank laden (reservierte Zeilen
// __ferien_anteil__<profileId>) und mit dem Namensstandard zur Karte
// zusammenführen. Nur auf dem Server.

import type { SupabaseClient } from '@supabase/supabase-js'
import { ANTEIL_ANCHOR, ANTEIL_PREFIX, baueAnteilKarte, parseAnteilRows, type AnteilKarte, type AnteilRegel } from './ferien-anteil'
import { ladeAlleSeiten } from './seiten'

const escLike = (s: string) => s.replace(/_/g, '\\_')

/** Alle gespeicherten Regeln, Schlüssel = Profil-ID. */
export async function ladeFerienAnteilRows(client: SupabaseClient): Promise<Record<string, AnteilRegel>> {
  const rows = await ladeAlleSeiten<{ user_full_name: string; comment: string }>((von, bis) => client
    .from('zeiterfassung_comments')
    .select('user_full_name, comment')
    .like('user_full_name', `${escLike(ANTEIL_PREFIX)}%`)
    .eq('schedule_date', ANTEIL_ANCHOR)
    .order('user_full_name')
    .range(von, bis))
  return parseAnteilRows(rows)
}

/** Karte der geltenden Regeln (gespeichert vor Standard) für diese Personen,
 *  unter Profil-ID und Namen. */
export async function ladeFerienAnteile(client: SupabaseClient, personen: Array<{ id: string; full_name: string }>): Promise<AnteilKarte> {
  const gespeichert = await ladeFerienAnteilRows(client)
  return baueAnteilKarte(personen, gespeichert)
}
