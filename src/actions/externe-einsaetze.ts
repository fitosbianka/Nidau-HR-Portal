'use server'

// Admin Aktionen zu den Einsätzen externer Mitarbeitender: Status pro
// Einsatz (offen, erledigt, abgesagt), Zeiten setzen oder ändern und die
// Einsätze der früheren Vereinbarung 2027 entfernen. Zeiten werden wie in
// der Ferienplanung unter __ferien_einsatz__ @ Datum abgelegt.

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { EINSATZ_KEY, parseEinsatzRows, type Einsatz } from '@/lib/ferien-regeln'
import { erledigtKey, type EinsatzStatus } from '@/lib/externe-einsaetze'

const UUID_RE = /^[0-9a-f-]{8,64}$/i
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/
const ZEIT_RE = /^\d{2}:\d{2}$/
const ID_RE = /^[\w-]{1,80}$/
type Row = { user_full_name: string; schedule_date: string; comment: string }

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (p?.role !== 'admin') throw new Error('Keine Berechtigung')
  return { admin: await createAdminClient(), name: p?.full_name ?? 'Admin' }
}

function revalidate(profileId: string) {
  for (const p of [`/admin/employees/${profileId}`, '/admin/zeiterfassung/ferien/planung']) revalidatePath(p)
}

async function profilName(admin: Awaited<ReturnType<typeof createAdminClient>>, profileId: string): Promise<string> {
  const { data } = await admin.from('profiles').select('full_name').eq('id', profileId).maybeSingle()
  return ((data as { full_name: string | null } | null)?.full_name ?? '').trim()
}

async function einsatzListeSchreiben(admin: Awaited<ReturnType<typeof createAdminClient>>, datum: string, liste: Einsatz[], von: string): Promise<string | null> {
  if (liste.length === 0) {
    const { error } = await admin.from('zeiterfassung_comments').delete().eq('user_full_name', EINSATZ_KEY).eq('schedule_date', datum)
    return error?.message ?? null
  }
  const am = new Date().toISOString()
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: EINSATZ_KEY, schedule_date: datum, comment: JSON.stringify({ liste: liste.map(x => ({ id: x.id, name: x.name, von: x.von, bis: x.bis, assistenz: x.assistenz })), von, am }), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error?.message ?? null
}

/** Status eines Einsatzes setzen: offen (Eintrag entfernen), erledigt oder abgesagt. */
export async function einsatzStatusSetzen(profileId: string, datum: string, einsatzId: string, status: EinsatzStatus) {
  const { admin } = await requireAdmin()
  if (!UUID_RE.test(profileId) || !DATUM_RE.test(datum) || !ID_RE.test(einsatzId) || !['offen', 'erledigt', 'abgesagt'].includes(status)) return { error: 'Ungültige Angaben.' }
  const key = erledigtKey(profileId)
  const { data } = await admin.from('zeiterfassung_comments').select('comment').eq('user_full_name', key).eq('schedule_date', datum).maybeSingle()
  const map: Record<string, 'erledigt' | 'abgesagt'> = {}
  try {
    const j = JSON.parse((data as { comment: string } | null)?.comment ?? '{}') as { status?: Record<string, unknown>; erledigt?: Record<string, unknown> }
    if (j.status && typeof j.status === 'object') for (const [id, v] of Object.entries(j.status)) if (v === 'erledigt' || v === 'abgesagt') map[id] = v
    if (j.erledigt && typeof j.erledigt === 'object') for (const id of Object.keys(j.erledigt)) if (!map[id]) map[id] = 'erledigt'
  } catch { /* leer */ }
  if (status === 'offen') delete map[einsatzId]; else map[einsatzId] = status
  const am = new Date().toISOString()
  const { error } = Object.keys(map).length === 0
    ? await admin.from('zeiterfassung_comments').delete().eq('user_full_name', key).eq('schedule_date', datum)
    : await admin.from('zeiterfassung_comments').upsert(
        { user_full_name: key, schedule_date: datum, comment: JSON.stringify({ status: map }), updated_at: am },
        { onConflict: 'user_full_name,schedule_date' },
      )
  if (error) return { error: error.message }
  revalidate(profileId)
  return { success: true as const }
}

/** Zeiten für einen oder mehrere Einsätze setzen oder ändern. Der Eintrag
 *  landet in der Liste der festen Einsätze des Tages mit der Kennung des
 *  Einsatzes und gilt damit auch in der Ferienplanung. */
export async function einsatzZeitenSetzen(profileId: string, eintraege: Array<{ datum: string; id: string }>, von: string, bis: string) {
  const { admin, name: adminName } = await requireAdmin()
  if (!UUID_RE.test(profileId) || !Array.isArray(eintraege) || eintraege.length === 0 || eintraege.length > 200) return { error: 'Ungültige Angaben.' }
  if (!ZEIT_RE.test(von) || !ZEIT_RE.test(bis) || bis <= von) return { error: 'Bitte Von und Bis angeben, Bis nach Von.' }
  for (const e of eintraege) if (!DATUM_RE.test(e.datum) || !ID_RE.test(e.id)) return { error: 'Ungültige Angaben.' }
  const name = await profilName(admin, profileId)
  if (!name) return { error: 'Person nicht gefunden.' }
  for (const e of eintraege) {
    const { data } = await admin.from('zeiterfassung_comments').select('user_full_name, schedule_date, comment').eq('user_full_name', EINSATZ_KEY).eq('schedule_date', e.datum).maybeSingle()
    // am selben Tag ersetzt der neue Eintrag frühere Einträge derselben Person
    const liste = parseEinsatzRows(data ? [data as Row] : []).filter(x => x.id !== e.id && x.name !== name)
    liste.push({ id: e.id, datum: e.datum, name, kategorie: 'ZAZ', von, bis, assistenz: true })
    const err = await einsatzListeSchreiben(admin, e.datum, liste, adminName)
    if (err) return { error: err }
  }
  revalidate(profileId)
  return { success: true as const, anzahl: eintraege.length }
}

/** Die gespeicherten Einsätze der früheren Vereinbarung 2027 (feste Wochen,
 *  Kennung fritz-2027-…) dieser Person entfernen. */
export async function alteEinsaetzeEntfernen(profileId: string) {
  const { admin, name: adminName } = await requireAdmin()
  if (!UUID_RE.test(profileId)) return { error: 'Ungültige Angaben.' }
  const name = await profilName(admin, profileId)
  if (!name) return { error: 'Person nicht gefunden.' }
  const { data } = await admin.from('zeiterfassung_comments').select('user_full_name, schedule_date, comment').eq('user_full_name', EINSATZ_KEY)
    .gte('schedule_date', '2027-01-01').lte('schedule_date', '2027-12-31')
  const alle = parseEinsatzRows((data ?? []) as Row[])
  const alt = alle.filter(e => e.name === name && /^fritz-2027-\d{2}-\d{2}$/.test(e.id))
  for (const datum of Array.from(new Set(alt.map(e => e.datum)))) {
    const err = await einsatzListeSchreiben(admin, datum, alle.filter(e => e.datum === datum && !alt.includes(e)), adminName)
    if (err) return { error: err }
  }
  revalidate(profileId)
  return { success: true as const, anzahl: alt.length }
}
