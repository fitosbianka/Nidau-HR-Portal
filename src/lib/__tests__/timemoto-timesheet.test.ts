import { describe, expect, it } from 'vitest'
import { zeilenAusTimesheet, type PdfSeite, type PdfWort } from '@/lib/timemoto-timesheet'
import { zeilenAusWoertern } from '@/lib/pdf-text'
import { parseCsv, parseTabelle, namenStand } from '@/lib/timemoto-import'

/** Zeile mit Wörtern an den x Positionen des echten TimeMoto Berichts
 *  (Date 37, Day 80, IN 116, OUT 174, Planned 239, Achieved 296, Balance 354, Comments 412). */
const Z = (y: number, ...w: Array<[number, string]>) => ({ y, woerter: w.map(([x, s]) => ({ x, y, w: s.length * 4, s })) })
const kopf = (y: number) => Z(y, [37, 'Date'], [80, 'Day'], [116, 'IN'], [174, 'OUT'], [239, 'Planned'], [296, 'Achieved'], [354, 'Balance'], [412, 'Comments/Codes'])
const abschnitt = (y: number, name: string) => [
  Z(y, [30, 'Name:'], [95, name], [210, 'Department:'], [260, 'Dentalassistentinnen'], [397, 'Schedule:']),
  Z(y + 22, [30, 'Employee No.:'], [95, '162'], [210, 'Employee No.:']),
]

const seite1: PdfSeite = [
  Z(31, [206, 'Timesheet']),
  Z(41, [36, 'Dentalpraxis Muster AG'], [448, '01-07-2026'], [493, '-'], [498, '31-07-2026']),
  ...abschnitt(88, 'Anna Muster'),
  kopf(127),
  Z(141, [37, 'Week'], [66, '27'], [116, '2026']),
  Z(155, [37, '01/07'], [80, 'Wed'], [116, '07:47'], [174, '12:06'], [239, '08:30'], [296, '08:21'], [354, '-00:09']),
  Z(170, [116, '13:02'], [174, '17:04']),
  Z(184, [37, '03/07'], [80, 'Fri'], [116, '07:59'], [174, '12:06'], [239, '08:30'], [296, '08:03'], [354, '-00:27']),
  Z(199, [116, '13:00'], [174, '16:56']),
  Z(213, [239, '17:00'], [296, '16:24'], [354, '-00:36']),
  Z(227, [37, 'Week'], [66, '30'], [116, '2026']),
  Z(242, [37, '20/07'], [80, 'Mon'], [116, 'Ferien'], [174, '08:30'], [239, '08:30'], [296, '08:30'], [354, '00:00'], [404, 'Ferien']),
  Z(256, [37, '21/07'], [80, 'Tue'], [116, '11:57'], [174, '16:31'], [239, '08:30'], [296, '08:30'], [354, '00:00'], [404, 'Spätschicht']),
  Z(271, [116, '16:56'], [174, '20:52']),
  Z(285, [239, '34:00'], [296, '34:21'], [354, '00:21']),
  Z(787, [44, 'Date'], [80, '15-09-2026']),
  Z(803, [44, 'Time'], [80, '14:29'], [295, '1']),
]
const seite2: PdfSeite = [
  kopf(60),
  Z(75, [37, '31/07'], [80, 'Fri'], [116, '08:06'], [174, '12:01'], [239, '08:30'], [296, '07:43'], [354, '-00:47']),
  Z(90, [116, '12:39'], [174, '16:27']),
  Z(105, [239, '153:00'], [296, '152:36'], [354, '-00:24']),
  Z(130, [30, 'Holiday:']),
  Z(145, [30, 'Total:'], [95, '22.300'], [210, 'Taken:'], [260, '-3.000']),
  Z(200, [206, 'Timesheet']),
  ...abschnitt(230, 'Mia Keller'),
  kopf(270),
  Z(285, [37, 'Week'], [66, '27'], [116, '2026']),
  Z(300, [37, '01/07'], [80, 'Wed'], [116, '08:00'], [174, '17:00'], [239, '08:30'], [296, '08:30'], [354, '00:00']),
  Z(315, [37, '02/07'], [80, 'Thu'], [116, 'Krank'], [174, '08:30'], [239, '08:30'], [296, '08:30'], [354, '00:00'], [404, 'Krank']),
  Z(803, [44, 'Time'], [80, '14:29'], [295, '2']),
]

