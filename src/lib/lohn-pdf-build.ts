// Serverseitiger Aufbau EINES Lohnabrechnungs-PDFs — gemeinsame Logik für
// den Einzel-Export (/api/admin/lohn-pdf) und den Monats-Sammelexport
// (/api/admin/lohn-monat-pdf), damit beide Wege rappengenau identisch sind.

import { generateLohnPdf } from '@/lib/pdf/hr-pdfs.mjs'
import { berechneLohn, fmtLohnChf, type LohnAbrechnung, type LohnSaetze } from '@/lib/lohn'

export type LohnPdfProfil = {
  id: string
  full_name: string
  address: string | null
  ahv_nummer: string | null
  pensum: number | null
  job_title: string | null
}

export type LohnPdfDaten = Pick<
  LohnAbrechnung,
  'titel' | 'periode' | 'monat' | 'lines' | 'zulagen' | 'nach' | 'ahv' | 'alv' | 'nbu' | 'ktg' | 'pkAbzug' | 'qstSatz' | 'deckelMonate' | 'manuell'
> & { qstTarif?: string | null }

const pct = (v: number) => `${(Math.round(v * 1000000) / 10000).toString()}%`

export async function buildLohnPdf(e: LohnPdfProfil, abrData: LohnPdfDaten, saetze: LohnSaetze): Promise<Uint8Array> {
  const calc = berechneLohn(abrData, saetze)

  // Basis/Satz-Spalten direkt aus der Engine: die Basis ist die EFFEKTIVE
  // Abzugsbasis (Brutto minus Taggeld-Ersatz, ggf. ALV/NBU-gedeckelt), nie
  // das volle Brutto (R4.3). Rendertest: angezeigte Basis × Satz muss den
  // angezeigten Betrag ergeben (Toleranz 5 Rappen) — sonst bricht der
  // Export mit einem Fehler ab, statt eine falsche Abrechnung auszugeben.
  const abzuege = calc.abzuege.map(a => {
    // Von Hand überschriebene Beträge gelten wie eingegeben (wie im Excel)
    if (a.basis != null && a.satz != null && !a.manuell) {
      const soll = Math.round(a.basis * a.satz * 100) / 100
      if (Math.abs(soll - Math.abs(a.betrag)) > 0.05) {
        throw new Error(
          `Basis-Kontrolle fehlgeschlagen bei «${a.label}»: Basis ${fmtLohnChf(a.basis)} × Satz ` +
          `ergibt ${fmtLohnChf(soll)}, ausgewiesen ist ${fmtLohnChf(Math.abs(a.betrag))}.`,
        )
      }
    }
    return {
      label: a.label,
      basisChf: a.basis != null ? fmtLohnChf(a.basis) : '',
      satzPct: a.satz != null ? pct(a.satz) : '',
      chf: fmtLohnChf(a.betrag),
    }
  })

  const addressLines = (e.address ?? '').split(/[\n,]/).map(s => s.trim()).filter(Boolean)
  const bgLabel = abrData.titel === 'Umsatzabrechnung' ? 'Umsatzlohn'
    : e.pensum != null ? `${e.pensum}%` : null

  return generateLohnPdf({
    titel: abrData.titel,
    periode: abrData.periode,
    name: e.full_name,
    anrede: null,
    adresse: addressLines[0] ?? null,
    plzOrt: addressLines.slice(1).join(', ') || null,
    ahvNr: e.ahv_nummer,
    bgLabel,
    bank: null,
    erstelltAm: new Date().toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' }),
    lines: abrData.lines.map(l => ({ label: l.label, chf: fmtLohnChf(l.betrag) })),
    bruttoChf: fmtLohnChf(calc.brutto),
    zulagen: abrData.zulagen.map(l => ({ label: l.label, chf: fmtLohnChf(l.betrag) })),
    zulagenTotalChf: fmtLohnChf(calc.zulagenTotal),
    abzuege,
    abzugTotalChf: fmtLohnChf(calc.abzugTotal + calc.qstBetrag),
    qst: abrData.qstSatz || calc.qstBetrag !== 0
      ? { label: `Quellensteuer${abrData.qstTarif ? ` (Tarif ${abrData.qstTarif})` : ''}`, satzPct: calc.qst.satzPct != null ? `${Math.round(calc.qst.satzPct * 10000) / 10000}%` : '', chf: fmtLohnChf(calc.qstBetrag) }
      : null,
    nach: abrData.nach.map(l => ({ label: l.label, chf: fmtLohnChf(l.betrag) })),
    auszahlungChf: fmtLohnChf(calc.auszahlung),
  })
}
