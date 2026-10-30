import { PLAN_YEAR } from '@/lib/ferien-wuensche'

// Ferienanspruch für die Ferienplanung (PLAN_YEAR) in WOCHEN pro Person —
// Praxis-Regeln gemäss Bianka (Stand 23.09.2026):
//   · DA und DH: 5 Wochen (Standard für alle nicht speziell Genannten)
//   · Dinusha: 6 Wochen (5 + 1 Geschenkwoche zum 10-Jahre-Jubiläum)
//   · Franziska: 7 Wochen · Noah und Paola: 5 Wochen
//   · Valérie: ohne festes Kontingent (Inhaberin)
// Gezählt wird PENSUMGEWICHTET in Tagen: 1 Woche = 5 Werktage × Pensum
// (z.B. 5 Wochen bei 60% = 15 Tage); Wünsche zählen ihre Werktage ebenfalls
// × Pensum, bereits angerechnete Einträge (F:x) mit ihrem Gewicht. Überall
// auf 2 Dezimalstellen gerundet.
export type FerienAnspruch = { wochen: number | null; hinweis?: string }

const STANDARD_WOCHEN = 5

const SPEZIAL: Record<string, FerienAnspruch> = {
  'Dinusha Atapattu':        { wochen: 6, hinweis: '5 Wochen + 1 Geschenkwoche zum 10-Jahre-Jubiläum in der Praxis 🎉' },
  'Franziska Rindlisbacher': { wochen: 7 },
  'Noah Diserens':           { wochen: 5 },
  'Paola Maldonado':         { wochen: 5 },
  'Valérie Diserens':        { wochen: null, hinweis: 'Ohne festes Kontingent' },
}

/** Anspruch einer Person — tolerant gegenüber Namensvarianten (gleiches
 *  Muster wie lohnSeedFor: Vorname plus ein Nachnamens-Teil identisch). */
export function ferienAnspruchFor(fullName: string): FerienAnspruch {
  if (SPEZIAL[fullName]) return SPEZIAL[fullName]
  const norm = (s: string) => s.toLowerCase().split(/[\s-]+/).filter(Boolean)
  const mine = norm(fullName)
  for (const [key, val] of Object.entries(SPEZIAL)) {
    const theirs = norm(key)
    if (mine[0] === theirs[0] && mine.slice(1).some(t => theirs.slice(1).includes(t))) return val
  }
  return { wochen: STANDARD_WOCHEN }
}

export const round2 = (n: number) => Math.round(n * 100) / 100

/** Pensum-Faktor aus profiles.pensum (Prozent); fehlend = 100%. */
export function pensumFaktor(pensum: number | null | undefined): number {
  return pensum != null && pensum > 0 && pensum <= 100 ? pensum / 100 : 1
}

/** Persönliche Kennzahlen für die Mitarbeiter-Seite — werden SERVERSEITIG
 *  gerechnet, damit jede Person nur die eigenen Zahlen erhält. */
export type MeinFerienKontingent = {
  jahr: number
  wochen: number | null
  /** Anspruch in Tagen (Wochen × 5 × Pensum); null = ohne festes Kontingent */
  tage: number | null
  /** Eigene Ferien-Wünsche, pensumgewichtet in Tagen */
  eingegeben: number
  /** Bereits akzeptierte/eingetragene Ferientage (gewichtet) */
  eingetragen: number
  /** Noch einzugeben, bis der Anspruch verplant ist (nie unter 0) */
  nochEinzugeben: number | null
  hinweis?: string
}

/** Anspruch in Tagen: Admin Anpassung (Schlüssel __ferien_anspruch__) vor
 *  der Praxisregel (Wochen × 5 × Pensum); undefined = keine Anpassung. */
export function anspruchTageFor(fullName: string, pensum: number | null | undefined, anpassung?: number | null): { tage: number | null; wochen: number | null; hinweis?: string; angepasst: boolean } {
  const a = ferienAnspruchFor(fullName)
  if (anpassung !== undefined) return { tage: anpassung == null ? null : round2(anpassung), wochen: a.wochen, hinweis: anpassung == null ? 'Ohne festes Kontingent' : 'Anspruch durch Admin angepasst', angepasst: true }
  return { tage: a.wochen != null ? round2(a.wochen * 5 * pensumFaktor(pensum)) : null, wochen: a.wochen, hinweis: a.hinweis, angepasst: false }
}

export function meinKontingentFor(
  fullName: string,
  pensum: number | null | undefined,
  eingegebenGewichtet: number,
  eingetragenGewichtet: number,
  anpassung?: number | null,
): MeinFerienKontingent {
  const a = anspruchTageFor(fullName, pensum, anpassung)
  const tage = a.tage
  const eingegeben = round2(eingegebenGewichtet)
  const eingetragen = round2(eingetragenGewichtet)
  return {
    jahr: PLAN_YEAR,
    wochen: a.wochen,
    tage,
    eingegeben,
    eingetragen,
    nochEinzugeben: tage != null ? round2(Math.max(0, tage - Math.max(eingegeben, eingetragen))) : null,
    hinweis: a.hinweis,
  }
}
