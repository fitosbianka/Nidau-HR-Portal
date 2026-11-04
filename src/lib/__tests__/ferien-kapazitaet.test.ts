import { describe, expect, it } from 'vitest'
import { wochen2027, wochenTage, type Person, type Woche, type Eintrag } from '@/lib/ferien-wochen'
import type { FerienWunsch } from '@/lib/ferien-wuensche'
import {
  REGELN_STANDARD, parseRegeln, vertretungsEinsaetze, FRITZ, einsatzTage, einsatzGanztags, personRegelFuer, faktorAm, PERSON_LEER, type Einsatz, type PersonRegel,
} from '@/lib/ferien-regeln'
import {
  codeInfo, kapazitaetFuer, nurAkzeptiert, pruefeAnmeldung, praxistageAssistenz, zweiWochenAmStueck, verletzungenFuer, tagesVerfuegbarkeit,
  meineArbeitstage, arbeitetLautStandardwoche, grundIstVoll, anmeldeFehler, oeffnungText, VOLL_HINWEIS, type Kontext, type StandardWeek,
} from '@/lib/ferien-kapazitaet'
import { wochenFuerMitarbeiter, wochenFuerAdmin, empfehlungAssistenz, type FerienKontext } from '@/lib/ferien-wochen-data'

const wochen = wochen2027()
const kw = (n: number): Woche => wochen.find(w => w.kw === n)!

// Testpraxis nach dem Beispiel im Prompt: Montag, Mittwoch, Donnerstag und
// Freitag je zwei ZAZ, Dienstag drei (Valérie Frühschicht, Fränzi
// Mittelschicht, Paola Spätschicht).
const personen: Person[] = [
  { id: 'z1', full_name: 'Valérie Diserens', job_title: 'ZAZ', pensum: 100 },
  { id: 'z2', full_name: 'Franziska Rindlisbacher', job_title: 'ZAZ', pensum: 80 },
  { id: 'z3', full_name: 'Paola Maldonado', job_title: 'ZAZ', pensum: 40 },
  { id: 'h1', full_name: 'Dinusha Atapattu', job_title: 'DH / PA', pensum: 100 },
  { id: 'h2', full_name: 'Sarah Muster', job_title: 'DH / PA', pensum: 100 },
  { id: 'h3', full_name: 'Dritte Hygienikerin', job_title: 'DH / PA', pensum: 80 },
  { id: 'd1', full_name: 'Laura Gerisch-Rudin', job_title: 'Leitende DA', pensum: 100 },
  { id: 'd2', full_name: 'Daniela Tschannen', job_title: 'Leitende DA', pensum: 100 },
  { id: 'd3', full_name: 'Annegret Muster', job_title: 'Leitende DA', pensum: 80 },
  { id: 'd4', full_name: 'Assistentin Vier', job_title: 'DA', pensum: 80 },
  { id: 'd5', full_name: 'Assistentin Fünf', job_title: 'DA', pensum: 100 },
  { id: 'd6', full_name: 'Assistentin Sechs', job_title: 'DA', pensum: 60 },
  { id: 'l1', full_name: 'Katarina Lernende', job_title: 'Lernende', pensum: 80 },
  { id: 'l2', full_name: 'Amanda Lernende', job_title: 'Lernende', pensum: 80 },
]
const alle = (code: string): StandardWeek => ({ '1': code, '2': code, '3': code, '4': code, '5': code })
const standardwochen: Record<string, StandardWeek> = {
  z1: alle('1f'),
  z2: { '1': '2t', '2': '2t', '3': '2t', '4': '%', '5': '2t' },
  z3: { '1': '%', '2': '3s', '3': '%', '4': '3t', '5': '%' },
  h1: alle('✓'), h2: alle('✓'), h3: { '1': '✓', '2': '✓', '3': '✓', '4': '✓', '5': '%' },
  d1: { '1': '6', '2': '6', '3': '6', '4': '6', '5': 'HO' },
  d3: { '1': '8', '2': '8', '3': '8', '4': '8', '5': 'HO' },
  l1: { '1': '✓', '2': '✓', '3': '✓', '4': '✓', '5': 'S' },
  l2: { '1': '✓', '2': '✓', '3': '✓', '4': '✓', '5': 'S' },
}
const personRegeln: Record<string, PersonRegel> = {}
for (const p of personen) personRegeln[p.id] = personRegelFuer(p)

const woche = (employeeId: string, w: Woche, status: FerienWunsch['status'] = 'offen', createdAt = '2026-10-01T10:00:00.000Z'): FerienWunsch =>
  ({ employeeId, from: w.montag, to: w.freitag, art: 'ferien', prio: 3, status, createdAt, quelle: 'woche', kw: w.kw })
// Ohne Platzhalter (die neue Zahnärztin ab Juni wird separat geprüft)
const REGELN = { ...REGELN_STANDARD, platzhalter: [], valerieFraenzi: true }
const ctxMit = (teile: Partial<Kontext> = {}): Kontext => ({
  regeln: REGELN, personen, personRegeln, standardwochen, vertretungen: {}, einsaetze: [], eintraege: [], wishes: [], ...teile,
})
const person = (id: string) => personen.find(p => p.id === id)!

