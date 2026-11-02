import { describe, expect, it } from 'vitest'
import { teamBaender, hinweisText } from '@/lib/plan-hinweise'
import type { PlanPeriodNote } from '@/lib/plan-notes'

const n = (anchor: string, texte: string[], to: string | null = null): PlanPeriodNote =>
  ({ anchor, note: texte.join(' · '), by: null, to, eintraege: texte.map(t => ({ text: t, by: 'BF', at: null, geaendert: null })) })

describe('Hinweise für das Team', () => {
  it('Bänder: auf den Monat beschnitten, Wochen aus dem Vormonat eingeschlossen, ohne Kürzel', () => {
    const b = teamBaender({
      tage: [n('2026-11-20', ['OPS Tag']), n('2026-11-02', ['Andrea 50 %'], '2026-11-04'), n('2026-12-01', ['anderer Monat'])],
      wochen: [n('2026-10-26', ['Lea Schule']), n('2026-11-23', ['Inventur', 'Lager zu'], '2026-12-06')],
    }, 2026, 11)
    expect(b).toEqual([
      { start: 1, end: 1, note: 'Lea Schule', woche: true },
      { start: 2, end: 4, note: 'Andrea 50 %', woche: false },
      { start: 20, end: 20, note: 'OPS Tag', woche: false },
      { start: 23, end: 30, note: 'Inventur · Lager zu', woche: true },
    ])
    expect(hinweisText(n('2026-11-02', ['a', 'b']))).toBe('a · b')
  })
})
