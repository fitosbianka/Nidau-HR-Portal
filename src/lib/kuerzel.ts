// Kürzel der Mitarbeitenden für Notizen und Protokolle. Normalfall: erste
// Buchstaben von Vor- und Nachname («Bianka Fitos» → BF). Wer im Team ein
// anderes Kürzel führt, steht in KUERZEL_FEST, damit Portal und Praxis
// dieselben Kürzel verwenden.

export const KUERZEL_FEST: Record<string, string> = {
  'Laura Gerisch-Rudin': 'LRG',
}

export function kuerzelFuer(fullName: string | null | undefined): string | null {
  const name = (fullName ?? '').trim()
  if (!name) return null
  if (KUERZEL_FEST[name]) return KUERZEL_FEST[name]
  const parts = name.split(/\s+/).filter(Boolean)
  return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0][0].toUpperCase()
}
