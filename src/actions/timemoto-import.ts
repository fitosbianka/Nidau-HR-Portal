'use server'

// TimeMoto Monatsexport importieren (Admin): Datei prüfen (Vorschau mit
// Zuordnung der Namen) und importieren. Die Ereignisse landen in
// attendance_events wie die Stempel des Webhooks; bestehende IDs werden
// nie überschrieben (Zeit-Sperre). Jeder Import steht im Protokoll
// (__timemoto_import__<id> @ Importdatum).

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { PRAXIS } from '@/config/praxis'
import { ladeAlleSeiten } from '@/lib/seiten'
import { isZeiterfassungPerson } from '@/lib/attendance-exclude'
import { ohneGaeste } from '@/lib/gaeste'
import { zurichHeute, zurichTagesFenster } from '@/lib/zeitzone'
import {
  decodeBytes, parseCsv, parseTabelle, namenStand, baueEvents, normName, istXlsx,
  type ImportZeile, type ParseErgebnis, type ProfilKurz, type ImportEvent,
} from '@/lib/timemoto-import'
import { tabelleAusXlsx } from '@/lib/xlsx-lesen'

const TIMEMOTO_NAME_PREFIX = '__timemoto_name__'
const TIMEMOTO_NAME_ANCHOR = '2000-01-01'
const TIMEMOTO_IMPORT_PREFIX = '__timemoto_import__'
const MAX_BYTES = 20 * 1024 * 1024

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (p?.role !== 'admin') throw new Error('Keine Berechtigung')
  return { admin: await createAdminClient(), name: p.full_name ?? 'Admin' }
}

type Admin = Awaited<ReturnType<typeof createAdminClient>>

async function ladeProfile(admin: Admin): Promise<Array<ProfilKurz & { job_title: string | null; timemoto_user_id: string | null }>> {
  const { data } = await admin.from('profiles').select('id, full_name, job_title, is_active, timemoto_user_id').eq('is_active', true).order('full_name')
  return ohneGaeste((data ?? []) as Array<{ id: string; full_name: string; job_title: string | null; is_active: boolean; timemoto_user_id: string | null }>)
}

async function ladeZuordnungen(admin: Admin): Promise<Record<string, string>> {
  const rows = await ladeAlleSeiten<{ user_full_name: string; comment: string }>((von, bis) => admin
    .from('zeiterfassung_comments').select('user_full_name, comment')
    .like('user_full_name', `${TIMEMOTO_NAME_PREFIX.replace(/_/g, '\\_')}%`)
    .order('user_full_name').range(von, bis))
  const out: Record<string, string> = {}
  for (const r of rows) {
    try { const j = JSON.parse(r.comment) as { profileId?: string }; if (j.profileId) out[r.user_full_name.slice(TIMEMOTO_NAME_PREFIX.length)] = j.profileId } catch { /* überspringen */ }
  }
  return out
}

