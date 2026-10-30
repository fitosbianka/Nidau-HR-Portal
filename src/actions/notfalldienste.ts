'use server'

// Notfalldienste mit Anmeldung: Admins und Laura legen Dienste an,
// bearbeiten und löschen sie und tragen Personen ein. Zahnärztinnen und
// Assistenz melden sich selbst an oder ab. Jede Anmeldung schreibt ND
// sofort an den Arbeitstagen des Zeitraums in den Arbeitsplan, nie über
// ein F (solche Tage bleiben frei). Abmelden entfernt die ND Tage wieder.

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { FERIEN_EDITORS } from '@/lib/leitende'
import { weekdaysBetween } from '@/lib/ferien-wuensche'
import {
  ND_PREFIX, ND_ANMELDUNG_PREFIX, ndAnmeldungKey, ndRolle, istNdRolle, ND_ROLLEN, ND_BEDARF_STANDARD, parseNdRow, parseNdAnmeldungRow,
  type NdRolle, type NdBedarf,
} from '@/lib/notfalldienste'

const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f-]{8,64}$/i
type Admin = Awaited<ReturnType<typeof createAdminClient>>
const NUR_VERWALTUNG = { error: 'Das können nur Admins und Laura.' }

async function nutzer() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase.from('profiles').select('role, full_name, job_title').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string; job_title: string | null } | null
  const name = p?.full_name ?? ''
  return { admin: await createAdminClient(), userId: user.id, name, jobTitle: p?.job_title ?? null, verwaltet: p?.role === 'admin' || FERIEN_EDITORS.includes(name) }
}
const revalidate = () => {
  for (const p of ['/admin/zeiterfassung/ferien/planung', '/employee/team/ferien', '/employee/ferien', '/admin/arbeitsplan', '/employee/arbeitsplan']) revalidatePath(p)
}

async function dienst(admin: Admin, von: string) {
  const { data } = await admin.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', ND_PREFIX).eq('schedule_date', von).maybeSingle()
  return data ? parseNdRow(von, (data as { comment: string }).comment) : null
}
async function anmeldung(admin: Admin, von: string, profileId: string) {
  const { data } = await admin.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', ndAnmeldungKey(profileId)).eq('schedule_date', von).maybeSingle()
  return data ? parseNdAnmeldungRow((data as { comment: string }).comment) : null
}
function bedarfSauber(b: Partial<NdBedarf> | null | undefined): NdBedarf {
  const z = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(20, Math.round(v)) : null)
  const out = { ...ND_BEDARF_STANDARD }
  for (const r of ND_ROLLEN) out[r] = z(b?.[r])
  return out
}

/** Notfalldienst anlegen (Admins und Laura). */
export async function ndAnlegen(von: string, bis: string, notiz: string, bedarf: Partial<NdBedarf> | null) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  if (!DATUM_RE.test(von) || !DATUM_RE.test(bis) || bis < von) return { error: 'Bitte einen gültigen Zeitraum wählen.' }
  if (await dienst(n.admin, von)) return { error: 'An diesem Startdatum ist schon ein Notfalldienst erfasst.' }
  const am = new Date().toISOString()
  const { error } = await n.admin.from('zeiterfassung_comments').upsert(
    { user_full_name: ND_PREFIX, schedule_date: von, comment: JSON.stringify({ bis, notiz: (notiz ?? '').trim().slice(0, 300), bedarf: bedarfSauber(bedarf ?? ND_BEDARF_STANDARD), erstelltVon: n.name, erstelltAm: am }), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  revalidate()
  return { success: true as const }
}

/** Notfalldienst bearbeiten; bei Datumswechsel ziehen die Anmeldungen mit
 *  (bestätigte ND Tage werden nicht verschoben, bitte Bestätigung neu setzen). */
export async function ndBearbeiten(von: string, neu: { von: string; bis: string; notiz: string; bedarf: Partial<NdBedarf> | null }) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  if (!DATUM_RE.test(von) || !DATUM_RE.test(neu.von) || !DATUM_RE.test(neu.bis) || neu.bis < neu.von) return { error: 'Bitte einen gültigen Zeitraum wählen.' }
  const alt = await dienst(n.admin, von)
  if (!alt) return { error: 'Notfalldienst nicht gefunden.' }
  if (neu.von !== von && (await dienst(n.admin, neu.von))) return { error: 'Am neuen Startdatum ist schon ein Notfalldienst erfasst.' }
  const am = new Date().toISOString()
  const comment = JSON.stringify({ bis: neu.bis, notiz: (neu.notiz ?? '').trim().slice(0, 300), bedarf: bedarfSauber(neu.bedarf), geaendertVon: n.name, geaendertAm: am })
  const { error } = await n.admin.from('zeiterfassung_comments').update({ schedule_date: neu.von, comment, updated_at: am }).eq('user_full_name', ND_PREFIX).eq('schedule_date', von)
  if (error) return { error: error.message }
  if (neu.von !== von) {
    await n.admin.from('zeiterfassung_comments').update({ schedule_date: neu.von, updated_at: am })
      .like('user_full_name', `${ND_ANMELDUNG_PREFIX.replace(/_/g, '\\_')}%`).eq('schedule_date', von)
  }
  revalidate()
  return { success: true as const }
}

