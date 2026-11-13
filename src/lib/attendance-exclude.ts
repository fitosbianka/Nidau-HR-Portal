import { PRAXIS } from '@/config/praxis'

// Employees who do NOT need TimeMoto time-tracking (Zeiterfassung).
// Their punches are ignored by the webhook and they are hidden from the
// "Jetzt anwesend" and "Berichte" views. Names must match profiles.full_name
// exactly (and the userFullName TimeMoto sends).
export const ZEITERFASSUNG_EXCLUDED = new Set<string>([])

// Employees pinned to the TOP of the Zeiterfassung report views: they always
// get a tile and a report card — even in periods without clocked times — and
// lead the list. Names must match profiles.full_name exactly.
export const ZEITERFASSUNG_PINNED_TOP: string[] = []

// Wer überhaupt zur Zeiterfassung gehört (und damit in Berichte, Konto und
// Monatsexport): die Funktionen aus src/config/praxis.ts, dazu einzeln
// genannte Personen mit anderer Funktion, die trotzdem stempeln.
const ZEITERFASSUNG_JOB_TITLES = new Set<string>(PRAXIS.zeiterfassungFunktionen)
const ZEITERFASSUNG_INCLUDED_NAMES = new Set<string>(PRAXIS.zeiterfassungZusaetzlich)

export function isZeiterfassungPerson(p: { full_name: string; job_title?: string | null }): boolean {
  if (ZEITERFASSUNG_EXCLUDED.has(p.full_name)) return false
  return ZEITERFASSUNG_JOB_TITLES.has((p.job_title ?? '').trim()) || ZEITERFASSUNG_INCLUDED_NAMES.has(p.full_name)
}
