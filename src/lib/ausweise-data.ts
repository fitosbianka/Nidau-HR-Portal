// Serverseitiges Laden der Ausweisdaten (Admin Client). Nur aufrufen,
// nachdem die Seite bzw. Action geprüft hat: eigene Person oder
// Organisatorin. Bilder werden nicht signiert verlinkt, sondern über die
// geprüfte Route /api/ausweis-bild ausgeliefert (dort entschlüsselt).

import type { SupabaseClient } from '@supabase/supabase-js'
import { AUSWEIS_ANCHOR, ausweisKey, type Ausweis, type AusweisBild } from './ausweise'
import { parseAusweisGeheim } from './teamevent-geheim'

export type AusweisMitBildern = Ausweis & { bilderMitUrl: Array<AusweisBild & { url: string | null }> }

export const ausweisBildUrl = (profileId: string, bildId: string) => `/api/ausweis-bild?p=${encodeURIComponent(profileId)}&id=${encodeURIComponent(bildId)}`

export async function ladeAusweis(admin: SupabaseClient, profileId: string): Promise<AusweisMitBildern> {
  const { data, error } = await admin.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', ausweisKey(profileId)).eq('schedule_date', AUSWEIS_ANCHOR).maybeSingle()
  if (error) throw new Error(`Ausweisdaten konnten nicht geladen werden: ${error.message}`)
  const a = parseAusweisGeheim(profileId, (data as { comment: string } | null)?.comment)
  return { ...a, bilderMitUrl: a.bilder.map(b => ({ ...b, url: ausweisBildUrl(profileId, b.id) })) }
}