/** Notfalldienst samt Anmeldungen löschen; bestätigte ND Tage werden entfernt. */
export async function ndLoeschen(von: string) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  if (!DATUM_RE.test(von)) return { error: 'Ungültiges Datum.' }
  const d = await dienst(n.admin, von)
  if (!d) return { error: 'Notfalldienst nicht gefunden.' }
  const { data: rows } = await n.admin.from('zeiterfassung_comments').select('user_full_name, comment')
    .like('user_full_name', `${ND_ANMELDUNG_PREFIX.replace(/_/g, '\\_')}%`).eq('schedule_date', von)
  for (const r of (rows ?? []) as Array<{ user_full_name: string; comment: string }>) {
    const a = parseNdAnmeldungRow(r.comment)
    if (a?.status === 'bestaetigt') await ndTageEntfernen(n.admin, r.user_full_name.slice(ND_ANMELDUNG_PREFIX.length), d.von, d.bis)
  }
  await n.admin.from('zeiterfassung_comments').delete().like('user_full_name', `${ND_ANMELDUNG_PREFIX.replace(/_/g, '\\_')}%`).eq('schedule_date', von)
  const { error } = await n.admin.from('zeiterfassung_comments').delete().eq('user_full_name', ND_PREFIX).eq('schedule_date', von)
  if (error) return { error: error.message }
  revalidate()
  return { success: true as const }
}

async function anmeldungSchreiben(admin: Admin, von: string, profileId: string, rolle: NdRolle, status: 'offen' | 'bestaetigt', durchAdmin: boolean, wer: string, amAlt?: string) {
  const am = new Date().toISOString()
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: ndAnmeldungKey(profileId), schedule_date: von, comment: JSON.stringify({ rolle, am: amAlt ?? am, status, durchAdmin, von: wer, geaendertAm: am }), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error ? { error: error.message } : null
}

/** Sich selbst anmelden (Zahnarzt oder Assistenz, nicht DH / PA). Die
 *  ND Tage stehen sofort im Arbeitsplan. */
export async function ndAnmelden(von: string) {
  const n = await nutzer()
  if (!DATUM_RE.test(von)) return { error: 'Ungültiges Datum.' }
  const rolle = ndRolle(n.jobTitle)
  if (!rolle) return { error: 'Für diese Kategorie ist keine Anmeldung zum Notfalldienst vorgesehen.' }
  const d = await dienst(n.admin, von)
  if (!d) return { error: 'Notfalldienst nicht gefunden.' }
  if (await anmeldung(n.admin, von, n.userId)) return { error: 'Du bist für diesen Notfalldienst schon angemeldet.' }
  const w = await ndTageSchreiben(n.admin, n.userId, d.von, d.bis)
  if (w.error) return { error: w.error }
  const err = await anmeldungSchreiben(n.admin, von, n.userId, rolle, 'bestaetigt', false, n.name)
  if (err) return err
  revalidate()
  return { success: true as const, tage: w.tage }
}

/** Eigene Anmeldung zurückziehen, solange der Dienst noch nicht begonnen
 *  hat. Die ND Tage verschwinden wieder aus dem Arbeitsplan. */
export async function ndAbmelden(von: string) {
  const n = await nutzer()
  if (!DATUM_RE.test(von)) return { error: 'Ungültiges Datum.' }
  const [d, a] = await Promise.all([dienst(n.admin, von), anmeldung(n.admin, von, n.userId)])
  if (!a) return { error: 'Anmeldung nicht gefunden.' }
  if (d && d.von <= heuteZurich()) return { error: 'Dieser Notfalldienst hat schon begonnen. Bitte melde dich bei der Praxisleitung.' }
  if (d) await ndTageEntfernen(n.admin, n.userId, d.von, d.bis)
  const { error } = await n.admin.from('zeiterfassung_comments').delete().eq('user_full_name', ndAnmeldungKey(n.userId)).eq('schedule_date', von)
  if (error) return { error: error.message }
  revalidate()
  return { success: true as const }
}

/** Person durch Admin oder Laura eintragen (Rolle wählbar). Die ND Tage
 *  stehen sofort im Arbeitsplan. */
export async function ndPersonSetzen(von: string, profileId: string, rolle: NdRolle | null) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  if (!DATUM_RE.test(von) || !UUID_RE.test(profileId)) return { error: 'Ungültige Angaben.' }
  const d = await dienst(n.admin, von)
  if (!d) return { error: 'Notfalldienst nicht gefunden.' }
  const { data: prof } = await n.admin.from('profiles').select('job_title').eq('id', profileId).maybeSingle()
  if (!prof) return { error: 'Person nicht gefunden.' }
  const r = istNdRolle(rolle) ? rolle : ndRolle((prof as { job_title: string | null }).job_title)
  if (!r) return { error: 'Bitte wählen, ob die Person als Zahnarzt oder Assistenz eingetragen wird.' }
  const w = await ndTageSchreiben(n.admin, profileId, d.von, d.bis)
  if (w.error) return { error: w.error }
  const err = await anmeldungSchreiben(n.admin, von, profileId, r, 'bestaetigt', true, n.name)
  if (err) return err
  revalidate()
  return { success: true as const, tage: w.tage }
}

