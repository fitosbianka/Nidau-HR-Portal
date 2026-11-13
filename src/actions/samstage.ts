'use server'

// Samstagsöffnungen: Admins und Ferien Editorinnen legen Samstage an, bearbeiten und
// löschen sie und tragen Personen ein; Zahnärztinnen, DH / PA und Assistenz
// melden sich selbst an oder ab. Ferien und ein Samstagseinsatz in derselben
// Woche schliessen sich nicht aus. Alle Prüfungen laufen serverseitig.

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { FERIEN_EDITORS } from '@/lib/leitende'
import {
  SAMSTAG_PREFIX, SAMSTAG_ANMELDUNG_PREFIX, SAMSTAG_LIKE, anmeldungKey, istSamstag, samstagRolle, istRolle, DATUM_RE, ROLLEN, BEDARF_STANDARD,
  parseSamstagRow, parseAnmeldungRow, samstagVoll, samstagVollText,
  type SamstagRolle, type SamstagBedarf,
} from '@/lib/samstage'

const UUID_RE = /^[0-9a-f-]{8,64}$/i
type Admin = Awaited<ReturnType<typeof createAdminClient>>

async function nutzer() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase.from('profiles').select('role, full_name, job_title').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string; job_title: string | null } | null
  const name = p?.full_name ?? ''
  return { admin: await createAdminClient(), userId: user.id, name, jobTitle: p?.job_title ?? null, verwaltet: p?.role === 'admin' || FERIEN_EDITORS.includes(name) }
}
const NUR_VERWALTUNG = { error: 'Das kann nur die Praxisleitung.' }
const revalidate = () => { for (const p of ['/admin/zeiterfassung/ferien/planung', '/employee/team/ferien', '/employee/ferien', '/admin/arbeitsplan', '/employee/arbeitsplan']) revalidatePath(p) }

/** Samstag im Arbeitsplan der Person eintragen (Anwesend), ohne einen
 *  bestehenden Eintrag zu überschreiben. */
async function samstagEintragSetzen(admin: Admin, profileId: string, datum: string) {
  const { data } = await admin.from('work_schedule').select('entry').eq('employee_id', profileId).eq('schedule_date', datum).maybeSingle()
  if (data) return
  await admin.from('work_schedule').upsert({ employee_id: profileId, schedule_date: datum, entry: '✓' }, { onConflict: 'employee_id,schedule_date' })
}
/** Den automatisch gesetzten Samstagseintrag wieder entfernen (nur Anwesend). */
async function samstagEintragEntfernen(admin: Admin, profileId: string, datum: string) {
  await admin.from('work_schedule').delete().eq('employee_id', profileId).eq('schedule_date', datum).eq('entry', '✓')
}
async function angemeldeteIds(admin: Admin, datum: string): Promise<string[]> {
  const { data } = await admin.from('zeiterfassung_comments').select('user_full_name')
    .like('user_full_name', `${SAMSTAG_ANMELDUNG_PREFIX.replace(/_/g, '\\_')}%`).eq('schedule_date', datum)
  return ((data ?? []) as Array<{ user_full_name: string }>).map(r => r.user_full_name.slice(SAMSTAG_ANMELDUNG_PREFIX.length))
}

/** Bedarf und Anmeldungen pro Rolle eines Samstags (mit Zeitpunkt, für die Prüfung beim Anmelden). */
async function samstagStand(admin: Admin, datum: string): Promise<{ bedarf: SamstagBedarf; anmeldungen: Array<{ profileId: string; rolle: SamstagRolle; am: string }> } | null> {
  const { data: rows } = await admin.from('zeiterfassung_comments').select('user_full_name, comment')
    .like('user_full_name', SAMSTAG_LIKE).eq('schedule_date', datum)
  const liste = (rows ?? []) as Array<{ user_full_name: string; comment: string }>
  const kopf = liste.find(r => r.user_full_name === SAMSTAG_PREFIX)
  if (!kopf) return null
  const ids = liste.filter(r => r.user_full_name.startsWith(SAMSTAG_ANMELDUNG_PREFIX)).map(r => r.user_full_name.slice(SAMSTAG_ANMELDUNG_PREFIX.length))
  const jobs = new Map<string, string | null>()
  if (ids.length > 0) {
    const { data: profs } = await admin.from('profiles').select('id, job_title').in('id', ids)
    for (const p of (profs ?? []) as Array<{ id: string; job_title: string | null }>) jobs.set(p.id, p.job_title)
  }
  const anmeldungen: Array<{ profileId: string; rolle: SamstagRolle; am: string }> = []
  for (const r of liste) {
    if (!r.user_full_name.startsWith(SAMSTAG_ANMELDUNG_PREFIX)) continue
    const id = r.user_full_name.slice(SAMSTAG_ANMELDUNG_PREFIX.length)
    const a = parseAnmeldungRow(r.comment, jobs.get(id))
    if (a) anmeldungen.push({ profileId: id, rolle: a.rolle, am: a.am })
  }
  return { bedarf: parseSamstagRow(kopf.comment).bedarf, anmeldungen }
}
const anzahlProRolle = (anmeldungen: Array<{ rolle: SamstagRolle }>): Record<SamstagRolle, number> => {
  const out: Record<SamstagRolle, number> = { zahnarzt: 0, dhpa: 0, assistenz: 0 }
  for (const a of anmeldungen) out[a.rolle]++
  return out
}