describe('Codes der Standardwoche', () => {
  it('liest Raum und Schicht', () => {
    expect(codeInfo('3f')).toMatchObject({ arbeitet: true, raum: 3, schicht: 'f' })
    expect(codeInfo('5t').raum).toBe(5)
    expect(codeInfo('2s').schicht).toBe('s')
    expect(codeInfo('6')).toMatchObject({ arbeitet: true, raum: null })
    expect(codeInfo('6/8t').arbeitet).toBe(true)
    expect(codeInfo('✓').arbeitet).toBe(true)
    expect(codeInfo('HO')).toMatchObject({ arbeitet: false, ho: true })
    expect(codeInfo('S')).toMatchObject({ arbeitet: false, schule: true })
    expect(codeInfo('%').arbeitet).toBe(false)
    expect(codeInfo('F').arbeitet).toBe(false)
    expect(codeInfo(undefined).arbeitet).toBe(true)   // keine Standardwoche
    expect(codeInfo('').arbeitet).toBe(true)          // leerer Tag = keine Vorgabe, arbeitet
    expect(codeInfo('*/7s')).toMatchObject({ arbeitet: true, raum: null, schicht: 's' })   // Joker, dann Spätsteri
    expect(codeInfo('3/7f')).toMatchObject({ arbeitet: true, raum: 3, schicht: 'f' })
    expect(codeInfo('6/8t')).toMatchObject({ arbeitet: true, raum: null, schicht: 't' })
    expect(codeInfo('2t/3s')).toMatchObject({ arbeitet: true, raum: 2, schicht: 's' })   // letzte Schicht zählt (Spätsteri)
    expect(codeInfo('3f|7')).toMatchObject({ arbeitet: true, raum: 3, schicht: 'f' })
    expect(codeInfo('Praxis').arbeitet).toBe(true)    // unbekannter Code zählt als anwesend
    expect(codeInfo('F:0.6').arbeitet).toBe(false)
    expect(codeInfo('KO').arbeitet).toBe(false)
  })
  it('Behandler: ein leerer Tag in der Standardwoche ist ein freier Tag, mit oder ohne % (Fränzi am Freitag)', () => {
    const w = kw(30)
    const ohne = { ...standardwochen, z2: { '1': '2t', '2': '2t', '3': '2t', '4': '' } }   // Donnerstag und Freitag leer statt %
    const k = kapazitaetFuer(ctxMit({ standardwochen: ohne }), w)
    expect(k.tage[3].zaz.map(a => a.name)).not.toContain('Franziska Rindlisbacher')
    expect(k.tage[4].zaz.map(a => a.name)).not.toContain('Franziska Rindlisbacher')
    expect(k.tage[0].zaz.map(a => a.name)).toContain('Franziska Rindlisbacher')
    const mit = kapazitaetFuer(ctxMit({ standardwochen: { ...standardwochen, z2: { '1': '2t', '2': '2t', '3': '2t', '4': '%', '5': '%' } } }), w)
    expect(mit.tage[4].zaz.map(a => a.name)).not.toContain('Franziska Rindlisbacher')
    expect(meineArbeitstage(ctxMit({ standardwochen: ohne }), 'z2')).toEqual([1, 2, 3])
    expect(arbeitetLautStandardwoche(ctxMit({ standardwochen: ohne }), 'z2', w.arbeitstage[4])).toBe(false)
  })
  it('Behandler ohne Standardwoche (oder mit leerer) gelten weiterhin als anwesend; Assistenz: leer heisst arbeitet', () => {
    const w = kw(30)
    const { z2: _weg, ...ohneZ2 } = standardwochen
    void _weg
    const k = kapazitaetFuer(ctxMit({ standardwochen: ohneZ2 }), w)
    expect(k.tage[4].zaz.map(a => a.name)).toContain('Franziska Rindlisbacher')
    const leer = kapazitaetFuer(ctxMit({ standardwochen: { ...standardwochen, z2: { '1': '', '2': '' } } }), w)
    expect(leer.tage[4].zaz.map(a => a.name)).toContain('Franziska Rindlisbacher')
    // Assistenz: Freitag nicht erfasst, Dinusha … d6 arbeitet laut Pensum trotzdem (keine Vorgabe)
    const ctx = ctxMit({ standardwochen: { ...standardwochen, d6: { '1': '6', '2': '6' } } })
    expect(meineArbeitstage(ctx, 'd6')).toEqual([1, 2, 3, 4, 5])
    expect(praxistageAssistenz(ctx, person('d6'), w)).toBe(3)   // 60 % von 5 Tagen
  })
})

describe('Regeln und Einsätze', () => {
  it('liest Regeln tolerant und sperrt Rot immer', () => {
    expect(parseRegeln(null)).toEqual(REGELN_STANDARD)
    const r = parseRegeln('{"plaetzeZaz":{"orange":2,"rot":3},"grundbedarf":{"steri":2},"reserve":1,"valerieFraenzi":false,"platzhalter":[]}')
    expect(r.plaetzeZaz.orange).toBe(2); expect(r.plaetzeZaz.rot).toBe(0)
    expect(r.grundbedarf.steri).toBe(2); expect(r.grundbedarf.empfang).toBe(1)
    expect(r.reserve).toBe(1); expect(r.valerieFraenzi).toBe(false); expect(r.platzhalter).toEqual([])
  })
  it('Vertretungswoche von Fritz: Dienstag und Donnerstag 13 bis 17 Uhr, halber Tag, Feiertage fallen weg', () => {
    const w = kw(11)
    const e = vertretungsEinsaetze(FRITZ, [w.arbeitstage[0], w.arbeitstage[4]])
    expect(e).toHaveLength(2)
    expect(e.every(x => [2, 4].includes(new Date(`${x.datum}T12:00:00`).getDay()) && x.von === '13:00' && x.bis === '17:00')).toBe(true)
    expect(e.every(x => x.datum >= w.montag && x.datum <= w.freitag)).toBe(true)
    // Auffahrt 2027 ist ein Donnerstag (06.05.): in dieser Woche nur der Dienstag
    expect(vertretungsEinsaetze(FRITZ, ['2027-05-03']).map(x => x.datum)).toEqual(['2027-05-04'])
    expect(einsatzTage(e[0])).toBe(0.5); expect(einsatzGanztags(e[0])).toBe(false)
    expect(einsatzGanztags({ von: '08:00', bis: '17:00' })).toBe(true)
  })
  it('hat Standardregeln pro Person: Noah bis Ende Juli, Amanda 50 % bis 31. Juli', () => {
    expect(personRegelFuer({ id: 'x', full_name: 'Noah Diserens' }).bis).toBe('2027-07-31')
    const a = personRegelFuer({ id: 'y', full_name: 'Amanda Lernende' })
    expect(faktorAm(a, '2027-06-15', true)).toBe(0.5)
    expect(faktorAm(a, '2027-08-02', true)).toBe(1)
    expect(faktorAm(a, '2027-06-15', false)).toBe(1)
    expect(personRegelFuer({ id: 'z', full_name: 'Jemand Neu', eintrittsdatum: '2027-03-01' }).ab).toBe('2027-03-01')
    expect(personRegelFuer({ id: 'z', full_name: 'Jemand Neu' }, { ...PERSON_LEER, bis: '2027-05-31' }).bis).toBe('2027-05-31')
  })
})

