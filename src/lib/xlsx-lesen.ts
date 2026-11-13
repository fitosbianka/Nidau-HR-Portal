// Minimaler XLSX Leser für den TimeMoto Import: erstes Tabellenblatt als
// Zeilen von Zellen (Text). Nutzt jszip (bereits im Projekt) und liest die
// OOXML Dateien direkt: Texte aus sharedStrings, Zahlen als Zahlentext,
// Datum und Zeit bleiben Excel Seriennummern (der Import erkennt sie an der
// Spalte). Kein vollständiger Excel Parser, für Exporte aus TimeMoto genug.

import JSZip from 'jszip'

const ENTITAETEN: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }
export const xmlText = (s: string) => s
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&(amp|lt|gt|quot|apos);/g, m => ENTITAETEN[m])

/** Spaltenbuchstaben (A, B, …, AA) in einen Index ab 0. */
export function spaltenIndex(ref: string): number {
  const m = ref.match(/^[A-Z]+/)
  if (!m) return 0
  let n = 0
  for (const c of m[0]) n = n * 26 + (c.charCodeAt(0) - 64)
  return n - 1
}

function sharedStrings(xml: string | null): string[] {
  if (!xml) return []
  const out: string[] = []
  for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    const teile = si.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []
    out.push(teile.map(t => xmlText(t.replace(/^<t[^>]*>/, '').replace(/<\/t>$/, ''))).join(''))
  }
  return out
}

/** Pfad des ersten Blatts aus workbook.xml und den Beziehungen; sonst sheet1. */
async function erstesBlatt(zip: JSZip): Promise<string> {
  const wb = await zip.file('xl/workbook.xml')?.async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
  const rid = wb?.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1]
  if (rid && rels) {
    const ziel = rels.match(new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*\\bTarget="([^"]+)"`))?.[1]
      ?? rels.match(new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${rid}"`))?.[1]
    if (ziel) return ziel.startsWith('/') ? ziel.slice(1) : `xl/${ziel.replace(/^\.\//, '')}`
  }
  return 'xl/worksheets/sheet1.xml'
}

/** Erstes Tabellenblatt als Zeilen; leere Zellen sind ''. */
export async function tabelleAusXlsx(bytes: Uint8Array): Promise<string[][]> {
  const zip = await JSZip.loadAsync(bytes)
  const pfad = await erstesBlatt(zip)
  const xml = await zip.file(pfad)?.async('string')
  if (!xml) throw new Error('Im XLSX wurde kein Tabellenblatt gefunden.')
  const strings = sharedStrings((await zip.file('xl/sharedStrings.xml')?.async('string')) ?? null)
  const rows: string[][] = []
  for (const row of xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) ?? []) {
    const zeile: string[] = []
    for (const c of row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const ref = c.match(/\br="([A-Z]+)\d+"/)?.[1] ?? ''
      const idx = ref ? spaltenIndex(ref) : zeile.length
      const typ = c.match(/\bt="([^"]+)"/)?.[1] ?? ''
      let wert = ''
      if (typ === 'inlineStr') {
        wert = (c.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map(t => xmlText(t.replace(/^<t[^>]*>/, '').replace(/<\/t>$/, ''))).join('')
      } else {
        const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ''
        if (typ === 's') wert = strings[+v] ?? ''
        else if (typ === 'b') wert = v === '1' ? 'WAHR' : 'FALSCH'
        else wert = xmlText(v)
      }
      while (zeile.length < idx) zeile.push('')
      zeile[idx] = wert.trim()
    }
    rows.push(zeile)
  }
  return rows
}
