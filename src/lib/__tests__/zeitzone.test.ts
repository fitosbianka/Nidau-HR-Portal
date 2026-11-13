import { describe, expect, it } from 'vitest'
import { timemotoZeitZuDate, zurichMonatsStart, zurichOffsetMinuten, zurichOffsetText, zurichTagesFenster, zurichZuIso } from '@/lib/zeitzone'

describe('Zürcher Zeitzone', () => {
  it('Offset je nach Zeitpunkt, nicht nach Monat: Ende Oktober 2026 gilt schon Winterzeit', () => {
    expect(zurichOffsetMinuten(new Date('2026-10-29T06:10:00Z'))).toBe(60)
    expect(zurichOffsetMinuten(new Date('2026-10-24T05:10:00Z'))).toBe(120)
    // Umstellung am 25.10.2026 um 01:00 UTC (03:00 Sommerzeit wird 02:00)
    expect(zurichOffsetMinuten(new Date('2026-10-25T00:30:00Z'))).toBe(120)
    expect(zurichOffsetMinuten(new Date('2026-10-25T01:30:00Z'))).toBe(60)
    expect(zurichOffsetText(new Date('2026-10-29T12:00:00Z'))).toBe('+01:00')
    expect(zurichOffsetText(new Date('2026-07-01T12:00:00Z'))).toBe('+02:00')
  })

  it('Wandzeit in Zürich wird richtig nach UTC gerechnet (der gemeldete Fall: 07:10 am 29.10.2026)', () => {
    expect(zurichZuIso('2026-10-29', '07:10')).toBe('2026-10-29T06:10:00.000Z')
    expect(zurichZuIso('2026-10-29', '07:42')).toBe('2026-10-29T06:42:00.000Z')
    expect(zurichZuIso('2026-10-24', '07:10')).toBe('2026-10-24T05:10:00.000Z')
    // Umstellung im Frühling 2026 am 29.3.
    expect(zurichZuIso('2026-03-28', '07:10')).toBe('2026-03-28T06:10:00.000Z')
    expect(zurichZuIso('2026-03-30', '07:10')).toBe('2026-03-30T05:10:00.000Z')
    // Tag der Herbstumstellung: vor und nach der doppelten Stunde
    expect(zurichZuIso('2026-10-25', '01:30')).toBe('2026-10-24T23:30:00.000Z')
    expect(zurichZuIso('2026-10-25', '04:00')).toBe('2026-10-25T03:00:00.000Z')
    expect(zurichZuIso('2026-12-31', '23:59:30')).toBe('2026-12-31T22:59:30.000Z')
    // Anzeige zurück in Zürcher Zeit ergibt wieder die Eingabe
    expect(new Date(zurichZuIso('2026-10-29', '07:10')).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' })).toBe('07:10')
  })

  it('TimeMoto Stempel (Wandzeit ohne Kennzeichen) werden an jedem Tag richtig gelesen', () => {
    const iso = (s: string) => timemotoZeitZuDate(s)?.toISOString()
    expect(iso('2026-10-29T07:10:00')).toBe('2026-10-29T06:10:00.000Z')
    expect(iso('2026-10-26T07:10:00')).toBe('2026-10-26T06:10:00.000Z')
    expect(iso('2026-10-24T07:10:00')).toBe('2026-10-24T05:10:00.000Z')
    expect(iso('2026-10-25 01:30:00')).toBe('2026-10-24T23:30:00.000Z')
    expect(iso('2026-10-25T04:00:00')).toBe('2026-10-25T03:00:00.000Z')
    expect(iso('2026-03-28T07:10:00')).toBe('2026-03-28T06:10:00.000Z')
    expect(iso('2026-03-30T07:10:00')).toBe('2026-03-30T05:10:00.000Z')
    // mit Kennzeichen unverändert übernommen
    expect(iso('2026-10-29T06:10:00Z')).toBe('2026-10-29T06:10:00.000Z')
    expect(iso('2026-10-29T07:10:00+01:00')).toBe('2026-10-29T06:10:00.000Z')
    expect(timemotoZeitZuDate('')).toBeNull()
    expect(timemotoZeitZuDate('kaputt')).toBeNull()
  })


  it('Tagesfenster und Monatsstart in UTC, auch am Tag der Zeitumstellung', () => {
    expect(zurichTagesFenster('2026-10-29')).toEqual({ start: '2026-10-28T23:00:00.000Z', ende: '2026-10-29T23:00:00.000Z' })
    expect(zurichTagesFenster('2026-10-25')).toEqual({ start: '2026-10-24T22:00:00.000Z', ende: '2026-10-25T23:00:00.000Z' })
    expect(zurichTagesFenster('2026-07-15')).toEqual({ start: '2026-07-14T22:00:00.000Z', ende: '2026-07-15T22:00:00.000Z' })
    expect(zurichMonatsStart('2026-10-29')).toBe('2026-09-30T22:00:00.000Z')
    expect(zurichMonatsStart('2026-11-03')).toBe('2026-10-31T23:00:00.000Z')
  })
})
