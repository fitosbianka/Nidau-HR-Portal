// Arbeitszeit- und Ferienkonto: keine importierten Altwerte für diese
// Installation. Alles wird live aus Zeiterfassung und Arbeitsplan gerechnet,
// ab dem ersten Monat des Jahres.

export const KONTO_YEAR = 2026
export const LIVE_FROM_MONTH = 1

export type KontoHistoryMonth = {
  sollMin: number; istMin: number
  saldoVorMin: number; kontoMin: number
  ferien: number; restFerien: number | null; krank: number
} | null

export type KontoHistoryEmployee = {
  funktion: string
  pensum: number | null            // Anteil (0.8), null = Stundenlohn
  bemerkungen: string | null
  ferienStand: number | null       // Restferien nach dem letzten Altmonat
  months: Record<number, KontoHistoryMonth>
}

export const KONTO_HISTORY: Record<string, KontoHistoryEmployee> = {}
