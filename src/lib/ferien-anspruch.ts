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
//
// Admins passen den Anspruch pro Person an (Zeile __ferien_anspruch__<id>):
//   wochen     Wochen statt der Praxisregel, null = ohne festes Kontingent
//   korrektur  Tage dazu oder weg (Übertrag, Geschenktage), Standard 0
//   tage       älterer fester Wert in Tagen, überschreibt die Rechnung
// Anspruch = Wochen × 5 Tage × Pensum + Korrektur.
export type FerienAnspruch = { wochen: number | null; hinweis?: string }

export type AnspruchAnpassung = {
  /** Wochen statt der Praxisregel; null = ohne festes Kontingent; undefined = Praxisregel */
  wochen?: number | null
  /** Korrektur in Tagen, dazu (positiv) oder weg (negativ) */
  korrektur?: number
  /** Fester Wert in Tagen (ältere Anpassung), null = ohne festes Kontingent */
  tage?: number | null
}

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
const pz = (n: number) => String(round2(n)).replace('.', ',')

/** Pensum-Faktor aus profiles.pensum (Prozent); fehlend = 100%. */
export function pensumFaktor(pensum: number | null | undefined): number {
  return pensum != null && pensum > 0 && pensum <= 100 ? pensum / 100 : 1
}

export type AnspruchErgebnis = {
  /** Anspruch in Tagen; null = ohne festes Kontingent */
  tage: number | null
  /** Wochen, die der Rechnung zugrunde liegen (Praxisregel oder Anpassung) */
  wochen: number | null
  /** Wochen × 5 × Pensum, ohne Korrektur */
  basisTage: number | null
  korrektur: number
  /** Pensum in Prozent, wie gerechnet */
  pensumProzent: number
  /** Ein fester Wert in Tagen überschreibt die Rechnung (ältere Anpassung) */
  fest: boolean
  hinweis?: string
  angepasst: boolean
}

/** Anspruch in Tagen: Admin Anpassung (Schlüssel __ferien_anspruch__) vor
 *  der Praxisregel (Wochen × 5 × Pensum), dazu die Korrektur in Tagen.
 *  undefined = keine Anpassung; eine Zahl oder null (älterer Aufruf) gilt
 *  als fester Wert. */
export function anspruchTageFor(fullName: string, pensum: number | null | undefined, anpassung?: AnspruchAnpassung | number | null): AnspruchErgebnis {
  const a = ferienAnspruchFor(fullName)
  const p: AnspruchAnpassung | undefined = anpassung === undefined ? undefined : (typeof anpassung === 'object' && anpassung !== null ? anpassung : { tage: anpassung })
  const faktor = pensumFaktor(pensum)
  const pensumProzent = Math.round(faktor * 100)
  const wochen = p && p.wochen !== undefined ? p.wochen : a.wochen
  const korrektur = round2(p?.korrektur ?? 0)
  const angepasst = !!p && (p.wochen !== undefined || (p.korrektur ?? 0) !== 0 || p.tage !== undefined)
  if (p && p.tage !== undefined) {
    const tage = p.tage == null ? null : round2(p.tage)
    return { tage, wochen, basisTage: null, korrektur: 0, pensumProzent, fest: true, hinweis: tage == null ? 'Ohne festes Kontingent' : 'Anspruch durch Admin fest gesetzt', angepasst: true }
  }
  if (wochen == null) return { tage: null, wochen: null, basisTage: null, korrektur, pensumProzent, fest: false, hinweis: a.hinweis ?? 'Ohne festes Kontingent', angepasst }
  const basisTage = round2(wochen * 5 * faktor)
  return { tage: round2(basisTage + korrektur), wochen, basisTage, korrektur, pensumProzent, fest: false, hinweis: a.hinweis, angepasst }
}

/** Lesbare Herleitung, zum Beispiel «5 Wochen × 5 Tage × 60 % = 15 Tage,
 *  + 1 Tag Korrektur = 16 Tage». */
export function herleitungText(a: AnspruchErgebnis): string {
  if (a.tage == null) return a.hinweis ?? 'Ohne festes Kontingent'
  if (a.fest) return `${pz(a.tage)} Tage, durch Admin fest gesetzt`
  const basis = `${pz(a.wochen ?? 0)} Wochen × 5 Tage × ${a.pensumProzent} % = ${pz(a.basisTage ?? 0)} Tage`
  const korr = a.korrektur !== 0 ? `, ${a.korrektur > 0 ? '+' : '−'} ${pz(Math.abs(a.korrektur))} ${Math.abs(a.korrektur) === 1 ? 'Tag' : 'Tage'} Korrektur = ${pz(a.tage)} Tage` : ''
  const hinweis = a.hinweis && !a.angepasst ? `. ${a.hinweis}` : a.angepasst ? ' (durch Admin angepasst)' : ''
  return `${basis}${korr}${hinweis}`
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

export function meinKontingentFor(
  fullName: string,
  pensum: number | null | undefined,
  eingegebenGewichtet: number,
  eingetragenGewichtet: number,
  anpassung?: AnspruchAnpassung | number | null,
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
