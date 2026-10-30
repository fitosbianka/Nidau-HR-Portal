import { describe, expect, it } from 'vitest'
import { berechneLohn, fmtLohnChf, rundRappen, zeilenWieExcel, sauberManuell, eintrittAbzug, unbezahltAbzug, LOHN_SAETZE_2026, LOHN_STAMM_DEFAULT, lohnSeedFor, korrigiereStamm } from '@/lib/lohn'

describe('Rappenrundung wie Excel', () => {
  it('rundet kaufmännisch ohne Gleitkomma Fehler', () => {
    expect(rundRappen(1.005)).toBe(1.01)
    expect(rundRappen(2.675)).toBe(2.68)
    expect(rundRappen(775.125)).toBe(775.13)
    expect(rundRappen(-1.005)).toBe(-1.01)
    expect(fmtLohnChf(1.005)).toBe('1.01')
    expect(fmtLohnChf(-2273.501)).toBe("-2'273.50")
    expect(fmtLohnChf(12351.499)).toBe("12'351.50")
  })
})

describe('Lohnrechnung wie das Lohn-Excel: 13. und Abzüge exakt, gerundet erst bei der Anzeige', () => {
  const abr = (ml: number, pk: number, ktg: 'standard' | 'erhoeht', zulagen: number[] = [], dreizehnter = ml / 12) => ({
    lines: [{ label: 'Monatslohn', betrag: ml }, { label: 'Anteil 13. Monatslohn', betrag: dreizehnter }],
    zulagen: zulagen.map(b => ({ label: 'Ausbildungszulage', betrag: b })), nach: [],
    ahv: true, alv: true, nbu: true, ktg, pkAbzug: pk, qstSatz: null,
  })
  it('Dinusha Oktober 2026 laut Excel: Auszahlung 5006.02', () => {
    const c = berechneLohn(abr(5120, 347.2, 'standard', [310]), LOHN_SAETZE_2026)
    expect(fmtLohnChf(c.brutto)).toBe("5'546.67")
    expect(c.abzuege.map(a => fmtLohnChf(a.betrag))).toEqual(['-293.97', '-61.01', '-94.07', '-54.39', '-347.20'])
    expect(fmtLohnChf(c.abzugTotal)).toBe('-850.64')
    expect(fmtLohnChf(c.auszahlung)).toBe("5'006.02")
  })
  it('Dinusha Januar bis September 2026 laut AHV Blatt: Nettolohn 4863.17', () => {
    expect(fmtLohnChf(berechneLohn(abr(4960, 332.45, 'standard', [310]), LOHN_SAETZE_2026).auszahlung)).toBe("4'863.17")
  })
  it('gespeicherter, auf den Rappen gerundeter 13. wird wieder exakt gerechnet', () => {
    const gerundet = abr(5120, 347.2, 'standard', [310], 426.67)
    expect(zeilenWieExcel(gerundet.lines)[1].betrag).toBe(5120 / 12)
    expect(fmtLohnChf(berechneLohn(gerundet, LOHN_SAETZE_2026).auszahlung)).toBe("5'006.02")
    // Pro rata oder andere Beträge bleiben unverändert
    const anders = [{ label: 'Monatslohn', betrag: 5120 }, { label: 'Anteil 13. Monatslohn', betrag: 400 }]
    expect(zeilenWieExcel(anders)).toBe(anders)
  })
  it('Valérie Januar 2026 laut Excel: AHV 775.13, Abzüge 2273.50, Auszahlung 12351.50', () => {
    const c = berechneLohn(abr(13500, 947.15, 'erhoeht'), LOHN_SAETZE_2026)
    expect(fmtLohnChf(c.brutto)).toBe("14'625.00")
    expect(c.abzuege.map(a => fmtLohnChf(a.betrag))).toEqual(['-775.13', '-135.85', '-209.46', '-205.92', '-947.15'])
    expect(fmtLohnChf(c.abzugTotal)).toBe("-2'273.50")
    expect(fmtLohnChf(c.auszahlung)).toBe("12'351.50")
  })
  it('Valérie Oktober 2026 laut Excel: Auszahlung 13744.64, ALV und NBU beim Deckel', () => {
    const c = berechneLohn(abr(15000, 1070, 'erhoeht'), LOHN_SAETZE_2026)
    expect(c.abzuege[1].basis).toBe(12350)
    expect(fmtLohnChf(c.abzugTotal)).toBe("-2'505.36")
    expect(fmtLohnChf(c.auszahlung)).toBe("13'744.64")
  })
})

