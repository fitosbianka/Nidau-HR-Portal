import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Wächter: Zürcher Wandzeit darf nirgends mehr mit einem geschätzten Offset
// («April bis Oktober = +02:00») umgerechnet werden. Alles läuft über
// src/lib/zeitzone.ts. Schlägt dieser Test an, ist die Stelle zu ersetzen
// (zurichZuIso, zurichTagesFenster, zurichMonatsStart, timemotoZeitZuDate).

const VERBOTEN: Array<{ muster: RegExp; grund: string }> = [
  { muster: /month\s*>=\s*4\s*&&\s*month\s*<=\s*10/, grund: 'Sommerzeit nach Monat geschätzt (month >= 4 && month <= 10)' },
  { muster: /getMonth\(\)\s*\+\s*1\s*>=\s*4\s*&&/, grund: 'Sommerzeit nach Monat geschätzt (getMonth() + 1 >= 4 && …)' },
  { muster: /\?\s*120\s*:\s*60\b/, grund: 'fester Offset 120 oder 60 Minuten' },
  { muster: /\?\s*'\+02:00'\s*:\s*'\+01:00'/, grund: 'fester Offset +02:00 oder +01:00' },
  { muster: /:00\$\{offset\}/, grund: 'Wandzeit mit geratenem Offset zusammengesetzt' },
]

function dateien(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') out.push(...dateien(p)) }
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

describe('Wächter Zeitzone', () => {
  it('kein Code schätzt den Zürcher Offset nach Monat, alles läuft über src/lib/zeitzone.ts', () => {
    const wurzel = join(process.cwd(), 'src')
    const treffer: string[] = []
    for (const f of dateien(wurzel)) {
      const text = readFileSync(f, 'utf8')
      for (const v of VERBOTEN) if (v.muster.test(text)) treffer.push(`${f.slice(wurzel.length + 1)}: ${v.grund}`)
    }
    expect(treffer).toEqual([])
  })
})