describe('Assistenz Bedarf und Angebot', () => {
  it('Fall 1: volle Woche ohne Abwesenheiten, Bedarf 27 Tage (Mo, Mi, Do, Fr je 5, Di 7)', () => {
    const k = kapazitaetFuer(ctxMit(), kw(2))
    expect(k.tage.map(t => t.bedarf)).toEqual([5, 7, 5, 5, 5])
    expect(k.assistenz.bedarf).toBe(27)
  })
  it('Fall 2: Paola fehlt ohne Vertretung, der Bedarf sinkt um 3 Tage und Frei steigt', () => {
    const basis = kapazitaetFuer(ctxMit(), kw(30))
    const k = kapazitaetFuer(ctxMit({ wishes: [woche('z3', kw(30))] }), kw(30))
    expect(k.assistenz.bedarf).toBe(24)
    expect(k.assistenz.frei).toBe(basis.assistenz.frei + 3)
    expect(k.zazZaehlend.map(b => b.employeeId)).toEqual(['z3'])
  })
  it('Fall 3: Paola ganztags vertreten, Bedarf bleibt 27 und kein ZAZ Platz; halbtägige Einsätze von Fritz decken nicht', () => {
    const w = kw(30)
    const di = w.arbeitstage[1], doo = w.arbeitstage[3]
    const k = kapazitaetFuer(ctxMit({ wishes: [woche('z3', w)], vertretungen: { [`z3|${di}`]: 'Fritz Fahrländer', [`z3|${doo}`]: 'Fritz Fahrländer' } }), w)
    expect(k.assistenz.bedarf).toBe(27)
    expect(k.zazZaehlend).toEqual([])
    expect(k.tage[1].zaz.some(a => a.art === 'vertretung' && a.schicht === 's')).toBe(true)
    const halb: Einsatz[] = [di, doo].map(d => ({ id: `f-${d}`, datum: d, name: 'Fritz Fahrländer', kategorie: 'ZAZ', von: '13:00', bis: '17:00', assistenz: true }))
    const k2 = kapazitaetFuer(ctxMit({ wishes: [woche('z3', w)], einsaetze: halb }), w)
    expect(k2.zazZaehlend.map(b => b.employeeId)).toEqual(['z3'])
    expect(k2.assistenz.bedarf).toBe(25)   // 24 plus zwei halbe Einsatztage
  })
  it('Fall 5: Einsätze von Fritz in KW 11 erhöhen den Bedarf um 1 Tag; Zimmerwarnung, wenn nachmittags kein Raum frei ist', () => {
    const w = kw(11)
    const fritz = vertretungsEinsaetze(FRITZ, [w.montag])
    const k = kapazitaetFuer(ctxMit({ einsaetze: fritz }), w)
    expect(k.assistenz.bedarf).toBe(28)
    expect(k.warnungen.some(x => x.includes('Behandlungszimmer'))).toBe(false)
    const voll: Person[] = [1, 2, 3, 4, 5].map(i => ({ id: `r${i}`, full_name: `Zahnarzt ${i}`, job_title: 'ZAZ', pensum: 100 }))
    const std: Record<string, StandardWeek> = {}
    for (const p of voll) std[p.id] = alle(`${p.id.slice(1)}t`)
    const regeln: Record<string, PersonRegel> = {}
    for (const p of voll) regeln[p.id] = PERSON_LEER
    const k2 = kapazitaetFuer(ctxMit({ personen: [...voll, person('h1'), person('d5')], standardwochen: std, personRegeln: regeln, einsaetze: fritz }), w)
    expect(k2.warnungen.filter(x => x.includes('kein Behandlungszimmer frei'))).toHaveLength(2)
    expect(k2.warnungen[k2.warnungen.length - 1]).toMatch(/nachmittags/)
  })
  it('Fall 7: eine DA mit 80 % meldet sich an, Frei sinkt um 4 Tage, die Woche kostet 4 Tage', () => {
    const w = kw(2)
    const basis = kapazitaetFuer(ctxMit(), w)
    const k = kapazitaetFuer(ctxMit({ wishes: [woche('d4', w)] }), w)
    expect(basis.assistenz.frei - k.assistenz.frei).toBe(4)
    expect(k.assistenz.abwesend).toBe(4)
    expect(wochenTage(w, 80)).toBe(4)
  })
  it('Fall 12: KW 18 mit Auffahrt, nur vier Tage, bei 60 % 2.4 Tage, Bedarf und Angebot ohne den Feiertag', () => {
    const w = kw(18)
    expect(w.arbeitstage).toHaveLength(4)
    expect(wochenTage(w, 60)).toBe(2.4)
    const k = kapazitaetFuer(ctxMit(), w)
    expect(k.tage).toHaveLength(4)
    expect(k.assistenz.bedarf).toBe(27 - 5)   // Donnerstag fällt weg
    expect(praxistageAssistenz(ctxMit(), person('d5'), w)).toBe(4)
  })
  it('Fall 14: Amanda zählt im Juni mit 50 % und im August mit 100 %, Home Office zählt nicht', () => {
    const ctx = ctxMit()
    expect(praxistageAssistenz(ctx, person('l2'), kw(24))).toBe(2)     // 0.8 × 5 = 4 Praxistage × 0.5
    expect(praxistageAssistenz(ctx, person('l2'), kw(32))).toBe(4)
    expect(praxistageAssistenz(ctx, person('l1'), kw(24))).toBe(4)
    expect(praxistageAssistenz(ctx, person('d1'), kw(2))).toBe(4)      // 100 % minus Home Office Freitag
    expect(praxistageAssistenz(ctx, person('d3'), kw(2))).toBe(3)      // 80 % minus Home Office
  })
  it('Platzhalter: die neue Zahnärztin zählt ab Juni Montag und Mittwoch als ZAZ', () => {
    const ctx = ctxMit({ regeln: REGELN_STANDARD })
    expect(kapazitaetFuer(ctx, kw(2)).assistenz.bedarf).toBe(27)
    expect(kapazitaetFuer(ctx, kw(30)).assistenz.bedarf).toBe(29)
    expect(kapazitaetFuer(ctx, kw(30)).tage[0].zaz.some(a => a.art === 'platzhalter')).toBe(true)
    // Valérie weg: Montag bleibt durch den Platzhalter besetzt, nur der Freitag nicht
    expect(pruefeAnmeldung({ ...ctx, wishes: [woche('z1', kw(30))], regeln: { ...REGELN_STANDARD, valerieFraenzi: false } }, kw(30), person('z2'))).toEqual(['Am Freitag wäre keine Zahnärztin in der Praxis'])
  })
  it('zählt Angebot, Frei und Frei in Personen', () => {
    const k = kapazitaetFuer(ctxMit(), kw(24))
    expect(k.assistenz.angebot).toBe(30)   // 4 + 5 + 3 + 4 + 5 + 3 + 4 + 2
    expect(k.assistenz.frei).toBe(3)
    expect(k.assistenz.freiPersonen).toBe(0)
    expect(k.personalstand).toBe('knapp')
    const k2 = kapazitaetFuer(ctxMit({ wishes: [woche('z3', kw(24))] }), kw(24))
    expect(k2.assistenz.frei).toBe(6)
    expect(k2.assistenz.freiPersonen).toBe(1)
  })
})

