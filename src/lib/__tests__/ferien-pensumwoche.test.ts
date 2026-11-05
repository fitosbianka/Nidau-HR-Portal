import { describe, expect, it } from 'vitest'
import { pensumWocheGewichte, ferienPruefung, montagVon } from '@/lib/ferien-pensumwoche'
import { buildDayGroups, absenceCredit, KOMP_MIN } from '@/lib/zeiterfassung-report'
import { istFeiertag } from '@/lib/feiertage'
import type { AnteilRegel } from '@/lib/ferien-anteil'

// KW 37 2026: Montag 7. bis Freitag 11. September, keine Feiertage
const WOCHE = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']
const block = (tage: string[], code = 'F') => Object.fromEntries(tage.map(d => [d, code]))
const ANNEGRET: AnteilRegel = { perioden: [{ ab: '2026-04-01', bis: null, anteile: { '1': 0.5, '2': 0.5, '3': 0.5, '4': 1, '5': 0 } }] }

describe('Pensumwoche: eine ganz mit F belegte Woche zählt bei Teilzeit nach Pensum', () => {
  it('60 Prozent, F Montag bis Freitag: jeder Tag F:0.6, zusammen 3 Tage und 25.30 Stunden', () => {
    const g = pensumWocheGewichte(block(WOCHE), 0.6)
    expect(WOCHE.map(d => g[d])).toEqual(['F:0.6', 'F:0.6', 'F:0.6', 'F:0.6', 'F:0.6'])
    const tage = buildDayGroups([], g, '2026-09-01', '2026-09-30', 'Jemand Teilzeit')   // nicht Laura: ihr September läuft als Minusstunden
    expect(tage.reduce((s, t) => s + (t.fWeight ?? 1), 0)).toBe(3)
    expect(tage.reduce((s, t) => s + absenceCredit(t.absence, t.dayTotal, t.fWeight ?? 1), 0)).toBe(Math.round(KOMP_MIN * 0.6) * 5)   // 25.30 h statt 42.30 h
  })
  it('Alessandra 50 Prozent: ganze Woche 2,5 Tage und 21.15 Stunden, drei einzelne Tage zählen drei Tage', () => {
    const ganz = pensumWocheGewichte(block(WOCHE), 0.5)
    expect(Object.values(ganz).every(v => v === 'F:0.5')).toBe(true)
    const tage = buildDayGroups([], ganz, '2026-09-07', '2026-09-11', 'Alessandra Diaz')
    expect(tage.reduce((s, t) => s + (t.fWeight ?? 1), 0)).toBe(2.5)
    expect(tage.reduce((s, t) => s + absenceCredit(t.absence, t.dayTotal, t.fWeight ?? 1), 0)).toBe(Math.round(KOMP_MIN * 2.5))
    const drei = block([WOCHE[0], WOCHE[1], WOCHE[4]])
    expect(pensumWocheGewichte(drei, 0.5)).toEqual(drei)
  })
  it('lässt 100 Prozent, explizite Gewichte, andere Codes und Tage mit Ferienanteil unverändert', () => {
    const a = block(WOCHE)
    expect(pensumWocheGewichte(a, 1)).toBe(a)
    expect(pensumWocheGewichte(a, null)).toBe(a)
    const mitGewicht = { ...block(WOCHE), '2026-09-09': 'F:0.8' }
    expect(pensumWocheGewichte(mitGewicht, 0.6)['2026-09-09']).toBe('F:0.8')
    const mitKrank = { ...block(WOCHE), '2026-09-09': 'K' }
    expect(pensumWocheGewichte(mitKrank, 0.6)).toEqual(mitKrank)   // keine ganze F-Woche
    expect(pensumWocheGewichte(block(WOCHE), 0.5, ANNEGRET)).toEqual(block(WOCHE))   // Annegret: Ferienanteil gilt
  })
  it('Woche mit Feiertag: Auffahrt 2026 am Donnerstag, vier Arbeitstage F sind eine ganze Woche (2,4 Tage bei 60 Prozent)', () => {
    expect(istFeiertag('2026-05-14')).toBe(true)
    const w = ['2026-05-11', '2026-05-12', '2026-05-13', '2026-05-15']
    const g = pensumWocheGewichte(block(w), 0.6)
    expect(w.map(d => g[d])).toEqual(['F:0.6', 'F:0.6', 'F:0.6', 'F:0.6'])
    expect(montagVon('2026-05-15')).toBe('2026-05-11')
  })
  it('wirkt pro Kalenderwoche, auch über den Monatswechsel (Montag 28.9. bis Freitag 2.10.)', () => {
    const w = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']
    const g = pensumWocheGewichte(block(w), 0.8)
    expect(w.map(d => g[d])).toEqual(['F:0.8', 'F:0.8', 'F:0.8', 'F:0.8', 'F:0.8'])
    // nur den Oktober gruppieren: die zwei Oktobertage tragen trotzdem das Wochengewicht
    expect(buildDayGroups([], g, '2026-10-01', '2026-10-31', 'Jemand').map(t => t.fWeight)).toEqual([0.8, 0.8])
  })
})