async function samstagExistiert(admin: Admin, datum: string): Promise<boolean> {
  const { data } = await admin.from('zeiterfassung_comments').select('user_full_name')
    .eq('user_full_name', SAMSTAG_PREFIX).eq('schedule_date', datum).maybeSingle()
  return !!data
}

function bedarfSauber(b: Partial<SamstagBedarf> | null | undefined): SamstagBedarf {
  const z = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(20, Math.round(v)) : null)
  const out = { ...BEDARF_STANDARD }
  for (const r of ROLLEN) out[r] = z(b?.[r])
  return out
}

/** Samstag anlegen (Admins und Ferien Editorinnen). */
export async function samstagAnlegen(datum: string, notiz: string, bedarf: Partial<SamstagBedarf> | null) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  if (!istSamstag(datum)) return { error: 'Bitte ein Datum wählen, das auf einen Samstag fällt.' }
  if (await samstagExistiert(n.admin, datum)) return { error: 'Dieser Samstag ist schon erfasst.' }
  const am = new Date().toISOString()
  const { error } = await n.admin.from('zeiterfassung_comments').upsert(
    { user_full_name: SAMSTAG_PREFIX, schedule_date: datum, comment: JSON.stringify({ notiz: (notiz ?? '').trim().slice(0, 300), bedarf: bedarfSauber(bedarf ?? BEDARF_STANDARD), erstelltVon: n.name, erstelltAm: am }), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  revalidate()
  return { success: true as const }
}

/** Samstag bearbeiten: Datum, Notiz, Bedarf. Bei Datumswechsel ziehen die Anmeldungen mit. */
export async function samstagBearbeiten(datum: string, neu: { datum: string; notiz: string; bedarf: Partial<SamstagBedarf> | null }) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  if (!DATUM_RE.test(datum) || !istSamstag(neu.datum)) return { error: 'Bitte ein Datum wählen, das auf einen Samstag fällt.' }
  if (!(await samstagExistiert(n.admin, datum))) return { error: 'Samstag nicht gefunden.' }
  if (neu.datum !== datum && (await samstagExistiert(n.admin, neu.datum))) return { error: 'Am neuen Datum ist schon ein Samstag erfasst.' }
  const am = new Date().toISOString()
  const comment = JSON.stringify({ notiz: (neu.notiz ?? '').trim().slice(0, 300), bedarf: bedarfSauber(neu.bedarf), geaendertVon: n.name, geaendertAm: am })
  if (neu.datum === datum) {
    const { error } = await n.admin.from('zeiterfassung_comments').update({ comment, updated_at: am }).eq('user_full_name', SAMSTAG_PREFIX).eq('schedule_date', datum)
    if (error) return { error: error.message }
  } else {
    const ids = await angemeldeteIds(n.admin, datum)
    const { error: e1 } = await n.admin.from('zeiterfassung_comments').update({ schedule_date: neu.datum, comment, updated_at: am }).eq('user_full_name', SAMSTAG_PREFIX).eq('schedule_date', datum)
    if (e1) return { error: e1.message }
    const { error: e2 } = await n.admin.from('zeiterfassung_comments').update({ schedule_date: neu.datum, updated_at: am })
      .like('user_full_name', `${SAMSTAG_ANMELDUNG_PREFIX.replace(/_/g, '\\_')}%`).eq('schedule_date', datum)
    if (e2) return { error: `Samstag verschoben, aber die Anmeldungen konnten nicht mitgezogen werden: ${e2.message}` }
    for (const id of ids) { await samstagEintragEntfernen(n.admin, id, datum); await samstagEintragSetzen(n.admin, id, neu.datum) }
  }
  revalidate()
  return { success: true as const }
}

/** Samstag samt Anmeldungen löschen (Admins und Ferien Editorinnen). */
export async function samstagLoeschen(datum: string) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  if (!DATUM_RE.test(datum)) return { error: 'Ungültiges Datum.' }
  for (const id of await angemeldeteIds(n.admin, datum)) await samstagEintragEntfernen(n.admin, id, datum)
  const { error: e1 } = await n.admin.from('zeiterfassung_comments').delete()
    .like('user_full_name', `${SAMSTAG_ANMELDUNG_PREFIX.replace(/_/g, '\\_')}%`).eq('schedule_date', datum)
  if (e1) return { error: e1.message }
  const { error } = await n.admin.from('zeiterfassung_comments').delete().eq('user_full_name', SAMSTAG_PREFIX).eq('schedule_date', datum)
  if (error) return { error: error.message }
  revalidate()
  return { success: true as const }
}

