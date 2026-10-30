// Prüfskript für die Geschäftsanalyse (Kategorien + Analyse) — läuft ohne
// Datenbank mit 15 ERFUNDENEN Monaten (Juli 2025 bis September 2026):
// ein Investitionsmonat, ein Monat mit 13. Monatslohn, ein laufender Monat.
// Ausführen mit:  npx tsx scripts/check-finanz-analyse.ts

import {
  START_KATEGORIEN, START_REGELN, baueKontext, kategorieVon, istGrosseBuchung,
  passtRegel, suchtextVorschlag, type Regel,
} from '../src/lib/finanzen/kategorien'
import {
  aggregiereMonate, kombiniereMonate, baueReihen, berechneKennzahlen,
  trendBetrieb, trendReserven, wohinGehtGeld, groessteVeraenderungen,
  kategorieVergleich, zielStatus, baueHinweise, vormonat,
} from '../src/lib/finanzen/analyse'
import type { Buchung, MonatsInfo } from '../src/lib/finanzen/types'
import { parseBetragRp } from '../src/lib/finanzen/ubs-csv'

let ok = 0
let fehl = 0
function check(name: string, bedingung: boolean, detail?: unknown) {
  if (bedingung) { ok++; console.log(`  PASS  ${name}`) }
  else { fehl++; console.log(`  FAIL  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`) }
}

const KONTO = 'CH0000TESTKONTO'
let zaehler = 0
const B = (datum: string, chf: number, text1: string, kategorieManuell: string | null = null, kontoKey = KONTO): Buchung => ({
  id: `b${zaehler++}`, kontoKey, buchungsdatum: datum, valutadatum: datum,
  betragRp: Math.round(chf * 100), waehrung: 'CHF', saldoRp: null,
  transaktionsNr: `T${zaehler}`, text1, text2: '', text3: '',
  details: [], kategorieManuell, importId: 'imp1',
})

// ── 15 Monate Testdaten ──────────────────────────────────────────────────
// Normalmonat: Patienten +90'000, Lohn −45'000, Miete −8'000, Material −6'000
//   → Betriebsergebnis +31'000, Ausgaben 59'000
// 2025-12: zusätzlich 13. Monatslohn −45'000            → B −14'000
// 2026-03: Investition Praxis Nidau −40'000 (manuell)   → B +31'000, ΔK −9'000
// 2026-06: Steuern −15'000                               → B +31'000, ΔK +16'000
// 2026-08: Material −12'000 statt −6'000                 → B +25'000 (auffällig)
// 2026-09: laufend/unvollständig, nur +40'000 / −45'000
const MONATE = [
  '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
  '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
  '2026-07', '2026-08', '2026-09',
]
const HEUTE = '2026-09'

const buchungen: Buchung[] = []
const infos: Record<string, MonatsInfo> = {}
let saldo = 200000_00   // Stand Ende Juni 2025
for (const monat of MONATE) {
  const neu: Buchung[] = []
  if (monat === '2026-09') {
    neu.push(B(`${monat}-05`, 40000, 'Zahlungseingang QRR 123456'))
    neu.push(B(`${monat}-25`, -45000, 'Sammelauftrag Lohn September'))
  } else {
    neu.push(B(`${monat}-10`, 90000, 'Zahlungseingang QRR 123456'))
    neu.push(B(`${monat}-25`, -45000, 'Sammelauftrag Lohn'))
    neu.push(B(`${monat}-01`, -8000, 'Mietzins Praxis Kehrsatz'))
    neu.push(B(`${monat}-15`, monat === '2026-08' ? -12000 : -6000, 'Kaladent AG Bern'))
    if (monat === '2025-12') neu.push(B(`${monat}-20`, -45000, 'Sammelauftrag Lohn 13. Monatslohn'))
    if (monat === '2026-03') neu.push(B(`${monat}-12`, -40000, 'Kauf Einrichtung Behandlungszimmer', 'kat_nidau'))
    if (monat === '2026-06') neu.push(B(`${monat}-30`, -15000, 'Steuerverwaltung des Kantons Bern'))
  }
  saldo += neu.reduce((s, b) => s + b.betragRp, 0)
  buchungen.push(...neu)
  infos[monat] = { saldoMonatsendeRp: saldo, vollstaendig: monat !== '2026-09', abgleichOk: true }
}