describe('TimeMoto Timesheet (PDF): Abschnitte pro Person, Spalten nach Kopfzeile', () => {
  it('trennt zwei Personen, liest Fortsetzungszeilen, Jahr aus der Wochenzeile, überspringt Absenzen und Summen', () => {
    const t = zeilenAusTimesheet([seite1, seite2])
    expect(t.fehler).toEqual([])
    expect(t.personen).toEqual(['Anna Muster', 'Mia Keller'])
    expect(t.uebersprungen).toBe(2)   // Ferien und Krank
    const anna = t.zeilen.filter(z => z.name === 'Anna Muster').map(z => `${z.datum} ${z.zeit} ${z.typ}`)
    expect(anna).toEqual([
      '2026-07-01 07:47 In', '2026-07-01 12:06 Out', '2026-07-01 13:02 In', '2026-07-01 17:04 Out',
      '2026-07-03 07:59 In', '2026-07-03 12:06 Out', '2026-07-03 13:00 In', '2026-07-03 16:56 Out',
      '2026-07-21 11:57 In', '2026-07-21 16:31 Out', '2026-07-21 16:56 In', '2026-07-21 20:52 Out',
      '2026-07-31 08:06 In', '2026-07-31 12:01 Out', '2026-07-31 12:39 In', '2026-07-31 16:27 Out',
    ])
    const mia = t.zeilen.filter(z => z.name === 'Mia Keller').map(z => `${z.datum} ${z.zeit} ${z.typ}`)
    expect(mia).toEqual(['2026-07-01 08:00 In', '2026-07-01 17:00 Out'])
    // keine Zeile landet bei der falschen Person, keine Summe wird zur Zeit
    expect(t.zeilen.every(z => z.name === 'Anna Muster' || z.name === 'Mia Keller')).toBe(true)
    expect(t.zeilen.some(z => z.zeit === '34:00' || z.zeit === '17:00' && z.name === 'Anna Muster')).toBe(false)
    const stand = namenStand(t.zeilen, [{ id: 'a', full_name: 'Anna Muster' }])
    expect(stand.map(s => [s.name, s.tage, s.anzahl, s.profil?.id ?? null])).toEqual([['Anna Muster', 4, 16, 'a'], ['Mia Keller', 1, 2, null]])
  })

  it('meldet fehlende Abschnitte, Zeilen vor dem ersten Namen und Abschnitte ohne Zeiten', () => {
    const ohne = zeilenAusTimesheet([[kopf(10), Z(20, [37, 'Week'], [66, '27'], [116, '2026']), Z(30, [37, '01/07'], [80, 'Wed'], [116, '07:47'], [174, '12:06'])]])
    expect(ohne.zeilen).toEqual([])
    expect(ohne.fehler.some(f => f.includes('Kein Abschnitt'))).toBe(true)
    expect(ohne.fehler.some(f => f.includes('vor dem ersten'))).toBe(true)
    const leer = zeilenAusTimesheet([[...abschnitt(10, 'Anna Muster'), kopf(40), Z(60, [37, 'Week'], [66, '27'], [116, '2026']), Z(70, [37, '01/07'], [80, 'Wed'], [116, 'Ferien'], [174, '08:30'])]])
    expect(leer.fehler).toEqual(['Abschnitt «Anna Muster» enthält keine Stempelzeiten.'])
    // Datum mit Jahr braucht keine Wochenzeile; ohne beides eine klare Meldung
    const mitJahr = zeilenAusTimesheet([[...abschnitt(10, 'Anna Muster'), kopf(40), Z(60, [37, '01.07.2026'], [80, 'Wed'], [116, '07:47'], [174, '12:06'])]])
    expect(mitJahr.zeilen.map(z => z.datum)).toEqual(['2026-07-01', '2026-07-01'])
    const ohneJahr = zeilenAusTimesheet([[...abschnitt(10, 'Anna Muster'), kopf(40), Z(60, [37, '01/07'], [80, 'Wed'], [116, '07:47'], [174, '12:06'])]])
    expect(ohneJahr.zeilen).toEqual([])
    expect(ohneJahr.fehler.some(f => f.includes('ohne Jahr'))).toBe(true)
  })

  it('gruppiert Wörter nach Höhe in Zeilen', () => {
    const w: PdfWort[] = [{ x: 174, y: 100.4, w: 20, s: '12:06' }, { x: 37, y: 100, w: 20, s: '01/07' }, { x: 116, y: 101.5, w: 20, s: '07:47' }, { x: 116, y: 115, w: 20, s: '13:02' }, { x: 5, y: 50, w: 2, s: ' ' }]
    const z = zeilenAusWoertern(w)
    expect(z.map(l => l.woerter.map(x => x.s))).toEqual([['01/07', '07:47', '12:06'], ['13:02']])
  })
})