describe('Von Hand überschriebene Werte wie im Excel', () => {
  const basis = {
    lines: [{ label: 'Monatslohn', betrag: 5120 }, { label: 'Anteil 13. Monatslohn', betrag: 5120 / 12 }],
    zulagen: [{ label: 'Ausbildungszulage', betrag: 310 }], nach: [],
    ahv: true, alv: true, nbu: true, ktg: 'standard' as const, pkAbzug: 347.2, qstSatz: null,
  }
  it('ohne Übersteuerung bleibt alles berechnet', () => {
    const c = berechneLohn(basis, LOHN_SAETZE_2026)
    expect(c.abzuege.some(a => a.manuell)).toBe(false)
    expect(fmtLohnChf(c.auszahlung)).toBe("5'006.02")
  })
  it('überschriebener Betrag gilt wie eingegeben, Total und Auszahlung rechnen mit', () => {
    const c = berechneLohn({ ...basis, manuell: { nbu: { betrag: 94.05 } } }, LOHN_SAETZE_2026)
    const nbu = c.abzuege.find(a => a.key === 'nbu')!
    expect(nbu.betrag).toBe(-94.05); expect(nbu.manuell).toBe(true)
    expect(fmtLohnChf(nbu.auto!.betrag)).toBe('-94.07')
    expect(fmtLohnChf(c.auszahlung)).toBe("5'006.04")
  })
  it('überschriebene Basis oder Satz rechnen den Betrag neu', () => {
    const c = berechneLohn({ ...basis, manuell: { ahv: { basis: 5000 }, ktg: { satz: 0.01 } } }, LOHN_SAETZE_2026)
    expect(c.abzuege.find(a => a.key === 'ahv')!.betrag).toBe(-265)
    expect(fmtLohnChf(c.abzuege.find(a => a.key === 'ktg')!.betrag)).toBe('-55.47')
  })
  it('überschriebener 13. Monatslohn wird nie automatisch korrigiert', () => {
    const lines = [{ label: 'Monatslohn', betrag: 5120 }, { label: 'Anteil 13. Monatslohn', betrag: 426.67, manuell: true }]
    expect(zeilenWieExcel(lines)).toBe(lines)
    expect(fmtLohnChf(berechneLohn({ ...basis, lines }, LOHN_SAETZE_2026).auszahlung)).toBe("5'006.03")
  })
  it('Quellensteuer lässt sich überschreiben, auch ohne Satz in den Stammdaten', () => {
    const c = berechneLohn({ ...basis, manuell: { qst: { betrag: 400 } } }, LOHN_SAETZE_2026)
    expect(c.qstBetrag).toBe(-400); expect(c.qst.manuell).toBe(true)
  })
  it('gespeichert werden nur gültige Zahlen', () => {
    expect(sauberManuell({ ahv: { betrag: 12.345, basis: -1, satz: 2 }, alv: {}, foo: { betrag: 1 }, nbu: { satz: 0.017 } }))
      .toEqual({ ahv: { betrag: 12.35 }, nbu: { satz: 0.017 } })
    expect(sauberManuell(null)).toEqual({})
  })
})

