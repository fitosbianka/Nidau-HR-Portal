import { describe, expect, it } from 'vitest'
import { arbeitstageBetween, istFeiertag, feiertagName } from '@/lib/feiertage'
import {
  wochen2027, standardFarbe, kategorieFuer, belegungFuer, wochenTage, wunschTage, wunschKosten, wochenTeile, gruenRegel, istLernende, istLeitendeDa,
  type Person, type Woche, ferientageZaehlen } from '@/lib/ferien-wochen'
import type { FerienWunsch } from '@/lib/ferien-wuensche'
import { ferienEintrag, ferienTage } from '@/lib/ferien-eintrag'
import { absenceCredit } from '@/lib/zeiterfassung-report'
import { parseSamstagRow, parseAnmeldungRow, samstagVoll, samstagVollText } from '@/lib/samstage'

const wochen = wochen2027()
const kw = (n: number): Woche => wochen.find(w => w.kw === n)!
const personen: Person[] = [
  { id: 'z1', full_name: 'Valérie Diserens', job_title: 'ZAZ', pensum: 100 },
  { id: 'z2', full_name: 'Noah Diserens', job_title: 'ZAZ', pensum: 60 },
  { id: 'z3', full_name: 'Franziska Rindlisbacher', job_title: 'ZAZ', pensum: 80 },
  { id: 'h1', full_name: 'Dinusha Atapattu', job_title: 'DH / PA', pensum: 100 },
  { id: 'd1', full_name: 'Laura Gerisch-Rudin', job_title: 'Leitende DA', pensum: 100 },
  { id: 'd2', full_name: 'Daniela Tschannen', job_title: 'DA', pensum: 60 },
  { id: 'd3', full_name: 'Annegret Muster', job_title: 'DA', pensum: 100 },
  { id: 'l1', full_name: 'Neya K', job_title: 'Lernende', pensum: 80 },
  { id: 'l2', full_name: 'Amina B', job_title: 'Lernende', pensum: 80 },
]
const woche = (employeeId: string, w: Woche, status: FerienWunsch['status'] = 'offen', createdAt = '2026-10-01T10:00:00.000Z'): FerienWunsch =>
  ({ employeeId, from: w.montag, to: w.freitag, art: 'ferien', prio: 3, status, createdAt, quelle: 'woche', kw: w.kw })

describe('Wochen 2027', () => {
  it('kennt 52 Wochen, KW 1 beginnt am 4. Januar, KW 30 ist der 26. bis 30. Juli', () => {
    expect(wochen).toHaveLength(52)
    expect(kw(1).montag).toBe('2027-01-04')
    expect(kw(30).montag).toBe('2027-07-26'); expect(kw(30).freitag).toBe('2027-07-30')
    expect(kw(52).freitag).toBe('2027-12-31')
  })
  it('verteilt die Farben wie vorgegeben', () => {
    expect([30, 40, 52].map(standardFarbe)).toEqual(['dunkelgruen', 'dunkelgruen', 'dunkelgruen'])
    expect([1, 6, 15, 16, 18, 27, 28, 29, 31, 32, 39, 41].every(k => standardFarbe(k) === 'hellgruen')).toBe(true)
    expect([26, 33, 34, 38, 42, 43].every(k => standardFarbe(k) === 'rot')).toBe(true)
    expect(standardFarbe(2)).toBe('orange')
    expect(wochen.filter(w => w.farbe === 'dunkelgruen')).toHaveLength(3)
    expect(wochen.filter(w => w.farbe === 'rot')).toHaveLength(6)
  })
  it('zieht Feiertage ab: KW 18 mit Auffahrt hat vier Arbeitstage', () => {
    expect(istFeiertag('2027-05-06')).toBe(true)
    expect(kw(18).arbeitstage).toHaveLength(4)
    expect(kw(12).arbeitstage).toHaveLength(4)  // Karfreitag
    expect(kw(13).arbeitstage).toHaveLength(4)  // Ostermontag
    expect(kw(20).arbeitstage).toHaveLength(4)  // Pfingstmontag
    expect(kw(30).arbeitstage).toHaveLength(5)
    expect(arbeitstageBetween('2027-01-01', '2027-01-01')).toEqual([])  // Neujahr
    expect(feiertagName('2027-05-06')).toBe('Auffahrt'); expect(feiertagName('2026-01-02')).toBe('Berchtoldstag'); expect(feiertagName('2027-05-07')).toBeNull()
  })
  it('übernimmt Farbanpassungen', () => {
    const w = wochen2027({ '2027-07-26': 'orange' }).find(x => x.kw === 30)!
    expect(w.farbe).toBe('orange'); expect(w.standardFarbe).toBe('dunkelgruen')
  })
})