describe('Regeln beim Anmelden', () => {
  it('Fall 4: Valérie ist abwesend, Fränzi wird blockiert, mit dem Tag ohne ZAZ in der Meldung', () => {
    const w = kw(30)   // dunkelgrün, zwei ZAZ Plätze
    const gruende = pruefeAnmeldung(ctxMit({ wishes: [woche('z1', w)] }), w, person('z2'))
    expect(gruende.some(g => /können Valérie und Fränzi nicht gleichzeitig weg/.test(g))).toBe(true)
    expect(gruende).toContain('Am Montag wäre keine Zahnärztin in der Praxis')
    // Paola allein: Dienstag und Donnerstag bleiben besetzt, Montag nicht
    const g2 = pruefeAnmeldung(ctxMit({ wishes: [woche('z1', w)], regeln: { ...REGELN, valerieFraenzi: false } }), w, person('z2'))
    expect(g2.some(x => x.includes('Valérie'))).toBe(false)
    expect(g2.some(x => x.includes('Montag'))).toBe(true)
  })
  it('ZAZ Plätze gelten pro Tag: in Orange ein Platz, in Grün zwei', () => {
    expect(pruefeAnmeldung(ctxMit({ wishes: [woche('z3', kw(2))] }), kw(2), person('z1'))).toContain('Am Dienstag ist für ZAZ kein Platz mehr (1 Platz)')
    expect(pruefeAnmeldung(ctxMit({ wishes: [woche('z3', kw(30))] }), kw(30), person('z1')).some(x => /kein Platz/.test(x))).toBe(false)
  })
  it('zwei Personen in derselben Woche, wenn ihre Tage sich nicht überschneiden', () => {
    const w = kw(2)   // orange, ein ZAZ Platz; Paola arbeitet Di und Do, Fränzi Mo, Di, Mi, Fr
    const ctx = ctxMit({ wishes: [{ ...woche('z3', w), tage: [w.arbeitstage[1], w.arbeitstage[3]] }] })
    expect(pruefeAnmeldung(ctx, w, person('z2'), [w.arbeitstage[0]])).toEqual([])
    expect(pruefeAnmeldung(ctx, w, person('z2'), [w.arbeitstage[0], w.arbeitstage[1]])).toContain('Am Dienstag ist für ZAZ kein Platz mehr (1 Platz)')
    const status = tagesVerfuegbarkeit(ctx, w, person('z2'))
    expect(status.map(s => s.moeglich)).toEqual([true, false, true, true, true])
    expect(status[1].grund).toBe('Am Dienstag ist für ZAZ kein Platz mehr (1 Platz)')
    const k = kapazitaetFuer({ ...ctx, wishes: [...ctx.wishes, { ...woche('z2', w), tage: [w.arbeitstage[0]] }] }, w)
    expect(k.plaetzeBelegt.ZAZ).toBe(1)
    expect(k.warnungen.some(x => x.includes('über den Plätzen'))).toBe(false)
  })
  it('Fall 6: Dinusha ist angemeldet, Sarah wird blockiert mit Freitag ohne DH', () => {
    const w = kw(30)
    expect(pruefeAnmeldung(ctxMit({ wishes: [woche('h1', w)] }), w, person('h2'))).toEqual(['Am Freitag wäre keine DH oder PA in der Praxis'])
    expect(pruefeAnmeldung(ctxMit({ wishes: [woche('h1', w)] }), w, person('h3'))).toEqual([])
  })
  it('Assistenz: Anmeldung nur, wenn Frei für die eigenen Praxistage reicht', () => {
    const w = kw(24)   // Frei 3 Tage
    expect(pruefeAnmeldung(ctxMit(), w, person('d6'))).toEqual([])   // 60 % braucht 3 Tage
    expect(pruefeAnmeldung(ctxMit(), w, person('d5'))[0]).toMatch(/reicht es in dieser Woche nicht \(frei 3 Tage, nötig 5\)/)
    // Paola weg → 6 Tage frei → auch 100 % geht
    expect(pruefeAnmeldung(ctxMit({ wishes: [woche('z3', w)] }), w, person('d5'))).toEqual([])
  })
  it('Leitende DA: höchstens eine gleichzeitig weg', () => {
    const w = kw(30)
    const ctx = ctxMit({ wishes: [woche('d1', w), woche('z3', w)] })
    expect(pruefeAnmeldung(ctx, w, person('d2'))).toContain('Von den Leitenden DA ist in dieser Woche schon jemand weg')
    expect(pruefeAnmeldung(ctx, w, person('d4')).some(x => x.startsWith('Von den Leitenden'))).toBe(false)
  })
  it('Fall 11: rote Woche für niemanden', () => {
    expect(pruefeAnmeldung(ctxMit(), kw(26), person('d4'))).toEqual(['Rote Woche, keine Ferien'])
  })
  it('Fall 19: bestehende Einträge von Valérie und Fränzi werden nicht blockiert, nur gewarnt', () => {
    const w = kw(30)
    const eintraege: Eintrag[] = w.arbeitstage.flatMap(d => [{ employee_id: 'z1', schedule_date: d, entry: 'F' }, { employee_id: 'z2', schedule_date: d, entry: 'F:0.8' }])
    const k = kapazitaetFuer(ctxMit({ eintraege }), w)
    expect(k.warnungen.some(x => x.startsWith('Valérie und Fränzi gleichzeitig weg am'))).toBe(true)
    expect(k.warnungen).toContain('Am Montag keine Zahnärztin in der Praxis')
    expect(k.belegung.get('ZAZ')!.map(b => b.employeeId).sort()).toEqual(['z1', 'z2'])
  })
  it('zeigt Admins die verletzten Regeln einer offenen Anmeldung', () => {
    const w = kw(2)
    const a = woche('z3', w, 'offen', '2026-10-01T10:00:00.000Z'), b = woche('z1', w, 'offen', '2026-10-02T10:00:00.000Z')
    const ctx = ctxMit({ wishes: [a, b] })
    expect(verletzungenFuer(ctx, w, a)).toContain('Am Dienstag ist für ZAZ kein Platz mehr (1 Platz)')
    expect(verletzungenFuer(ctxMit({ wishes: [a] }), w, a)).toEqual([])
  })
})

