// Phasenmodell für Unfall- und Krankheitsabsenzen in der Lohnabrechnung.
// Umsetzung der «Regeln Lohnabrechnung bei Krankheit und Unfall» der
// Dentalpraxis Kehrsatz AG (Stand 21.09.2026) — die Regelnummern (R…) im
// Code verweisen auf dieses Dokument.
//
// Kernpunkte:
//   R1.1  Alle Absenzen in KALENDERTAGEN (nie Arbeitstage).
//   R1.2  Tagessatz = Monatslohn ÷ effektive Kalendertage des Monats.
//   R1.4  Jede Phase ist eine eigene Lohnart — kein Pauschalabzug.
//   R1.6  Fälle laufen über Monatsgrenzen; Karenz/Wartefrist pro FALL.
//   R2.x  Unfall: Tag 1–3 Karenz 80% (pflichtig), ab Tag 4 UVG-Taggeld-
//         Ersatz 80% (nicht abzugspflichtig).
//   R3.x  Krankheit: Tag 1–2 100%, Tag 3–30 80% (beides Lohnfortzahlung,
//         pflichtig), ab Tag 31 KTG-Taggeld-Ersatz 80% (frei).
//   R2.7  Kontrollwert erwartete Rückerstattung pro Unfallfall.

const DAY_MS = 86400000
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const toISO = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const round2 = (n: number) => Math.round(n * 100) / 100

export type AbsenzFallTyp = 'unfall' | 'krankheit'

export type AbsenzFall = {
  typ: AbsenzFallTyp
  /** Fallbeginn: Unfalltag bzw. erster ärztlich attestierter Tag (R1.3) —
   *  kann in einem früheren Monat liegen (R1.6) */
  beginn: string
  /** attestiertes Ende der Arbeitsunfähigkeit (letzter Absenztag) */
  ende: string
}

export type PhasenZeile = {
  label: string
  betrag: number
  /** true = Taggeld-Ersatz, NICHT abzugspflichtig (R4.2) */
  frei?: boolean
  tage: number
}

export type AbsenzMonat = {
  zeilen: PhasenZeile[]
  /** Kalendertage des Monats, die keiner Absenz zugeordnet sind (R6.1) */
  gearbeitetTage: number
  /** Absenz-Kalendertage im Monat */
  absenzTage: number
  kalendertage: number
  tagessatz: number
  /** R2.7: erwartete Rückerstattung pro Unfallfall (Phase-B-Tage im Monat) */
  kontrollwerte: Array<{ beginn: string; tageB: number; betrag: number }>
  fehler: string[]
}