const ctx = baueKontext(START_KATEGORIEN, START_REGELN, [], buchungen.map(b => ({ kontoKey: b.kontoKey, buchungsdatum: b.buchungsdatum, betragRp: b.betragRp })))

console.log('\n— Zuordnung —')
{
  const z = buchungen.map(b => kategorieVon(b, ctx))
  check('keine Buchung unklassiert', z.every(x => x.quelle !== 'unklassiert'))
  check('Patientenzahlung über Auffangregel', kategorieVon(buchungen[0], ctx).kategorieId === 'kat_patienten')
  const lohn = buchungen.find(b => b.text1.startsWith('Sammelauftrag'))!
  check('Lohn → kat_loehne', kategorieVon(lohn, ctx).kategorieId === 'kat_loehne')
  const invest = buchungen.find(b => b.kategorieManuell)!
  check('manuelle Zuordnung gewinnt', kategorieVon(invest, ctx).kategorieId === 'kat_nidau' && kategorieVon(invest, ctx).quelle === 'manuell')
  check('grosse Buchung erkannt (Patient 90k)', istGrosseBuchung(buchungen[0], kategorieVon(buchungen[0], ctx)))
  check('Lohn nie «grosse Buchung»', !istGrosseBuchung(lohn, kategorieVon(lohn, ctx)))
}

console.log('\n— Aggregate & Reihen —')
const aggregate = aggregiereMonate(KONTO, buchungen, infos, ctx)
const reihen = baueReihen(kombiniereMonate(aggregate, 'alle'), HEUTE)
const r = (m: string) => reihen.find(x => x.monat === m)!
{
  check('15 Monate aggregiert', aggregate.length === 15, aggregate.length)
  check('vormonat(2026-01) = 2025-12', vormonat('2026-01') === '2025-12')
  check('Normalmonat B = +31 000', r('2025-08').B === 31000_00, r('2025-08').B)
  check('Dezember (13. Lohn) B = −14 000', r('2025-12').B === -14000_00, r('2025-12').B)
  check('März: Investition I = −40 000', r('2026-03').I === -40000_00, r('2026-03').I)
  check('März: B bleibt +31 000', r('2026-03').B === 31000_00)
  check('März: ΔK = −9 000', r('2026-03').deltaK === -9000_00, r('2026-03').deltaK)
  check('Juni: Steuern S = −15 000, ΔK = +16 000', r('2026-06').S === -15000_00 && r('2026-06').deltaK === 16000_00)
  check('August: B = +25 000', r('2026-08').B === 25000_00, r('2026-08').B)
  check('laufender Monat erkannt', r('2026-09').status === 'laufend')
  check('erster Monat: Kontrolle offen (kein Vormonat)', r('2025-07').kontrolleOk === null)
  check('Kontrollsumme geht in allen übrigen Monaten auf', reihen.slice(1).every(x => x.kontrolleOk === true),
    reihen.filter(x => x.kontrolleOk === false).map(x => x.monat))
}

console.log('\n— Kennzahlen —')
const kz = berechneKennzahlen(reihen, HEUTE)
{
  check('Kontostand = 523 000', kz.kontostandRp === 523000_00, kz.kontostandRp)
  check('Δ 3 Monate = +51 000', kz.delta3Rp === 51000_00, kz.delta3Rp)
  check('Ø B letzte 3 vollständige = 29 000', kz.oeB3Rp === 29000_00, kz.oeB3Rp)
  check('Ø B Vorjahr fehlt (zu wenig Daten)', kz.oeB3VorjahrRp === null)
  check('Einnahmen seit Jahresbeginn = 720 000 (8 Monate)', kz.ytdRp === 720000_00 && kz.ytdMonate.length === 8, kz.ytdRp)
  check('YTD-Vorjahresvergleich fehlt sauber', kz.ytdVorjahrRp === null && kz.ytdProzent === null)
  check('Ø Ausgaben 6 Monate = 60 000', kz.oeA6Rp === 60000_00, kz.oeA6Rp)
  check('Reserve = 8,7 Monate', kz.reserveMonate === 8.7, kz.reserveMonate)
}

console.log('\n— Trends —')
const fmtRp = (rp: number) => `CHF ${Math.round(rp / 100)}`
const tb = trendBetrieb(reihen, fmtRp)
const tr = trendReserven(reihen, fmtRp)
{
  check('Betriebstrend: Abwärts (29k vs 31k, Schwelle 1.8k)', tb?.richtung === 'ab', tb)
  check('Betriebstrend hat Erklärung', !!tb && tb.erklaerung.includes('29') && tb.erklaerung.includes('31'))
  check('Reserventrend: Wachsend (+72 000 in 3 Monaten)', tr?.richtung === 'auf', tr)
  check('Reserventrend nennt die Steuern', !!tr && tr.erklaerung.includes('Steuern'))
}

