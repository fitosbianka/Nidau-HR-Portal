'use server'

// Aufgaben Zeiterfassung (Meine Stempeluhr): Kategorien und Aufgaben
// speichern, Zeiteinträge erfassen, ändern, löschen. Jede Aktion prüft,
// dass die angemeldete Person Bianka ist (darfAufgabenZeit), kein anderer
// Admin kommt an diese Daten.

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import {
  AUFGABEN_KONFIG_KEY, AUFGABEN_KONFIG_ANCHOR, AUFGABEN_ZEIT_KEY, DATUM_RE, MINUTEN_MAX, NOTIZ_MAX,
  darfAufgabenZeit, konfigBereinigen, parseKonfig, parseTag, tagZuJson, aufgabenIndex, istId, neueId, type ZeitEintrag,
} from '@/lib/aufgaben-zeit'

const PFAD = '/admin/stempeluhr'

async function zugang(): Promise<{ admin: SupabaseClient } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Nicht angemeldet.' }
  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (!darfAufgabenZeit(p?.role, p?.full_name)) return { error: 'Keine Berechtigung.' }
  return { admin: await createAdminClient() }
}

async function tagLaden(admin: SupabaseClient, datum: string): Promise<ZeitEintrag[]> {
  const { data } = await admin.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', AUFGABEN_ZEIT_KEY).eq('schedule_date', datum).maybeSingle()
  return parseTag(datum, (data as { comment: string } | null)?.comment)
}

async function tagSpeichern(admin: SupabaseClient, datum: string, eintraege: ZeitEintrag[]): Promise<string | null> {
  if (eintraege.length === 0) {
    const { error } = await admin.from('zeiterfassung_comments').delete().eq('user_full_name', AUFGABEN_ZEIT_KEY).eq('schedule_date', datum)
    return error ? error.message : null
  }
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: AUFGABEN_ZEIT_KEY, schedule_date: datum, comment: tagZuJson(eintraege), updated_at: new Date().toISOString() },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error ? error.message : null
}

async function konfigLaden(admin: SupabaseClient) {
  const { data } = await admin.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', AUFGABEN_KONFIG_KEY).eq('schedule_date', AUFGABEN_KONFIG_ANCHOR).maybeSingle()
  return parseKonfig((data as { comment: string } | null)?.comment)
}

type EintragEingabe = { datum: string; aufgabeId: string; minuten: number; notiz?: string | null }

function eingabePruefen(e: EintragEingabe): { error: string } | { datum: string; aufgabeId: string; minuten: number; notiz: string | null } {
  if (!e || typeof e.datum !== 'string' || !DATUM_RE.test(e.datum) || Number.isNaN(new Date(`${e.datum}T00:00:00Z`).getTime())) return { error: 'Bitte ein gültiges Datum wählen.' }
  if (!istId(e.aufgabeId)) return { error: 'Bitte eine Aufgabe wählen.' }
  const minuten = Math.round(Number(e.minuten))
  if (!Number.isFinite(minuten) || minuten <= 0) return { error: 'Bitte die Dauer eingeben (mindestens 1 Minute).' }
  if (minuten > MINUTEN_MAX) return { error: 'Die Dauer kann nicht länger als 24 Stunden sein.' }
  const notiz = typeof e.notiz === 'string' ? e.notiz.replace(/\s+/g, ' ').trim().slice(0, NOTIZ_MAX) : ''
  return { datum: e.datum, aufgabeId: e.aufgabeId, minuten, notiz: notiz || null }
}

