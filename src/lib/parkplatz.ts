// Parkplatz-Vermietung (Einstellhalle): admin-only tracking of who rents a
// space and which months are paid.
//
// Stored as reserved zeiterfassung_comments rows (no DDL possible — same
// mechanism as __konto__ / __ferienwunsch__ / __plan_* rows):
//   __parkplatz__<profileId>          @ 1970-01-01  → participant JSON
//   __parkplatz_zahlung__<profileId>  @ YYYY-MM-01  → payment JSON for a month
//     { am, notiz?, betrag, art: 'monat'|'jahr'|'lohnabzug', soll? }
//     { ausgesetzt: true, soll? }  = manual override: auto-Lohnabzug month NOT paid
//     { soll, notiz? }             = noch unbezahlt, aber abweichender Monatsbetrag
//   `soll` = abweichender Monatsbetrag (CHF) für genau diesen Monat (z. B.
//   halber Monat); fehlt er, gilt der Monatsbetrag der Mieterin.

import type { SupabaseClient } from '@supabase/supabase-js'

export const PP_TEILNEHMER_PREFIX = '__parkplatz__'
export const PP_ZAHLUNG_PREFIX = '__parkplatz_zahlung__'
export const PP_ANCHOR = '1970-01-01'

// Cost side (fixed): the practice rents 6 spaces at CHF 130 each.
export const PP_PLAETZE = 6
export const PP_KOSTEN_PRO_PLATZ = 130

export type PpMethode = 'bar' | 'twint' | 'lohnabzug' | 'zulage_bar' | 'jahresrechnung'

export const PP_METHODEN: Array<{ key: PpMethode; label: string }> = [
  { key: 'bar', label: 'Bar' },
  { key: 'twint', label: 'Twint' },
  { key: 'lohnabzug', label: 'Lohnabzug' },
  { key: 'zulage_bar', label: 'Zulage + Bar' },
  { key: 'jahresrechnung', label: 'Jahresrechnung' },
]

export type PpTeilnehmer = {
  id: string               // profile id
  name: string
  pensum: number           // %
  betrag: number           // CHF pro Monat
  methode: PpMethode
  von: string              // YYYY-MM
  bis: string | null       // YYYY-MM (inclusive) — set = beendet
  autoLohn: boolean        // Lohnabzug: Monate automatisch als bezahlt zeigen
  notiz: string | null
  adresse: string | null   // Rechnungsadresse (Jahresrechnung)
}

export type PpZahlung = {
  monat: string            // YYYY-MM
  am: string | null        // YYYY-MM-DD — null = (noch) nicht bezahlt
  notiz: string | null
  betrag: number           // bezahlter Betrag
  art: 'monat' | 'jahr' | 'lohnabzug' | 'auto'
  ausgesetzt: boolean
  /** abweichender Monatsbetrag (Soll) nur für diesen Monat, sonst null */
  soll: number | null
}

/** Geschuldeter Betrag eines Monats: Abweichung aus der Monatszeile, sonst
 *  der Monatsbetrag der Mieterin. */
export function ppSoll(t: PpTeilnehmer, z: PpZahlung | null | undefined): number {
  return z?.soll != null ? z.soll : t.betrag
}

export function ppMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

/** Months (1–12) of `year` inside the participant's active range. */
export function ppActiveMonths(t: PpTeilnehmer, year: number): number[] {
  const out: number[] = []
  for (let m = 1; m <= 12; m++) {
    const ym = ppMonthKey(year, m)
    if (ym >= t.von && (!t.bis || ym <= t.bis)) out.push(m)
  }
  return out
}

export function parsePpTeilnehmer(rows: Array<{ user_full_name: string; schedule_date: string; comment: string }>): PpTeilnehmer[] {
  const out: PpTeilnehmer[] = []
  for (const r of rows) {
    if (!r.user_full_name.startsWith(PP_TEILNEHMER_PREFIX)) continue
    try {
      const j = JSON.parse(r.comment) as Partial<PpTeilnehmer>
      if (!j.name || !j.von) continue
      out.push({
        id: r.user_full_name.slice(PP_TEILNEHMER_PREFIX.length),
        name: j.name,
        pensum: typeof j.pensum === 'number' ? j.pensum : 100,
        betrag: typeof j.betrag === 'number' ? j.betrag : 100,
        methode: (['bar', 'twint', 'lohnabzug', 'zulage_bar', 'jahresrechnung'] as const).includes(j.methode as PpMethode) ? (j.methode as PpMethode) : 'bar',
        von: j.von,
        bis: j.bis ?? null,
        autoLohn: !!j.autoLohn,
        notiz: j.notiz ?? null,
        adresse: j.adresse ?? null,
      })
    } catch { /* ignore bad rows */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function parsePpZahlungen(rows: Array<{ user_full_name: string; schedule_date: string; comment: string }>): Record<string, Record<string, PpZahlung>> {
  // participantId → { 'YYYY-MM' → Zahlung }
  const out: Record<string, Record<string, PpZahlung>> = {}
  for (const r of rows) {
    if (!r.user_full_name.startsWith(PP_ZAHLUNG_PREFIX)) continue
    const id = r.user_full_name.slice(PP_ZAHLUNG_PREFIX.length)
    const monat = r.schedule_date.slice(0, 7)
    try {
      const j = JSON.parse(r.comment) as { am?: string; notiz?: string; betrag?: number; art?: string; ausgesetzt?: boolean; soll?: number }
      ;(out[id] ??= {})[monat] = {
        monat,
        am: j.am ?? null,
        notiz: j.notiz ?? null,
        betrag: typeof j.betrag === 'number' ? j.betrag : 0,
        art: j.art === 'jahr' ? 'jahr' : j.art === 'lohnabzug' ? 'lohnabzug' : 'monat',
        ausgesetzt: !!j.ausgesetzt,
        soll: typeof j.soll === 'number' && j.soll >= 0 ? j.soll : null,
      }
    } catch { /* ignore bad rows */ }
  }
  return out
}

export async function loadParkplatzData(admin: SupabaseClient) {
  const { data } = await admin
    .from('zeiterfassung_comments')
    .select('user_full_name, schedule_date, comment')
    .like('user_full_name', '\\_\\_parkplatz%')
  const rows = (data ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>
  return {
    teilnehmer: parsePpTeilnehmer(rows),
    zahlungen: parsePpZahlungen(rows),
  }
}

// fmtChf lebt neu in src/lib/utils.ts (auch die Finanzen nutzen es) —
// Re-Export, damit bestehende Importe weiter funktionieren.
export { fmtChf } from './utils'