const fmtD = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`

/** Tageskategorie nach Fall-Tag (1-basiert ab Fallbeginn). */
function kategorie(typ: AbsenzFallTyp, fallTag: number): 'karenzU' | 'uvg' | 'k100' | 'k80' | 'ktg' {
  if (typ === 'unfall') return fallTag <= 3 ? 'karenzU' : 'uvg'          // R2.1
  return fallTag <= 2 ? 'k100' : fallTag <= 30 ? 'k80' : 'ktg'           // R3.2 / R3.3
}

/** Zerlegt den Monat in Phasen-Lohnzeilen gemäss Regelwerk. `monatslohn`
 *  OHNE 13. (der 13. läuft voll weiter, R2.6/R3.5, separate Zeile). */
export function absenzZeilenFuerMonat(
  faelle: AbsenzFall[],
  monat: string,          // YYYY-MM
  monatslohn: number,
): AbsenzMonat {
  const jahr = parseInt(monat.slice(0, 4), 10)
  const mon = parseInt(monat.slice(5, 7), 10)
  const kalendertage = new Date(jahr, mon, 0).getDate()
  const tagessatz = monatslohn / kalendertage                             // R1.2
  const first = toMs(`${monat}-01`)
  const last = first + (kalendertage - 1) * DAY_MS
  const fehler: string[] = []

  // Tag → Kategorie (Kalendertage, R1.1); Überschneidungen sind Fehler
  const proTag = new Map<number, { kat: ReturnType<typeof kategorie>; fall: AbsenzFall }>()
  for (const f of faelle) {
    if (!f.beginn || !f.ende) { fehler.push('Absenzfall: Beginn und Ende angeben.'); continue }
    if (f.ende < f.beginn) { fehler.push(`Absenzfall ${fmtD(f.beginn)}: Ende liegt vor dem Beginn.`); continue }
    const von = Math.max(toMs(f.beginn), first)
    const bis = Math.min(toMs(f.ende), last)
    for (let ms = von; ms <= bis; ms += DAY_MS) {
      if (proTag.has(ms)) {
        fehler.push(`${fmtD(toISO(ms))}: zwei Absenzfälle überschneiden sich — bitte Daten korrigieren.`)
        continue
      }
      const fallTag = Math.round((ms - toMs(f.beginn)) / DAY_MS) + 1      // R1.6: über Monatsgrenzen
      proTag.set(ms, { kat: kategorie(f.typ, fallTag), fall: f })
    }
  }

  // Zusammenhängende gleiche Kategorien zu Zeilen bündeln
  type Block = { kat: ReturnType<typeof kategorie>; von: number; bis: number; tage: number; fall: AbsenzFall }
  const bloecke: Block[] = []
  for (let ms = first; ms <= last; ms += DAY_MS) {
    const t = proTag.get(ms)
    if (!t) continue
    const prev = bloecke[bloecke.length - 1]
    if (prev && prev.kat === t.kat && prev.fall === t.fall && prev.bis === ms - DAY_MS) {
      prev.bis = ms; prev.tage++
    } else {
      bloecke.push({ kat: t.kat, von: ms, bis: ms, tage: 1, fall: t.fall })
    }
  }

  const absenzTage = bloecke.reduce((s, b) => s + b.tage, 0)
  const gearbeitetTage = kalendertage - absenzTage                        // R6.1: Tagesbilanz per Konstruktion
  const zeilen: PhasenZeile[] = []
  if (gearbeitetTage > 0 && absenzTage > 0) {
    zeilen.push({
      label: `Gearbeitet (${gearbeitetTage} von ${kalendertage} Kalendertagen, 100%)`,
      betrag: round2(tagessatz * gearbeitetTage),
      tage: gearbeitetTage,
    })
  }
  for (const b of bloecke) {
    const range = `${fmtD(toISO(b.von))}–${fmtD(toISO(b.bis))}`
    const t80 = round2(tagessatz * 0.8 * b.tage)
    if (b.kat === 'karenzU') {
      zeilen.push({ label: `Lohnfortzahlung Unfall Karenztage (${range}, ${b.tage} ${b.tage === 1 ? 'Tag' : 'Tage'}, 80%)`, betrag: t80, tage: b.tage })              // R2.2
    } else if (b.kat === 'uvg') {
      zeilen.push({ label: `UVG-Taggeld-Ersatz (${range}, ${b.tage} ${b.tage === 1 ? 'Tag' : 'Tage'}, 80%, nicht abzugspflichtig)`, betrag: t80, frei: true, tage: b.tage })  // R2.3
    } else if (b.kat === 'k100') {
      zeilen.push({ label: `Lohnfortzahlung Krankheit (${range}, Tag 1–2, 100%)`, betrag: round2(tagessatz * b.tage), tage: b.tage })                                  // R3.2
    } else if (b.kat === 'k80') {
      zeilen.push({ label: `Lohnfortzahlung Krankheit (${range}, ${b.tage} ${b.tage === 1 ? 'Tag' : 'Tage'} ab Tag 3, 80%)`, betrag: t80, tage: b.tage })              // R3.2
    } else {
      zeilen.push({ label: `KTG-Taggeld-Ersatz (${range}, ${b.tage} ${b.tage === 1 ? 'Tag' : 'Tage'} ab Tag 31, 80%, nicht abzugspflichtig)`, betrag: t80, frei: true, tage: b.tage })  // R3.3
    }
  }

  // R2.7: Kontrollwert erwartete Rückerstattung pro Unfallfall —
  // versicherter Jahreslohn (ML × 13, max. 300'000) ÷ 365 × 0.8 × Phase-B-Tage
  const kontrollwerte: AbsenzMonat['kontrollwerte'] = []
  for (const f of faelle) {
    if (f.typ !== 'unfall') continue
    const tageB = bloecke.filter(b => b.fall === f && b.kat === 'uvg').reduce((s, b) => s + b.tage, 0)
    if (tageB === 0) continue
    const versichert = Math.min(monatslohn * 13, 300000)
    kontrollwerte.push({ beginn: f.beginn, tageB, betrag: round2((versichert / 365) * 0.8 * tageB) })
  }

  return { zeilen, gearbeitetTage, absenzTage, kalendertage, tagessatz, kontrollwerte, fehler }
}