/** Kategorien und Aufgaben als Ganzes speichern (die Verwaltung schickt immer den ganzen Stand) */
export async function aufgabenKonfigSpeichern(konfig: unknown) {
  const z = await zugang()
  if ('error' in z) return { error: z.error }
  const sauber = konfigBereinigen(konfig)
  if (!sauber) return { error: 'Die Kategorien konnten nicht gelesen werden.' }
  const { error } = await z.admin.from('zeiterfassung_comments').upsert(
    { user_full_name: AUFGABEN_KONFIG_KEY, schedule_date: AUFGABEN_KONFIG_ANCHOR, comment: JSON.stringify(sauber), updated_at: new Date().toISOString() },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  revalidatePath(PFAD)
  return { success: true as const, konfig: sauber }
}

/** Neuen Zeiteintrag erfassen */
export async function aufgabenZeitErfassen(eingabe: EintragEingabe) {
  const z = await zugang()
  if ('error' in z) return { error: z.error }
  const p = eingabePruefen(eingabe)
  if ('error' in p) return { error: p.error }
  const index = aufgabenIndex(await konfigLaden(z.admin))
  if (!index.has(p.aufgabeId)) return { error: 'Diese Aufgabe gibt es nicht mehr. Bitte die Seite neu laden.' }
  const tag = await tagLaden(z.admin, p.datum)
  const eintrag: ZeitEintrag = { id: neueId(), datum: p.datum, aufgabeId: p.aufgabeId, minuten: p.minuten, notiz: p.notiz, erfasst: new Date().toISOString() }
  const err = await tagSpeichern(z.admin, p.datum, [...tag, eintrag])
  if (err) return { error: err }
  revalidatePath(PFAD)
  return { success: true as const, eintrag }
}

/** Bestehenden Eintrag ändern (auch auf einen anderen Tag verschieben) */
export async function aufgabenZeitAendern(alt: { datum: string; id: string }, eingabe: EintragEingabe) {
  const z = await zugang()
  if ('error' in z) return { error: z.error }
  if (!alt || typeof alt.datum !== 'string' || !DATUM_RE.test(alt.datum) || !istId(alt.id)) return { error: 'Eintrag nicht gefunden.' }
  const p = eingabePruefen(eingabe)
  if ('error' in p) return { error: p.error }
  const index = aufgabenIndex(await konfigLaden(z.admin))
  if (!index.has(p.aufgabeId)) return { error: 'Diese Aufgabe gibt es nicht mehr. Bitte die Seite neu laden.' }
  const altTag = await tagLaden(z.admin, alt.datum)
  const bisher = altTag.find(e => e.id === alt.id)
  if (!bisher) return { error: 'Eintrag nicht gefunden, vielleicht wurde er schon gelöscht.' }
  const neu: ZeitEintrag = { ...bisher, datum: p.datum, aufgabeId: p.aufgabeId, minuten: p.minuten, notiz: p.notiz }
  if (p.datum === alt.datum) {
    const err = await tagSpeichern(z.admin, alt.datum, altTag.map(e => (e.id === alt.id ? neu : e)))
    if (err) return { error: err }
  } else {
    const neuTag = await tagLaden(z.admin, p.datum)
    const err1 = await tagSpeichern(z.admin, p.datum, [...neuTag.filter(e => e.id !== alt.id), neu])
    if (err1) return { error: err1 }
    const err2 = await tagSpeichern(z.admin, alt.datum, altTag.filter(e => e.id !== alt.id))
    if (err2) return { error: err2 }
  }
  revalidatePath(PFAD)
  return { success: true as const, eintrag: neu }
}

export async function aufgabenZeitLoeschen(datum: string, id: string) {
  const z = await zugang()
  if ('error' in z) return { error: z.error }
  if (typeof datum !== 'string' || !DATUM_RE.test(datum) || !istId(id)) return { error: 'Eintrag nicht gefunden.' }
  const tag = await tagLaden(z.admin, datum)
  if (!tag.some(e => e.id === id)) return { error: 'Eintrag nicht gefunden, vielleicht wurde er schon gelöscht.' }
  const err = await tagSpeichern(z.admin, datum, tag.filter(e => e.id !== id))
  if (err) return { error: err }
  revalidatePath(PFAD)
  return { success: true as const }
}
