// Abzugspflichtige Krankheits-/Unfalltage für die Lohnabrechnung.
//
// Praxis-Regel: Abzug ab dem 3. Tag pro Fall, gezählt in KALENDERTAGEN
// (inkl. Wochenende). Der Arbeitsplan enthält aber nur Arbeitstage —
// darum werden K-/U-Tage zuerst zu Fällen (Episoden) zusammengefasst:
// aufeinanderfolgende markierte Tage mit höchstens 3 Kalendertagen
// Abstand (überbrückt ein Wochenende Fr→Mo) gehören zum selben Fall.
// Ein Fall dauert kalendarisch vom ersten bis zum letzten markierten
// Tag; abzugspflichtig sind die Kalendertage ab Tag 3 des Falls.

const DAY_MS = 86400000

const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const toISO = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Gruppiert markierte Tage (YYYY-MM-DD) zu Fällen. */
export function absenzEpisoden(tage: string[]): Array<{ von: string; bis: string }> {
  const sorted = Array.from(new Set(tage)).sort()
  const episoden: Array<{ von: string; bis: string }> = []
  for (const t of sorted) {
    const last = episoden[episoden.length - 1]
    if (last && (toMs(t) - toMs(last.bis)) / DAY_MS <= 3) last.bis = t
    else episoden.push({ von: t, bis: t })
  }
  return episoden
}

/** Abzugspflichtige KALENDERTAGE (ab Tag 3 pro Fall), die in den Monat
 *  YYYY-MM fallen. Fälle über Monatsgrenzen werden korrekt aufgeteilt:
 *  die ersten 2 freien Tage zählen nur einmal pro Fall. */
export function abzugsTageImMonat(tage: string[], monat: string): number {
  let n = 0
  for (const ep of absenzEpisoden(tage)) {
    const start = toMs(ep.von) + 2 * DAY_MS   // Tag 3 des Falls
    const end = toMs(ep.bis)
    for (let ms = start; ms <= end; ms += DAY_MS) {
      if (toISO(ms).startsWith(monat)) n++
    }
  }
  return n
}