describe('Kategorien', () => {
  it('ordnet die Kategorien zu, Lernende zählen zur Assistenz', () => {
    expect(kategorieFuer('ZAZ')).toBe('ZAZ'); expect(kategorieFuer('DH')).toBe('DHPA'); expect(kategorieFuer('Leitende DA')).toBe('ASSISTENZ')
    expect(kategorieFuer('Lernende')).toBe('ASSISTENZ'); expect(kategorieFuer('Admin')).toBeNull(); expect(kategorieFuer(null)).toBeNull()
    expect(istLernende('Lernende')).toBe(true); expect(istLeitendeDa('Leitende DA')).toBe(true); expect(istLeitendeDa('DA')).toBe(false)
  })
})

describe('Belegung', () => {
  it('zählt Wochenanmeldungen, Wünsche ab drei Arbeitstagen und Arbeitsplan Einträge', () => {
    const w = kw(30)
    const wishes: FerienWunsch[] = [
      woche('d1', w),
      { employeeId: 'd2', from: '2027-07-28', to: '2027-07-30', art: 'ferien', prio: 3, status: 'offen', createdAt: '2026-10-02T10:00:00.000Z' }, // 3 Tage → zählt
      { employeeId: 'd3', from: '2027-07-29', to: '2027-07-30', art: 'ferien', prio: 3, status: 'offen', createdAt: '2026-10-03T10:00:00.000Z' }, // 2 Tage → zählt nicht
      woche('z1', w, 'abgelehnt'),
    ]
    const eintraege = ['2027-07-26', '2027-07-27', '2027-07-28', '2027-07-29', '2027-07-30'].map(d => ({ employee_id: 'h1', schedule_date: d, entry: 'F:0.6' }))
    const b = belegungFuer(w, wishes, eintraege, personen)
    expect(b.get('ASSISTENZ')!.map(x => x.employeeId)).toEqual(['d1', 'd2'])
    expect(b.get('DHPA')!.map(x => `${x.employeeId}:${x.status}`)).toEqual(['h1:akzeptiert'])
    expect(b.get('ZAZ')).toEqual([])
  })
  it('sortiert nach Eingang, Einträge zuerst', () => {
    const w = kw(1)
    const b = belegungFuer(w, [woche('d2', w, 'offen', '2026-10-05T08:00:00.000Z'), woche('d1', w, 'offen', '2026-10-01T08:00:00.000Z')], [], personen)
    expect(b.get('ASSISTENZ')!.map(x => x.employeeId)).toEqual(['d1', 'd2'])
  })
})

