import { describe, expect, it } from 'vitest'
import {
  BINGO_AUFGABEN, BINGO_FREI_ID, BINGO_LAYOUT, BINGO_REIHEN, BINGO_STANDARD, LEERE_WERTUNG, PUNKTE,
  bingoPhase, lokalZuIso, isoZuLokal, parseEinstellungen, punkteFuer, rangliste, startTeams, offeneZuordnen, teamName, uploadLimit, aufgabeFuer,
  darfBingoSehen, bingoRolle,
  type BingoFoto, type BingoTeam,
} from '@/lib/teamevent-bingo'

const foto = (aufgabe: string, status: BingoFoto['status'], am = '2026-10-23T10:00:00.000Z', extra: Partial<BingoFoto> = {}): BingoFoto => ({
  id: `f${Math.random().toString(36).slice(2, 10)}`, slug: 'europapark-2026', team: 't1', aufgabe, datum: '2026-10-23', am,
  von: 'Test', vonId: 'u1', mime: 'image/jpeg', bytes: 1000, thumb: true, status, entschiedenVon: null, entschiedenAm: null, test: false, ...extra,
})
const alleAkzeptiert = () => BINGO_AUFGABEN.map((a, i) => foto(a.id, 'akzeptiert', `2026-10-23T10:${String(i).padStart(2, '0')}:00.000Z`))
const mitBuchstaben = { ...LEERE_WERTUNG, buchstabenOk: true }

describe('Karte', () => {
  it('hat 24 verschiedene Aufgaben und das freie Feld in der Mitte', () => {
    expect(BINGO_AUFGABEN).toHaveLength(24)
    expect(new Set(BINGO_AUFGABEN.map(a => a.id)).size).toBe(24)
    expect(BINGO_LAYOUT).toHaveLength(25)
    expect(BINGO_LAYOUT[12]).toBe(BINGO_FREI_ID)
    expect(new Set(BINGO_LAYOUT).size).toBe(25)
    for (const id of BINGO_LAYOUT) expect(aufgabeFuer(id)).not.toBeNull()
  })
  it('kennt 12 Reihen mit je 5 Feldern', () => {
    expect(BINGO_REIHEN).toHaveLength(12)
    for (const r of BINGO_REIHEN) expect(new Set(r).size).toBe(5)
  })
})

describe('Punkte', () => {
  it('leere Karte gibt 0 Punkte', () => {
    const p = punkteFuer([], LEERE_WERTUNG)
    expect(p.total).toBe(0); expect(p.felder).toBe(0); expect(p.reihen).toBe(0); expect(p.volleKarte).toBe(false)
  })
  it('mittlere Reihe mit 4 akzeptierten Feldern plus freies Feld gibt 7 Punkte', () => {
    const ids = [10, 11, 13, 14].map(i => BINGO_LAYOUT[i])
    const p = punkteFuer(ids.map(id => foto(id, 'akzeptiert')), LEERE_WERTUNG)
    expect(p.felder).toBe(4); expect(p.reihen).toBe(1); expect(p.total).toBe(4 + PUNKTE.reihe)
  })
  it('volle Karte gibt 70 Punkte, mit den Boni Kürbismeer und Schrittzähler 74', () => {
    const p = punkteFuer(alleAkzeptiert(), mitBuchstaben)
    expect(p.felder).toBe(24); expect(p.reihen).toBe(12); expect(p.volleKarte).toBe(true); expect(p.total).toBe(70)
    expect(punkteFuer(alleAkzeptiert(), { ...mitBuchstaben, bonusKuerbis: true }).total).toBe(72)
    expect(punkteFuer(alleAkzeptiert(), { ...mitBuchstaben, bonusKuerbis: true, bonusSchritte: true }).total).toBe(PUNKTE.max)
    // der frühere Bonus Wartezeitrekord zählt nicht mehr, auch wenn er gespeichert ist
    expect(punkteFuer(alleAkzeptiert(), { ...mitBuchstaben, bonusWartezeit: true, bonusKuerbis: true }).total).toBe(72)
  })
  it('zwei akzeptierte Fotos im selben Feld zählen einmal', () => {
    const p = punkteFuer([foto('apero', 'akzeptiert'), foto('apero', 'akzeptiert')], LEERE_WERTUNG)
    expect(p.total).toBe(1)
  })
  it('offene oder abgelehnte Fotos geben 0 Punkte', () => {
    expect(punkteFuer([foto('apero', 'offen'), foto('bus', 'abgelehnt')], LEERE_WERTUNG).total).toBe(0)
  })
  it('das freie Feld gibt selbst keinen Punkt', () => {
    expect(punkteFuer([foto(BINGO_FREI_ID, 'akzeptiert')], LEERE_WERTUNG).total).toBe(0)
  })
  it('Ablehnen des einzigen Fotos einer vollen Reihe nimmt Feld und Reihenpunkte weg', () => {
    const ids = [10, 11, 13, 14].map(i => BINGO_LAYOUT[i])
    const fotos = ids.map(id => foto(id, 'akzeptiert'))
    expect(punkteFuer(fotos, LEERE_WERTUNG).total).toBe(7)
    fotos[0] = { ...fotos[0], status: 'abgelehnt' }
    expect(punkteFuer(fotos, LEERE_WERTUNG).total).toBe(3)
  })
  it('Buchstabenjagd zählt nur mit der Markierung', () => {
    const fotos = Array.from({ length: 8 }, () => foto('buchstaben', 'akzeptiert'))
    expect(punkteFuer(fotos, LEERE_WERTUNG).total).toBe(0)
    expect(punkteFuer(fotos, mitBuchstaben).total).toBe(1)
  })
  it('Korrektur wird dazugezählt', () => {
    expect(punkteFuer([foto('apero', 'akzeptiert')], { ...LEERE_WERTUNG, korrektur: -1 }).total).toBe(0)
    expect(punkteFuer([], { ...LEERE_WERTUNG, korrektur: 2 }).total).toBe(2)
  })
})