describe('Prüfung Ferientage Teilzeit', () => {
  const zeitraum = { from: '2026-07-01', to: '2026-11-05' }
  it('ganze Woche F bei 60 Prozent: Hinweis Pensumwoche mit bisher 5 und neu 3', () => {
    const [w] = ferienPruefung({ absences: block(WOCHE), faktor: 0.6, ...zeitraum })
    expect(w.montag).toBe('2026-09-07')
    expect(w.arten).toEqual(['pensumwoche'])
    expect(w.bisher).toBe(5); expect(w.neu).toBe(3); expect(w.erlaubt).toBe(3)
  })
  it('mehr F-Tage als das Pensum ergibt, ohne ganze Woche: Hinweis zuviel, Zählung bleibt', () => {
    const [w] = ferienPruefung({ absences: block(WOCHE.slice(0, 4)), faktor: 0.6, ...zeitraum })
    expect(w.arten).toEqual(['zuviel'])
    expect(w.bisher).toBe(4); expect(w.neu).toBe(4)
    // drei Tage bei 60 Prozent oder drei Tage bei Alessandra: nichts zu melden
    expect(ferienPruefung({ absences: block(WOCHE.slice(0, 3)), faktor: 0.6, ...zeitraum })).toEqual([])
    expect(ferienPruefung({ absences: block([WOCHE[0], WOCHE[1], WOCHE[4]]), faktor: 0.5, ...zeitraum })).toEqual([])
  })
  it('F an einem freien Tag laut Standardwoche (Schultag der Lernenden, % der Assistenz), auch bei 100 Prozent', () => {
    const lernende = ferienPruefung({ absences: block([WOCHE[4]]), faktor: 0.8, standardwoche: { '1': '✓', '2': '✓', '3': '✓', '4': '✓', '5': 'S' }, ...zeitraum })
    expect(lernende[0].arten).toEqual(['freier_tag'])
    expect(lernende[0].tage[0].frei).toBe(true)
    const voll = ferienPruefung({ absences: block([WOCHE[2]]), faktor: 1, standardwoche: { '3': '%' }, ...zeitraum })
    expect(voll[0].arten).toEqual(['freier_tag'])
    // Home Office ist ein Arbeitstag, leer ist keine Vorgabe
    expect(ferienPruefung({ absences: block([WOCHE[0], WOCHE[1]]), faktor: 0.8, standardwoche: { '1': 'HO', '2': '' }, ...zeitraum })).toEqual([])
  })
  it('Ferienanteil pro Wochentag: keine Pensumwoche, die Tage zählen ihren Anteil', () => {
    expect(ferienPruefung({ absences: block(WOCHE), faktor: 0.5, regel: ANNEGRET, ...zeitraum })).toEqual([])
    expect(ferienPruefung({ absences: block(WOCHE), faktor: 1, ...zeitraum })).toEqual([])   // 100 Prozent, ganze Woche ist normal
  })
  it('zeigt nur Wochen im Zeitraum', () => {
    expect(ferienPruefung({ absences: block(['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06']), faktor: 0.6, ...zeitraum })).toEqual([])
  })
})