describe('Tagesgenaue Anmeldung bei Teilzeit', () => {
  it('zählt nur die gewählten Tage als abwesend, auch bei ZAZ', () => {
    const w = kw(30)
    const di = w.arbeitstage[1], doo = w.arbeitstage[3]
    const k = kapazitaetFuer(ctxMit({ wishes: [{ ...woche('z3', w), tage: [di] }] }), w)
    expect(k.tage[1].zaz.some(a => a.name === 'Paola Maldonado')).toBe(false)
    expect(k.tage[3].zaz.some(a => a.name === 'Paola Maldonado')).toBe(true)
    expect(k.tage[3].datum).toBe(doo)
    expect(k.zazZaehlend.map(b => b.employeeId)).toEqual(['z3'])   // belegt trotzdem einen Platz
  })
  it('Assistenz: drei gewählte Tage einer 60 Prozent Person kosten 3 Tage, die Prüfung rechnet mit den gewählten Tagen', () => {
    const w = kw(2)
    const tage = [w.arbeitstage[0], w.arbeitstage[1], w.arbeitstage[2]]
    const basis = kapazitaetFuer(ctxMit(), w)
    const k = kapazitaetFuer(ctxMit({ wishes: [{ ...woche('d6', w), tage }] }), w)
    expect(basis.assistenz.frei - k.assistenz.frei).toBe(3)
    expect(pruefeAnmeldung(ctxMit(), kw(24), person('d6'), kw(24).arbeitstage.slice(0, 3))).toEqual([])   // frei 3 Tage, nötig 3
    expect(pruefeAnmeldung(ctxMit(), kw(24), person('d6'), kw(24).arbeitstage.slice(0, 4))[0]).toMatch(/nötig 4/)
  })
})

describe('Zwei Wochen am Stück', () => {
  it('Fall 16: erkennt zwei aufeinanderfolgende volle Ferienwochen', () => {
    expect(zweiWochenAmStueck('d4', wochen, [], [woche('d4', kw(30))]).ok).toBe(false)
    expect(zweiWochenAmStueck('d4', wochen, [], [woche('d4', kw(29)), woche('d4', kw(30))]).ok).toBe(true)
    const f = kw(18).arbeitstage.map(d => ({ employee_id: 'd4', schedule_date: d, entry: 'F:0.8' }))
    expect(zweiWochenAmStueck('d4', wochen, f, [woche('d4', kw(19))])).toEqual({ ok: true, vollWochen: [18, 19] })
    expect(zweiWochenAmStueck('d4', wochen, f, [woche('d4', kw(19), 'abgelehnt')]).ok).toBe(false)
    // Teilzeit: Wochenanmeldungen mit gewählten Tagen zählen als volle Woche; F nur an den eigenen Arbeitstagen reicht
    const w29 = kw(29), w30 = kw(30)
    expect(zweiWochenAmStueck('d6', wochen, [], [{ ...woche('d6', w29), tage: w29.arbeitstage.slice(0, 2) }, { ...woche('d6', w30), tage: w30.arbeitstage.slice(0, 3) }]).ok).toBe(true)
    const nurMoDi = (t: string) => [1, 2].includes((new Date(`${t}T12:00:00`).getDay() + 6) % 7 + 1)
    const f2 = [...w29.arbeitstage.slice(0, 2), ...w30.arbeitstage.slice(0, 2)].map(d => ({ employee_id: 'd6', schedule_date: d, entry: 'F' }))
    expect(zweiWochenAmStueck('d6', wochen, f2, [], nurMoDi).ok).toBe(true)
    expect(zweiWochenAmStueck('d6', wochen, f2, []).ok).toBe(false)
  })
})

