// Zugang zur Geschäftsanalyse (Finanzen) — bewusst enger als die Admin-
// Rolle: Peter ist auch Admin und soll den Bereich vorerst NICHT sehen.
// Weitere Personen bekommen Zugang nur durch Ergänzen dieser Liste.

import { PRAXIS } from '@/config/praxis'

export const FINANZ_ZUGANG: string[] = PRAXIS.finanzZugang

/** Admin-Rolle UND Name in FINANZ_ZUGANG — beides muss stimmen. */
export function hatFinanzZugang(role: string | null | undefined, fullName: string | null | undefined): boolean {
  return role === 'admin' && FINANZ_ZUGANG.includes(fullName ?? '')
}
