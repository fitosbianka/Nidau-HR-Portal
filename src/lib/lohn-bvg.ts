// BVG-/Pensionskassen-Abzug — EINE Quelle für HR-Seite und Lohnabrechnung.
//
// Der gültige Betrag steht in den Lohn-Stammdaten der Person (pkAbzug in
// __lohn_stamm__<id>) zusammen mit seinem Stand (pkAbzugStand: woher und
// seit wann). Die HR-Seite zeigt und ändert genau diesen Wert; die
// Lohnabrechnung wird damit vorbelegt und schreibt einen dort eingegebenen
// Betrag zurück. Beim ersten Aufruf nach Einführung erhält jede Person ohne
// bestätigten Stand den Betrag ihrer massgebenden letzten Abrechnung.
// Nur serverseitig mit dem Admin-Client verwenden.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  LOHN_STAMM_PREFIX, LOHN_ABR_PREFIX, LOHN_STAMM_DEFAULT, lohnSeedFor, parseLohnAbrechnungen,
  type LohnAbrechnung,
} from './lohn'

export type BvgQuelle = 'abrechnung' | 'stammdaten' | 'hr'

export type BvgStand = {
  /** gültiger BVG-Abzug CHF/Monat */
  betrag: number
  /** woher der Wert stammt; null = Seed/Standard, noch nie bestätigt */
  quelle: BvgQuelle | null
  /** Abrechnungsmonat (YYYY-MM), aus dem der Wert übernommen wurde */
  monat: string | null
  am: string | null
  /** massgebende letzte Abrechnung der Person */
  letzteAbrechnung: { monat: string; periode: string; titel: string; betrag: number } | null
  /** gespeicherter Wert ≠ Betrag der letzten Abrechnung */
  abweichung: boolean
}

/** Massgebende letzte Abrechnung für den BVG-Abzug: die neuste mit einem
 *  Abzug > 0 (Umsatz- oder Bonusabrechnungen ohne PK-Abzug zählen nicht);
 *  hat die Person nie einen Abzug, die neuste Abrechnung überhaupt. */
export function massgebendeAbrechnung(abrs: LohnAbrechnung[]): LohnAbrechnung | null {
  const sortiert = [...abrs].sort((a, b) =>
    b.monat.localeCompare(a.monat) || (b.erstelltAm ?? '').localeCompare(a.erstelltAm ?? ''))
  return sortiert.find(a => a.pkAbzug > 0) ?? sortiert[0] ?? null
}

type Raw = Record<string, unknown>
const STAMM_DATE = '1970-01-01'
const escLike = (s: string) => s.replace(/_/g, '\\_')
const runde = (n: number) => Math.round(n * 100) / 100

function standAusRaw(raw: Raw | null): { quelle: BvgQuelle | null; monat: string | null; am: string | null } {
  const st = raw?.pkAbzugStand as { quelle?: unknown; monat?: unknown; am?: unknown } | null | undefined
  if (!st || typeof st !== 'object') return { quelle: null, monat: null, am: null }
  const quelle = st.quelle === 'abrechnung' || st.quelle === 'stammdaten' || st.quelle === 'hr' ? st.quelle : null
  return { quelle, monat: typeof st.monat === 'string' ? st.monat : null, am: typeof st.am === 'string' ? st.am : null }
}

/** BVG-Stand aus Rohdaten (reine Funktion, auch für Listenseiten). */
export function bvgStandAus(raw: Raw | null, fullName: string | null, abrs: LohnAbrechnung[]): BvgStand {
  const seed = fullName ? lohnSeedFor(fullName) : null
  const betrag = typeof raw?.pkAbzug === 'number' ? (raw.pkAbzug as number) : (seed?.pkAbzug ?? 0)
  const letzte = massgebendeAbrechnung(abrs)
  return {
    betrag: runde(betrag),
    ...standAusRaw(raw),
    letzteAbrechnung: letzte ? { monat: letzte.monat, periode: letzte.periode, titel: letzte.titel, betrag: runde(letzte.pkAbzug) } : null,
    abweichung: letzte != null && Math.abs(runde(letzte.pkAbzug) - runde(betrag)) > 0.004,
  }
}

