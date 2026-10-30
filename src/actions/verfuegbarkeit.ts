'use server'

// Verfügbarkeit speichern: die Person selbst (nur wer in
// VERFUEGBARKEIT_PERSONEN steht) oder ein Admin für sie. Einsatzanfragen:
// Admins tragen Tage und Positionen ein, die Person sagt zu oder ab (und
// darf ihre Antwort jederzeit ändern); Admins dürfen die Antwort ebenfalls
// setzen, falls sie telefonisch kommt.

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  istVerfuegbarkeitPerson, verfuegbarKey, bedarfKey, antwortKey, monatAnker, tageImMonat, parseAnfragen, parseVerfuegbarkeit, parseEntscheidungen,
  positionGueltig, ergaenzeAusPlan, tagesStand, offeneTage,
  type EinsatzAnfrage, type AnfrageStatus, type Entscheidung, type Entscheidungen,
} from '@/lib/verfuegbarkeit'
import { ladePlanEintraege } from '@/lib/verfuegbarkeit-data'

const UUID_RE = /^[0-9a-f-]{8,64}$/i
const ID_RE = /^[a-z0-9]{6,32}$/i
type Admin = Awaited<ReturnType<typeof createAdminClient>>

/** Wer darf an der Liste dieser Person arbeiten: sie selbst oder ein Admin. */
async function zugang(profileId: string, year: number, month: number): Promise<{ admin: Admin; name: string; istAdmin: boolean; eigene: boolean } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Nicht angemeldet.' }
  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (!UUID_RE.test(profileId) || !Number.isInteger(year) || !Number.isInteger(month) || year < 2020 || year > 2099 || month < 1 || month > 12) return { error: 'Ungültige Angaben.' }
  const admin = await createAdminClient()
  const eigene = user.id === profileId
  const istAdmin = p?.role === 'admin'
  if (eigene) {
    if (!istVerfuegbarkeitPerson(p?.full_name)) return { error: 'Für dich ist keine Verfügbarkeitsliste vorgesehen.' }
  } else if (!istAdmin) {
    return { error: 'Keine Berechtigung.' }
  } else {
    const { data: ziel } = await admin.from('profiles').select('full_name').eq('id', profileId).maybeSingle()
    if (!istVerfuegbarkeitPerson((ziel as { full_name: string } | null)?.full_name)) return { error: 'Für diese Person ist keine Verfügbarkeitsliste vorgesehen.' }
  }
  return { admin, name: p?.full_name ?? '', istAdmin, eigene }
}

const revalidate = () => { revalidatePath('/admin/arbeitsplan'); revalidatePath('/employee/arbeitsplan') }

