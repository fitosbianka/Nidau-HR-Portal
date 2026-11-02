import { describe, expect, it } from 'vitest'
import { parseNoteComment, encodeNoteEntries, eintragAnfuegen, eintragAendern, notizText, einzigerAutor } from '@/lib/plan-notes'

describe('Notizen zur Planung mit Einträgen und Kürzel', () => {
  it('liest alte Zeilen als einen Eintrag (JSON oder reiner Text)', () => {
    expect(parseNoteComment('{"t":"Melinda nur vormittags","by":"BF"}')).toEqual({ text: 'Melinda nur vormittags', by: 'BF', to: null, eintraege: [{ text: 'Melinda nur vormittags', by: 'BF', at: null, geaendert: null }] })
    expect(parseNoteComment('Betriebsferien')).toEqual({ text: 'Betriebsferien', by: null, to: null, eintraege: [{ text: 'Betriebsferien', by: null, at: null, geaendert: null }] })
    expect(parseNoteComment('{"t":"","by":"BF"}').eintraege).toEqual([])
    expect(parseNoteComment('{"t":"x","to":"2026-11-07"}').to).toBe('2026-11-07')
    expect(parseNoteComment('{"t":"x","to":"7.11."}').to).toBeNull()
  })

  it('anfügen, ändern, löschen; Kürzel und Zeit bleiben, Änderung durch andere wird vermerkt', () => {
    let e = eintragAnfuegen([], 'Steri Schulung 13.00 Uhr', 'BF', '2026-11-02T13:12:00.000Z')
    e = eintragAnfuegen(e, 'Zorana erst ab 9.00 Uhr', 'LG', '2026-11-02T14:05:00.000Z')
    expect(e).toHaveLength(2)
    expect(notizText(e)).toBe('BF: Steri Schulung 13.00 Uhr · LG: Zorana erst ab 9.00 Uhr')
    expect(einzigerAutor(e)).toBeNull()
    // Laura passt den Eintrag von Bianka an: Kürzel BF bleibt, LG kommt als Änderung dazu
    e = eintragAendern(e, 0, 'Steri Schulung 14.00 Uhr', 'LG')
    expect(e[0]).toEqual({ text: 'Steri Schulung 14.00 Uhr', by: 'BF', at: '2026-11-02T13:12:00.000Z', geaendert: 'LG' })
    // dieselbe Person ändert ihren eigenen Eintrag: kein Vermerk
    e = eintragAendern(e, 1, 'Zorana erst ab 9.30 Uhr', 'LG')
    expect(e[1].geaendert).toBeNull()
    // ungültige Position: unverändert
    expect(eintragAendern(e, 5, 'x', 'BF')).toBe(e)
    // leerer Text löscht den Eintrag
    e = eintragAendern(e, 0, '   ', 'BF')
    expect(e.map(x => x.text)).toEqual(['Zorana erst ab 9.30 Uhr'])
    expect(notizText(e)).toBe('Zorana erst ab 9.30 Uhr')
    expect(einzigerAutor(e)).toBe('LG')
  })

  it('Speicherform: Einträge gehen verlustfrei hin und zurück, Zusammenfassung für ältere Leser bleibt gefüllt', () => {
    const e = eintragAendern(eintragAnfuegen(eintragAnfuegen([], 'A', 'BF', '2026-11-02T13:12:00.000Z'), 'B', 'LG', '2026-11-02T14:05:00.000Z'), 0, 'A2', 'LG')
    const raw = encodeNoteEntries(e, '2026-11-06')
    const j = JSON.parse(raw)
    expect(j.t).toBe('BF: A2 · LG: B')
    expect(j.by).toBeNull()
    expect(j.to).toBe('2026-11-06')
    expect(parseNoteComment(raw)).toEqual({ text: 'BF: A2 · LG: B', by: null, to: '2026-11-06', eintraege: e })
    const einzeln = encodeNoteEntries(eintragAnfuegen([], 'Nur ich', 'BF', '2026-11-02T13:12:00.000Z'), null)
    expect(JSON.parse(einzeln)).toMatchObject({ t: 'Nur ich', by: 'BF' })
    expect(JSON.parse(einzeln).to).toBeUndefined()
  })
})
