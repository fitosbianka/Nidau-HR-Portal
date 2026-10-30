// Prüfskript für den UBS-CSV-Parser — läuft mit `npx tsx scripts/check-ubs-parser.ts`.
// Nutzt NUR die erfundenen Fixtures; niemals echte Kontodaten ins Repo.
import { readFileSync } from 'fs'
import { join } from 'path'
import { decodeCsvBytes, parseUbsCsv, fuehreJahrZusammen } from '../src/lib/finanzen/ubs-csv'

let ok = true
function check(name: string, got: unknown, want: unknown) {
  const pass = JSON.stringify(got) === JSON.stringify(want)
  ok = ok && pass
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : ` → ${JSON.stringify(got)} (erwartet ${JSON.stringify(want)})`}`)
}
const lade = (n: string) => decodeCsvBytes(new Uint8Array(readFileSync(join(__dirname, '../src/lib/finanzen/__fixtures__', n))))

// ── aktuelles Format: Sammelbuchungen, Detailzeilen, vorgemerkte Zeile ──
const a = parseUbsCsv(lade('aktuell.csv'))
check('aktuell: Format', a.format, 'aktuell')
check('aktuell: kontoKey = IBAN ohne Leerzeichen', a.kontoKey, 'CH1200235235999999 01A'.replace(/\s+/g, ''))
check('aktuell: 6 Buchungen (Details zählen nicht)', a.buchungen.length, 6)
check('aktuell: 1 vorgemerkte nicht übernommen', a.vorgemerkt, 1)
check('aktuell: Saldo-Abgleich OK', a.saldoAbgleichOk, true)
check('aktuell: keine Warnungen (Zeilen-Saldi stimmen)', a.warnungen, [])
const sammel = a.buchungen.find(b => b.text1 === 'Sammelauftrag')!
check('aktuell: Sammelauftrag hat 2 Details', sammel.details.length, 2)
check('aktuell: Detailsumme = Buchungsbetrag', sammel.details.reduce((s, d) => s + d.betragRp, 0), sammel.betragRp)
check('aktuell: Semikolon im Text bleibt erhalten', a.buchungen.some(b => b.text1 === 'Miete August; Nebenkosten'), true)
check('aktuell: Juli Einnahmen', a.monate['2026-07'].einnahmenRp, 950000)
check('aktuell: Juli Ausgaben', a.monate['2026-07'].ausgabenRp, 26320)
check('aktuell: Juli Saldo Monatsende', a.monate['2026-07'].saldoEndeRp, 9423680)
check('aktuell: August Saldo Monatsende = Schlusssaldo', a.monate['2026-08'].saldoEndeRp, a.schlusssaldoRp)
check('aktuell: beide Monate vollständig', [a.monate['2026-07'].vollstaendig, a.monate['2026-08'].vollstaendig], [true, true])

// gleiches Kartenzahlungs-Paar am selben Tag → zwei verschiedene ids
const doppelt = lade('aktuell.csv').replace(
  '2026-07-02;;2026-07-02;2026-07-02;CHF;-263.20;',
  '2026-07-02;;2026-07-02;2026-07-02;CHF;-263.20;;;86473.60;9900006BN0000006;"Muster Material AG";"E-Banking Auftrag";;;\n2026-07-02;;2026-07-02;2026-07-02;CHF;-263.20;')
const d = parseUbsCsv(doppelt.replace('Schlusssaldo:;91234.55', 'Schlusssaldo:;90971.35'))
const gleiche = d.buchungen.filter(b => b.betragRp === -26320)
check('ids: identische Zeilen am selben Tag → 2 Buchungen mit 2 ids', [gleiche.length, new Set(gleiche.map(b => b.id)).size], [2, 2])

// Zusammenführen: vollständiger Monat ersetzt, kategorieManuell bleibt
const erst = fuehreJahrZusammen(null, a.kontoKey, 2026, a, 'imp1')
erst.datei.buchungen = erst.datei.buchungen.map(b => (b.text1 === 'Sammelauftrag' ? { ...b, kategorieManuell: 'kat_loehne' } : b))
const zweit = fuehreJahrZusammen(erst.datei, a.kontoKey, 2026, a, 'imp2')
check('merge: Monate als ersetzt markiert', zweit.status, { '2026-07': 'ersetzt', '2026-08': 'ersetzt' })
check('merge: keine Duplikate nach zweitem Import', zweit.datei.buchungen.length, 6)
check('merge: kategorieManuell überlebt Re-Import', zweit.datei.buchungen.find(b => b.text1 === 'Sammelauftrag')?.kategorieManuell, 'kat_loehne')

// ── Variante mit Transaktionsbetrag (Vorzeichen) ──
const t = parseUbsCsv(lade('transaktionsbetrag.csv'))
check('trxbetrag: Format', t.format, 'transaktionsbetrag')
check('trxbetrag: Beträge mit Vorzeichen', t.buchungen.map(b => b.betragRp).sort((x, y) => x - y), [-300000, 800000])
check('trxbetrag: Saldo-Abgleich OK', t.saldoAbgleichOk, true)

// ── altes 21-Spalten-Format (Komma, TT.MM.JJJJ, Apostroph-Tausender) ──
const alt = parseUbsCsv(lade('alt21.csv'))
check('alt21: Format', alt.format, 'alt21')
check('alt21: 2 Buchungen', alt.buchungen.length, 2)
check('alt21: TT.MM.JJJJ → ISO', alt.buchungen[0].buchungsdatum, '2025-03-03')
check('alt21: Apostroph-Tausender', alt.buchungen.map(b => b.betragRp), [450000, -150000])
check('alt21: Saldo aus Zeilen-Saldo', alt.monate['2025-03'].saldoEndeRp, 6300000)

console.log(ok ? '\nAlle Prüfungen bestanden.' : '\nFEHLER — siehe oben.')
process.exit(ok ? 0 : 1)
