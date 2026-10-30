import { describe, expect, it } from 'vitest'
import { pfaendungHinweis, pfaendungsBetrag } from '@/lib/lohn'
import { parseErinnerungAus } from '@/lib/erinnerungen'

const PF_QUOTE = 'Lohnpfändung Betreibungsamt (Netto − Existenzminimum Fr. 2\'666.00)'
const PF_NULL = 'Lohnpfändung Betreibungsamt (Netto unter Existenzminimum — Überweisung 0)'
const monat = (m: string, pf: number | null) => ({
  monat: m,
  nach: pf == null ? [] : [{ label: pf === 0 ? PF_NULL : PF_QUOTE, betrag: -pf }],
})

describe('R5.4 Lohnpfändung: Meldung ans Betreibungsamt', () => {
  it('liest den Pfändungsbetrag aus der Zeile', () => {
    expect(pfaendungsBetrag(monat('2026-10', 10.46))).toBe(10.46)
    expect(pfaendungsBetrag(monat('2026-09', 0))).toBe(0)
    expect(pfaendungsBetrag(monat('2026-08', null))).toBeNull()
    expect(pfaendungsBetrag({ nach: [{ label: 'Bereits ausbezahlt', betrag: -500 }] })).toBeNull()
  })

  it('Alessandra: September unter dem Existenzminimum, Oktober wieder 10.46 wie im August — nichts zu melden', () => {
    const list = [monat('2026-10', 10.46), monat('2026-09', 0), monat('2026-08', 10.46), monat('2026-07', 10.46)]
    expect(pfaendungHinweis(list[0], list)).toBeNull()
  })

  it('der Ausfallmonat selbst wird gemeldet (keine Überweisung), auch wenn die Zeile ganz fehlt', () => {
    const list = [monat('2026-09', 0), monat('2026-08', 10.46)]
    expect(pfaendungHinweis(list[0], list)).toEqual({ art: 'keine-ueberweisung', bisher: { monat: '2026-08', betrag: 10.46 } })
    const ohneZeile = [monat('2026-09', null), monat('2026-08', 10.46)]
    expect(pfaendungHinweis(ohneZeile[0], ohneZeile)).toEqual({ art: 'keine-ueberweisung', bisher: { monat: '2026-08', betrag: 10.46 } })
  })

  it('anderer Betrag als bisher wird gemeldet, mit dem Vergleichsmonat vor dem Ausfall', () => {
    const list = [monat('2026-10', 12.3), monat('2026-09', 0), monat('2026-08', 10.46)]
    expect(pfaendungHinweis(list[0], list)).toEqual({ art: 'anders', betrag: 12.3, bisher: { monat: '2026-08', betrag: 10.46 } })
    // 5 Rappen Toleranz
    const fast = [monat('2026-10', 10.5), monat('2026-09', 10.46)]
    expect(pfaendungHinweis(fast[0], fast)).toBeNull()
  })

  it('erstmals eine Überweisung: ohne frühere Abrechnung oder nach lauter Nullmonaten', () => {
    expect(pfaendungHinweis(monat('2026-10', 10.46), [monat('2026-10', 10.46)])).toEqual({ art: 'erstmals', betrag: 10.46 })
    const list = [monat('2026-10', 10.46), monat('2026-09', 0), monat('2026-08', 0)]
    expect(pfaendungHinweis(list[0], list)).toEqual({ art: 'erstmals', betrag: 10.46 })
    // nie etwas überwiesen und auch jetzt nichts: Meldung «keine Überweisung»
    expect(pfaendungHinweis(monat('2026-10', 0), [])).toEqual({ art: 'keine-ueberweisung', bisher: null })
  })

  it('spätere Monate zählen nicht als «bisher» (Reihenfolge der Liste egal)', () => {
    const list = [monat('2026-08', 10.46), monat('2026-11', 20), monat('2026-10', 10.46)]
    expect(pfaendungHinweis(list[2], list)).toBeNull()
  })
})

describe('Ausgeblendete Erinnerungen', () => {
  it('liest die gespeicherte Zeile tolerant, neuste zuerst', () => {
    const l = parseErinnerungAus(JSON.stringify({
      'pfaendung:p1': { label: 'Lohnpfändung A: Meldung', am: '2026-10-21T08:00:00.000Z', von: 'Bianka' },
      'lohn-faellig': { label: 'Fehlende Lohnabrechnungen', am: '2026-10-22T08:00:00.000Z', von: 'Bianka' },
      kaputt: null,
    }))
    expect(l.map(x => x.key)).toEqual(['lohn-faellig', 'pfaendung:p1'])
    expect(parseErinnerungAus(null)).toEqual([])
    expect(parseErinnerungAus('nicht json')).toEqual([])
  })
})