async function ndTageEntfernen(admin: Admin, profileId: string, von: string, bis: string) {
  await admin.from('work_schedule').delete().eq('employee_id', profileId).eq('entry', 'ND').gte('schedule_date', von).lte('schedule_date', bis)
}

/** ND an den Arbeitstagen des Zeitraums eintragen, nie über ein F (diese
 *  Tage bleiben frei). Fehler, wenn kein Tag frei ist. */
async function ndTageSchreiben(admin: Admin, profileId: string, von: string, bis: string): Promise<{ error?: string; tage?: number }> {
  const tage = weekdaysBetween(von, bis)
  if (tage.length === 0) return { error: 'Keine Arbeitstage im Zeitraum.' }
  const { data: belegt } = await admin.from('work_schedule').select('schedule_date, entry').eq('employee_id', profileId).in('schedule_date', tage)
  const ferien = new Set(((belegt ?? []) as Array<{ schedule_date: string; entry: string }>).filter(e => e.entry === 'F' || e.entry.startsWith('F:') || e.entry === 'UF').map(e => e.schedule_date))
  const frei = tage.filter(t => !ferien.has(t))
  if (frei.length === 0) return { error: 'In diesem Zeitraum sind Ferien eingetragen, ein Notfalldienst ist dann nicht möglich.' }
  const { error } = await admin.from('work_schedule').upsert(frei.map(t => ({ employee_id: profileId, schedule_date: t, entry: 'ND' })), { onConflict: 'employee_id,schedule_date' })
  if (error) return { error: error.message }
  return { tage: frei.length }
}
const heuteZurich = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' })

/** Anmeldung einer Person entfernen; war sie bestätigt, verschwinden die ND Tage. */
export async function ndPersonEntfernen(von: string, profileId: string) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  if (!DATUM_RE.test(von) || !UUID_RE.test(profileId)) return { error: 'Ungültige Angaben.' }
  const [d, a] = await Promise.all([dienst(n.admin, von), anmeldung(n.admin, von, profileId)])
  if (d && a?.status === 'bestaetigt') await ndTageEntfernen(n.admin, profileId, d.von, d.bis)
  const { error } = await n.admin.from('zeiterfassung_comments').delete().eq('user_full_name', ndAnmeldungKey(profileId)).eq('schedule_date', von)
  if (error) return { error: error.message }
  revalidate()
  return { success: true as const }
}

/** Anmeldung bestätigen: ND an den Werktagen des Zeitraums eintragen, nie über ein F. */
export async function ndBestaetigen(von: string, profileId: string) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  if (!DATUM_RE.test(von) || !UUID_RE.test(profileId)) return { error: 'Ungültige Angaben.' }
  const [d, a] = await Promise.all([dienst(n.admin, von), anmeldung(n.admin, von, profileId)])
  if (!d || !a) return { error: 'Anmeldung nicht gefunden.' }
  const tage = weekdaysBetween(d.von, d.bis)
  if (tage.length === 0) return { error: 'Keine Arbeitstage im Zeitraum.' }
  const { data: ferien } = await n.admin.from('work_schedule').select('schedule_date').eq('employee_id', profileId)
    .in('schedule_date', tage).or('entry.eq.F,entry.like.F:*,entry.eq.UF').limit(1)
  if ((ferien ?? []).length > 0) return { error: 'Die Person hat in diesem Zeitraum Ferien eingetragen. Der Notfalldienst kann nicht bestätigt werden.' }
  const { error } = await n.admin.from('work_schedule').upsert(tage.map(t => ({ employee_id: profileId, schedule_date: t, entry: 'ND' })), { onConflict: 'employee_id,schedule_date' })
  if (error) return { error: error.message }
  const err = await anmeldungSchreiben(n.admin, von, profileId, a.rolle, 'bestaetigt', a.durchAdmin, n.name, a.am)
  if (err) return err
  revalidate()
  return { success: true as const, tage: tage.length }
}

/** Bestätigung zurücknehmen: ND Tage entfernen, Anmeldung bleibt offen. */
export async function ndBestaetigungZuruecknehmen(von: string, profileId: string) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  if (!DATUM_RE.test(von) || !UUID_RE.test(profileId)) return { error: 'Ungültige Angaben.' }
  const [d, a] = await Promise.all([dienst(n.admin, von), anmeldung(n.admin, von, profileId)])
  if (!d || !a) return { error: 'Anmeldung nicht gefunden.' }
  await ndTageEntfernen(n.admin, profileId, d.von, d.bis)
  const err = await anmeldungSchreiben(n.admin, von, profileId, a.rolle, 'offen', a.durchAdmin, n.name, a.am)
  if (err) return err
  revalidate()
  return { success: true as const }
}
