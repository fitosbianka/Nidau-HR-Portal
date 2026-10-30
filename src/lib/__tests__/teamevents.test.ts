import { describe, expect, it } from 'vitest'
import { parseFotos, fotoalbumIntro, TE_FOTO_PREFIX } from '@/lib/teamevents'
import { parseEinstellungen, BINGO_STANDARD } from '@/lib/teamevent-bingo'

describe('Fotoalbum', () => {
  it('liest die Beschreibung eines Fotos, alte Zeilen ohne Beschreibung bleiben gültig', () => {
    const rows = [
      { user_full_name: `${TE_FOTO_PREFIX}europapark-2026__abc12345`, schedule_date: '2026-10-23', comment: JSON.stringify({ name: 'IMG_1.jpg', mime: 'image/jpeg', bytes: 1200, von: 'Neya Krishnamoorthy', am: '2026-10-23T12:00:00.000Z', thumb: true, beschreibung: '  Silver Star am Morgen  ' }) },
      { user_full_name: `${TE_FOTO_PREFIX}europapark-2026__abc12346`, schedule_date: '2026-10-23', comment: JSON.stringify({ name: 'IMG_2.jpg', von: 'Bianka Fitos', am: '2026-10-23T13:00:00.000Z' }) },
    ]
    const f = parseFotos(rows)
    expect(f).toHaveLength(2)
    expect(f[0]).toMatchObject({ id: 'abc12346', beschreibung: '' })
    expect(f[1]).toMatchObject({ id: 'abc12345', beschreibung: 'Silver Star am Morgen', von: 'Neya Krishnamoorthy' })
  })
  it('Einleitung oben im Album, Europapark 2026 mit eigenem Text', () => {
    expect(fotoalbumIntro({ slug: 'europapark-2026', name: 'Europapark 2026' })).toMatch(/^Das ist der Fotoordner unseres Ausflugs in den Europapark im Oktober 2026\. Lade gern/)
    expect(fotoalbumIntro({ slug: 'skitag-2027', name: 'Skitag 2027' })).toMatch(/^Das ist der Fotoordner zu «Skitag 2027»\./)
    for (const t of [fotoalbumIntro({ slug: 'europapark-2026', name: 'x' })]) expect(t).not.toMatch(/[:\-–]/)
  })
  it('Album ist offen, ausser es ist gesperrt; alte Schlüssel albumFreigabe und Zeitfenster zählen nicht mehr', () => {
    expect(BINGO_STANDARD.albumGesperrt).toBe(false)
    expect(parseEinstellungen('{"albumFreigabe":false,"albumStart":"2026-10-23T07:00:00+02:00"}').albumGesperrt).toBe(false)
    expect(parseEinstellungen('{"albumGesperrt":true}').albumGesperrt).toBe(true)
  })
})