describe('TimeMoto Timesheet als CSV oder XLSX: Abschnitte und Fortsetzungszeilen', () => {
  it('ordnet Zeilen ohne Namen der zuletzt genannten Person zu, Zeilen ohne Datum dem letzten Tag, ignoriert wiederholte Kopfzeilen', () => {
    const text = [
      'Timesheet;;;;',
      'Dentalpraxis Muster AG;;;01-07-2026 - 31-07-2026;',
      'Name:;Anna Muster;Department:;Dentalassistentinnen;',
      'Date;Day;IN;OUT;Planned',
      'Week 27 2026;;;;',
      '01/07/2026;Wed;07:47;12:06;08:30',
      ';;13:02;17:04;',
      '03/07/2026;Fri;Ferien;08:30;08:30',
      ';;;34:00;34:21',
      'Name:;Mia Keller;Department:;Dentalhygiene;',
      'Date;Day;IN;OUT;Planned',
      '01/07/2026;Wed;08:00;17:00;08:30',
    ].join('\n')
    const p = parseTabelle(parseCsv(text))
    expect(p.format).toBe('tage')
    expect(p.fehler).toEqual([])
    expect(p.zeilen.map(z => `${z.name} ${z.datum} ${z.zeit} ${z.typ}`)).toEqual([
      'Anna Muster 2026-07-01 07:47 In', 'Anna Muster 2026-07-01 12:06 Out', 'Anna Muster 2026-07-01 13:02 In', 'Anna Muster 2026-07-01 17:04 Out',
      'Mia Keller 2026-07-01 08:00 In', 'Mia Keller 2026-07-01 17:00 Out',
    ])
    expect(p.uebersprungen).toBe(1)   // Ferien
  })
  it('Name in der Zelle selbst («Name: Anna Muster») und Fortsetzung ohne Abschnitt bei leerer Namensspalte', () => {
    const a = parseTabelle(parseCsv('Name: Anna Muster;;;\nDate;IN;OUT\n01.07.2026;07:47;12:06\n;13:02;17:04'))
    expect(a.zeilen.map(z => `${z.name} ${z.zeit}`)).toEqual(['Anna Muster 07:47', 'Anna Muster 12:06', 'Anna Muster 13:02', 'Anna Muster 17:04'])
    const b = parseTabelle(parseCsv('Name;Date;IN;OUT\nAnna Muster;01.07.2026;07:47;12:06\n;;13:02;17:04\nMia Keller;01.07.2026;08:00;17:00\n;;12:00;12:30'))
    expect(b.zeilen.map(z => `${z.name} ${z.datum} ${z.zeit}`)).toEqual([
      'Anna Muster 2026-07-01 07:47', 'Anna Muster 2026-07-01 12:06', 'Anna Muster 2026-07-01 13:02', 'Anna Muster 2026-07-01 17:04',
      'Mia Keller 2026-07-01 08:00', 'Mia Keller 2026-07-01 17:00', 'Mia Keller 2026-07-01 12:00', 'Mia Keller 2026-07-01 12:30',
    ])
  })
})
