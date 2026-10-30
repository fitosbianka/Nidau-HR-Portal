import { describe, expect, it } from 'vitest'
import { fritzDonnerstage2026, externeEinsaetze, parseStatusRows, vereinbarteEinsaetze, istAlteVereinbarung, datumLang, zeitText } from '@/lib/externe-einsaetze'
import { FRITZ } from '@/lib/ferien-regeln'

describe('Einsätze von Fritz', () => {
  it('Donnerstage im November und Dezember 2026, ohne 24.12. und 31.12., ohne feste Einsätze 2027', () => {
    expect(fritzDonnerstage2026()).toEqual(['2026-11-05', '2026-11-12', '2026-11-19', '2026-11-26', '2026-12-03', '2026-12-10', '2026-12-17'])
    const v = vereinbarteEinsaetze(FRITZ)
    expect(v).toHaveLength(7)
    expect(v.every(e => e.von === null && e.bis === null && e.datum.startsWith('2026'))).toBe(true)
    expect(vereinbarteEinsaetze('Jemand Anders')).toEqual([])
  })
  it('Vertretungswochen 2027: Dienstag und Donnerstag 13 bis 17 Uhr mit dem Namen der vertretenen Person', () => {
    const liste = externeEinsaetze({
      name: FRITZ, gespeichert: [],
      // KW 6 2027: Montag 08.02., Vertretung für Valérie Montag bis Mittwoch, dazu eine fremde Vertretung
      vertretungen: [{ employeeId: 'z1', date: '2027-02-08', name: FRITZ }, { employeeId: 'z1', date: '2027-02-10', name: FRITZ }, { employeeId: 'z2', date: '2027-02-08', name: 'Jemand' }],
      namen: { z1: 'Valérie Test' }, status: new Map(),
    })
    const vt = liste.filter(e => e.art === 'vertretung')
    expect(vt.map(e => e.datum)).toEqual(['2027-02-09', '2027-02-11'])
    expect(vt.every(e => e.von === '13:00' && e.bis === '17:00' && e.titel === 'Vertretung für Valérie Test' && e.quelle === 'vertretung')).toBe(true)
    expect(liste.filter(e => e.datum.startsWith('2027'))).toHaveLength(2)
  })
  it('gespeicherte Einsätze übersteuern am selben Tag die Zeit, Status wird zugeordnet, alte Vereinbarung erkannt', () => {
    const status = parseStatusRows([
      { schedule_date: '2026-11-05', comment: JSON.stringify({ status: { 'fritz-2026-11-05': 'erledigt' } }) },
      { schedule_date: '2026-11-12', comment: JSON.stringify({ status: { 'fritz-2026-11-12': 'abgesagt' } }) },
      { schedule_date: '2026-11-19', comment: JSON.stringify({ erledigt: { 'fritz-2026-11-19': { am: 'x', von: 'y' } } }) },
    ])
    const liste = externeEinsaetze({
      name: FRITZ,
      gespeichert: [
        { id: 'fritz-2026-11-05', datum: '2026-11-05', name: FRITZ, kategorie: 'ZAZ', von: '08:00', bis: '12:00', assistenz: true },
        { id: 'vt-2027-02-09', datum: '2027-02-09', name: FRITZ, kategorie: 'ZAZ', von: '14:00', bis: '18:00', assistenz: true },
        { id: 'fritz-2027-03-02', datum: '2027-03-02', name: FRITZ, kategorie: 'ZAZ', von: '13:00', bis: '17:00', assistenz: true },
        { id: 'x', datum: '2027-03-03', name: 'Andere Person', kategorie: 'ZAZ', von: '08:00', bis: '12:00', assistenz: true },
      ],
      vertretungen: [{ employeeId: 'z1', date: '2027-02-08', name: FRITZ }],
      namen: { z1: 'Valérie Test' }, status,
    })
    const do5 = liste.find(e => e.datum === '2026-11-05')!
    expect(do5.von).toBe('08:00'); expect(do5.quelle).toBe('gespeichert'); expect(do5.status).toBe('erledigt')
    expect(liste.find(e => e.datum === '2026-11-12')?.status).toBe('abgesagt')
    expect(liste.find(e => e.datum === '2026-11-19')?.status).toBe('erledigt')
    const di = liste.find(e => e.datum === '2027-02-09')!
    expect(di.von).toBe('14:00'); expect(di.art).toBe('vertretung'); expect(di.titel).toBe('Vertretung für Valérie Test'); expect(di.quelle).toBe('gespeichert')
    expect(liste.find(e => e.datum === '2027-02-11')?.von).toBe('13:00')
    const alt = liste.find(e => e.datum === '2027-03-02')!
    expect(istAlteVereinbarung(alt)).toBe(true); expect(istAlteVereinbarung(di)).toBe(false)
    expect(liste.some(e => e.id === 'x')).toBe(false)
    expect(liste.map(e => e.datum)).toEqual([...liste.map(e => e.datum)].sort())
  })
  it('Texte in Schweizer Schreibweise', () => {
    expect(datumLang('2026-11-05')).toBe('Do 05.11.2026')
    expect(zeitText('13:00', '17:00')).toBe('13.00 bis 17.00 Uhr')
  })
})
