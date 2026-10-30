import { describe, expect, it } from 'vitest'
import {
  addTage, anzahlProAufgabe, auswerten, darfAufgabenZeit, fmtDauer, fmtDauerKurz, haeufigsteAufgaben, isoKw, konfigBereinigen, montagVon, parseTag, parseZeitRows,
  periodeFuer, periodeVerschieben, tagZuJson, tagesSumme, zuletztVerwendet, zusammenfassung, type AufgabenKonfig, type ZeitEintrag,
} from '@/lib/aufgaben-zeit'

const konfig: AufgabenKonfig = {
  kategorien: [
    { id: 'kat1admin', name: 'Administration', aufgaben: [{ id: 'lohn0001', titel: 'Lohnabrechnungen', archiviert: false }, { id: 'post0001', titel: 'Post und Mails', archiviert: false }] },
    { id: 'kat2team', name: 'Team', aufgaben: [{ id: 'plan0001', titel: 'Arbeitsplan', archiviert: false }, { id: 'alt00001', titel: 'Alte Aufgabe', archiviert: true }] },
  ],
}
const e = (datum: string, aufgabeId: string, minuten: number, erfasst = `${datum}T10:00:00.000Z`): ZeitEintrag => ({ id: `id${datum.replace(/-/g, '')}${minuten}`.slice(0, 20), datum, aufgabeId, minuten, notiz: null, erfasst })
const eintraege: ZeitEintrag[] = [
  e('2026-10-26', 'lohn0001', 120), e('2026-10-26', 'post0001', 30),
  e('2026-10-27', 'lohn0001', 60), e('2026-10-27', 'plan0001', 45),
  e('2026-10-29', 'lohn0001', 90, '2026-10-29T15:00:00.000Z'), e('2026-10-29', 'weg00001', 15, '2026-10-29T16:00:00.000Z'),
  e('2026-11-02', 'plan0001', 240),
]