describe('Ferientage in Tagen', () => {
  it('eine Woche kostet Arbeitstage mal Pensum, mit Feiertag weniger', () => {
    expect(wochenTage(kw(30), 100)).toBe(5)
    expect(wochenTage(kw(30), 60)).toBe(3)
    expect(wochenTage(kw(30), 50)).toBe(2.5)
    expect(wochenTage(kw(18), 60)).toBe(2.4)
    expect(wunschTage('2027-05-03', '2027-05-07', 60)).toBe(2.4)
  })
  it('teilt einen Zeitraum in Kalenderwochen auf, Feiertage ohne Ferientag', () => {
    const t = wochenTeile('2027-05-05', '2027-05-18')   // Mi KW 18 (Auffahrt Do) bis Di KW 20 (Pfingstmontag)
    expect(t.map(x => [x.from, x.to, x.tage.length])).toEqual([
      ['2027-05-05', '2027-05-07', 2], ['2027-05-10', '2027-05-14', 5], ['2027-05-17', '2027-05-18', 1],
    ])
    expect(wochenTeile('2027-07-26', '2027-07-30')).toHaveLength(1)
  })
  it('zählt gewählte Tage je einen Ferientag, ohne Tagesauswahl nach Pensum', () => {
    const w = kw(30)
    const basis = { from: w.montag, to: w.freitag, quelle: 'woche' as const }
    expect(wunschKosten({ ...basis, tage: [w.arbeitstage[0], w.arbeitstage[1]] }, w, 50)).toBe(2)
    expect(wunschKosten({ ...basis, tage: [w.arbeitstage[0], w.arbeitstage[1], w.arbeitstage[2]] }, w, 50)).toBe(3)
    expect(wunschKosten({ ...basis, tage: null }, w, 50)).toBe(2.5)
    expect(wunschKosten({ from: '2027-05-03', to: '2027-05-07', quelle: null, tage: ['2027-05-03', '2027-05-06'] }, undefined, 60)).toBe(1)   // Auffahrt zählt nicht
  })
  it('schreibt ab 2027 gewichtete Einträge an Arbeitstagen ohne Feiertage', () => {
    expect(ferienTage('2027-05-03', '2027-05-07')).toHaveLength(4)
    expect(ferienTage('2026-05-11', '2026-05-15')).toHaveLength(5)   // 2026 unverändert, Auffahrt 14.5. bleibt Wochentag
    expect(ferienEintrag()).toBe('F')   // tagesgenau, jeder gewählte Tag ein Ferientag
  })
  it('gutschreibt im Zeitkonto das Wochensoll: 5 Tage F:0.6 ergeben 25.5 Stunden', () => {
    const min = 5 * absenceCredit('F', 0, 0.6)
    expect(min).toBe(1530)
    expect(min / 60).toBe(25.5)
    expect(5 * 8.5 * 0.6).toBe(25.5)
  })
  it('prüft die Regel zwei grüne Wochen, davon eine dunkelgrüne', () => {
    expect(gruenRegel(wochen, [kw(30).montag, kw(1).montag])).toEqual({ gruen: 2, dunkelgruen: 1, ok: true })
    expect(gruenRegel(wochen, [kw(1).montag, kw(6).montag]).ok).toBe(false)
  })
})

describe('Samstage mit drei Rollen', () => {
  it('eine Rolle ist besetzt, sobald der Bedarf erreicht ist; ohne Zahl gibt es keine Grenze', () => {
    const bedarf = { zahnarzt: 1, dhpa: 1, assistenz: 1 }
    expect(samstagVoll(bedarf, { zahnarzt: 0, dhpa: 0, assistenz: 1 }, 'assistenz')).toBe(true)
    expect(samstagVoll(bedarf, { zahnarzt: 0, dhpa: 0, assistenz: 1 }, 'zahnarzt')).toBe(false)
    expect(samstagVoll({ ...bedarf, assistenz: 2 }, { zahnarzt: 0, dhpa: 0, assistenz: 1 }, 'assistenz')).toBe(false)
    expect(samstagVoll({ ...bedarf, assistenz: null }, { zahnarzt: 0, dhpa: 0, assistenz: 5 }, 'assistenz')).toBe(false)
    expect(samstagVollText('assistenz', bedarf)).toBe('Für diesen Samstag ist Assistenz schon besetzt (1 Person nötig).')
  })
  it('setzt alte Daten um', () => {
    expect(parseSamstagRow('{"notiz":"","bedarf":{"behandler":1,"assistenz":2}}').bedarf).toEqual({ zahnarzt: 1, dhpa: 1, assistenz: 2 })
    expect(parseSamstagRow('{"bedarf":{"zahnarzt":2,"dhpa":0,"assistenz":1}}').bedarf).toEqual({ zahnarzt: 2, dhpa: 0, assistenz: 1 })
    expect(parseAnmeldungRow('{"rolle":"behandler","am":"x"}', 'DH / PA')?.rolle).toBe('dhpa')
    expect(parseAnmeldungRow('{"rolle":"behandler","am":"x"}', 'ZAZ')?.rolle).toBe('zahnarzt')
    expect(parseAnmeldungRow('{"rolle":"assistenz","am":"x"}', 'DA')?.rolle).toBe('assistenz')
  })
})

