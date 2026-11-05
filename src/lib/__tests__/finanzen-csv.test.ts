import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeCsvBytes, parseUbsCsv, fuehreJahrZusammen, monatAbgedeckt, vollstaendigAusProtokoll } from '@/lib/finanzen/ubs-csv'
import { kombiniereMonate, baueReihen, aggregiereMonate } from '@/lib/finanzen/analyse'
import { baueKontext } from '@/lib/finanzen/kategorien'

const fixture = (name: string) => decodeCsvBytes(new Uint8Array(readFileSync(join(__dirname, '..', 'finanzen', '__fixtures__', name))))

describe('UBS CSV: Zeitraum deckt den Monat ab (Bankarbeitstage)', () => {
  it('Oktober 2026: der 31. ist ein Samstag, ein Export bis Freitag 30.10. ist vollständig', () => {
    expect(monatAbgedeckt('2026-10-01', '2026-10-30', '2026-10')).toBe(true)
    expect(monatAbgedeckt('2026-10-01', '2026-10-31', '2026-10')).toBe(true)
    expect(monatAbgedeckt('2026-10-01', '2026-10-29', '2026-10')).toBe(false)
    expect(monatAbgedeckt('2026-10-02', '2026-10-30', '2026-10')).toBe(false)   // der 1. Oktober ist ein Donnerstag
    expect(monatAbgedeckt('2026-09-01', '2026-11-04', '2026-10')).toBe(true)
    expect(monatAbgedeckt(null, '2026-10-30', '2026-10')).toBe(false)
  })
  it('November 2026 beginnt am Sonntag: ein Export ab Montag 2.11. zählt ab dem ersten Arbeitstag', () => {
    expect(monatAbgedeckt('2026-11-02', '2026-11-30', '2026-11')).toBe(true)
    expect(monatAbgedeckt('2026-11-03', '2026-11-30', '2026-11')).toBe(false)
  })
  it('Dezember 2026: Weihnachten ist ein Feiertag, der letzte Bankarbeitstag ist Donnerstag 31.12.', () => {
    expect(monatAbgedeckt('2026-12-01', '2026-12-31', '2026-12')).toBe(true)
    expect(monatAbgedeckt('2026-12-01', '2026-12-30', '2026-12')).toBe(false)
  })
  it('wertet gespeicherte Monate anhand des Importprotokolls nachträglich als vollständig', () => {
    const infos = {
      '2026-09': { saldoMonatsendeRp: 100, vollstaendig: true, abgleichOk: true },
      '2026-10': { saldoMonatsendeRp: 200, vollstaendig: false, abgleichOk: true },
      '2026-11': { saldoMonatsendeRp: 300, vollstaendig: false, abgleichOk: null },
    }
    const neu = vollstaendigAusProtokoll(infos, [{ von: '2026-10-01', bis: '2026-10-30' }, { von: '2026-11-01', bis: '2026-11-04' }])
    expect(neu['2026-10'].vollstaendig).toBe(true)
    expect(neu['2026-11'].vollstaendig).toBe(false)
    expect(neu['2026-09']).toBe(infos['2026-09'])
    expect(vollstaendigAusProtokoll(infos, [{ von: null, bis: null }])['2026-10'].vollstaendig).toBe(false)
  })
})

describe('UBS CSV: Parser', () => {
  it('aktuelles Format: Buchungen, Vorgemerktes, Einzelbeträge, Saldo-Abgleich und Monate', () => {
    const p = parseUbsCsv(fixture('aktuell.csv'))
    expect(p.format).toBe('aktuell')
    expect(p.kontoKey).toBe('CH120023523599999901A')   // IBAN ohne Leerzeichen
    expect(p.von).toBe('2026-07-01'); expect(p.bis).toBe('2026-08-31')
    expect(p.buchungen).toHaveLength(6)
    expect(p.vorgemerkt).toBe(1)   // Debitkarte ohne Buchungsdatum zählt nicht
    expect(p.buchungen.reduce((s, b) => s + b.betragRp, 0)).toBe(623455)
    expect(p.saldoAbgleichOk).toBe(true)
    // Sammelauftrag: Einzelbeträge hängen als Details dran und zählen nie zusätzlich
    const sammel = p.buchungen.find(b => b.transaktionsNr === '9900001TO0000001')!
    expect(sammel.betragRp).toBe(-482135)
    expect(sammel.details.map(d => d.betragRp)).toEqual([-250010, -232125])
    const qr = p.buchungen.find(b => b.transaktionsNr === '9900002PH0000002')!
    expect(qr.betragRp).toBe(301910); expect(qr.details).toHaveLength(2)
    expect(p.monate['2026-07']).toMatchObject({ anzahl: 3, vollstaendig: true, saldoEndeRp: 9423680 })
    expect(p.monate['2026-08']).toMatchObject({ anzahl: 3, vollstaendig: true, saldoEndeRp: 9123455 })
    expect(p.buchungen.map(b => b.buchungsdatum)).toEqual([...p.buchungen.map(b => b.buchungsdatum)].sort())
  })
  it('Format mit Transaktionsbetrag und altes Format mit 21 Spalten', () => {
    const t = parseUbsCsv(fixture('transaktionsbetrag.csv'))
    expect(t.format).toBe('transaktionsbetrag')
    expect(t.buchungen.map(b => b.betragRp)).toEqual([-300000, 800000])
    expect(t.saldoAbgleichOk).toBe(true)
    expect(t.monate['2026-06'].vollstaendig).toBe(true)
    const a = parseUbsCsv(fixture('alt21.csv'))
    expect(a.format).toBe('alt21')
    expect(a.buchungen.map(b => b.betragRp)).toEqual([450000, -150000])
    expect(a.monate['2025-03'].vollstaendig).toBe(false)   // ohne Von/Bis zählen die Buchungsdaten (3. bis 10. März)
  })
  it('findet die Spalten über die Kopfzeile, auch wenn die Bank die Reihenfolge ändert', () => {
    const text = fixture('aktuell.csv')
    const zeilen = text.split('\n')
    const kopf = zeilen.findIndex(z => z.startsWith('Abschlussdatum'))
    const tausch = (z: string) => { const f = z.split(';'); [f[5], f[6], f[7]] = [f[7], f[5], f[6]]; return f.join(';') }
    const vertauscht = zeilen.map((z, i) => (i >= kopf ? tausch(z) : z)).join('\n')
    expect(vertauscht.split('\n')[kopf]).toContain('Einzelbetrag;Belastung;Gutschrift')
    const p = parseUbsCsv(vertauscht)
    expect(p.buchungen).toHaveLength(6)
    expect(p.buchungen.reduce((s, b) => s + b.betragRp, 0)).toBe(623455)
    expect(p.saldoAbgleichOk).toBe(true)
    expect(p.buchungen.find(b => b.transaktionsNr === '9900001TO0000001')!.details).toHaveLength(2)
  })
  it('Oktober 2026 aus dem E-Banking: Von 1.10. bis 30.10. ist ein vollständiger Monat', () => {
    const text = fixture('aktuell.csv')
      .replace('Von:;2026-07-01', 'Von:;2026-10-01').replace('Bis:;2026-08-31', 'Bis:;2026-10-30')
      .replace(/2026-08-/g, '2026-10-').replace(/2026-07-/g, '2026-10-')
    const p = parseUbsCsv(text)
    expect(Object.keys(p.monate)).toEqual(['2026-10'])
    expect(p.monate['2026-10'].vollstaendig).toBe(true)
  })
})

