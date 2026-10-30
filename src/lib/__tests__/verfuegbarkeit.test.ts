import { describe, expect, it } from 'vitest'
import { parseAnfragen, positionGueltig, positionText, positionZerlegen, parseVerfuegbarkeit, ergaenzeAusPlan, planPositionAnfragbar, type EinsatzAnfrage } from '@/lib/verfuegbarkeit'

describe('Einsatzanfragen (Verfügbarkeit)', () => {
  it('Positionen: dieselben Codes wie eine Plan-Zelle oder ✓', () => {
    for (const ok of ['✓', '3', '3f', '6', '7', '8s', '*', '*/7s', '6/8t', 'PA', 'HO']) expect(positionGueltig(ok), ok).toBe(true)
    for (const bad of ['', 'x', '3x', '3ff', 'Zimmer 3', '✓f']) expect(positionGueltig(bad), bad).toBe(false)
  })
  it('lesbare Positionsbezeichnung', () => {
    expect(positionText('✓')).toBe('Anwesend, Position offen')
    expect(positionText('3f')).toBe('Zimmer 3, Frühschicht')
    expect(positionText('6')).toBe('Empfang')
    expect(positionText('*/7s')).toBe('Joker / Aufträge, dann Steri, Spätschicht')
    expect(positionText('10')).toBe('Position 10')
    expect(positionZerlegen('3f')).toEqual({ basis: '3', schicht: 'f' })
    expect(positionZerlegen('*/7S')).toEqual({ basis: '*/7', schicht: 's' })
    expect(positionZerlegen('6')).toEqual({ basis: '6', schicht: '' })
    expect(positionZerlegen('✓')).toEqual({ basis: '✓', schicht: '' })
  })
  it('liest Anfragen tolerant: nur Tage im Monat, gültige Positionen, Status sonst offen, sortiert nach Datum', () => {
    const l = parseAnfragen(JSON.stringify({ anfragen: [
      { id: 'anfrage0b2', datum: '2026-11-12', position: '7', zeit: '', status: 'abgesagt', entschiedenAm: '2026-10-21T10:00:00.000Z', entschiedenVon: 'Emese Diserens', erstelltAm: '2026-10-20T08:00:00.000Z', erstelltVon: 'Bianka Fitos' },
      { id: 'anfrage0a1', datum: '2026-11-03', position: '3f', zeit: '8.00 bis 12.00 Uhr', status: 'zugesagt', bemerkung: '  erst ab 8.30 Uhr ', erstelltAm: '2026-10-20T08:00:00.000Z' },
      { id: 'anfrage0c3', datum: '2026-11-05', position: '6', status: 'irgendwas' },
      { id: 'anfrage0d4', datum: '2026-12-01', position: '6' },             // anderer Monat
      { id: 'anfrage0e5', datum: '2026-11-06', position: 'Zimmer' },        // ungültige Position
      { id: 'anfrage0a1', datum: '2026-11-07', position: '6' },             // doppelte id
      { datum: '2026-11-08', position: '6' },                       // ohne id
    ] }), 2026, 11)
    expect(l.map(a => a.id)).toEqual(['anfrage0a1', 'anfrage0c3', 'anfrage0b2'])
    expect(l[0]).toMatchObject({ datum: '2026-11-03', position: '3f', zeit: '8.00 bis 12.00 Uhr', status: 'zugesagt', bemerkung: 'erst ab 8.30 Uhr', entschiedenAm: null, erstelltVon: '' })
    expect(l[1]).toMatchObject({ status: 'offen', bemerkung: '' })
    expect(l[2]).toMatchObject({ status: 'abgesagt', entschiedenVon: 'Emese Diserens' })
    expect(parseAnfragen(null, 2026, 11)).toEqual([])
    expect(parseAnfragen('kaputt', 2026, 11)).toEqual([])
    expect(parseAnfragen('{"tage":["2026-11-03"]}', 2026, 11)).toEqual([])
  })
  it('aus dem Arbeitsplan übernehmen: nur Positionen, keine Abwesenheit, kein Home Office, Tage mit Anfrage bleiben', () => {
    for (const ok of ['3f', '6', '✓', '*/7s']) expect(planPositionAnfragbar(ok), ok).toBe(true)
    for (const bad of ['', 'F', 'K', '%', 'HO', 'HOf', 'UF', 'TE']) expect(planPositionAnfragbar(bad), bad).toBe(false)
    const bestehend: EinsatzAnfrage = { id: 'anfrage0a1', datum: '2026-11-03', position: '6', zeit: '', status: 'zugesagt', bemerkung: '', entschiedenAm: '2026-10-21T10:00:00.000Z', entschiedenVon: 'Emese Diserens', erstelltAm: '2026-10-20T08:00:00.000Z', erstelltVon: 'Bianka Fitos' }
    let n = 0
    const { liste, neu } = ergaenzeAusPlan([bestehend], [
      { datum: '2026-11-03', position: '3f' },     // schon angefragt (andere Position): bleibt, wie sie ist
      { datum: '2026-11-05', position: 'F' },      // Ferien: nicht anfragbar
      { datum: '2026-11-06', position: '7s|alt' }, // Legacy zweiter Teil wird ignoriert
      { datum: '2026-11-04', position: '6' },
      { datum: '2026-12-01', position: '6' },      // anderer Monat
      { datum: '2026-11-10', position: '' },
    ], 2026, 11, () => `neu${String(++n).padStart(6, '0')}`, '2026-10-21T12:00:00.000Z', 'Bianka Fitos')
    expect(neu).toBe(2)
    expect(liste.map(a => [a.datum, a.position, a.status])).toEqual([
      ['2026-11-03', '6', 'zugesagt'], ['2026-11-04', '6', 'offen'], ['2026-11-06', '7s', 'offen'],
    ])
    expect(liste[0]).toBe(bestehend)
    expect(liste[1]).toMatchObject({ erstelltVon: 'Bianka Fitos', zeit: '', entschiedenAm: null })
    expect(ergaenzeAusPlan(liste, [{ datum: '2026-11-04', position: '6' }], 2026, 11, () => 'x', '', '').neu).toBe(0)
  })
  it('Verfügbarkeit und Anfragen liegen in getrennten Zeilen: die Verfügbarkeit kennt keine Anfragen', () => {
    const v = parseVerfuegbarkeit('{"tage":["2026-11-03","2026-11-40"],"notiz":" nur vormittags ","anfragen":[{"id":"x"}]}', 2026, 11)
    expect(v).toEqual({ tage: ['2026-11-03'], notiz: 'nur vormittags', aktualisiertAm: null })
  })
})