async function anmeldungSchreiben(admin: Admin, datum: string, profileId: string, rolle: SamstagRolle, durchAdmin: boolean, von: string) {
  const am = new Date().toISOString()
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: anmeldungKey(profileId), schedule_date: datum, comment: JSON.stringify({ rolle, am, durchAdmin, von }), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error ? { error: error.message } : null
}

/** Sich selbst für einen Samstag eintragen (Zahnarzt, DH / PA oder Assistenz). */
export async function samstagAnmelden(datum: string) {
  const n = await nutzer()
  if (!DATUM_RE.test(datum)) return { error: 'Ungültiges Datum.' }
  const rolle = samstagRolle(n.jobTitle)
  if (!rolle) return { error: 'Für diese Kategorie ist keine Samstagsanmeldung vorgesehen.' }
  const stand = await samstagStand(n.admin, datum)
  if (!stand) return { error: 'Samstag nicht gefunden.' }
  // Nur so viele, wie der Bedarf der Rolle vorgibt (an Samstagen zum
  // Beispiel eine Assistenz); wer schon drin ist, bleibt drin
  const schonDabei = stand.anmeldungen.some(a => a.profileId === n.userId)
  if (!schonDabei && samstagVoll(stand.bedarf, anzahlProRolle(stand.anmeldungen), rolle)) return { error: samstagVollText(rolle, stand.bedarf) }
  const err = await anmeldungSchreiben(n.admin, datum, n.userId, rolle, false, n.name)
  if (err) return err
  // Gegen gleichzeitige Klicks: nach dem Schreiben nochmals zählen, die
  // jüngste Anmeldung über dem Bedarf wird wieder gelöscht
  if (!schonDabei) {
    const nachher = await samstagStand(n.admin, datum)
    const gleicheRolle = (nachher?.anmeldungen ?? []).filter(a => a.rolle === rolle)
    const soll = stand.bedarf[rolle]
    if (soll != null && gleicheRolle.length > soll) {
      const juengste = [...gleicheRolle].sort((a, b) => b.am.localeCompare(a.am))[0]
      if (juengste?.profileId === n.userId) {
        await n.admin.from('zeiterfassung_comments').delete().eq('user_full_name', anmeldungKey(n.userId)).eq('schedule_date', datum)
        return { error: `${samstagVollText(rolle, stand.bedarf)} Jemand war schneller.` }
      }
    }
  }
  await samstagEintragSetzen(n.admin, n.userId, datum)
  revalidate()
  return { success: true as const }
}

/** Eigene Anmeldung zurückziehen. */
export async function samstagAbmelden(datum: string) {
  const n = await nutzer()
  if (!DATUM_RE.test(datum)) return { error: 'Ungültiges Datum.' }
  const { error } = await n.admin.from('zeiterfassung_comments').delete().eq('user_full_name', anmeldungKey(n.userId)).eq('schedule_date', datum)
  if (error) return { error: error.message }
  await samstagEintragEntfernen(n.admin, n.userId, datum)
  revalidate()
  return { success: true as const }
}

/** Person durch Admin oder Ferien Editorin eintragen (Rolle wählbar, Standard aus der Kategorie). */
export async function samstagPersonSetzen(datum: string, profileId: string, rolle: SamstagRolle | null) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  if (!DATUM_RE.test(datum) || !UUID_RE.test(profileId)) return { error: 'Ungültige Angaben.' }
  if (!(await samstagExistiert(n.admin, datum))) return { error: 'Samstag nicht gefunden.' }
  const { data: prof } = await n.admin.from('profiles').select('job_title, full_name').eq('id', profileId).maybeSingle()
  if (!prof) return { error: 'Person nicht gefunden.' }
  const r: SamstagRolle | null = istRolle(rolle) ? rolle : samstagRolle((prof as { job_title: string | null }).job_title)
  if (!r) return { error: 'Bitte wählen, ob die Person als Zahnarzt, DH / PA oder Assistenz eingetragen wird.' }
  const err = await anmeldungSchreiben(n.admin, datum, profileId, r, true, n.name)
  if (err) return err
  await samstagEintragSetzen(n.admin, profileId, datum)
  revalidate()
  return { success: true as const }
}

/** Anmeldung einer Person entfernen (Admins und Ferien Editorinnen). */
export async function samstagPersonEntfernen(datum: string, profileId: string) {
  const n = await nutzer()
  if (!n.verwaltet) return NUR_VERWALTUNG
  if (!DATUM_RE.test(datum) || !UUID_RE.test(profileId)) return { error: 'Ungültige Angaben.' }
  const { error } = await n.admin.from('zeiterfassung_comments').delete().eq('user_full_name', anmeldungKey(profileId)).eq('schedule_date', datum)
  if (error) return { error: error.message }
  await samstagEintragEntfernen(n.admin, profileId, datum)
  revalidate()
  return { success: true as const }
}