describe('Nur akzeptierte Anmeldungen zählen (Anzeige)', () => {
  it('nurAkzeptiert lässt offene Anmeldungen weg, akzeptierte und Einträge bleiben', () => {
    const w2 = kw(2), w30 = kw(30)
    const ctx = ctxMit({ wishes: [woche('z3', w2), { ...woche('z1', w30), status: 'akzeptiert' }] })
    // offen in KW 2: zählt für Regeln und Warnungen, nicht für die akzeptierte Belegung
    expect(kapazitaetFuer(ctx, w2).plaetzeBelegt.ZAZ).toBe(1)
    expect(kapazitaetFuer(nurAkzeptiert(ctx), w2).plaetzeBelegt.ZAZ).toBe(0)
    // akzeptiert in KW 30: zählt in beiden Sichten
    expect(kapazitaetFuer(ctx, w30).plaetzeBelegt.ZAZ).toBe(1)
    expect(kapazitaetFuer(nurAkzeptiert(ctx), w30).plaetzeBelegt.ZAZ).toBe(1)
    // der Kontext selbst bleibt unverändert
    expect(ctx.wishes).toHaveLength(2)
  })
})

describe('Mitarbeitende: nur Verfügbarkeit, keine Zahlen über andere', () => {
  const fk = (teile: Partial<Kontext> = {}, w: Woche = kw(30)): FerienKontext => ({ ...ctxMit(teile), konfig: { farben: {}, anspruch: {} }, wochen: [w], personRegelnGespeichert: {} })

  it('Wochenzahlen zeigen pro Kategorie Plätze und Belegung (offene zählen, wer zuerst kommt), aber keine Namen', () => {
    const ctx = fk({ wishes: [woche('d1', kw(30), 'akzeptiert'), woche('d2', kw(30)), woche('z2', kw(30), 'akzeptiert'), woche('h1', kw(30))] })
    const [w] = wochenFuerMitarbeiter(ctx, person('d4'))
    for (const k of ['ZAZ', 'DHPA', 'ASSISTENZ'] as const) expect(Object.keys(w.zaehler[k]).sort()).toEqual(['belegt', 'frei', 'plaetze'])
    // eine ZAZ akzeptiert weg, eine DH offen angemeldet: beides belegt einen Platz
    expect(w.zaehler.ZAZ).toEqual({ plaetze: 2, belegt: 1, frei: 1 })
    expect(w.zaehler.DHPA).toEqual({ plaetze: 4, belegt: 1, frei: 3 })
    expect(w.zaehler.ASSISTENZ.belegt).toBe(2)
    expect(w.zaehler.ASSISTENZ.plaetze).toBe(2 + w.zaehler.ASSISTENZ.frei)
    expect(JSON.stringify(w)).not.toMatch(/Laura|Daniela|Franziska|Dinusha|"akzeptiert"|"offen"/)
  })

  it('volle Woche: Anmeldung gesperrt mit Hinweis auf den Wunsch, rote Woche ohne Hinweis', () => {
    // KW 2 ist orange (1 ZAZ Platz), Paola hat ihn mit offener Anmeldung schon
    const gruende = pruefeAnmeldung(ctxMit({ wishes: [woche('z3', kw(2))] }), kw(2), person('z1'))
    expect(grundIstVoll(gruende[0])).toBe(true)
    const f = anmeldeFehler(gruende, 'KW 2: ')
    expect(f.voll).toBe(true)
    expect(f.error).toBe(`KW 2: Am Dienstag ist für ZAZ kein Platz mehr (1 Platz). ${VOLL_HINWEIS}`)
    const rot = anmeldeFehler(pruefeAnmeldung(ctxMit(), { ...kw(30), farbe: 'rot' }, person('z1')))
    expect(rot.voll).toBe(false)
    expect(rot.error).toBe('Rote Woche, keine Ferien.')
    // Assistenz: reicht nicht = voll
    const vollDa = ctxMit({ wishes: ['d1', 'd2', 'd3', 'd4', 'd5'].map(id => woche(id, kw(30), 'akzeptiert')) })
    expect(anmeldeFehler(pruefeAnmeldung(vollDa, kw(30), person('d6'))).voll).toBe(true)
    // Mitarbeiterseite: Woche nicht möglich, Grund ist «voll»
    const [w] = wochenFuerMitarbeiter({ ...vollDa, konfig: { farben: {}, anspruch: {} }, wochen: [kw(30)], personRegelnGespeichert: {} }, person('d6'))
    expect(w.moeglich).toBe(false)
    expect(grundIstVoll(w.nichtMoeglich)).toBe(true)
  })

  it('zählt Ferientage nach Pensum: 60 Prozent in einer Fünftagewoche sind 3 Tage', () => {
    expect(wochenFuerMitarbeiter(fk(), person('d6'))[0].tage).toBe(3)
    expect(wochenFuerMitarbeiter(fk(), person('d4'))[0].tage).toBe(4)
    expect(wochenFuerMitarbeiter(fk(), person('d5'))[0].tage).toBe(5)
    // Woche mit Feiertag (Auffahrt): 4 Arbeitstage, 60 Prozent sind 2,4 Tage
    expect(wochenFuerMitarbeiter(fk({}, kw(18)), person('d6'))[0].tage).toBe(2.4)
  })

  it('Empfehlung für die Assistenz: viel Spielraum, besonders wenn Behandler abwesend sind; nie für ZAZ oder rote Wochen', () => {
    const ohne = kapazitaetFuer(fk(), kw(30))
    const mitZaz = kapazitaetFuer(fk({ wishes: [woche('z1', kw(30), 'akzeptiert')] }), kw(30))
    // Zahnärztin weg: Bedarf sinkt, mehr Spielraum für die Assistenz
    expect(mitZaz.assistenz.bedarf).toBeLessThan(ohne.assistenz.bedarf)
    expect(mitZaz.assistenz.frei).toBeGreaterThan(ohne.assistenz.frei)
    const e = empfehlungAssistenz(mitZaz, kw(30), 'ASSISTENZ')
    expect(e.ja).toBe(true)
    expect(e.grund).toMatch(/Behandler abwesend an 5 Tagen/)
    expect(empfehlungAssistenz(mitZaz, kw(30), 'ZAZ').ja).toBe(false)
    expect(empfehlungAssistenz(mitZaz, { ...kw(30), farbe: 'rot' }, 'ASSISTENZ').ja).toBe(false)
    // Viele DA schon weg: kein Spielraum mehr, keine Empfehlung, weitere Anmeldung gesperrt
    const voll = fk({ wishes: ['d1', 'd2', 'd3', 'd4', 'd5'].map(id => woche(id, kw(30), 'akzeptiert')) })
    const kVoll = kapazitaetFuer(voll, kw(30))
    expect(kVoll.assistenz.freiPersonen).toBe(0)
    expect(empfehlungAssistenz(kVoll, kw(30), 'ASSISTENZ').ja).toBe(false)
    expect(pruefeAnmeldung(voll, kw(30), person('d6'))[0]).toMatch(/Für die Assistenz reicht es/)
    expect(wochenFuerMitarbeiter(voll, person('d6'))[0].empfohlen.ja).toBe(false)
  })
})