async function ladeStammRaw(admin: SupabaseClient, profileId: string): Promise<Raw | null> {
  const { data } = await admin.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', `${LOHN_STAMM_PREFIX}${profileId}`).eq('schedule_date', STAMM_DATE).maybeSingle()
  if (!data) return null
  try { return JSON.parse((data as { comment: string }).comment) as Raw } catch { return null }
}

async function ladeAbrechnungen(admin: SupabaseClient, profileId: string): Promise<LohnAbrechnung[]> {
  const { data } = await admin.from('zeiterfassung_comments')
    .select('user_full_name, schedule_date, comment')
    .like('user_full_name', `${escLike(LOHN_ABR_PREFIX)}${profileId}\\_%`)
  return parseLohnAbrechnungen((data ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>)[profileId] ?? []
}

async function ladeName(admin: SupabaseClient, profileId: string): Promise<string | null> {
  const { data } = await admin.from('profiles').select('full_name').eq('id', profileId).maybeSingle()
  return (data as { full_name: string } | null)?.full_name ?? null
}

/** BVG-Abzug als gültigen Wert speichern — erhält alle übrigen Stammdaten.
 *  Gibt es noch keine Stammdaten-Zeile, entsteht sie aus Standard + Seed
 *  (als «ungeprüft» markiert, bis die Stammdaten einmal bestätigt werden). */
export async function schreibeBvg(
  admin: SupabaseClient, profileId: string, betrag: number, quelle: BvgQuelle, monat: string | null,
): Promise<string | null> {
  const neu = runde(betrag)
  if (!Number.isFinite(neu) || neu < 0 || neu > 20000) return 'Bitte einen gültigen BVG-Abzug eingeben.'
  let raw = await ladeStammRaw(admin, profileId)
  if (!raw) {
    const name = await ladeName(admin, profileId)
    raw = { ...LOHN_STAMM_DEFAULT, ...(name ? (lohnSeedFor(name) ?? {}) : {}), geprueft: false }
  }
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    {
      user_full_name: `${LOHN_STAMM_PREFIX}${profileId}`,
      schedule_date: STAMM_DATE,
      comment: JSON.stringify({ ...raw, pkAbzug: neu, pkAbzugStand: { quelle, monat, am: new Date().toISOString() } }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error?.message ?? null
}

export async function ladeBvgStand(admin: SupabaseClient, profileId: string): Promise<BvgStand> {
  const [raw, abrs, name] = await Promise.all([ladeStammRaw(admin, profileId), ladeAbrechnungen(admin, profileId), ladeName(admin, profileId)])
  return bvgStandAus(raw, name, abrs)
}

/** Erst-Abgleich: jede Person OHNE bestätigten BVG-Stand erhält den Betrag
 *  ihrer massgebenden letzten Abrechnung (Oktober, wo es schon eine gibt,
 *  sonst September …). Idempotent — läuft bei jedem Seitenaufruf, schreibt
 *  aber nur, wo noch kein Stand hinterlegt ist. Gibt die Anzahl Schreibungen
 *  zurück. */
export async function bvgAbgleich(admin: SupabaseClient, nurProfileId?: string): Promise<number> {
  const { data } = await admin.from('zeiterfassung_comments')
    .select('user_full_name, schedule_date, comment')
    .like('user_full_name', '\\_\\_lohn%')
  const rows = (data ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>
  const stammRaw: Record<string, Raw> = {}
  for (const r of rows) {
    if (!r.user_full_name.startsWith(LOHN_STAMM_PREFIX)) continue
    try { stammRaw[r.user_full_name.slice(LOHN_STAMM_PREFIX.length)] = JSON.parse(r.comment) as Raw } catch { /* überspringen */ }
  }
  const abrechnungen = parseLohnAbrechnungen(rows)
  let geschrieben = 0
  for (const [profileId, list] of Object.entries(abrechnungen)) {
    if (nurProfileId && profileId !== nurProfileId) continue
    if (standAusRaw(stammRaw[profileId] ?? null).quelle) continue   // schon bestätigt
    const m = massgebendeAbrechnung(list)
    if (!m) continue
    const err = await schreibeBvg(admin, profileId, m.pkAbzug, 'abrechnung', m.monat)
    if (!err) geschrieben++
  }
  return geschrieben
}