describe('Zusammenführen mit dem Bestand', () => {
  it('derselbe Export zweimal importiert: keine doppelten Buchungen, Status «ersetzt»', () => {
    const p = parseUbsCsv(fixture('aktuell.csv'))
    const erst = fuehreJahrZusammen(null, p.kontoKey, 2026, p, 'imp1')
    expect(Object.values(erst.status)).toEqual(['neu', 'neu'])
    expect(erst.datei.buchungen).toHaveLength(6)
    const zweit = fuehreJahrZusammen(erst.datei, p.kontoKey, 2026, p, 'imp2')
    expect(Object.values(zweit.status)).toEqual(['ersetzt', 'ersetzt'])
    expect(zweit.datei.buchungen).toHaveLength(6)
    expect(zweit.datei.monate['2026-08']).toMatchObject({ vollstaendig: true, saldoMonatsendeRp: 9123455 })
  })
  it('ein Teilimport ergänzt den Monat ohne Doppelte, ein voller Import ersetzt ihn und rettet Handzuordnungen', () => {
    const voll = parseUbsCsv(fixture('aktuell.csv'))
    const teil = parseUbsCsv(fixture('aktuell.csv').replace('Bis:;2026-08-31', 'Bis:;2026-08-24'))
    expect(teil.monate['2026-08'].vollstaendig).toBe(false)
    const a = fuehreJahrZusammen(null, voll.kontoKey, 2026, teil, 'imp1')
    expect(a.status['2026-08']).toBe('neu'); expect(a.datei.monate['2026-08'].vollstaendig).toBe(false)
    a.datei.buchungen.find(b => b.transaktionsNr === '9900004TO0000004')!.kategorieManuell = 'miete'
    const b = fuehreJahrZusammen(a.datei, voll.kontoKey, 2026, teil, 'imp2')
    expect(b.status['2026-08']).toBe('ergaenzt'); expect(b.datei.buchungen).toHaveLength(6)
    const c = fuehreJahrZusammen(b.datei, voll.kontoKey, 2026, voll, 'imp3')
    expect(c.status['2026-08']).toBe('ersetzt'); expect(c.datei.buchungen).toHaveLength(6)
    expect(c.datei.buchungen.find(x => x.transaktionsNr === '9900004TO0000004')!.kategorieManuell).toBe('miete')
    expect(c.datei.monate['2026-08'].vollstaendig).toBe(true)
  })
  it('Monatsreihe: unvollständige Monate heissen so, der laufende Monat «laufend», die Kontrollrechnung geht auf', () => {
    const p = parseUbsCsv(fixture('aktuell.csv'))
    const { datei } = fuehreJahrZusammen(null, p.kontoKey, 2026, p, 'imp1')
    const ctx = baueKontext([], [], [p.iban, p.kontoKey], [])
    const agg = aggregiereMonate(p.kontoKey, datei.buchungen, { ...datei.monate, '2026-08': { ...datei.monate['2026-08'], vollstaendig: false } }, ctx)
    const reihen = baueReihen(kombiniereMonate(agg, 'alle'), '2026-09')
    expect(reihen.map(r => [r.monat, r.status])).toEqual([['2026-07', 'ok'], ['2026-08', 'unvollstaendig']])
    expect(reihen[1].deltaK).toBe(9123455 - 9423680)
    expect(reihen[1].kontrolleOk).toBe(true)
    expect(baueReihen(kombiniereMonate(agg, 'alle'), '2026-08')[1].status).toBe('laufend')
  })
})