console.log('\n— Wohin geht das Geld (Jun–Aug 2026) —')
{
  const w = wohinGehtGeld(reihen, '2026-06', '2026-08', START_KATEGORIEN)
  check('Löhne sind der grösste Posten', w[0]?.kategorieId === 'kat_loehne', w[0])
  check('Löhne: 135 000 = 74%', w[0]?.betragRp === 135000_00 && Math.round(w[0].anteil * 100) === 74, w[0])
  const mat = w.find(x => x.kategorieId === 'kat_material')
  check('Material +6 000 gegenüber Vorperiode', mat?.deltaRp === 6000_00, mat)
  const lo = w.find(x => x.kategorieId === 'kat_loehne')
  check('Löhne unverändert zur Vorperiode', lo?.deltaRp === 0)
}

console.log('\n— Grösste Veränderungen (3 vs 3) —')
{
  const v = groessteVeraenderungen(reihen, START_KATEGORIEN)
  check('Nidau-Investition ist die grösste Veränderung (+40 000)', v[0]?.kategorieId === 'kat_nidau' && v[0]?.deltaRp === 40000_00, v[0])
  check('Steuern an zweiter Stelle (−15 000)', v[1]?.kategorieId === 'kat_steuern' && v[1]?.deltaRp === -15000_00, v[1])
  check('Material dabei (−6 000)', v.some(x => x.kategorieId === 'kat_material' && x.deltaRp === -6000_00))
  check('unveränderte Kategorien fehlen', !v.some(x => x.kategorieId === 'kat_loehne' || x.kategorieId === 'kat_patienten'))
}

console.log('\n— Kategorien-Vergleich August (auffällig) —')
{
  const kv = kategorieVergleich(reihen, '2026-08', START_KATEGORIEN)
  const mat = kv.find(x => x.kategorieId === 'kat_material')
  check('Material: 12 000 gegen Schnitt 6 000', mat?.betragRp === -12000_00 && mat?.schnittRp === -6000_00, mat)
  check('Material als auffällig markiert', mat?.auffaellig === true)
  const miete = kv.find(x => x.kategorieId === 'kat_miete')
  check('Miete unauffällig', miete?.auffaellig === false)
}

console.log('\n— Reserveziel —')
{
  const ziel = { zielRp: 600000_00, zieldatum: '2027-09-30', mindestMonate: 3 }
  const st = zielStatus(ziel, kz, reihen, HEUTE)
  check('Mindestreserve = 180 000, erfüllt', st.mindestreserveRp === 180000_00 && st.reserveOk === true, st)
  check('12 Monate bis zum Ziel', st.monateBisZiel === 12, st.monateBisZiel)
  check('nötige Sparrate ≈ 6 417/Monat', st.noetigeSparrateRp === Math.ceil(77000_00 / 12), st.noetigeSparrateRp)
  check('tatsächlich Ø +24 000/Monat', st.tatsaechlichRp === 24000_00, st.tatsaechlichRp)
  check('Im Plan', st.imPlan === true)

  const ohne = zielStatus({ zielRp: null, zieldatum: null, mindestMonate: 3 }, kz, reihen, HEUTE)
  check('ohne Ziel: nur Mindestreserve-Check', ohne.fortschritt === null && ohne.mindestreserveRp === 180000_00)
}

console.log('\n— Hinweise —')
{
  const ziel = { zielRp: null, zieldatum: null, mindestMonate: 3 }
  const st = zielStatus(ziel, kz, reihen, HEUTE)
  const h = baueHinweise({ reihen, kennzahlen: kz, kategorien: START_KATEGORIEN, ziel, zielSt: st, trendB: tb, unklassiertOffen: 0, grosseOffen: 5, fmtRp })
  check('Hinweise vorhanden', h.length > 0, h.length)
  check('Hinweis: Betriebsergebnis rückläufig', h.some(x => x.titel.includes('rückläufig')))
  check('Hinweis: Praxismaterial auffällig', h.some(x => x.titel.includes('Praxismaterial')), h.map(x => x.titel))
  check('Hinweis: grosse Buchungen zu prüfen', h.some(x => x.titel.includes('grosse Buchung')))
  check('Hinweis: solide Reserve (8,7 > 5 Monate)', h.some(x => x.titel === 'Solide Reserve'))
  check('höchstens 6 Hinweise', h.length <= 6)
}

