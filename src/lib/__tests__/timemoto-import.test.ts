import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  parseCsv, erkenneTrenner, decodeBytes, parseTabelle, parseDatum, parseZeit, parseZeitstempel, parseTyp, excelSerial,
  findeProfil, namenStand, baueEvents, importEventId, hash64, istXlsx,
} from '@/lib/timemoto-import'
import { tabelleAusXlsx, spaltenIndex, xmlText } from '@/lib/xlsx-lesen'

const profile = [
  { id: '11111111-aaaa-4bbb-8ccc-000000000001', full_name: 'Anna Muster' },
  { id: '22222222-aaaa-4bbb-8ccc-000000000002', full_name: 'Léonie Beispiel-Muster' },
  { id: '33333333-aaaa-4bbb-8ccc-000000000003', full_name: 'Mia Keller' },
  { id: '44444444-aaaa-4bbb-8ccc-000000000004', full_name: 'Mia Meier' },
]

describe('TimeMoto Import: Werte lesen', () => {
  it('Datum, Zeit, Zeitstempel und Typ in allen üblichen Schreibweisen', () => {
    expect(parseDatum('03.11.2026')).toBe('2026-11-03')
    expect(parseDatum('3.11.26')).toBe('2026-11-03')
    expect(parseDatum('2026-11-03')).toBe('2026-11-03')
    expect(parseDatum('03/11/2026')).toBe('2026-11-03')
    expect(parseDatum('46329')).toBe('2026-11-03')   // Excel Seriennummer
    expect(parseDatum('Total')).toBeNull()
    expect(parseZeit('7:05')).toBe('07:05')
    expect(parseZeit('17:30:12')).toBe('17:30')
    expect(parseZeit('8.00')).toBe('08:00')
    expect(parseZeit('0.5')).toBe('12:00')
    expect(parseZeit('')).toBeNull()
    expect(parseZeitstempel('03.11.2026 07:05:00')).toEqual({ datum: '2026-11-03', zeit: '07:05' })
    expect(parseZeitstempel('2026-11-03T07:05:00')).toEqual({ datum: '2026-11-03', zeit: '07:05' })
    expect(parseZeitstempel('2026-05-21 08:30:00+02')).toEqual({ datum: '2026-05-21', zeit: '08:30' })
    expect(parseZeitstempel('46329.2951388889')).toEqual({ datum: '2026-11-03', zeit: '07:05' })
    expect(parseTyp('Ein')).toBe('In'); expect(parseTyp('In')).toBe('In'); expect(parseTyp('Kommen')).toBe('In')
    expect(parseTyp('Aus')).toBe('Out'); expect(parseTyp('Out')).toBe('Out'); expect(parseTyp('Gehen')).toBe('Out')
    expect(parseTyp('Pause')).toBe('Out'); expect(parseTyp('Pause Ende')).toBe('In'); expect(parseTyp('Break end')).toBe('In')
    expect(parseTyp('Clock In')).toBe('In'); expect(parseTyp('Ferien')).toBeNull()
    expect(excelSerial(45658)).toEqual({ datum: '2025-01-01', zeit: '00:00' })
  })

  it('CSV mit Semikolon, Komma oder Tab, Anführungszeichen und BOM', () => {
    expect(erkenneTrenner('Name;Datum;Zeit')).toBe(';')
    expect(erkenneTrenner('Name\tDatum\tZeit')).toBe('\t')
    expect(erkenneTrenner('a,b,c')).toBe(',')
    expect(parseCsv('Name;Datum\n"Muster; Anna";03.11.2026\n')).toEqual([['Name', 'Datum'], ['Muster; Anna', '03.11.2026']])
    expect(parseCsv('a,b\n"x ""y""",2')).toEqual([['a', 'b'], ['x "y"', '2']])
    expect(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A')
    expect(decodeBytes(new Uint8Array([0x4c, 0xe9, 0x6f]))).toBe('Léo')   // Windows-1252 aus Excel
    expect(istXlsx(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe(true)
    expect(istXlsx(new Uint8Array([0x41]), 'export.xlsx')).toBe(true)
    expect(istXlsx(new Uint8Array([0x41]), 'export.csv')).toBe(false)
  })
})

describe('TimeMoto Import: Tabellenformen', () => {
  it('Ereignisliste mit deutscher Kopfzeile, Titelzeilen darüber, Absenzzeilen übersprungen', () => {
    const text = [
      'Stempelungen Dentalpraxis;;;',
      'Zeitraum: 01.11.2026 - 30.11.2026;;;',
      'Mitarbeiter;Datum;Zeit;Ein/Aus;Benutzer-ID',
      'Anna Muster;03.11.2026;07:05;Ein;17',
      'Anna Muster;03.11.2026;12:00;Aus;17',
      'Anna Muster;03.11.2026;12:45;Ein;17',
      'Anna Muster;03.11.2026;17:30;Aus;17',
      'Mia Keller;03.11.2026;;Ferien;18',
      'Muster Anna;04.11.2026;08:00;Ein;17',
    ].join('\n')
    const p = parseTabelle(parseCsv(text))
    expect(p.format).toBe('ereignisse')
    expect(p.fehler).toEqual([])
    expect(p.uebersprungen).toBe(1)
    expect(p.zeilen).toHaveLength(5)
    expect(p.zeilen[0]).toEqual({ name: 'Anna Muster', datum: '2026-11-03', zeit: '07:05', typ: 'In', userId: '17', zeile: 4 })
    expect(p.zeilen[4].name).toBe('Muster Anna')
  })

  it('Tagesliste mit Vorname, Nachname und mehreren Ein/Aus Spalten', () => {
    const text = [
      'Vorname\tNachname\tDatum\tEin 1\tAus 1\tEin 2\tAus 2\tStunden',
      'Anna\tMuster\t03.11.2026\t07:05\t12:00\t12:45\t17:30\t9:40',
      'Mia\tKeller\t03.11.2026\t08:00\t\t\t\t',
      'Mia\tKeller\t04.11.2026\t\t\t\t\t0:00',
    ].join('\n')
    const p = parseTabelle(parseCsv(text))
    expect(p.format).toBe('tage')
    expect(p.zeilen.map(z => `${z.name} ${z.datum} ${z.zeit} ${z.typ}`)).toEqual([
      'Anna Muster 2026-11-03 07:05 In', 'Anna Muster 2026-11-03 12:00 Out', 'Anna Muster 2026-11-03 12:45 In', 'Anna Muster 2026-11-03 17:30 Out',
      'Mia Keller 2026-11-03 08:00 In',
    ])
    expect(p.uebersprungen).toBe(1)
  })

  it('Portal Vorlage (attendance_events_template.csv) und englische Exporte', () => {
    const vorlage = 'timemoto_event_id,user_full_name,clocking_type,time_logged,time_inserted,location_name\nx1,Anna Muster,In,2026-05-21 08:30:00+02,2026-05-21 08:30:05+02,Dentalpraxis Nidau\nx2,Anna Muster,Out,2026-05-21 17:00:00+02,,'
    const p = parseTabelle(parseCsv(vorlage))
    expect(p.format).toBe('portal')
    expect(p.zeilen.map(z => `${z.zeit} ${z.typ}`)).toEqual(['08:30 In', '17:00 Out'])
    const en = 'User,Date,Time,Type\nAnna Muster,2026-11-03,07:05,Clock In\nAnna Muster,2026-11-03,17:30,Clock Out'
    expect(parseTabelle(parseCsv(en)).zeilen.map(z => z.typ)).toEqual(['In', 'Out'])
    const leer = parseTabelle(parseCsv('Name;Pensum\nAnna Muster;80'))
    expect(leer.format).toBeNull(); expect(leer.fehler[0]).toMatch(/Kopfzeile/)
  })

  it('liest das erste Blatt eines XLSX mit sharedStrings und Zahlen', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types/>')
    zip.file('xl/workbook.xml', '<workbook xmlns:r="r"><sheets><sheet name="Export" sheetId="1" r:id="rId1"/></sheets></workbook>')
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>')
    zip.file('xl/sharedStrings.xml', '<sst><si><t>Name</t></si><si><t>Datum</t></si><si><t>Zeit</t></si><si><t>Typ</t></si><si><t>Léonie Beispiel-Muster</t></si><si><r><t>E</t></r><r><t>in</t></r></si><si><t>Aus</t></si></sst>')
    zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" s="1"><v>46329</v></c><c r="C2" s="2"><v>0.2951388888888889</v></c><c r="D2" t="s"><v>5</v></c></row>'
      + '<row r="3"><c r="A3" t="inlineStr"><is><t>Léonie Beispiel-Muster</t></is></c><c r="B3"><v>46329</v></c><c r="C3"><v>0.7291666666666666</v></c><c r="D3" t="s"><v>6</v></c></row>'
      + '</sheetData></worksheet>')
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    expect(istXlsx(bytes)).toBe(true)
    const rows = await tabelleAusXlsx(bytes)
    expect(rows[0]).toEqual(['Name', 'Datum', 'Zeit', 'Typ'])
    expect(rows[1]).toEqual(['Léonie Beispiel-Muster', '46329', '0.2951388888888889', 'Ein'])
    const p = parseTabelle(rows)
    expect(p.zeilen.map(z => `${z.datum} ${z.zeit} ${z.typ}`)).toEqual(['2026-11-03 07:05 In', '2026-11-03 17:30 Out'])
    expect(spaltenIndex('AB7')).toBe(27)
    expect(xmlText('a &amp; b &#233; &lt;')).toBe('a & b é <')
  })
})

describe('TimeMoto Import: Namen zuordnen und Ereignisse bauen', () => {
  it('ordnet exakt, umgekehrt, mit Doppelname, nie bei Mehrdeutigkeit, mit gespeicherter Zuordnung', () => {
    expect(findeProfil('Anna Muster', profile)?.id).toBe(profile[0].id)
    expect(findeProfil('MUSTER Anna', profile)?.id).toBe(profile[0].id)
    expect(findeProfil('Leonie Beispiel', profile)?.id).toBe(profile[1].id)       // ohne Akzent, ohne zweiten Nachnamen
    expect(findeProfil('Mia', profile)).toBeNull()                                 // zwei Mias
    expect(findeProfil('Mia K.', profile)).toBeNull()
    expect(findeProfil('M. Keller', profile, { 'm keller': profile[2].id })?.id).toBe(profile[2].id)
    expect(findeProfil('', profile)).toBeNull()
  })

  it('fasst pro Dateiname zusammen und baut gepaarte Ereignisse mit stabilen IDs', () => {
    const zeilen = parseTabelle(parseCsv([
      'Name;Datum;Zeit;Typ',
      'Anna Muster;03.11.2026;17:30;Aus',
      'Anna Muster;03.11.2026;07:05;Ein',
      'Anna Muster;03.11.2026;12:00;Aus',
      'Anna Muster;03.11.2026;12:45;Ein',
      'Anna Muster;03.11.2026;12:45;Ein',   // doppelt in der Datei
      'Anna Muster;04.11.2026;17:00;Aus',   // Aus ohne Ein (Einstempeln vergessen)
      'Mia K.;04.11.2026;08:00;Ein',
    ].join('\n'))).zeilen
    const stand = namenStand(zeilen, profile)
    expect(stand.map(s => [s.name, s.anzahl, s.von, s.bis, s.profil?.full_name ?? null])).toEqual([
      ['Anna Muster', 6, '2026-11-03', '2026-11-04', 'Anna Muster'],
      ['Mia K.', 1, '2026-11-04', '2026-11-04', null],
    ])
    const ev = baueEvents(zeilen.filter(z => z.name === 'Anna Muster'), profile[0], 'november.csv', 'Dentalpraxis Nidau')
    expect(ev).toHaveLength(5)
    expect(ev.map(e => `${e.clocking_type} ${e.time_logged} ${e.clocking_pair_id.slice(-12)}`)).toEqual([
      'In 2026-11-03T06:05:00.000Z 2026-11-03_1',
      'Out 2026-11-03T11:00:00.000Z 2026-11-03_1',
      'In 2026-11-03T11:45:00.000Z 2026-11-03_2',
      'Out 2026-11-03T16:30:00.000Z 2026-11-03_2',
      'Out 2026-11-04T16:00:00.000Z 2026-11-04_1',
    ])
    expect(ev[0].timemoto_event_id).toBe(importEventId(profile[0].id, 'In', '2026-11-03T06:05:00.000Z'))
    expect(ev[0].timemoto_event_id).toMatch(/^import_[0-9a-f]{16}$/)
    expect(ev[0]).toMatchObject({ employee_id: profile[0].id, user_full_name: 'Anna Muster', location_name: 'Dentalpraxis Nidau', deleted_at: null, raw_payload: { source: 'import_timemoto', datei: 'november.csv', zeile: 3 } })
    // Sommerzeit: der Juli liegt zwei Stunden vor UTC
    const juli = baueEvents([{ name: 'Anna Muster', datum: '2026-07-06', zeit: '07:00', typ: 'In', userId: null, zeile: 2 }], profile[0], 'juli.csv', 'Praxis')
    expect(juli[0].time_logged).toBe('2026-07-06T05:00:00.000Z')
    expect(hash64('a')).not.toBe(hash64('b'))
    expect(hash64('Anna')).toBe(hash64('Anna'))
  })
})
