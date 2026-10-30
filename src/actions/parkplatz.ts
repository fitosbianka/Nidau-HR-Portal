'use server'

// Parkplatz-Vermietung: admin-only actions (participants + payments).
// Storage: reserved zeiterfassung_comments rows — see src/lib/parkplatz.ts.

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  PP_TEILNEHMER_PREFIX, PP_ZAHLUNG_PREFIX, PP_ANCHOR,
  type PpMethode,
} from '@/lib/parkplatz'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') throw new Error('Keine Berechtigung')
  return await createAdminClient()
}

const revalidate = () => revalidatePath('/admin/parkplaetze')

const MONAT_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/

export type TeilnehmerInput = {
  id: string
  name: string
  pensum: number
  betrag: number
  methode: PpMethode
  von: string
  bis: string | null
  autoLohn: boolean
  notiz: string | null
  adresse: string | null
}

/** Create or update a participant (keyed by profile id). */
export async function savePpTeilnehmer(input: TeilnehmerInput) {
  const admin = await requireAdmin()
  if (!input.id || !input.name.trim()) return { error: 'Bitte eine Mitarbeiterin wählen.' }
  if (!MONAT_RE.test(input.von)) return { error: 'Bitte einen gültigen Start-Monat wählen.' }
  if (input.bis && !MONAT_RE.test(input.bis)) return { error: 'Bitte einen gültigen End-Monat wählen.' }
  if (input.bis && input.bis < input.von) return { error: 'Der End-Monat liegt vor dem Start-Monat.' }
  if (!(input.betrag >= 0) || input.betrag > 10000) return { error: 'Bitte einen gültigen Betrag eingeben.' }
  if (!(input.pensum > 0) || input.pensum > 100) return { error: 'Bitte ein gültiges Pensum eingeben.' }

  const { error } = await admin.from('zeiterfassung_comments').upsert(
    {
      user_full_name: `${PP_TEILNEHMER_PREFIX}${input.id}`,
      schedule_date: PP_ANCHOR,
      comment: JSON.stringify({
        name: input.name.trim(),
        pensum: input.pensum,
        betrag: Math.round(input.betrag * 100) / 100,
        methode: input.methode,
        von: input.von,
        bis: input.bis,
        autoLohn: input.methode === 'lohnabzug' ? input.autoLohn : false,
        notiz: input.notiz?.trim().slice(0, 1000) || null,
        adresse: input.adresse?.trim() || null,
      }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  revalidate()
  return { success: true }
}

/** Remove a participant COMPLETELY (only offered while no payments exist —
 *  ending the rental is done via the Bis-Monat, which keeps all history). */
export async function deletePpTeilnehmer(id: string) {
  const admin = await requireAdmin()
  const { data } = await admin
    .from('zeiterfassung_comments')
    .select('schedule_date')
    .eq('user_full_name', `${PP_ZAHLUNG_PREFIX}${id}`)
    .limit(1)
  if (data && data.length > 0) {
    return { error: 'Für diese Person sind Zahlungen erfasst — bitte stattdessen die Vermietung per End-Monat beenden.' }
  }
  const { error } = await admin
    .from('zeiterfassung_comments')
    .delete()
    .eq('user_full_name', `${PP_TEILNEHMER_PREFIX}${id}`)
    .eq('schedule_date', PP_ANCHOR)
  if (error) return { error: error.message }
  revalidate()
  return { success: true }
}

const rundeChf = (n: number) => Math.round(n * 100) / 100
const sollWert = (soll: number | null | undefined) => (typeof soll === 'number' && isFinite(soll) && soll >= 0 ? rundeChf(soll) : null)

/** Einen Monat als bezahlt markieren (oder Datum/Betrag/Notiz einer Zahlung
 *  ändern). `am` = null speichert den Monat als UNBEZAHLT, nur mit
 *  abweichendem Monatsbetrag (`soll`) und/oder Notiz — ohne beides wird die
 *  Zeile gelöscht (zurück auf Standard). `betrag` = tatsächlich bezahlt,
 *  `soll` = abweichender Monatsbetrag nur für diesen Monat (null = Standard). */
export async function setPpZahlung(
  id: string, monat: string, am: string | null, betrag: number, notiz: string | null,
  art: 'monat' | 'jahr' | 'lohnabzug' = 'monat', soll: number | null = null,
) {
  const admin = await requireAdmin()
  if (!MONAT_RE.test(monat)) return { error: 'Ungültiger Monat.' }
  if (am !== null && !DATUM_RE.test(am)) return { error: 'Bitte ein gültiges Zahlungsdatum wählen.' }
  if (am !== null && (!(betrag >= 0) || betrag > 10000)) return { error: 'Bitte einen gültigen Betrag eingeben.' }
  const s = sollWert(soll)
  if (soll != null && s == null) return { error: 'Bitte einen gültigen Monatsbetrag eingeben.' }
  const n = notiz?.trim().slice(0, 300) || null
  const key = { user_full_name: `${PP_ZAHLUNG_PREFIX}${id}`, schedule_date: `${monat}-01` }

  if (am === null && s == null && !n) {
    const { error } = await admin.from('zeiterfassung_comments').delete()
      .eq('user_full_name', key.user_full_name).eq('schedule_date', key.schedule_date)
    if (error) return { error: error.message }
    revalidate()
    return { success: true }
  }
  const comment = am === null
    ? { soll: s, notiz: n }
    : { am, notiz: n, betrag: rundeChf(betrag), art, soll: s }
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { ...key, comment: JSON.stringify(comment), updated_at: new Date().toISOString() },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  revalidate()
  return { success: true }
}

/** Zahlung entfernen (zurück auf unbezahlt). Ein abweichender Monatsbetrag
 *  (`soll`) bleibt dabei erhalten, wenn er mitgegeben wird. */
export async function clearPpZahlung(id: string, monat: string, soll: number | null = null) {
  const admin = await requireAdmin()
  if (!MONAT_RE.test(monat)) return { error: 'Ungültiger Monat.' }
  const s = sollWert(soll)
  if (s != null) {
    const { error } = await admin.from('zeiterfassung_comments').upsert(
      {
        user_full_name: `${PP_ZAHLUNG_PREFIX}${id}`,
        schedule_date: `${monat}-01`,
        comment: JSON.stringify({ soll: s, notiz: null }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_full_name,schedule_date' },
    )
    if (error) return { error: error.message }
  } else {
    const { error } = await admin
      .from('zeiterfassung_comments')
      .delete()
      .eq('user_full_name', `${PP_ZAHLUNG_PREFIX}${id}`)
      .eq('schedule_date', `${monat}-01`)
    if (error) return { error: error.message }
  }
  revalidate()
  return { success: true }
}

/** Auto-Lohnabzug override: mark ONE auto month explicitly as NOT paid
 *  (aussetzen = true) or remove that override again (aussetzen = false). */
export async function setPpAussetzung(id: string, monat: string, aussetzen: boolean, soll: number | null = null) {
  const admin = await requireAdmin()
  if (!MONAT_RE.test(monat)) return { error: 'Ungültiger Monat.' }
  const s = sollWert(soll)
  if (aussetzen) {
    const { error } = await admin.from('zeiterfassung_comments').upsert(
      {
        user_full_name: `${PP_ZAHLUNG_PREFIX}${id}`,
        schedule_date: `${monat}-01`,
        comment: JSON.stringify({ ausgesetzt: true, soll: s }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_full_name,schedule_date' },
    )
    if (error) return { error: error.message }
  } else if (s != null) {
    // Aussetzung aufheben, abweichenden Monatsbetrag behalten
    const { error } = await admin.from('zeiterfassung_comments').upsert(
      {
        user_full_name: `${PP_ZAHLUNG_PREFIX}${id}`,
        schedule_date: `${monat}-01`,
        comment: JSON.stringify({ soll: s, notiz: null }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_full_name,schedule_date' },
    )
    if (error) return { error: error.message }
  } else {
    const { error } = await admin
      .from('zeiterfassung_comments')
      .delete()
      .eq('user_full_name', `${PP_ZAHLUNG_PREFIX}${id}`)
      .eq('schedule_date', `${monat}-01`)
    if (error) return { error: error.message }
  }
  revalidate()
  return { success: true }
}

export type PpPosten = { monat: string; betrag: number; soll?: number | null }

/** Quick action: mark all past months of the year (up to and including the
 *  current month, inside the active range) as paid today — je Monat mit
 *  seinem (ggf. abweichenden) Betrag. */
export async function setPpBisherigeBezahlt(id: string, posten: PpPosten[]) {
  const admin = await requireAdmin()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })
  for (const { monat, betrag, soll } of posten) {
    if (!MONAT_RE.test(monat)) continue
    const { error } = await admin.from('zeiterfassung_comments').upsert(
      {
        user_full_name: `${PP_ZAHLUNG_PREFIX}${id}`,
        schedule_date: `${monat}-01`,
        comment: JSON.stringify({ am: today, notiz: null, betrag: rundeChf(betrag), art: 'monat', soll: sollWert(soll) }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_full_name,schedule_date' },
    )
    if (error) return { error: error.message }
  }
  revalidate()
  return { success: true }
}

/** Jahresrechnung: mark the WHOLE year as paid (12 monthly rows with the
 *  same payment date), or clear the whole year again. */
export async function setPpJahrBezahlt(id: string, jahr: number, am: string | null, posten: PpPosten[]) {
  const admin = await requireAdmin()
  if (am !== null && !DATUM_RE.test(am)) return { error: 'Bitte ein gültiges Zahlungsdatum wählen.' }
  if (am === null) {
    const { error } = await admin
      .from('zeiterfassung_comments')
      .delete()
      .eq('user_full_name', `${PP_ZAHLUNG_PREFIX}${id}`)
      .gte('schedule_date', `${jahr}-01-01`)
      .lte('schedule_date', `${jahr}-12-31`)
    if (error) return { error: error.message }
    // abweichende Monatsbeträge wieder hinterlegen (sie gehören zum Monat, nicht zur Zahlung)
    for (const { monat, soll } of posten) {
      const s = sollWert(soll)
      if (!MONAT_RE.test(monat) || s == null) continue
      await admin.from('zeiterfassung_comments').upsert(
        { user_full_name: `${PP_ZAHLUNG_PREFIX}${id}`, schedule_date: `${monat}-01`, comment: JSON.stringify({ soll: s, notiz: null }), updated_at: new Date().toISOString() },
        { onConflict: 'user_full_name,schedule_date' },
      )
    }
  } else {
    for (const { monat, betrag, soll } of posten) {
      if (!MONAT_RE.test(monat)) continue
      const { error } = await admin.from('zeiterfassung_comments').upsert(
        {
          user_full_name: `${PP_ZAHLUNG_PREFIX}${id}`,
          schedule_date: `${monat}-01`,
          comment: JSON.stringify({ am, notiz: 'Jahresrechnung', betrag: rundeChf(betrag), art: 'jahr', soll: sollWert(soll) }),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_full_name,schedule_date' },
      )
      if (error) return { error: error.message }
    }
  }
  revalidate()
  return { success: true }
}