describe('Ferientage bei Teilzeit: eine Woche zählt nach Pensum', () => {
  const woche = (montag: string) => [0, 1, 2, 3, 4].map(i => { const d = new Date(`${montag}T12:00:00`); d.setDate(d.getDate() + i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
  const F = (tage: string[], gewicht = 1) => tage.map(datum => ({ datum, gewicht }))
  const kw6 = woche('2027-02-08')
  it('40 Prozent: ganze Woche 2 Tage, nicht 5', () => {
    expect(ferientageZaehlen(F(kw6), 40)).toBe(2)
    expect(wunschKosten({ from: kw6[0], to: kw6[4], tage: kw6, quelle: null }, undefined, 40)).toBe(2)
    expect(wunschKosten({ from: kw6[0], to: kw6[4], tage: null, quelle: null }, undefined, 40)).toBe(2)
  })
  it('40 Prozent: einzelne Tage zählen, höchstens 2 pro Woche', () => {
    expect(ferientageZaehlen(F(kw6.slice(0, 1)), 40)).toBe(1)
    expect(ferientageZaehlen(F(kw6.slice(0, 2)), 40)).toBe(2)
    expect(ferientageZaehlen(F(kw6.slice(0, 4)), 40)).toBe(2)
  })
  it('50 Prozent: drei gewählte Tage zählen 3, die ganze Woche 2,5', () => {
    expect(ferientageZaehlen(F(kw6.slice(0, 3)), 50)).toBe(3)
    expect(ferientageZaehlen(F(kw6), 50)).toBe(2.5)
  })
  it('100 Prozent: jeder Tag zählt', () => {
    expect(ferientageZaehlen(F(kw6), 100)).toBe(5)
    expect(ferientageZaehlen(F(kw6), null)).toBe(5)
  })
  it('Woche mit Feiertag (Auffahrt 06.05.2027): 4 Arbeitstage mal 40 Prozent', () => {
    expect(ferientageZaehlen(F(woche('2027-05-03')), 40)).toBe(1.6)
  })
  it('alte gewichtete Einträge (F:0.4 an fünf Tagen) bleiben 2 Tage, 2026 unverändert', () => {
    expect(ferientageZaehlen(F(kw6, 0.4), 40)).toBe(2)
    expect(ferientageZaehlen(F(woche('2026-11-02')), 40)).toBe(5)
  })
  it('Fall Fabienne: 11 ganze Wochen bei 40 Prozent sind 22 Tage statt 55', () => {
    const elf = Array.from({ length: 11 }, (_, i) => { const d = new Date('2027-02-08T12:00:00'); d.setDate(d.getDate() + i * 14); return woche(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`) }).flat()
    const ohneFeiertage = elf.filter(d => !['2027-03-26', '2027-03-29', '2027-05-06', '2027-05-17'].includes(d))
    expect(ferientageZaehlen(F(ohneFeiertage), 100)).toBe(ohneFeiertage.length)
    expect(ferientageZaehlen(F(ohneFeiertage), 40)).toBeLessThanOrEqual(22)
  })
})