describe('Rangliste', () => {
  const team = (id: string, ausserKonkurrenz = false): BingoTeam => ({ id, mitglieder: [], offen: [], ausserKonkurrenz })
  it('sortiert nach Punkten, dann Feldern, dann früherem Abschluss und lässt die Jury weg', () => {
    const t = [team('t1'), team('t2'), team('t3'), team('t9', true)]
    const fotos = new Map<string, BingoFoto[]>([
      // t1: 2 Felder, später fertig
      ['t1', [foto('apero', 'akzeptiert', '2026-10-23T12:00:00Z', { team: 't1' }), foto('bus', 'akzeptiert', '2026-10-23T13:00:00Z', { team: 't1' })]],
      // t2: 2 Felder, früher fertig
      ['t2', [foto('apero', 'akzeptiert', '2026-10-23T09:00:00Z', { team: 't2' }), foto('bus', 'akzeptiert', '2026-10-23T11:00:00Z', { team: 't2' })]],
      // t3: 1 Feld plus Korrektur 1 = 2 Punkte, aber weniger Felder
      ['t3', [foto('apero', 'akzeptiert', '2026-10-23T08:00:00Z', { team: 't3' })]],
      ['t9', alleAkzeptiert().map(f => ({ ...f, team: 't9' }))],
    ])
    const w = new Map([['t3', { ...LEERE_WERTUNG, korrektur: 1 }]])
    const r = rangliste(t, fotos, w)
    expect(r.map(z => z.team.id)).toEqual(['t2', 't1', 't3'])
    expect(r.map(z => z.rang)).toEqual([1, 2, 3])
  })
})

describe('Teams', () => {
  const konten = [
    { id: 'a', full_name: 'Franziska Rindlisbacher' }, { id: 'b', full_name: 'Paola Maldonado' },
    { id: 'c', full_name: 'Emese Diserens' }, { id: 'd', full_name: 'Bianka Fitos' }, { id: 'e', full_name: 'Noah Diserens' },
  ]
  it('ordnet Vornamen und Kurzformen zu und lässt Fehlende offen', () => {
    const t = startTeams(konten)
    expect(t.find(x => x.id === 't2')?.mitglieder).toEqual(['a', 'b'])
    expect(t.find(x => x.id === 't6')?.mitglieder).toEqual(['c'])
    expect(t.find(x => x.id === 't6')?.offen).toEqual(['Odette'])
    expect(t.find(x => x.id === 't9')?.ausserKonkurrenz).toBe(true)
  })
  it('ordnet offene Vornamen später zu', () => {
    const t = startTeams(konten)
    const { teams, geaendert } = offeneZuordnen(t, [...konten, { id: 'o', full_name: 'Odette Muster' }])
    expect(geaendert).toBe(true)
    expect(teams.find(x => x.id === 't6')?.mitglieder).toEqual(['c', 'o'])
    expect(teams.find(x => x.id === 't6')?.offen).toEqual([])
  })
  it('bildet den Teamnamen aus Rufnamen', () => {
    const t = startTeams(konten).find(x => x.id === 't2')!
    expect(teamName(t, id => ({ a: 'Fränzi', b: 'Paola' } as Record<string, string>)[id] ?? null)).toBe('Fränzi + Paola')
    const t6 = startTeams(konten).find(x => x.id === 't6')!
    expect(teamName(t6, id => (id === 'c' ? 'Mesi' : null))).toBe('Mesi + Odette')
  })
})