async function leseDatei(formData: FormData): Promise<{ datei: string; ergebnis: ParseErgebnis } | { error: string }> {
  const file = formData.get('datei')
  if (!(file instanceof File) || file.size === 0) return { error: 'Bitte eine Exportdatei wählen (CSV, TXT oder XLSX).' }
  if (file.size > MAX_BYTES) return { error: 'Die Datei ist grösser als 20 MB. Bitte den Export auf einen Monat beschränken.' }
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    const rows = istXlsx(bytes, file.name) ? await tabelleAusXlsx(bytes) : parseCsv(decodeBytes(bytes))
    return { datei: file.name, ergebnis: parseTabelle(rows) }
  } catch (e) {
    return { error: `Die Datei konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export type VorschauPerson = {
  name: string
  anzahl: number
  von: string
  bis: string
  profileId: string | null
  profilName: string | null
  /** Die Person gehört zur Zeiterfassung (Funktion stempelt) */
  stempelt: boolean
  /** Ereignisse dieser Datei, die schon gespeichert sind */
  bereits: number
}

export type Vorschau = {
  datei: string
  format: ParseErgebnis['format']
  zeilen: number
  uebersprungen: number
  fehler: string[]
  personen: VorschauPerson[]
  profile: ProfilKurz[]
  von: string | null
  bis: string | null
}

/** Datei lesen und zeigen, wer wie oft vorkommt und wem die Namen zugeordnet sind. */
export async function timemotoVorschau(formData: FormData): Promise<{ vorschau?: Vorschau; error?: string }> {
  let admin: Admin
  try { ({ admin } = await requireAdmin()) } catch { return { error: 'Keine Berechtigung.' } }
  const gelesen = await leseDatei(formData)
  if ('error' in gelesen) return { error: gelesen.error }
  const { datei, ergebnis } = gelesen
  if (ergebnis.fehler.length > 0 && ergebnis.zeilen.length === 0) return { error: ergebnis.fehler.join(' ') }

  const [profile, zuordnungen] = await Promise.all([ladeProfile(admin), ladeZuordnungen(admin)])
  const stand = namenStand(ergebnis.zeilen, profile, zuordnungen)
  const personen: VorschauPerson[] = []
  for (const s of stand) {
    let bereits = 0
    if (s.profil) {
      const ids = baueEvents(ergebnis.zeilen.filter(z => normName(z.name) === normName(s.name)), s.profil, datei, PRAXIS.name).map(e => e.timemoto_event_id)
      for (let i = 0; i < ids.length; i += 400) {
        const { count } = await admin.from('attendance_events').select('timemoto_event_id', { count: 'exact', head: true }).in('timemoto_event_id', ids.slice(i, i + 400))
        bereits += count ?? 0
      }
    }
    const p = s.profil ? profile.find(x => x.id === s.profil!.id) : undefined
    personen.push({
      name: s.name, anzahl: s.anzahl, von: s.von, bis: s.bis,
      profileId: s.profil?.id ?? null, profilName: s.profil?.full_name ?? null,
      stempelt: p ? isZeiterfassungPerson({ full_name: p.full_name, job_title: p.job_title }) : false,
      bereits,
    })
  }
  const daten = ergebnis.zeilen.map(z => z.datum).sort()
  return {
    vorschau: {
      datei, format: ergebnis.format, zeilen: ergebnis.zeilen.length, uebersprungen: ergebnis.uebersprungen, fehler: ergebnis.fehler,
      personen, profile: profile.map(p => ({ id: p.id, full_name: p.full_name })),
      von: daten[0] ?? null, bis: daten[daten.length - 1] ?? null,
    },
  }
}

export type ImportErgebnis = {
  datei: string
  neu: number
  bereits: number
  ersetzt: number
  personen: Array<{ name: string; neu: number; bereits: number }>
  nichtZugeordnet: string[]
  von: string | null
  bis: string | null
}

/** Datei importieren. zuordnungJson: { [Dateiname]: profileId } für Namen,
 *  die der Admin in der Vorschau von Hand zugeordnet hat (wird gespeichert).
 *  ersetzen: frühere Importzeilen derselben Personen im Zeitraum der Datei,
 *  die in der Datei nicht mehr vorkommen, in den Papierkorb legen (für
 *  einen korrigierten Export desselben Monats). */
export async function timemotoImportieren(formData: FormData, zuordnungJson: string, ersetzen: boolean): Promise<{ ergebnis?: ImportErgebnis; error?: string }> {
  let admin: Admin, adminName: string
  try { ({ admin, name: adminName } = await requireAdmin()) } catch { return { error: 'Keine Berechtigung.' } }
  const gelesen = await leseDatei(formData)
  if ('error' in gelesen) return { error: gelesen.error }
  const { datei, ergebnis } = gelesen
  if (ergebnis.zeilen.length === 0) return { error: ergebnis.fehler.join(' ') || 'Keine Stempelungen in der Datei.' }

  let manuell: Record<string, string> = {}
  try { const j = JSON.parse(zuordnungJson || '{}') as Record<string, unknown>; for (const [k, v] of Object.entries(j)) if (typeof v === 'string' && v) manuell[normName(k)] = v } catch { manuell = {} }

  const [profile, gespeichert] = await Promise.all([ladeProfile(admin), ladeZuordnungen(admin)])
  const zuordnungen = { ...gespeichert, ...manuell }
  // Neue Zuordnungen merken, damit der nächste Import sie kennt
  const am = new Date().toISOString()
  for (const [k, id] of Object.entries(manuell)) {
    if (gespeichert[k] === id) continue
    if (!profile.some(p => p.id === id)) continue
    await admin.from('zeiterfassung_comments').upsert(
      { user_full_name: `${TIMEMOTO_NAME_PREFIX}${k}`, schedule_date: TIMEMOTO_NAME_ANCHOR, comment: JSON.stringify({ profileId: id, von: adminName, am }), updated_at: am },
      { onConflict: 'user_full_name,schedule_date' },
    )
  }

  const stand = namenStand(ergebnis.zeilen, profile, zuordnungen)
  const personen: ImportErgebnis['personen'] = []
  const nichtZugeordnet: string[] = []
  let neu = 0, bereits = 0, ersetzt = 0
  const daten = ergebnis.zeilen.map(z => z.datum).sort()
  const von = daten[0] ?? null, bis = daten[daten.length - 1] ?? null

  for (const s of stand) {
    if (!s.profil) { nichtZugeordnet.push(s.name); continue }
    const zeilen: ImportZeile[] = ergebnis.zeilen.filter(z => normName(z.name) === normName(s.name))
    const events: ImportEvent[] = baueEvents(zeilen, s.profil, datei, PRAXIS.name)
    const ids = events.map(e => e.timemoto_event_id)
    // Was ist schon da (Zeit-Sperre: bestehende Zeilen bleiben unverändert)
    const vorhanden = new Set<string>()
    for (let i = 0; i < ids.length; i += 400) {
      const { data } = await admin.from('attendance_events').select('timemoto_event_id').in('timemoto_event_id', ids.slice(i, i + 400))
      for (const r of (data ?? []) as Array<{ timemoto_event_id: string }>) vorhanden.add(r.timemoto_event_id)
    }
    const neue = events.filter(e => !vorhanden.has(e.timemoto_event_id))
    for (let i = 0; i < neue.length; i += 400) {
      const { error } = await admin.from('attendance_events').upsert(neue.slice(i, i + 400), { onConflict: 'timemoto_event_id', ignoreDuplicates: true })
      if (error) return { error: `Import abgebrochen bei ${s.profil.full_name}: ${error.message}` }
    }
    // Benutzer ID von TimeMoto merken, dann passt später auch der Webhook
    const userId = zeilen.find(z => z.userId)?.userId ?? null
    const prof = profile.find(p => p.id === s.profil!.id)
    if (userId && prof && !prof.timemoto_user_id) await admin.from('profiles').update({ timemoto_user_id: userId }).eq('id', prof.id)

    let weg = 0
    if (ersetzen && von && bis) {
      // Frühere Importzeilen dieser Person im Zeitraum, die in der Datei fehlen: Papierkorb
      const { start } = zurichTagesFenster(von), { ende } = zurichTagesFenster(bis)
      const alte = await ladeAlleSeiten<{ timemoto_event_id: string }>((a, b) => admin
        .from('attendance_events').select('timemoto_event_id')
        .eq('employee_id', s.profil!.id).is('deleted_at', null)
        .like('timemoto_event_id', 'import\\_%')
        .gte('time_logged', start).lt('time_logged', ende)
        .order('timemoto_event_id').range(a, b))
      const loeschen = alte.map(r => r.timemoto_event_id).filter(id => !ids.includes(id))
      for (let i = 0; i < loeschen.length; i += 400) {
        const { error } = await admin.from('attendance_events').update({ deleted_at: am }).in('timemoto_event_id', loeschen.slice(i, i + 400))
        if (error) return { error: `Ersetzen abgebrochen bei ${s.profil.full_name}: ${error.message}` }
      }
      weg = loeschen.length
    }
    neu += neue.length; bereits += events.length - neue.length; ersetzt += weg
    personen.push({ name: s.profil.full_name, neu: neue.length, bereits: events.length - neue.length })
  }

  // Protokoll
  const id = Math.random().toString(36).slice(2, 10)
  await admin.from('zeiterfassung_comments').insert({
    user_full_name: `${TIMEMOTO_IMPORT_PREFIX}${id}`,
    schedule_date: zurichHeute(),
    comment: JSON.stringify({ datei, am, von: adminName, zeitraum: { von, bis }, neu, bereits, ersetzt, personen, nichtZugeordnet, format: ergebnis.format, uebersprungen: ergebnis.uebersprungen }),
  })

  for (const pfad of ['/admin/zeiterfassung/berichte', '/admin/zeiterfassung/konto', '/admin/zeiterfassung/import', '/employee/zeiterfassung', '/employee']) revalidatePath(pfad)
  return { ergebnis: { datei, neu, bereits, ersetzt, personen, nichtZugeordnet, von, bis } }
}

export type ImportProtokoll = {
  id: string
  datum: string
  datei: string
  am: string
  von: string
  zeitraum: { von: string | null; bis: string | null }
  neu: number
  bereits: number
  ersetzt: number
  personen: Array<{ name: string; neu: number; bereits: number }>
  nichtZugeordnet: string[]
}

/** Bisherige Importe, neueste zuerst. */
export async function timemotoProtokoll(): Promise<ImportProtokoll[]> {
  let admin: Admin
  try { ({ admin } = await requireAdmin()) } catch { return [] }
  const rows = await ladeAlleSeiten<{ user_full_name: string; schedule_date: string; comment: string }>((von, bis) => admin
    .from('zeiterfassung_comments').select('user_full_name, schedule_date, comment')
    .like('user_full_name', `${TIMEMOTO_IMPORT_PREFIX.replace(/_/g, '\\_')}%`)
    .order('schedule_date', { ascending: false }).order('user_full_name').range(von, bis))
  const out: ImportProtokoll[] = []
  for (const r of rows) {
    try {
      const j = JSON.parse(r.comment) as Partial<ImportProtokoll>
      out.push({
        id: r.user_full_name.slice(TIMEMOTO_IMPORT_PREFIX.length), datum: r.schedule_date.slice(0, 10),
        datei: j.datei ?? '?', am: j.am ?? '', von: j.von ?? '', zeitraum: j.zeitraum ?? { von: null, bis: null },
        neu: j.neu ?? 0, bereits: j.bereits ?? 0, ersetzt: j.ersetzt ?? 0, personen: j.personen ?? [], nichtZugeordnet: j.nichtZugeordnet ?? [],
      })
    } catch { /* überspringen */ }
  }
  return out.sort((a, b) => b.am.localeCompare(a.am))
}