describe('Rote Woche: Öffnung für die Assistenz, wenn eine ZAZ fest fehlt', () => {
  const w = kw(26)   // rot, fünf Arbeitstage
  const [mo, di, , doo] = w.arbeitstage
  const fk = (ctx: Kontext): FerienKontext => ({ ...ctx, konfig: { farben: {}, anspruch: {} }, wochen: [w], personRegelnGespeichert: {} })

  it('ohne feste Behandlerferien bleibt Rot für alle zu, auch bei offener ZAZ Anmeldung oder voller Vertretung', () => {
    expect(w.farbe).toBe('rot')
    expect(kapazitaetFuer(ctxMit(), w).oeffnung?.offen).toEqual([])
    expect(kapazitaetFuer(ctxMit(), kw(30)).oeffnung).toBeNull()   // nur rote Wochen rechnen die Öffnung
    expect(pruefeAnmeldung(ctxMit(), w, person('d5'))).toEqual(['Rote Woche, keine Ferien'])
    // ein offener Wunsch von Paola öffnet noch nichts
    const offen = ctxMit({ wishes: [woche('z3', w)] })
    expect(kapazitaetFuer(offen, w).oeffnung?.offen).toEqual([])
    expect(tagesVerfuegbarkeit(offen, w, person('d5')).every(t => !t.moeglich && t.grund === 'Rote Woche, keine Ferien')).toBe(true)
    expect(wochenFuerMitarbeiter(fk(offen), person('d5'))[0].oeffnung).toBeNull()
    // akzeptiert, aber ganztags vertreten: der Bedarf bleibt, keine Öffnung
    const vertreten = ctxMit({ wishes: [woche('z3', w, 'akzeptiert')], vertretungen: { [`z3|${di}`]: 'Fritz Fahrländer', [`z3|${doo}`]: 'Fritz Fahrländer' } })
    expect(kapazitaetFuer(vertreten, w).oeffnung?.offen).toEqual([])
    expect(oeffnungText(kapazitaetFuer(vertreten, w).oeffnung)).toBe('')
  })

  it('Paola fest in den Ferien: Dienstag und Donnerstag offen mit je einem Platz, die anderen Tage bleiben zu', () => {
    const ctx = ctxMit({ wishes: [woche('z3', w, 'akzeptiert')] })
    const k = kapazitaetFuer(ctx, w)
    expect(k.oeffnung?.offen).toEqual([di, doo])
    expect(k.oeffnung?.tage.map(t => t.frei)).toEqual([0, 1, 0, 1, 0])
    expect(k.oeffnung?.freiPersonen).toBe(1)
    expect(k.oeffnung?.freiTage).toBe(2)
    const status = tagesVerfuegbarkeit(ctx, w, person('d5'))
    expect(status.map(s => s.moeglich)).toEqual([false, true, false, true, false])
    expect(status[0].grund).toBe('Rote Woche, am Montag ist keine Zahnärztin in den Ferien')
    expect(pruefeAnmeldung(ctx, w, person('d5'), [di, doo])).toEqual([])
    expect(pruefeAnmeldung(ctx, w, person('d5'))).toContain('Rote Woche, am Montag ist keine Zahnärztin in den Ferien')   // die ganze Woche geht nicht
    // ZAZ und DH / PA bleiben gesperrt
    expect(pruefeAnmeldung(ctx, w, person('z2'))).toEqual(['Rote Woche, keine Ferien'])
    expect(pruefeAnmeldung(ctx, w, person('h1'))).toEqual(['Rote Woche, keine Ferien'])
    expect(tagesVerfuegbarkeit(ctx, w, person('z2')).every(t => t.grund === 'Rote Woche, keine Ferien')).toBe(true)
    // Empfehlung: dort soll jemand von der Assistenz frei nehmen
    expect(empfehlungAssistenz(k, w, 'ASSISTENZ')).toEqual({ ja: true, grund: 'Eine Zahnärztin ist am Di und Do fest in den Ferien, eine Person der Assistenz darf dort frei nehmen' })
    expect(empfehlungAssistenz(k, w, 'ZAZ').ja).toBe(false)
    // Mitarbeiterseite: offen, Zähler ohne Namen
    const [z] = wochenFuerMitarbeiter(fk(ctx), person('d5'))
    expect(z.moeglich).toBe(true)
    expect(z.oeffnung).toEqual({ tage: [di, doo], frei: 1 })
    expect(z.zaehler.ASSISTENZ).toEqual({ plaetze: 1, belegt: 0, frei: 1 })
    expect(z.assistenzFrei).toBe(2)
    expect(z.empfohlen.ja).toBe(true)
    expect(JSON.stringify(z)).not.toMatch(/Paola|Maldonado|Assistentin/)
    // Admin: Öffnung mit Text, in grünen Wochen null
    const [a] = wochenFuerAdmin(fk(ctx))
    expect(a.oeffnungAkzeptiert?.freiPersonen).toBe(1)
    expect(a.oeffnungText).toBe('Eine Zahnärztin ist am Di und Do fest in den Ferien, eine Person der Assistenz darf dort frei nehmen')
    expect(wochenFuerAdmin({ ...fk(ctx), wochen: [kw(30)] })[0].oeffnung).toBeNull()
  })

  it('ist der Platz vergeben, ist der Tag voll (Hinweis auf den Wunsch), nie eine zweite Person', () => {
    const ctx = ctxMit({ wishes: [woche('z3', w, 'akzeptiert'), { ...woche('d5', w), tage: [di, doo] }] })
    const k = kapazitaetFuer(ctx, w)
    expect(k.oeffnung?.tage.map(t => t.belegt)).toEqual([0, 1, 0, 1, 0])
    expect(k.oeffnung?.freiPersonen).toBe(0)
    const g = pruefeAnmeldung(ctx, w, person('d4'), [di])
    expect(g[0]).toBe('Am Dienstag ist für die Assistenz kein Platz mehr (1 Platz, weil eine Zahnärztin in den Ferien ist)')
    expect(grundIstVoll(g[0])).toBe(true)
    expect(anmeldeFehler(g).voll).toBe(true)
    expect(empfehlungAssistenz(k, w, 'ASSISTENZ').ja).toBe(false)
    // Mitarbeiterseite: voll statt gesperrt, der Grund «voll» steht zuerst
    const [z] = wochenFuerMitarbeiter(fk(ctx), person('d4'))
    expect(z.moeglich).toBe(false)
    expect(grundIstVoll(z.nichtMoeglich)).toBe(true)
    expect(z.oeffnung).toEqual({ tage: [di, doo], frei: 0 })
    expect(z.zaehler.ASSISTENZ).toEqual({ plaetze: 1, belegt: 1, frei: 0 })
    // die Lernende mit 50 Prozent passt in einen halb belegten Platz, eine ganze Person nicht
    const halb = ctxMit({ wishes: [woche('z3', w, 'akzeptiert'), { ...woche('l2', w), tage: [di] }] })
    expect(kapazitaetFuer(halb, w).oeffnung?.tage[1].frei).toBe(0.5)
    expect(pruefeAnmeldung(halb, w, person('d5'), [di])[0]).toMatch(/kein Platz mehr/)
  })

  it('Fränzi die ganze Woche fest weg (F im Plan) und Paola akzeptiert: am Dienstag zwei Plätze, sonst einer', () => {
    const f: Eintrag[] = w.arbeitstage.map(d => ({ employee_id: 'z2', schedule_date: d, entry: 'F' }))
    const ctx = ctxMit({ eintraege: f, wishes: [woche('z3', w, 'akzeptiert')] })
    const k = kapazitaetFuer(ctx, w)
    expect(k.oeffnung?.tage.map(t => t.zazWeg)).toEqual([1, 2, 1, 1, 1])   // Fränzi hat am Donnerstag frei, dort nur Paola
    expect(k.oeffnung?.freiPersonen).toBe(2)
    expect(oeffnungText(k.oeffnung)).toBe('Mindestens eine Zahnärztin ist die ganze Woche fest in den Ferien, bis zu 2 Personen der Assistenz dürfen dort frei nehmen')
    expect(pruefeAnmeldung(ctx, w, person('d5'))).toEqual([])   // eine Person darf die ganze Woche
    const mitD5 = { ...ctx, wishes: [...ctx.wishes, woche('d5', w)] }
    expect(pruefeAnmeldung(mitD5, w, person('d4'), [di])).toEqual([])   // der zweite Platz nur am Dienstag
    expect(pruefeAnmeldung(mitD5, w, person('d4'), [mo])[0]).toMatch(/^Am Montag ist für die Assistenz kein Platz mehr/)
    expect(tagesVerfuegbarkeit(mitD5, w, person('d4')).map(s => s.moeglich)).toEqual([false, true, false, false, false])
    expect(kapazitaetFuer(mitD5, w).oeffnung?.freiPersonen).toBe(1)
  })

  it('die Wochenregel gilt weiter: reicht die Assistenz insgesamt nicht, bleibt der Tag trotz Lücke zu', () => {
    const f: Eintrag[] = w.arbeitstage.map(d => ({ employee_id: 'z2', schedule_date: d, entry: 'F' }))
    const ctx = ctxMit({ eintraege: f, regeln: { ...REGELN, reserve: 20 } })
    const k = kapazitaetFuer(ctx, w)
    expect(k.oeffnung?.freiPersonen).toBe(1)
    expect(k.assistenz.frei).toBeLessThan(0)
    expect(pruefeAnmeldung(ctx, w, person('d5'), [di])[0]).toMatch(/^Für die Assistenz reicht es/)
    const [z] = wochenFuerMitarbeiter(fk(ctx), person('d5'))
    expect(z.moeglich).toBe(false)
    expect(z.assistenzFrei).toBe(0)
  })
})