describe('Eintritt unter dem Monat wie im Lohn-Excel (Sarah Aebischer Oktober 2026)', () => {
  const ml = 4604, th = 4604 / 12
  it('die Eintrittszeile ist (Monatslohn + 13.) mal fehlende Solltage durch Solltage, gerundet', () => {
    expect(eintrittAbzug(ml + th, 16, 18)).toBe(-554.19)
    expect(eintrittAbzug(ml + th, 18, 18)).toBe(0)
    expect(eintrittAbzug(ml + th, 0, 18)).toBe(-4987.67)
    expect(eintrittAbzug(ml + th, 16, 0)).toBe(0)
  })
  it('Auszahlung 3876.57 wie das Excel, nicht 3876.58', () => {
    const c = berechneLohn({
      lines: [{ label: 'Monatslohn', betrag: ml }, { label: 'Anteil 13. Monatslohn', betrag: th }, { label: 'Eintritt unter dem Monat (05.10.2026, 16 von 18 Solltagen)', betrag: eintrittAbzug(ml + th, 16, 18) }],
      zulagen: [], nach: [], ahv: true, alv: true, nbu: true, ktg: 'standard', pkAbzug: 154.5, qstSatz: null,
    }, LOHN_SAETZE_2026)
    expect(fmtLohnChf(c.brutto)).toBe("4'433.48")
    expect(c.abzuege.map(a => fmtLohnChf(a.betrag))).toEqual(['-234.97', '-48.77', '-75.19', '-43.47', '-154.50'])
    expect(fmtLohnChf(c.abzugTotal)).toBe('-556.90')
    expect(fmtLohnChf(c.auszahlung)).toBe("3'876.57")
    // die bisherige Verteilung auf zwei gerundete Zeilen (so gespeichert bis 19.10.) ergab einen Rappen mehr
    const alt = berechneLohn({
      lines: [{ label: 'Monatslohn (Eintritt 05.10.2026, 16 von 18 Solltagen)', betrag: 4092.44 }, { label: 'Anteil 13. Monatslohn (Eintritt 05.10.2026, 16 von 18 Solltagen)', betrag: 341.04 }],
      zulagen: [], nach: [], ahv: true, alv: true, nbu: true, ktg: 'standard', pkAbzug: 154.5, qstSatz: null,
    }, LOHN_SAETZE_2026)
    expect(fmtLohnChf(alt.auszahlung)).toBe("3'876.58")
  })
  it('unbezahlte Ferien nach dem Eintritt rechnen auf der gekürzten Basis mit den Solltagen innerhalb der Anstellung', () => {
    const basis = ml + th + eintrittAbzug(ml + th, 16, 18)
    expect(unbezahltAbzug(basis, 2, 16)).toBe(-554.18)
  })
})

describe('Emese: Grundlohn inkl. Ferienentschädigung ist 995.67', () => {
  it('Seed 900 ohne Zuschlag, auf der Abrechnung 900 × 1.1063 = 995.67 (nicht 1\'095.24)', () => {
    const seed = lohnSeedFor('Emese Diserens')
    expect(seed).toMatchObject({ art: 'stundenlohn', grundlohn: 900, stundensatz: 30 })
    const zeile = Math.round(900 * (1 + LOHN_SAETZE_2026.ferienzuschlag) * 1000) / 1000
    expect(zeile).toBe(995.67)
    expect(fmtLohnChf(zeile)).toBe('995.67')
  })
  it('gespeicherte Stammdaten mit dem alten 990 werden beim Lesen auf 900 korrigiert, andere Werte bleiben', () => {
    const alt = { ...LOHN_STAMM_DEFAULT, art: 'stundenlohn' as const, stundensatz: 30, grundlohn: 990, geprueft: true }
    expect(korrigiereStamm('Emese Diserens', alt).grundlohn).toBe(900)
    expect(korrigiereStamm('Emese Diserens', { ...alt, grundlohn: 950 }).grundlohn).toBe(950)
    expect(korrigiereStamm('Emese Diserens', { ...alt, grundlohn: 900 }).grundlohn).toBe(900)
    expect(korrigiereStamm('Anita Trachsel', { ...alt, grundlohn: 990 }).grundlohn).toBe(990)
  })
})