console.log('\n— Interne Umbuchungen über zwei Konten —')
{
  const a = B('2026-05-15', -10000, 'Übertrag auf Sparkonto', null, 'CHKONTOA')
  const b = B('2026-05-15', 10000, 'Übertrag vom Geschäftskonto', null, 'CHKONTOB')
  const ctx2 = baueKontext(START_KATEGORIEN, START_REGELN, [],
    [a, b].map(x => ({ kontoKey: x.kontoKey, buchungsdatum: x.buchungsdatum, betragRp: x.betragRp })))
  check('Gegenpaar → intern (beide Seiten)', kategorieVon(a, ctx2).gruppe === 'INTERN' && kategorieVon(b, ctx2).gruppe === 'INTERN')

  const c = B('2026-05-20', -5000, 'Übertrag CH93 0076 2011 6238 5295 7', null, 'CHKONTOA')
  const ctx3 = baueKontext(START_KATEGORIEN, START_REGELN, ['CH9300762011623852957'])
  check('eigene IBAN im Text → intern', kategorieVon(c, ctx3).gruppe === 'INTERN')

  const aggA = aggregiereMonate('CHKONTOA', [a], { '2026-05': { saldoMonatsendeRp: 50000_00, vollstaendig: true, abgleichOk: true } }, ctx2)
  const aggB = aggregiereMonate('CHKONTOB', [b], { '2026-05': { saldoMonatsendeRp: 30000_00, vollstaendig: true, abgleichOk: true } }, ctx2)
  const kombi = kombiniereMonate([...aggA, ...aggB], 'alle')
  check('«Alle Konten»: intern hebt sich auf', (kombi[0].gruppen.INTERN ?? 0) === 0, kombi[0].gruppen)
  check('«Alle Konten»: Salden addiert', kombi[0].saldoEndeRp === 80000_00, kombi[0].saldoEndeRp)
}

console.log('\n— Suchtext-Vorschlag & Regel-Matching —')
{
  const text1 = 'Gutschrift QRR 12 345 678 Kaladent Dental AG Bern; Referenz 99'
  const v = suchtextVorschlag(text1)
  check('Vorschlag = längster Namensteil ohne Zahlen', v === 'Kaladent Dental AG Bern', v)
  check('Vorschlag ist Teilstück des Originaltexts', text1.toLowerCase().replace(/\s+/g, ' ').includes(v.toLowerCase()))
  const regel: Regel = { id: 'test', suchtext: v, richtung: 'ausgabe', betragMin: null, betragMax: null, kategorieId: 'kat_material', prioritaet: 1, aktiv: true }
  check('Regel aus dem Vorschlag trifft die Ursprungsbuchung', passtRegel(B('2026-04-10', -500, text1), regel))
  check('doppelte Leerzeichen im Bankexport stören nicht', passtRegel(B('2026-04-11', -500, 'Kaladent  Dental   AG Bern Lieferung'), regel))
  check('reine Nummern-Texte geben leeren Vorschlag', suchtextVorschlag('QRR 12 345 678 99') === '')
}


// ── Betrags-Parser des UBS-Imports ────────────────────────────────────────
console.log('\n— Betrags-Parser (UBS CSV) —')
check("1'234.50 → 123450", parseBetragRp("1'234.50") === 123450)
check('1234.5 → 123450', parseBetragRp('1234.5') === 123450)
check('-12.30 → −1230', parseBetragRp('-12.30') === -1230)
check('Komma-Dezimale 1234,56 → 123456', parseBetragRp('1234,56') === 123456)
check('Komma-Tausender 1,234.56 → 123456', parseBetragRp('1,234.56') === 123456)
check('Punkt-Tausender 1.234,56 → 123456', parseBetragRp('1.234,56') === 123456)
check('CHF 99.90 → 9990', parseBetragRp('CHF 99.90') === 9990)
check('leer → null', parseBetragRp('') === null)
check('Text → null', parseBetragRp('abc') === null)
check('3 Dezimalen → null (nicht raten)', parseBetragRp('1.234') === null)

console.log(`\n${ok} PASS, ${fehl} FAIL`)
if (fehl > 0) process.exit(1)