describe('Fristen und Limits', () => {
  it('kennt die Phasen', () => {
    expect(bingoPhase(BINGO_STANDARD, '2026-10-23T04:59:00.000Z')).toBe('vor')      // 6.59 Uhr Schweizer Zeit
    expect(bingoPhase(BINGO_STANDARD, '2026-10-23T05:00:00.000Z')).toBe('laeuft')   // 7.00 Uhr
    expect(bingoPhase(BINGO_STANDARD, '2026-10-24T13:59:00.000Z')).toBe('laeuft')   // 15.59 Uhr
    expect(bingoPhase(BINGO_STANDARD, '2026-10-24T14:00:00.000Z')).toBe('vorbei')   // 16.00 Uhr
  })
  it('wandelt Schweizer Zeit hin und zurück', () => {
    expect(isoZuLokal(BINGO_STANDARD.start)).toBe('2026-10-23T07:00')
    expect(lokalZuIso('2026-10-24T16:00')).toBe('2026-10-24T16:00:00+02:00')
    expect(lokalZuIso('2026-11-02T08:00')).toBe('2026-11-02T08:00:00+01:00')
    expect(lokalZuIso('kaputt')).toBeNull()
  })
  it('begrenzt Fotos pro Feld, Buchstabenjagd pro Person', () => {
    const apero = aufgabeFuer('apero')!
    expect(uploadLimit(apero, [foto('apero', 'offen'), foto('apero', 'offen')], 'u1').frei).toBe(3)
    const b = aufgabeFuer('buchstaben')!
    const fremde = Array.from({ length: 20 }, () => foto('buchstaben', 'offen', undefined, { vonId: 'u2' }))
    expect(uploadLimit(b, fremde, 'u1').frei).toBe(20)
    expect(uploadLimit(b, fremde, 'u2').frei).toBe(0)
  })
  it('liest Einstellungen tolerant', () => {
    const e = parseEinstellungen('{"veroeffentlicht":true,"start":"kaputt","texte":{"apero":{"titel":"Prost"}}}')
    expect(e.veroeffentlicht).toBe(true); expect(e.start).toBe(BINGO_STANDARD.start); expect(e.texte.apero?.titel).toBe('Prost')
    expect(parseEinstellungen(null)).toEqual(BINGO_STANDARD)
  })
  it('keine Veröffentlichung ohne Bianka: alter Schlüssel «freigabe» zählt nicht, Zeiten schalten nichts frei, Jury wartet wie alle', () => {
    const alt = parseEinstellungen('{"freigabe":true}')
    expect(alt.veroeffentlicht).toBe(false)
    const mitarbeitende = bingoRolle('employee', 'Jemand Team')
    const noah = bingoRolle('employee', 'Noah Diserens')
    const admin = bingoRolle('admin', 'Peter Test')
    const bianka = bingoRolle('admin', 'Bianka Fitos')
    // auch mitten im Zeitfenster des Spiels bleibt es für Mitarbeitende unsichtbar
    const laeuft = { ...alt, start: '2026-10-23T07:00:00+02:00', ende: '2026-10-24T16:00:00+02:00' }
    expect(bingoPhase(laeuft, '2026-10-23T10:00:00+02:00')).toBe('laeuft')
    expect(darfBingoSehen(laeuft, mitarbeitende)).toBe(false)
    expect(darfBingoSehen(laeuft, noah)).toBe(false)
    expect(darfBingoSehen(laeuft, admin)).toBe(true)
    expect(darfBingoSehen(laeuft, bianka)).toBe(true)
    const offen = { ...alt, veroeffentlicht: true }
    expect(darfBingoSehen(offen, mitarbeitende)).toBe(true)
    expect(darfBingoSehen(offen, noah)).toBe(true)
  })
})
