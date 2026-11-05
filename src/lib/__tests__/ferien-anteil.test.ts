import { describe, expect, it } from 'vitest'
import {
  ANTEIL_STANDARD, anteilAm, anteilAus, anteilAuswirkung, anteilRegelFuer, anteilSumme, anteilText, baueAnteilKarte, ferienGewicht,
  isoWochentag, normalisierePerioden, parseAnteilRows, type AnteilRegel,
} from '@/lib/ferien-anteil'
import { buildDayGroups, absenceCredit, KOMP_MIN } from '@/lib/zeiterfassung-report'
import { wochen2027, wochenTage, wunschKosten, ferientageZaehlen, type Woche } from '@/lib/ferien-wochen'

/** Annegret: 50 Prozent, halbe Tage Mo bis Mi, ganzer Do, Fr frei (in Kehrsatz als Namensstandard hinterlegt) */
const ANNEGRET: AnteilRegel = { perioden: [{ ab: '2026-04-01', bis: null, anteile: { '1': 0.5, '2': 0.5, '3': 0.5, '4': 1, '5': 0 } }] }
const STANDARD_HINTERLEGT = !!ANTEIL_STANDARD['Annegret Schmid']
const kw = (n: number): Woche => wochen2027().find(w => w.kw === n)!

describe('Ferienanteil pro Wochentag', () => {
  it.skipIf(!STANDARD_HINTERLEGT)('Namensstandard für Annegret: halbe Tage Mo bis Mi, ganzer Do, Fr frei, seit April 2026, auch für Namensvarianten', () => {
    expect(ANTEIL_STANDARD['Annegret Schmid']).toEqual(ANNEGRET)
    expect(anteilRegelFuer('Annegret Schmid')).toEqual(ANNEGRET)
    expect(anteilRegelFuer('Annegret Schmid-Muster')).toEqual(ANNEGRET)   // Namensvariante
    expect(anteilRegelFuer('Daniela Tschannen')).toBeNull()
    expect(anteilAus(undefined, 'Annegret Schmid')).toEqual(ANNEGRET)      // ohne Karte der Namensstandard
    const absences = { '2026-09-07': 'F', '2026-09-10': 'F' }
    expect(buildDayGroups([], absences, '2026-09-07', '2026-09-11', 'Annegret Schmid').map(t => t.fWeight)).toEqual([0.5, 1])
  })

  it('Anteile: Summe 2,5 = 50 Prozent, Text, Anteil pro Datum', () => {
    expect(anteilSumme(ANNEGRET.perioden[0].anteile)).toBe(2.5)
    expect(anteilText(ANNEGRET.perioden[0].anteile)).toBe('Mo 0,5 · Di 0,5 · Mi 0,5 · Do 1 · Fr 0')
    // 2026-09-07 ist ein Montag, 2026-09-10 ein Donnerstag, 2026-09-11 ein Freitag
    expect(isoWochentag('2026-09-07')).toBe(1)
    expect(anteilAm(ANNEGRET, '2026-09-07')).toBe(0.5)
    expect(anteilAm(ANNEGRET, '2026-09-10')).toBe(1)
    expect(anteilAm(ANNEGRET, '2026-09-11')).toBe(0)
    expect(anteilAm(ANNEGRET, '2026-09-12')).toBe(0)        // Samstag
    expect(anteilAm(ANNEGRET, '2026-03-30')).toBeNull()     // vor April: keine Regel
    expect(anteilAm(null, '2026-09-07')).toBeNull()
  })

  it('Gewicht eines Eintrags: glattes F den Anteil, F:x sein Gewicht, ohne Regel 1', () => {
    expect(ferienGewicht('F', ANNEGRET, '2026-09-07')).toBe(0.5)
    expect(ferienGewicht('F', ANNEGRET, '2026-09-10')).toBe(1)
    expect(ferienGewicht('F', ANNEGRET, '2026-09-11')).toBe(0)
    expect(ferienGewicht('F:0.8', ANNEGRET, '2026-09-07')).toBe(0.8)
    expect(ferienGewicht('F', null, '2026-09-07')).toBe(1)
    expect(ferienGewicht('F', ANNEGRET, '2026-03-02')).toBe(1)   // vor der Periode wie bisher
    expect(ferienGewicht('KO', ANNEGRET, '2026-09-07')).toBeNull()
  })

  it('gespeicherte Zeilen: gültige Perioden, leere Liste heisst bewusst keine Regel, Karte nach ID und Namen', () => {
    const rows = [
      { user_full_name: '__ferien_anteil__p1', comment: JSON.stringify({ perioden: [{ ab: '2026-04-01', bis: null, anteile: { '1': 0.5, '2': 0.5, '3': 0.5, '4': 1, '5': 0 } }] }) },
      { user_full_name: '__ferien_anteil__p2', comment: JSON.stringify({ perioden: [] }) },
      { user_full_name: '__ferien_anteil__p3', comment: 'kaputt' },
      { user_full_name: '__ferien_regeln__', comment: '{}' },
    ]
    const g = parseAnteilRows(rows)
    expect(Object.keys(g).sort()).toEqual(['p1', 'p2'])
    expect(anteilRegelFuer('Jemand', g.p1)?.perioden[0].anteile['4']).toBe(1)
    expect(anteilRegelFuer('Annegret Schmid', g.p2)).toBeNull()        // gespeichert «keine Regel» schlägt den Standard
    const karte = baueAnteilKarte([{ id: 'p1', full_name: 'Jemand Neu' }, { id: 'p2', full_name: 'Annegret Schmid' }, { id: 'p4', full_name: 'Ohne Regel' }], g)
    expect(Object.keys(karte).sort()).toEqual(['Jemand Neu', 'p1'])
    expect(anteilAus(karte, 'p1')).toBe(karte['Jemand Neu'])
    expect(anteilAus(karte, 'Jemand Neu-Alt')).toBe(karte.p1)
    expect(anteilAus(karte, 'Annegret Schmid')).toBeNull()             // Karte ist massgebend
    expect(anteilAus(undefined, 'Ohne Regel')).toBeNull()
  })

  it('prüft Eingaben: Datum, Reihenfolge, Überschneidung, Anteile 0 bis 1', () => {
    const a = { '1': 0.5, '2': 0.5, '3': 0.5, '4': 1, '5': 0 }
    expect('error' in normalisierePerioden([{ ab: '2026-4-1', bis: null, anteile: a }])).toBe(true)
    expect('error' in normalisierePerioden([{ ab: '2026-04-01', bis: '2026-03-01', anteile: a }])).toBe(true)
    expect('error' in normalisierePerioden([{ ab: '2026-04-01', bis: null, anteile: a }, { ab: '2027-01-01', bis: null, anteile: a }])).toBe(true)
    const ok = normalisierePerioden([{ ab: '2027-01-01', bis: null, anteile: a }, { ab: '2026-04-01', bis: '2026-12-31', anteile: { '1': 2, '4': 1 } }])
    expect('perioden' in ok && ok.perioden.map(p => p.ab)).toEqual(['2026-04-01', '2027-01-01'])
    expect('perioden' in ok && ok.perioden[0].anteile).toEqual({ '1': 0, '2': 0, '3': 0, '4': 1, '5': 0 })   // 2 ist ungültig, fehlend ist 0
  })

  it('Zeiterfassung: ein F am Montag zählt 0,5 Tage und 4.15 Stunden, am Donnerstag 1 Tag und 8.30, am Freitag nichts', () => {
    const absences = { '2026-09-07': 'F', '2026-09-08': 'F', '2026-09-09': 'F', '2026-09-10': 'F', '2026-09-11': 'F' }
    const karte = { a1: ANNEGRET, 'Annegret Schmid': ANNEGRET }
    const tage = buildDayGroups([], absences, '2026-09-07', '2026-09-11', 'Annegret Schmid', karte)
    expect(tage.map(t => t.fWeight)).toEqual([0.5, 0.5, 0.5, 1, 0])
    expect(tage.reduce((s, t) => s + absenceCredit(t.absence, t.dayTotal, t.fWeight ?? 1), 0)).toBe(Math.round(KOMP_MIN * 2.5))   // 21.15 Stunden = Wochensoll bei 50 Prozent
    expect(tage.reduce((s, t) => s + (t.fWeight ?? 1), 0)).toBe(2.5)
    // ohne Regel bleibt es bei 1 pro Tag
    expect(buildDayGroups([], absences, '2026-09-07', '2026-09-11', 'Daniela Tschannen').map(t => t.fWeight)).toEqual([1, 1, 1, 1, 1])
    // eine gespeicherte Karte ist massgebend, auch wenn sie leer ist
    expect(buildDayGroups([], absences, '2026-09-07', '2026-09-11', 'Annegret Schmid', {}).map(t => t.fWeight)).toEqual([1, 1, 1, 1, 1])
  })

  it('Ferienplanung 2027: Montag bis Donnerstag kosten 2,5 Tage, ein Donnerstag 1, ein Montag 0,5, die ganze Woche 2,5', () => {
    const w = kw(30)
    const moBisDo = w.arbeitstage.slice(0, 4)
    expect(ferientageZaehlen(moBisDo.map(datum => ({ datum, gewicht: 1 })), 50, ANNEGRET)).toBe(2.5)
    expect(ferientageZaehlen(moBisDo.map(datum => ({ datum, gewicht: 1 })), 50)).toBe(3)              // bisher: Deckel aufgerundet
    expect(ferientageZaehlen([{ datum: w.arbeitstage[3], gewicht: 1 }], 50, ANNEGRET)).toBe(1)
    expect(ferientageZaehlen([{ datum: w.arbeitstage[0], gewicht: 1 }], 50, ANNEGRET)).toBe(0.5)
    expect(ferientageZaehlen([{ datum: w.arbeitstage[0], gewicht: 0.8 }], 50, ANNEGRET)).toBe(0.8)   // explizites Gewicht bleibt
    expect(wochenTage(w, 50, ANNEGRET)).toBe(2.5)
    expect(wochenTage(w, 50)).toBe(2.5)
    expect(wunschKosten({ from: w.montag, to: w.freitag, tage: moBisDo, quelle: 'woche' }, w, 50, ANNEGRET)).toBe(2.5)
    expect(wunschKosten({ from: w.montag, to: w.freitag, tage: null, quelle: 'woche' }, w, 50, ANNEGRET)).toBe(2.5)
    // 2026: auch vor der tagesgenauen Zählung zählt der Anteil
    expect(ferientageZaehlen([{ datum: '2026-09-07', gewicht: 1 }, { datum: '2026-09-10', gewicht: 1 }], 50, ANNEGRET)).toBe(1.5)
  })

  it('Liste der korrigierten Tage: alle F-Tage mit altem und neuem Wert, geändert markiert', () => {
    const regel: AnteilRegel = ANNEGRET
    const eintraege = [
      { schedule_date: '2026-09-07', entry: 'F' }, { schedule_date: '2026-09-10', entry: 'F' }, { schedule_date: '2026-09-11', entry: 'F' },
      { schedule_date: '2026-09-14', entry: 'F:0.5' }, { schedule_date: '2026-09-15', entry: 'KO' }, { schedule_date: '2026-03-02', entry: 'F' },
    ]
    const liste = anteilAuswirkung(eintraege, regel)
    expect(liste.map(a => [a.datum, a.alt, a.neu, a.geaendert])).toEqual([
      ['2026-03-02', 1, 1, false],
      ['2026-09-07', 1, 0.5, true],
      ['2026-09-10', 1, 1, false],
      ['2026-09-11', 1, 0, true],
      ['2026-09-14', 0.5, 0.5, false],
    ])
    expect(liste.filter(a => a.datum.startsWith('2026-09')).reduce((s, a) => s + a.neu, 0)).toBe(2)   // Monatssumme neu
    expect(anteilAuswirkung(eintraege, null).every(a => !a.geaendert)).toBe(true)
  })
})
