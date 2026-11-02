import { describe, expect, it } from 'vitest'
import { monatsnotizZerlegen, kuerzelAbtrennen, datumErkennen } from '@/lib/notiz-umwandlung'
import { kuerzelFuer } from '@/lib/kuerzel'

const K = ['BF', 'DT', 'LRG', 'PD']

describe('Monatsnotiz in Tagesnotizen umwandeln', () => {
  it('Kürzel: Vor- und Nachname, feste Ausnahmen', () => {
    expect(kuerzelFuer('Bianka Fitos')).toBe('BF')
    expect(kuerzelFuer('Daniela Tschannen')).toBe('DT')
    expect(kuerzelFuer('Laura Gerisch-Rudin')).toBe('LRG')
    expect(kuerzelFuer('Fitos')).toBe('F')
    expect(kuerzelFuer('')).toBeNull()
  })
  it('trennt nur bekannte Kürzel am Zeilenende ab', () => {
    expect(kuerzelAbtrennen('Melinda nur vormittags bf', K)).toEqual({ text: 'Melinda nur vormittags', by: 'BF' })
    expect(kuerzelAbtrennen('Steri Schulung (lrg)', K)).toEqual({ text: 'Steri Schulung', by: 'LRG' })
    expect(kuerzelAbtrennen('Zorana erst ab 9.00 Uhr - DT.', K)).toEqual({ text: 'Zorana erst ab 9.00 Uhr', by: 'DT' })
    expect(kuerzelAbtrennen('Zorana erst ab 9.00 Uhr', K)).toEqual({ text: 'Zorana erst ab 9.00 Uhr', by: null })
    expect(kuerzelAbtrennen('Empfang frei', K)).toEqual({ text: 'Empfang frei', by: null })
  })
  it('erkennt Tag, Zeitraum, Wochentag, «am» und KW nur im Planmonat, nie Uhrzeiten', () => {
    expect(datumErkennen('3.12. Melinda nur vormittags', 2026, 12)).toEqual({ scope: 'day', anchor: '2026-12-03', to: null })
    expect(datumErkennen('Steri Schulung am 12. nachmittags', 2026, 12)).toEqual({ scope: 'day', anchor: '2026-12-12', to: null })
    expect(datumErkennen('Mo 1.12. - Mi 3.12. Peter Kongress?', 2026, 12)).toEqual({ scope: 'day', anchor: '2026-12-01', to: '2026-12-03' })
    expect(datumErkennen('4.–5. Dezember Betriebsferien?', 2026, 12)).toEqual({ scope: 'day', anchor: '2026-12-04', to: '2026-12-05' })
    expect(datumErkennen('7. bis 11.12. Lea Schule', 2026, 12)).toEqual({ scope: 'day', anchor: '2026-12-07', to: '2026-12-11' })
    expect(datumErkennen('Di 15. Dinusha Weiterbildung', 2026, 12)).toEqual({ scope: 'day', anchor: '2026-12-15', to: null })
    expect(datumErkennen('KW 50 Lea in der Schule', 2026, 12)).toEqual({ scope: 'week', anchor: '2026-12-07', to: null })
    expect(datumErkennen('Zorana erst ab 9.00 Uhr', 2026, 12)).toEqual({ scope: 'month', anchor: null, to: null })
    expect(datumErkennen('Sitzung 14.30 - 16.00 Uhr', 2026, 12)).toEqual({ scope: 'month', anchor: null, to: null })
    expect(datumErkennen('30.11. Übergabe', 2026, 12)).toEqual({ scope: 'month', anchor: null, to: null })
    expect(datumErkennen('KW 2 Inventur', 2026, 12)).toEqual({ scope: 'month', anchor: null, to: null })
  })
  it('zerlegt eine Monatsnotiz zeilenweise mit Aufzählungszeichen', () => {
    const items = monatsnotizZerlegen('- 3.12. Melinda nur vormittags bf\n• Steri Schulung am 12. nachmittags dt\n\nZorana erst ab 9.00 Uhr lrg\n– KW 51 Lea Schule (lrg)', 2026, 12, K)
    expect(items.map(i => [i.scope, i.anchor, i.by, i.text])).toEqual([
      ['day', '2026-12-03', 'BF', '3.12. Melinda nur vormittags'],
      ['day', '2026-12-12', 'DT', 'Steri Schulung am 12. nachmittags'],
      ['month', null, 'LRG', 'Zorana erst ab 9.00 Uhr'],
      ['week', '2026-12-14', 'LRG', 'KW 51 Lea Schule'],
    ])
    expect(items[0].original).toBe('3.12. Melinda nur vormittags bf')
  })
})
