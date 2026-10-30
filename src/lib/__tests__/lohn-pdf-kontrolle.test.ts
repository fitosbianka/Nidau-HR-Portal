import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { bezugZumMonat, titelPruefen, beurteile, monatLabel, zaehle, type KontrollePerson } from '@/lib/lohn-pdf-kontrolle'
import { buildLohnPdf } from '@/lib/lohn-pdf-build'
import { LOHN_SAETZE_2026 } from '@/lib/lohn'

const NAMEN = ['Sarah Aebischer', 'Dinusha Atapattu', 'Valérie Diserens', 'Emese Diserens', 'Noah Diserens']

describe('Kontrollansicht Abgelegte PDFs', () => {
  it('ordnet Dateien dem Monat zu: Monatslohn, Quartal, Halbjahr', () => {
    expect(monatLabel('2026-10')).toBe('Oktober 2026')
    expect(bezugZumMonat('Lohnabrechnung Oktober 2026', '2026-10')).toBe('monat')
    expect(bezugZumMonat('Lohnabrechnung September 2026', '2026-10')).toBeNull()
    expect(bezugZumMonat('Umsatzabrechnung 4. Quartal 2026', '2026-10')).toBe('periode')
    expect(bezugZumMonat('Umsatzabrechnung 3. Quartal 2026', '2026-10')).toBeNull()
    expect(bezugZumMonat('Umsatzabrechnung 2. Halbjahr 2026', '2026-10')).toBe('periode')
    expect(bezugZumMonat('Umsatzabrechnung 2. Halbjahr 2025', '2026-10')).toBeNull()
  })

  it('prüft den PDF-Titel gegen die Ordnerinhaberin, auch bei gleichem Nachnamen', () => {
    expect(titelPruefen('Lohnabrechnung Oktober 2026 Sarah Aebischer', 'Sarah Aebischer', NAMEN)).toEqual({ status: 'ok', name: 'Sarah Aebischer' })
    expect(titelPruefen('Lohnabrechnung Oktober 2026 Emese Diserens', 'Valérie Diserens', NAMEN)).toEqual({ status: 'fremd', name: 'Emese Diserens' })
    expect(titelPruefen('Lohnabrechnung Oktober 2026 Valérie Diserens', 'Valérie Diserens', NAMEN)).toEqual({ status: 'ok', name: 'Valérie Diserens' })
    expect(titelPruefen('', 'Sarah Aebischer', NAMEN)).toEqual({ status: 'unbekannt', name: null })
    expect(titelPruefen(null, 'Sarah Aebischer', NAMEN)).toEqual({ status: 'unbekannt', name: null })
    expect(titelPruefen('scan_0042.pdf', 'Sarah Aebischer', NAMEN)).toEqual({ status: 'unbekannt', name: null })
    expect(titelPruefen('Sarah Aebischer Lohn Oktober', 'Sarah Aebischer', NAMEN).status).toBe('ok')
  })

  it('Urteil pro Person: fremd vor allem, dann fehlt, nicht prüfbar, doppelt, in Ordnung', () => {
    const ok = { pruefung: { status: 'ok' as const, name: 'x' } }
    const fremd = { pruefung: { status: 'fremd' as const, name: 'y' } }
    const unbekannt = { pruefung: { status: 'unbekannt' as const, name: null } }
    expect(beurteile(true, [ok])).toBe('ok')
    expect(beurteile(true, [ok, ok])).toBe('doppelt')
    expect(beurteile(true, [ok, fremd])).toBe('fremd')
    expect(beurteile(true, [unbekannt])).toBe('unbekannt')
    expect(beurteile(true, [])).toBe('fehlt')
    expect(beurteile(false, [])).toBe('nicht_faellig')
    const personen = [{ urteil: 'ok' }, { urteil: 'ok' }, { urteil: 'fehlt' }] as KontrollePerson[]
    expect(zaehle(personen)).toMatchObject({ ok: 2, fehlt: 1, fremd: 0 })
  })

  it('ein vom Portal erzeugtes Lohn-PDF trägt den Namen der Mitarbeiterin im Titel', async () => {
    const bytes = await buildLohnPdf(
      { id: 'p1', full_name: 'Sarah Aebischer', address: 'Teststrasse 1\n3122 Kehrsatz', ahv_nummer: '756.0000.0000.00', pensum: 80, job_title: 'DA' },
      { titel: 'Lohnabrechnung', periode: 'Oktober 2026', monat: '2026-10', lines: [{ label: 'Monatslohn', betrag: 4604 }], zulagen: [], nach: [], ahv: true, alv: true, nbu: true, ktg: 'standard', pkAbzug: 0, qstSatz: null, deckelMonate: 1 },
      LOHN_SAETZE_2026,
    )
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(doc.getTitle()).toBe('Lohnabrechnung Oktober 2026 Sarah Aebischer')
    expect(titelPruefen(doc.getTitle(), 'Sarah Aebischer', NAMEN).status).toBe('ok')
    expect(titelPruefen(doc.getTitle(), 'Dinusha Atapattu', NAMEN)).toEqual({ status: 'fremd', name: 'Sarah Aebischer' })
  })
})
