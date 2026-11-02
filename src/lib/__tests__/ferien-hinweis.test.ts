import { describe, expect, it } from 'vitest'
import { parseFerienHinweis, ferienHinweisKey, FERIEN_HINWEIS_ANKER } from '@/lib/ferien-hinweis'
import { PLAN_YEAR } from '@/lib/ferien-wuensche'

describe('Ferienplanung Hinweise «Nicht mehr anzeigen»', () => {
  it('liest den Stand tolerant: nur gesetzte Zeitstempel zählen', () => {
    expect(parseFerienHinweis(null)).toEqual({ seite: false, login: false })
    expect(parseFerienHinweis('kaputt')).toEqual({ seite: false, login: false })
    expect(parseFerienHinweis('[1]')).toEqual({ seite: false, login: false })
    expect(parseFerienHinweis('{"seite":"2026-11-02T08:00:00.000Z"}')).toEqual({ seite: true, login: false })
    expect(parseFerienHinweis('{"seite":"","login":"2026-11-02T08:00:00.000Z","x":1}')).toEqual({ seite: false, login: true })
    expect(parseFerienHinweis('{"seite":true}')).toEqual({ seite: false, login: false })
  })
  it('Schlüssel pro Person und Planjahr', () => {
    expect(ferienHinweisKey('abc')).toBe('__ferien_hinweis__abc')
    expect(FERIEN_HINWEIS_ANKER).toBe(`${PLAN_YEAR}-01-01`)
  })
})
