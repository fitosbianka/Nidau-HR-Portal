import { describe, expect, it } from 'vitest'
import {
  erinnerungTermin, naechsteErinnerung, ersterTerminAb, erinnerungFaellig, gueltigesDatum, datumCH,
  parseBeobachtenRow, BEOBACHTEN_PREFIX,
} from '@/lib/bestellungen'

describe('Erinnerungen «Im Auge behalten»', () => {
  it('Wochenrhythmen zählen in Tagen, Monatsrhythmen behalten den Tag und kappen am Monatsende', () => {
    expect(erinnerungTermin('2026-10-20', 'w1', 1)).toBe('2026-10-27')
    expect(erinnerungTermin('2026-10-20', 'w2', 2)).toBe('2026-11-17')
    expect(erinnerungTermin('2026-10-20', 'w3', 1)).toBe('2026-11-10')
    expect(erinnerungTermin('2026-01-31', 'm1', 1)).toBe('2026-02-28')
    expect(erinnerungTermin('2026-01-31', 'm1', 2)).toBe('2026-03-31')
    expect(erinnerungTermin('2026-11-30', 'm3', 1)).toBe('2027-02-28')
    expect(erinnerungTermin('2026-10-20', 'm6', 1)).toBe('2027-04-20')
    expect(erinnerungTermin('2028-02-29', 'j1', 1)).toBe('2029-02-28')
    expect(erinnerungTermin('2026-10-20', 'einmalig', 5)).toBe('2026-10-20')
  })

  it('nächster Termin liegt strikt nach heute — auch wenn mehrere Termine verpasst wurden', () => {
    expect(naechsteErinnerung({ ab: '2026-11-01', rhythmus: 'm1' }, '2026-11-03')).toBe('2026-12-01')
    expect(naechsteErinnerung({ ab: '2026-11-01', rhythmus: 'm1' }, '2026-12-05')).toBe('2027-01-01')
    expect(naechsteErinnerung({ ab: '2026-10-20', rhythmus: 'w1' }, '2026-10-20')).toBe('2026-10-27')
    expect(naechsteErinnerung({ ab: '2020-01-15', rhythmus: 'w2' }, '2026-10-20')).toBe('2026-10-28')
    expect(naechsteErinnerung({ ab: '2026-10-20', rhythmus: 'einmalig' }, '2026-10-20')).toBeNull()
  })

  it('erster Termin ab heute: ein Anker in der Vergangenheit macht einen Rhythmus nicht rückwirkend fällig', () => {
    expect(ersterTerminAb({ ab: '2026-10-01', rhythmus: 'm1' }, '2026-10-20')).toBe('2026-11-01')
    expect(ersterTerminAb({ ab: '2026-10-20', rhythmus: 'm1' }, '2026-10-20')).toBe('2026-10-20')
    expect(ersterTerminAb({ ab: '2026-12-24', rhythmus: 'j1' }, '2026-10-20')).toBe('2026-12-24')
    expect(ersterTerminAb({ ab: '2026-10-01', rhythmus: 'einmalig' }, '2026-10-20')).toBe('2026-10-01')
  })

  it('fällig, sobald heute den nächsten Termin erreicht', () => {
    const e = { ab: '2026-10-20', rhythmus: 'm1' as const, naechste: '2026-10-20' }
    expect(erinnerungFaellig({ erinnerung: e }, '2026-10-19')).toBe(false)
    expect(erinnerungFaellig({ erinnerung: e }, '2026-10-20')).toBe(true)
    expect(erinnerungFaellig({ erinnerung: e }, '2026-11-02')).toBe(true)
    expect(erinnerungFaellig({ erinnerung: null }, '2026-11-02')).toBe(false)
  })

  it('Datumsprüfung und Anzeige', () => {
    expect(gueltigesDatum('2026-02-28')).toBe(true)
    expect(gueltigesDatum('2026-02-31')).toBe(false)
    expect(gueltigesDatum('20.10.2026')).toBe(false)
    expect(gueltigesDatum(null)).toBe(false)
    expect(datumCH('2026-10-20')).toBe('20.10.2026')
  })

  it('gespeicherte Zeilen: Erinnerung wird gelesen, kaputte Erinnerung verworfen, alte Zeilen ohne Feld bleiben gültig', () => {
    const mit = parseBeobachtenRow(`${BEOBACHTEN_PREFIX}a1`, JSON.stringify({
      name: 'Ersatzlampe', firma: 'Kaladent', erstellt: '2026-10-01T08:00:00.000Z', erstelltVon: 'Neya',
      erinnerung: { ab: '2026-11-01', rhythmus: 'm2', naechste: '2027-01-01' },
    }))
    expect(mit?.erinnerung).toEqual({ ab: '2026-11-01', rhythmus: 'm2', naechste: '2027-01-01' })
    const kaputt = parseBeobachtenRow(`${BEOBACHTEN_PREFIX}a2`, JSON.stringify({
      name: 'X', firma: 'Y', erinnerung: { ab: 'bald', rhythmus: 'm1' },
    }))
    expect(kaputt?.erinnerung).toBeNull()
    const alt = parseBeobachtenRow(`${BEOBACHTEN_PREFIX}a3`, JSON.stringify({ name: 'X', firma: 'Y' }))
    expect(alt?.erinnerung).toBeNull()
  })
})