describe('Aufgaben Zeiterfassung', () => {
  it('nur Bianka als Admin', () => {
    expect(darfAufgabenZeit('admin', 'Bianka Fitos')).toBe(true)
    expect(darfAufgabenZeit('admin', 'Peter Diserens')).toBe(false)
    expect(darfAufgabenZeit('employee', 'Bianka Fitos')).toBe(false)
  })

  it('Perioden: Woche Montag bis Sonntag mit KW, Monat, Jahr, verschieben', () => {
    expect(montagVon('2026-10-29')).toBe('2026-10-26')
    expect(isoKw('2026-10-29')).toBe(44)
    expect(addTage('2026-10-31', 1)).toBe('2026-11-01')
    const w = periodeFuer('2026-10-29', 'woche')
    expect(w).toMatchObject({ von: '2026-10-26', bis: '2026-11-01', label: 'KW 44, 26.10. bis 01.11.2026' })
    expect(periodeFuer('2026-10-29', 'monat')).toMatchObject({ von: '2026-10-01', bis: '2026-10-31', label: 'Oktober 2026' })
    expect(periodeFuer('2026-02-10', 'monat')).toMatchObject({ von: '2026-02-01', bis: '2026-02-28' })
    expect(periodeFuer('2026-12-10', 'monat')).toMatchObject({ von: '2026-12-01', bis: '2026-12-31' })
    expect(periodeFuer('2026-10-29', 'jahr')).toMatchObject({ von: '2026-01-01', bis: '2026-12-31', label: '2026' })
    expect(periodeVerschieben('2026-10-29', 'woche', -1)).toBe('2026-10-19')
    expect(periodeVerschieben('2026-12-15', 'monat', 1)).toBe('2027-01-01')
    expect(periodeVerschieben('2026-01-15', 'monat', -1)).toBe('2025-12-01')
    expect(periodeVerschieben('2026-10-29', 'jahr', 1)).toBe('2027-01-01')
  })

  it('Dauer formatiert als Std. und Min.', () => {
    expect(fmtDauer(0)).toBe('0 Min.')
    expect(fmtDauer(45)).toBe('45 Min.')
    expect(fmtDauer(120)).toBe('2 Std.')
    expect(fmtDauer(135)).toBe('2 Std. 15 Min.')
    expect(fmtDauerKurz(135)).toBe('2:15')
    expect(fmtDauerKurz(5)).toBe('0:05')
  })

  it('wertet eine Woche aus: Total, Anteile, Reihenfolge, gelöschte Aufgabe, Tage', () => {
    const a = auswerten(eintraege, konfig, '2026-10-26', '2026-11-01')
    expect(a.total).toBe(360)
    expect(a.anzahl).toBe(6)
    expect(a.tage).toBe(3)
    expect(a.top.map(t => [t.titel, t.minuten, t.anteil])).toEqual([
      ['Lohnabrechnungen', 270, 75], ['Arbeitsplan', 45, 13], ['Post und Mails', 30, 8], ['Gelöschte Aufgabe', 15, 4],
    ])
    expect(a.kategorien.map(k => [k.name, k.minuten, k.anteil])).toEqual([['Administration', 300, 83], ['Team', 45, 13], ['Gelöschte Aufgaben', 15, 4]])
    expect(a.proTag).toEqual([{ datum: '2026-10-26', minuten: 150 }, { datum: '2026-10-27', minuten: 105 }, { datum: '2026-10-29', minuten: 105 }])
    // Monat enthält auch den 2. November nicht
    expect(auswerten(eintraege, konfig, '2026-10-01', '2026-10-31').total).toBe(360)
    expect(auswerten(eintraege, konfig, '2026-11-01', '2026-11-30').total).toBe(240)
  })

  it('schreibt den Absatz, welche Aufgabe am meisten Zeit nimmt', () => {
    const p = periodeFuer('2026-10-29', 'woche')
    const a = auswerten(eintraege, konfig, p.von, p.bis)
    expect(zusammenfassung(a, p)).toBe(
      'In der KW 44 (26.10. bis 01.11.2026) hast du insgesamt 6 Std. an 3 Tagen mit 6 Einträgen erfasst. '
      + 'Am meisten Zeit nimmt «Lohnabrechnungen» (Administration) mit 4 Std. 30 Min., das sind 75 % der erfassten Zeit. '
      + 'Danach folgen «Arbeitsplan» mit 45 Min. (13 %) und «Post und Mails» mit 30 Min. (8 %). '
      + 'Nach Kategorien liegt «Administration» mit 5 Std. (83 %) vorne. '
      + 'Im Schnitt sind das 2 Std. pro Tag mit Einträgen.',
    )
    const leer = periodeFuer('2026-09-10', 'monat')
    expect(zusammenfassung(auswerten(eintraege, konfig, leer.von, leer.bis), leer)).toBe('Im September 2026 hast du noch keine Zeit erfasst.')
    const nov = periodeFuer('2026-11-02', 'monat')
    expect(zusammenfassung(auswerten(eintraege, konfig, nov.von, nov.bis), nov)).toBe(
      'Im November 2026 hast du insgesamt 4 Std. an 1 Tag mit 1 Eintrag erfasst. Am meisten Zeit nimmt «Arbeitsplan» (Team) mit 4 Std., das sind 100 % der erfassten Zeit.',
    )
  })

  it('Tagessumme, zuletzt verwendete Aufgaben, Einträge pro Aufgabe', () => {
    expect(tagesSumme(eintraege, '2026-10-26')).toBe(150)
    expect(zuletztVerwendet(eintraege, 3)).toEqual(['plan0001', 'weg00001', 'lohn0001'])
    expect(anzahlProAufgabe(eintraege).get('lohn0001')).toBe(3)
    // häufigste: Lohn 3×, Plan 2× (285 Min.), Post 1× (30), weg 1× (15)
    expect(haeufigsteAufgaben(eintraege, 5).map(h => [h.id, h.anzahl, h.minuten])).toEqual([['lohn0001', 3, 270], ['plan0001', 2, 285], ['post0001', 1, 30], ['weg00001', 1, 15]])
    expect(haeufigsteAufgaben(eintraege, 2)).toHaveLength(2)
    expect(haeufigsteAufgaben([], 5)).toEqual([])
  })

  it('bereinigt die Konfiguration und liest Tageszeilen', () => {
    const k = konfigBereinigen({ kategorien: [
      { id: 'kat1admin', name: '  Administration ', aufgaben: [{ id: 'lohn0001', titel: 'Lohn' }, { id: 'BAD', titel: 'x' }, { id: 'lohn0001', titel: 'Dublette' }, { id: 'ok000002', titel: '   ' }] },
      { id: 'kat2team', name: '', aufgaben: [] },
      { id: 'kat3xyz1', name: 'Team', aufgaben: [{ id: 'plan0001', titel: 'Plan', archiviert: true }] },
    ] })
    expect(k).toEqual({ kategorien: [
      { id: 'kat1admin', name: 'Administration', aufgaben: [{ id: 'lohn0001', titel: 'Lohn', archiviert: false }] },
      { id: 'kat3xyz1', name: 'Team', aufgaben: [{ id: 'plan0001', titel: 'Plan', archiviert: true }] },
    ] })
    expect(konfigBereinigen('quatsch')).toBeNull()
    expect(konfigBereinigen({ kategorien: 'x' })).toBeNull()
    const tag = parseTag('2026-10-29', tagZuJson([e('2026-10-29', 'lohn0001', 90), { ...e('2026-10-29', 'post0001', 15), notiz: ' Mails ' }]))
    expect(tag).toHaveLength(2)
    expect(tag[1]).toMatchObject({ datum: '2026-10-29', aufgabeId: 'post0001', minuten: 15, notiz: 'Mails' })
    expect(parseTag('2026-10-29', '{"eintraege":[{"id":"x","aufgabeId":"lohn0001","minuten":10},{"id":"abcd1234","aufgabeId":"lohn0001","minuten":0}]}')).toEqual([])
    expect(parseTag('2026-10-29', 'kaputt')).toEqual([])
    const rows = parseZeitRows([{ schedule_date: '2026-10-30', comment: tagZuJson([e('2026-10-30', 'lohn0001', 10)]) }, { schedule_date: '2026-10-29', comment: tagZuJson([e('2026-10-29', 'lohn0001', 20)]) }])
    expect(rows.map(r => r.datum)).toEqual(['2026-10-29', '2026-10-30'])
  })
})
