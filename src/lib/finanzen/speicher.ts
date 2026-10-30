// Ablage der Geschäftsanalyse — NUR serverseitig über den Admin-Client.
// Buchungen als JSON im privaten Bucket employee-documents (ohne Eintrag in
// der Tabelle documents), Konfiguration als reservierte __finanz_-Zeilen in
// zeiterfassung_comments (schedule_date 1970-01-01).

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  FINANZ_ANCHOR, FINANZ_KONTO_PREFIX, FINANZ_IMPORT_PREFIX,
  type FinanzKonto, type ImportEintrag, type Jahresdatei,
} from './types'
import { verschluesseln, entschluesseln, istVerschluesselt } from './krypto'

export const FINANZ_BUCKET = 'employee-documents'
export const FINANZ_BASIS = '_finanzen/ubs'

export const jahresPfad = (kontoKey: string, jahr: number) => `${FINANZ_BASIS}/${kontoKey}/${jahr}.json`
export const originalPfad = (dateiname: string) =>
  `${FINANZ_BASIS}/originale/${Date.now()}_${dateiname.replace(/[^a-zA-Z0-9._-]/g, '_')}`

const esc = (s: string) => s.replace(/_/g, '\\_')

// Die Jahresdateien werden bei jedem Import und jeder Umbuchung
// ÜBERSCHRIEBEN. Supabase liefert Storage-Objekte über ein CDN aus, das
// eine überschriebene Datei sonst bis zur Cache-Dauer (Standard 1 Stunde)
// in der ALTEN Version zurückgeben kann — ein neu importierter Monat fehlte
// dann auf der Seite, und eine Umbuchung auf Basis der alten Version
// überschrieb frühere Zuordnungen. Deshalb: jede Lesung mit eigener
// Cache-Kennung und ohne Zwischenspeicher, jedes Schreiben ohne Cache-Dauer.
const frischeKennung = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export async function ladeJahresdatei(admin: SupabaseClient, kontoKey: string, jahr: number): Promise<Jahresdatei | null> {
  const { data, error } = await admin.storage.from(FINANZ_BUCKET)
    .download(jahresPfad(kontoKey, jahr), { cacheNonce: frischeKennung() }, { cache: 'no-store' })
  if (error || !data) return null
  try {
    const bytes = new Uint8Array(await data.arrayBuffer())
    // verschlüsselt gespeichert; unverschlüsselte Dateien aus der ersten
    // Version werden noch gelesen und beim nächsten Speichern verschlüsselt
    const klartext = istVerschluesselt(bytes)
      ? entschluesseln(bytes).toString('utf-8')
      : new TextDecoder().decode(bytes)
    return JSON.parse(klartext) as Jahresdatei
  } catch {
    return null
  }
}

export async function speichereJahresdatei(admin: SupabaseClient, datei: Jahresdatei): Promise<string | null> {
  // Immer verschlüsselt ablegen (AES-256-GCM) — im Bucket liegt kein
  // Klartext mit Buchungstexten, Namen oder Salden
  const chiffrat = verschluesseln(new TextEncoder().encode(JSON.stringify(datei)))
  const { error } = await admin.storage.from(FINANZ_BUCKET).upload(
    jahresPfad(datei.kontoKey, datei.jahr),
    new Blob([new Uint8Array(chiffrat)]),
    { upsert: true, contentType: 'application/octet-stream', cacheControl: '0' },
  )
  return error?.message ?? null
}

/** Vorhandene Jahre eines Kontos (aus den Dateinamen im Bucket). */
export async function ladeJahre(admin: SupabaseClient, kontoKey: string): Promise<number[]> {
  const { data } = await admin.storage.from(FINANZ_BUCKET).list(`${FINANZ_BASIS}/${kontoKey}`, { limit: 100 })
  return ((data ?? []) as Array<{ name: string }>)
    .map(f => /^(\d{4})\.json$/.exec(f.name)?.[1])
    .filter((x): x is string => !!x)
    .map(Number)
    .sort()
}

export async function ladeKontos(admin: SupabaseClient): Promise<FinanzKonto[]> {
  const { data } = await admin.from('zeiterfassung_comments')
    .select('user_full_name, comment')
    .like('user_full_name', `${esc(FINANZ_KONTO_PREFIX)}%`)
  const out: FinanzKonto[] = []
  for (const r of (data ?? []) as Array<{ user_full_name: string; comment: string }>) {
    try {
      const p = JSON.parse(r.comment) as { name?: string; iban?: string }
      out.push({
        kontoKey: r.user_full_name.slice(FINANZ_KONTO_PREFIX.length),
        name: p.name ?? 'Geschäftskonto UBS',
        iban: p.iban ?? '',
      })
    } catch { /* kaputte Zeile überspringen */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'de-CH'))
}

export async function speichereKonto(admin: SupabaseClient, konto: FinanzKonto): Promise<string | null> {
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    {
      user_full_name: `${FINANZ_KONTO_PREFIX}${konto.kontoKey}`,
      schedule_date: FINANZ_ANCHOR,
      comment: JSON.stringify({ name: konto.name, iban: konto.iban }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error?.message ?? null
}

// ── Kleine Konfigurations-JSONs (Kategorien, Regeln, Ziel, Geprüft-Liste) ──

export const FINANZ_KATEGORIEN_KEY = '__finanz_kategorien__'
export const FINANZ_REGELN_KEY = '__finanz_regeln__'
export const FINANZ_ZIEL_KEY = '__finanz_ziel__'
export const FINANZ_GEPRUEFT_KEY = '__finanz_geprueft__'

export async function ladeFinanzConfig<T>(admin: SupabaseClient, key: string): Promise<T | null> {
  const { data } = await admin.from('zeiterfassung_comments')
    .select('comment')
    .eq('user_full_name', key)
    .eq('schedule_date', FINANZ_ANCHOR)
    .maybeSingle()
  const comment = (data as { comment?: string } | null)?.comment
  if (!comment) return null
  try { return JSON.parse(comment) as T } catch { return null }
}

export async function speichereFinanzConfig(admin: SupabaseClient, key: string, wert: unknown): Promise<string | null> {
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    {
      user_full_name: key,
      schedule_date: FINANZ_ANCHOR,
      comment: JSON.stringify(wert),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error?.message ?? null
}

export async function ladeImportprotokoll(admin: SupabaseClient): Promise<ImportEintrag[]> {
  const { data } = await admin.from('zeiterfassung_comments')
    .select('user_full_name, comment')
    .like('user_full_name', `${esc(FINANZ_IMPORT_PREFIX)}%`)
  const out: ImportEintrag[] = []
  for (const r of (data ?? []) as Array<{ user_full_name: string; comment: string }>) {
    try {
      const p = JSON.parse(r.comment) as Omit<ImportEintrag, 'importId'>
      if (!p.am) continue
      out.push({ ...p, importId: r.user_full_name.slice(FINANZ_IMPORT_PREFIX.length) })
    } catch { /* überspringen */ }
  }
  return out.sort((a, b) => b.am.localeCompare(a.am)).slice(0, 50)
}

export async function schreibeImportEintrag(admin: SupabaseClient, eintrag: ImportEintrag): Promise<void> {
  const { importId, ...meta } = eintrag
  await admin.from('zeiterfassung_comments').insert({
    user_full_name: `${FINANZ_IMPORT_PREFIX}${importId}`,
    schedule_date: FINANZ_ANCHOR,
    comment: JSON.stringify(meta),
  })
}
