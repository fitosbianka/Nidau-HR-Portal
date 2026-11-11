import { describe, expect, it } from 'vitest'
import { anspruchTageFor, herleitungText, ferienAnspruchFor } from '@/lib/ferien-anspruch'
import { parseAnspruchRows } from '@/lib/ferien-wochen'

describe('Ferienanspruch: Wochen × 5 Tage × Pensum plus Korrektur', () => {
  it('Praxisregel: 5 Wochen, bei 60 Prozent 15 Tage; Dinusha 6 Wochen bei 80 Prozent 24 Tage; Valérie ohne Kontingent', () => {
    const laura = anspruchTageFor('Laura Gerisch-Rudin', 60)
    expect(laura).toMatchObject({ tage: 15, wochen: 5, basisTage: 15, korrektur: 0, pensumProzent: 60, fest: false, angepasst: false })
    expect(herleitungText(laura)).toBe('5 Wochen × 5 Tage × 60 % = 15 Tage')
    const dinusha = anspruchTageFor('Dinusha Atapattu', 80)
    expect(dinusha.tage).toBe(24)
    expect(herleitungText(dinusha)).toBe('6 Wochen × 5 Tage × 80 % = 24 Tage. 5 Wochen + 1 Geschenkwoche zum 10-Jahre-Jubiläum in der Praxis 🎉')
    expect(anspruchTageFor('Valérie Diserens', 100).tage).toBeNull()
    expect(herleitungText(anspruchTageFor('Valérie Diserens', 100))).toBe('Ohne festes Kontingent')
    expect(ferienAnspruchFor('Jemand Neu').wochen).toBe(5)
    expect(anspruchTageFor('Alessandra Diaz', 50).tage).toBe(12.5)
  })
  it('Anpassung durch den Admin: Wochen und Korrektur, Rechnung passt sich an', () => {
    const a = anspruchTageFor('Laura Gerisch-Rudin', 60, { wochen: 6, korrektur: 1.15 })
    expect(a).toMatchObject({ tage: 19.15, wochen: 6, basisTage: 18, korrektur: 1.15, angepasst: true, fest: false })
    expect(herleitungText(a)).toBe('6 Wochen × 5 Tage × 60 % = 18 Tage, + 1,15 Tage Korrektur = 19,15 Tage (durch Admin angepasst)')
    const minus = anspruchTageFor('Anita Trachsel', 80, { korrektur: -2 })
    expect(minus.tage).toBe(18)
    expect(herleitungText(minus)).toBe('5 Wochen × 5 Tage × 80 % = 20 Tage, − 2 Tage Korrektur = 18 Tage (durch Admin angepasst)')
    expect(anspruchTageFor('Laura Gerisch-Rudin', 60, { wochen: null }).tage).toBeNull()
    // ohne Pensum im Profil rechnet die Regel mit 100 Prozent
    expect(anspruchTageFor('Jemand Neu', null, { wochen: 4 }).tage).toBe(20)
  })
  it('älterer fester Wert in Tagen überschreibt die Rechnung, auch als Zahl übergeben', () => {
    expect(anspruchTageFor('Laura Gerisch-Rudin', 60, { tage: 16 })).toMatchObject({ tage: 16, fest: true, angepasst: true })
    expect(anspruchTageFor('Laura Gerisch-Rudin', 60, 16).tage).toBe(16)
    expect(anspruchTageFor('Laura Gerisch-Rudin', 60, null).tage).toBeNull()
    expect(herleitungText(anspruchTageFor('Laura Gerisch-Rudin', 60, { tage: 16 }))).toBe('16 Tage, durch Admin fest gesetzt')
  })
  it('liest neue und alte Anpassungszeilen', () => {
    const rows = [
      { user_full_name: '__ferien_anspruch__a', comment: JSON.stringify({ wochen: 6, korrektur: 1, von: 'Bianka', am: '' }) },
      { user_full_name: '__ferien_anspruch__b', comment: JSON.stringify({ tage: 15 }) },
      { user_full_name: '__ferien_anspruch__c', comment: JSON.stringify({ tage: null }) },
      { user_full_name: '__ferien_anspruch__d', comment: JSON.stringify({ wochen: null, korrektur: 0 }) },
      { user_full_name: '__ferien_anspruch__e', comment: JSON.stringify({ wochen: 99 }) },   // ausserhalb: keine Anpassung
      { user_full_name: '__ferien_wochenfarbe__', comment: '{"farbe":"rot"}' },
    ]
    const g = parseAnspruchRows(rows)
    expect(g.a).toEqual({ wochen: 6, korrektur: 1 })
    expect(g.b).toEqual({ tage: 15 })
    expect(g.c).toEqual({ tage: null })
    expect(g.d).toEqual({ wochen: null })
    expect(g.e).toBeUndefined()
    expect(anspruchTageFor('Laura Gerisch-Rudin', 60, g.a).tage).toBe(19)
    expect(anspruchTageFor('Laura Gerisch-Rudin', 60, g.c).tage).toBeNull()
  })
})