export async function verfuegbarkeitSpeichern(profileId: string, year: number, month: number, tage: string[], notiz: string) {
  const z = await zugang(profileId, year, month)
  if ('error' in z) return { error: z.error }
  const gueltig = new Set(tageImMonat(year, month))
  const sauber = Array.from(new Set((Array.isArray(tage) ? tage : []).filter(t => typeof t === 'string' && gueltig.has(t)))).sort()
  const am = new Date().toISOString()
  const { error } = await z.admin.from('zeiterfassung_comments').upsert(
    {
      user_full_name: verfuegbarKey(profileId), schedule_date: monatAnker(year, month),
      comment: JSON.stringify({ tage: sauber, notiz: (notiz ?? '').replace(/\s+/g, ' ').trim().slice(0, 500), aktualisiertAm: am, von: z.name }),
      updated_at: am,
    },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  revalidate()
  return { success: true as const, tage: sauber }
}

// ── Einsatzanfragen ──────────────────────────────────────────────────────
// Eigene Zeile pro Person und Monat; jede Aktion liest die Zeile frisch,
// ändert nur ihren Eintrag und schreibt zurück, damit sich Admin und Person
// nicht gegenseitig überschreiben.

async function ladeAnfragenRoh(admin: Admin, profileId: string, year: number, month: number): Promise<EinsatzAnfrage[]> {
  const { data } = await admin.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', bedarfKey(profileId)).eq('schedule_date', monatAnker(year, month)).maybeSingle()
  return parseAnfragen((data as { comment: string } | null)?.comment, year, month)
}

async function speichereAnfragen(admin: Admin, profileId: string, year: number, month: number, anfragen: EinsatzAnfrage[]): Promise<string | null> {
  const am = new Date().toISOString()
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: bedarfKey(profileId), schedule_date: monatAnker(year, month), comment: JSON.stringify({ anfragen }), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error?.message ?? null
}

const neueId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** Admin: Tag und Position anfragen. */
export async function einsatzAnfrageHinzufuegen(profileId: string, year: number, month: number, e: { datum: string; position: string; zeit: string }) {
  const z = await zugang(profileId, year, month)
  if ('error' in z) return { error: z.error }
  if (!z.istAdmin) return { error: 'Nur Admins können Einsätze anfragen.' }
  const datum = typeof e?.datum === 'string' ? e.datum : ''
  if (!tageImMonat(year, month).includes(datum)) return { error: 'Bitte einen Tag in diesem Monat wählen.' }
  const position = (e?.position ?? '').trim()
  if (!positionGueltig(position)) return { error: 'Bitte eine gültige Position wählen (z.B. 3f, 6, 7 oder ✓).' }
  const zeit = (e?.zeit ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const liste = await ladeAnfragenRoh(z.admin, profileId, year, month)
  if (liste.some(a => a.datum === datum && a.position === position)) return { error: 'Für diesen Tag ist diese Position bereits angefragt.' }
  const am = new Date().toISOString()
  liste.push({ id: neueId(), datum, position, zeit, status: 'offen', bemerkung: '', entschiedenAm: null, entschiedenVon: null, erstelltAm: am, erstelltVon: z.name })
  liste.sort((a, b) => a.datum.localeCompare(b.datum) || a.erstelltAm.localeCompare(b.erstelltAm))
  const err = await speichereAnfragen(z.admin, profileId, year, month, liste)
  if (err) return { error: err }
  revalidate()
  return { success: true as const, anfragen: liste }
}

/** Admin: Anfrage zurückziehen. */
export async function einsatzAnfrageEntfernen(profileId: string, year: number, month: number, id: string) {
  const z = await zugang(profileId, year, month)
  if ('error' in z) return { error: z.error }
  if (!z.istAdmin) return { error: 'Nur Admins können Anfragen entfernen.' }
  if (!ID_RE.test(id)) return { error: 'Ungültige Anfrage.' }
  const liste = await ladeAnfragenRoh(z.admin, profileId, year, month)
  const neu = liste.filter(a => a.id !== id)
  if (neu.length === liste.length) return { success: true as const, anfragen: liste }
  const err = await speichereAnfragen(z.admin, profileId, year, month, neu)
  if (err) return { error: err }
  revalidate()
  return { success: true as const, anfragen: neu }
}

/** Zusagen, absagen oder wieder offen lassen — die Person selbst, oder ein
 *  Admin (telefonische Antwort); wer entschieden hat, wird gespeichert.
 *  bemerkung: optionaler Text zur Antwort (undefined = unverändert lassen). */
export async function einsatzAnfrageEntscheiden(profileId: string, year: number, month: number, id: string, status: AnfrageStatus, bemerkung?: string) {
  const z = await zugang(profileId, year, month)
  if ('error' in z) return { error: z.error }
  if (!ID_RE.test(id)) return { error: 'Ungültige Anfrage.' }
  if (status !== 'zugesagt' && status !== 'abgesagt' && status !== 'offen') return { error: 'Ungültige Antwort.' }
  const liste = await ladeAnfragenRoh(z.admin, profileId, year, month)
  const a = liste.find(x => x.id === id)
  if (!a) return { error: 'Diese Anfrage gibt es nicht mehr — bitte die Seite neu laden.' }
  if (a.status !== status) {
    a.status = status
    a.entschiedenAm = status === 'offen' ? null : new Date().toISOString()
    a.entschiedenVon = status === 'offen' ? null : z.name
  }
  if (typeof bemerkung === 'string') a.bemerkung = bemerkung.replace(/\s+/g, ' ').trim().slice(0, 300)
  const err = await speichereAnfragen(z.admin, profileId, year, month, liste)
  if (err) return { error: err }
  revalidate()
  return { success: true as const, anfragen: liste }
}

/** Admin: Tag, Position und Zeit einer Anfrage ändern. Mit
 *  antwortZuruecksetzen wird eine bestehende Zu- oder Absage auf «offen»
 *  gestellt, damit die Person den geänderten Einsatz neu beantwortet; die
 *  Bemerkung der Person bleibt erhalten. */
export async function einsatzAnfrageAendern(profileId: string, year: number, month: number, id: string, e: { datum: string; position: string; zeit: string; antwortZuruecksetzen: boolean }) {
  const z = await zugang(profileId, year, month)
  if ('error' in z) return { error: z.error }
  if (!z.istAdmin) return { error: 'Nur Admins können Anfragen ändern.' }
  if (!ID_RE.test(id)) return { error: 'Ungültige Anfrage.' }
  const datum = typeof e?.datum === 'string' ? e.datum : ''
  if (!tageImMonat(year, month).includes(datum)) return { error: 'Bitte einen Tag in diesem Monat wählen.' }
  const position = (e?.position ?? '').trim()
  if (!positionGueltig(position)) return { error: 'Bitte eine gültige Position wählen (z.B. 3f, 6, 7 oder ✓).' }
  const zeit = (e?.zeit ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const liste = await ladeAnfragenRoh(z.admin, profileId, year, month)
  const a = liste.find(x => x.id === id)
  if (!a) return { error: 'Diese Anfrage gibt es nicht mehr — bitte die Seite neu laden.' }
  if (liste.some(x => x.id !== id && x.datum === datum && x.position === position)) return { error: 'Für diesen Tag ist diese Position bereits angefragt.' }
  const geaendert = a.datum !== datum || a.position !== position || a.zeit !== zeit
  a.datum = datum; a.position = position; a.zeit = zeit
  if (geaendert && e.antwortZuruecksetzen && a.status !== 'offen') {
    a.status = 'offen'; a.entschiedenAm = null; a.entschiedenVon = null
  }
  liste.sort((x, y) => x.datum.localeCompare(y.datum) || x.erstelltAm.localeCompare(y.erstelltAm))
  const err = await speichereAnfragen(z.admin, profileId, year, month, liste)
  if (err) return { error: err }
  revalidate()
  return { success: true as const, anfragen: liste }
}

/** Admin: die Einträge der Person aus dem Arbeitsplan dieses Monats als
 *  Anfragen übernehmen. Tage, die schon eine Anfrage haben, bleiben
 *  unverändert; Abwesenheitscodes und Home Office werden übersprungen. */
export async function einsatzAnfragenAusPlan(profileId: string, year: number, month: number) {
  const z = await zugang(profileId, year, month)
  if ('error' in z) return { error: z.error }
  if (!z.istAdmin) return { error: 'Nur Admins können Einsätze anfragen.' }
  const tage = tageImMonat(year, month)
  const [{ data: rows }, liste] = await Promise.all([
    z.admin.from('work_schedule').select('schedule_date, entry').eq('employee_id', profileId)
      .gte('schedule_date', tage[0]).lte('schedule_date', tage[tage.length - 1]),
    ladeAnfragenRoh(z.admin, profileId, year, month),
  ])
  const eintraege = ((rows ?? []) as Array<{ schedule_date: string; entry: string }>).map(r => ({ datum: r.schedule_date, position: r.entry ?? '' }))
  const { liste: neu, neu: anzahl } = ergaenzeAusPlan(liste, eintraege, year, month, neueId, new Date().toISOString(), z.name)
  if (anzahl === 0) return { success: true as const, anfragen: liste, neu: 0 }
  const err = await speichereAnfragen(z.admin, profileId, year, month, neu)
  if (err) return { error: err }
  revalidate()
  return { success: true as const, anfragen: neu, neu: anzahl }
}

// ── Rückmeldung pro Tag (Admins) ─────────────────────────────────────────
// Eigene Zeile pro Person und Monat. Angebotene Tage annehmen oder ablehnen;
// die Person sieht den Stand sofort unter ihrem Arbeitsplan. Tage, an denen
// sie im Arbeitsplan steht, gelten ohnehin als eingeplant.

async function ladeEntscheidungenRoh(admin: Admin, profileId: string, year: number, month: number): Promise<Entscheidungen> {
  const { data } = await admin.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', antwortKey(profileId)).eq('schedule_date', monatAnker(year, month)).maybeSingle()
  return parseEntscheidungen((data as { comment: string } | null)?.comment, year, month)
}

async function speichereEntscheidungen(admin: Admin, profileId: string, year: number, month: number, entscheidungen: Entscheidungen): Promise<string | null> {
  const am = new Date().toISOString()
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: antwortKey(profileId), schedule_date: monatAnker(year, month), comment: JSON.stringify({ entscheidungen }), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error?.message ?? null
}

/** Admin: einen angebotenen Tag annehmen, ablehnen oder die Entscheidung zurücknehmen (offen). */
export async function verfuegbarkeitEntscheiden(profileId: string, year: number, month: number, datum: string, status: Entscheidung | 'offen') {
  const z = await zugang(profileId, year, month)
  if ('error' in z) return { error: z.error }
  if (!z.istAdmin) return { error: 'Nur Admins können Tage annehmen oder ablehnen.' }
  if (typeof datum !== 'string' || !tageImMonat(year, month).includes(datum)) return { error: 'Bitte einen Tag in diesem Monat wählen.' }
  if (status !== 'angenommen' && status !== 'abgelehnt' && status !== 'offen') return { error: 'Ungültige Antwort.' }
  const entscheidungen = await ladeEntscheidungenRoh(z.admin, profileId, year, month)
  if (status === 'offen') delete entscheidungen[datum]
  else entscheidungen[datum] = { status, am: new Date().toISOString(), von: z.name }
  const err = await speichereEntscheidungen(z.admin, profileId, year, month, entscheidungen)
  if (err) return { error: err }
  revalidate()
  return { success: true as const, entscheidungen }
}

/** Admin: alle angebotenen Tage ablehnen, über die noch niemand entschieden
 *  hat (nicht im Plan, nicht angefragt, nicht beantwortet). Die übrigen
 *  Tage bleiben unverändert. */
export async function verfuegbarkeitOffeneAblehnen(profileId: string, year: number, month: number) {
  const z = await zugang(profileId, year, month)
  if ('error' in z) return { error: z.error }
  if (!z.istAdmin) return { error: 'Nur Admins können Tage ablehnen.' }
  const [{ data: vRow }, planEintraege, anfragen, entscheidungen] = await Promise.all([
    z.admin.from('zeiterfassung_comments').select('comment').eq('user_full_name', verfuegbarKey(profileId)).eq('schedule_date', monatAnker(year, month)).maybeSingle(),
    ladePlanEintraege(z.admin, profileId, year, month),
    ladeAnfragenRoh(z.admin, profileId, year, month),
    ladeEntscheidungenRoh(z.admin, profileId, year, month),
  ])
  const verfuegbar = parseVerfuegbarkeit((vRow as { comment: string } | null)?.comment, year, month).tage
  const offen = offeneTage(tagesStand({ verfuegbar, planEintraege, planSichtbar: true, anfragen, entscheidungen, year, month }))
  if (offen.length === 0) return { success: true as const, entscheidungen, anzahl: 0 }
  const am = new Date().toISOString()
  for (const d of offen) entscheidungen[d] = { status: 'abgelehnt', am, von: z.name }
  const err = await speichereEntscheidungen(z.admin, profileId, year, month, entscheidungen)
  if (err) return { error: err }
  revalidate()
  return { success: true as const, entscheidungen, anzahl: offen.length }
}
