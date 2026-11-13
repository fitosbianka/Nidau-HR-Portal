// Text mit Positionen aus einem PDF (pdfjs, nur auf dem Server). Liefert pro
// Seite die Zeilen mit ihren Wörtern und x Positionen, von oben nach unten;
// daraus liest der Timesheet Parser die Spalten anhand der Kopfzeile.

import type { PdfSeite, PdfWort } from './timemoto-timesheet'

/** Wörter einer Seite in Zeilen gruppieren (gleiche Höhe, Toleranz in Punkt). */
export function zeilenAusWoertern(woerter: PdfWort[], toleranz = 3): PdfSeite {
  const sortiert = [...woerter].filter(w => w.s.trim()).sort((a, b) => a.y - b.y || a.x - b.x)
  const zeilen: PdfSeite = []
  for (const w of sortiert) {
    const letzte = zeilen[zeilen.length - 1]
    if (letzte && Math.abs(letzte.y - w.y) <= toleranz) letzte.woerter.push(w)
    else zeilen.push({ y: w.y, woerter: [w] })
  }
  for (const z of zeilen) z.woerter.sort((a, b) => a.x - b.x)
  return zeilen
}

/** Alle Seiten eines PDFs als Zeilen mit Wörtern (y von oben, x von links, Punkt). */
export async function pdfSeiten(bytes: Uint8Array): Promise<PdfSeite[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false, verbosity: 0 })
  const doc = await task.promise
  const seiten: PdfSeite[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const hoehe = page.getViewport({ scale: 1 }).height
      const inhalt = await page.getTextContent()
      const woerter: PdfWort[] = []
      for (const it of inhalt.items) {
        if (!('str' in it) || !it.str.trim()) continue
        const t = it.transform as number[]
        woerter.push({ x: t[4], y: hoehe - t[5], w: it.width, s: it.str.replace(/\s+/g, ' ').trim() })
      }
      seiten.push(zeilenAusWoertern(woerter))
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  return seiten
}

export const istPdf = (bytes: Uint8Array, name = '') =>
  (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) || /\.pdf$/i.test(name)
