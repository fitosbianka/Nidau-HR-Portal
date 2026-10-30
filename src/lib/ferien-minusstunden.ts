// Ferientage, die NICHT vom Ferienguthaben abgehen, sondern als
// Minusstunden über die Zeiterfassung laufen.
//
// Hintergrund (Vereinbarung): Das Ferienkonto der Person ist bereits im
// Minus. Die im Arbeitsplan als «F» geplanten Tage des genannten Monats
// gelten deshalb NICHT als Ferienbezug — die Restferien bleiben unverändert
// und in den Ferienplanungs-Zählungen erscheinen sie nicht als bezogene
// Tage. Sie bringen aber auch KEINE Zeitgutschrift: der Tag zählt 0:00 h,
// während das Monats-Soll den Tag weiter mitzählt — das Zeitkonto rutscht
// pro Tag um 8:30 h × Gewicht ins Minus. Der Ausgleich wird per Jahresende
// angeschaut; ein allfälliger Lohnabzug (z. B. Dezember) läuft bewusst
// manuell über die Lohnabrechnung und nie automatisch.
//
// Der Arbeitsplan zeigt die Tage weiterhin als «F». Namen müssen
// profiles.full_name entsprechen; `monat` ist YYYY-MM.

export type FerienMinusRegel = { name: string; monat: string; grund: string }

export const FERIEN_ALS_MINUSSTUNDEN: readonly FerienMinusRegel[] = []

// Namensvarianten der Stempeluhr («Laura Gerisch» vs. «Laura Gerisch-Rudin»)
function passtName(konfig: string, fullName: string): boolean {
  if (konfig === fullName) return true
  return konfig.startsWith(`${fullName}-`) || fullName.startsWith(`${konfig}-`)
}

/** Die passende Regel für eine Person an einem Tag (YYYY-MM-DD), sonst null. */
export function ferienMinusRegel(fullName: string | null | undefined, date: string): FerienMinusRegel | null {
  if (!fullName) return null
  const monat = date.slice(0, 7)
  return FERIEN_ALS_MINUSSTUNDEN.find(r => r.monat === monat && passtName(r.name, fullName)) ?? null
}

/** true = ein «F» dieser Person an diesem Tag zählt als Minusstunden, nicht als Ferienbezug. */
export function istFerienAlsMinusstunden(fullName: string | null | undefined, date: string): boolean {
  return ferienMinusRegel(fullName, date) != null
}
