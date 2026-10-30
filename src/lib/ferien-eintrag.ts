// Ferien im Arbeitsplan eintragen: ab 2027 nur an Arbeitstagen ohne
// Feiertage. Gezählt wird tagesgenau: jeder eingetragene Tag ist ein
// Ferientag (F). Teilzeit wählt bei der Anmeldung die konkreten Tage, bei
// 50 Prozent zwei Tage in der einen und drei in der anderen Woche. Ältere
// gewichtete Einträge (F:x) werden weiterhin mit ihrem Gewicht gelesen.
// 2026 bleibt unverändert (Wochentage, manuelles «angerechnet»).

import { weekdaysBetween } from './ferien-wuensche'
import { arbeitstageBetween } from './feiertage'

export const GEWICHTET_AB = '2027-01-01'

/** Tage, an denen Ferien geschrieben werden. */
export const ferienTage = (from: string, to: string): string[] => (from >= GEWICHTET_AB ? arbeitstageBetween(from, to) : weekdaysBetween(from, to))

/** Eintrag für einen Ferientag: immer ein ganzer Tag F (tagesgenaue Zählung). */
export const ferienEintrag = (): string => 'F'
