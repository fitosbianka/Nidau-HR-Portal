'use client'

// Lohnabrechnungen (admin only): Abrechnungen erstellen (Mitarbeiterin +
// Abrechnungsart wählen, personenspezifische Posten wie Quellensteuer oder
// Zulagen sind aus den Stammdaten vorbefüllt), Stammdaten pflegen, Sätze
// pro Jahr pflegen. Rechenlogik: src/lib/lohn.ts (gegen das bisherige
// Lohn-Excel rappengenau verifiziert).

import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  berechneLohn, rundRappen, unbezahltAbzug, eintrittAbzug, fmtLohnChf, lohnSeedFor, korrigiereStamm,
  type AbzugKey, type AbzugManuell, type LohnManuell,
  LOHN_SAETZE_2026, LOHN_STAMM_DEFAULT, LOHN_ART_LABEL, LOHN_TITEL,
  type LohnStamm, type LohnSaetze, type LohnAbrechnung, type LohnPos, type LohnArt,
} from '@/lib/lohn'
import { absenzZeilenFuerMonat, type AbsenzFall } from '@/lib/absenz-phasen'
import { saveLohnStamm, saveLohnSaetze, saveLohnAbrechnung, deleteLohnAbrechnung } from '@/actions/lohn'
import { istExtern } from '@/lib/externe'
import { openFileWindow, downloadBlob } from '@/lib/client-files'
import { getDocumentUrl } from '@/actions/documents'
import { URTEIL_TEXT, type KontrolleErgebnis, type Urteil } from '@/lib/lohn-pdf-kontrolle'

type Profile = {
  id: string
  full_name: string
  job_title: string | null
  pensum: number | null
  monatslohn: number | null
  bruttolohn_100: number | null
  is_active: boolean
  extern?: boolean
}

const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']

const inputCls = 'w-full px-2.5 py-2 text-sm border border-edge-ctl rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk placeholder:text-ink-5'
const numCls = `${inputCls} tnum text-right`

function currentMonth(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' }).slice(0, 7)
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 4)
}

/** Tage kompakt: ganze ohne Nachkommastellen, halbe mit einer (z.B. 5.5). */
function fmtDays(d: number): string {
  return Number.isInteger(d) ? String(d) : d.toFixed(1)
}

const fmtDatumCH = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

function monatslohnOf(p: Profile): number {
  if (p.monatslohn != null && p.monatslohn > 0) return p.monatslohn
  if (p.bruttolohn_100 != null && p.pensum != null) return p.bruttolohn_100 * p.pensum / 100
  return 0
}

/** Tagesvergütungen der Umsatzabrechnung (wie im bisherigen Excel):
 *  Betrag = Tage × Tagesansatz × Faktor. Faktoren gemäss der letzten
 *  Excel-Abrechnung: Ferien/Fortbildung 100%, Personalaufwand 12.5%,
 *  Krankheit 80%, Unfall 90% — pro Abrechnung anpassbar. */
type UmsatzTagRow = { label: string; tage: number; faktor: number }

const UMSATZ_TAGE_DEFAULT: UmsatzTagRow[] = [
  { label: 'Ferien', tage: 0, faktor: 100 },
  { label: 'Fortbildung', tage: 0, faktor: 100 },
  { label: 'Personalaufwand', tage: 0, faktor: 12.5 },
  { label: 'Krankheit', tage: 0, faktor: 80 },
  { label: 'Unfall', tage: 0, faktor: 90 },
]

type Bausteine = {
  art: LohnArt
  /** Umsatzlohn + Akontolohn: 'akonto' = monatliche Akonto-Abrechnung,
   *  'umsatz' = periodische Umsatzabrechnung (Akonto wird abgezogen) */
  modus: 'akonto' | 'umsatz'
  ml: number
  dreizehnter: boolean
  /** Unfall-/Krankheitsfälle gemäss Regelwerk (Phasen-Lohnarten in
   *  Kalendertagen, R1.1/R1.4) — aus dem Arbeitsplan vorbefüllt */
  absenzen: AbsenzFall[]
  /** Unbezahlte Ferien — effektive Methode: Abzug = (ML + 13.-Anteil) ×
   *  ufTage ÷ ufPlanTage (persönliche Plantage des konkreten Monats).
   *  Beide Felder editierbar (0.5er-Schritte); die *Auto-Werte halten den
   *  Arbeitsplan-Stand fest (null = kein Plan für diesen Monat, Pflicht
   *  zur manuellen Erfassung, bevor gespeichert werden kann). */
  ufTage: number
  ufPlanTage: number
  ufTageAuto: number | null
  ufPlanTageAuto: number | null
  /** Fall C — Ein-/Austritt im Monat: Monatslohn UND Anteil 13. werden mit
   *  Solltagen-innerhalb ÷ Solltage-des-Monats proratiert (round2 je Zeile).
   *  Beim Eintritt aus dem Arbeitsplan vorbefüllt; Austritt manuell. */
  prorata: boolean
  prorataTage: number
  prorataTageAuto: number | null
  prorataDatum: string | null    // Eintrittsdatum fürs Zeilen-Label (null = Austritt/manuell)
  stunden: number
  stundensatz: number
  grundlohn: number
  /** Ferienentschädigung auch auf dem Grundlohn (aus den Stammdaten) */
  ferienAufGrundlohn: boolean
  umsatz: number
  umsatzsatz: number
  akontoMonate: number
  akontoBetrag: number
  /** Geleistete Arbeitstage der Periode — daraus wird der Tagesansatz
   *  automatisch berechnet (Umsatzbeteiligung ÷ Tage, auf Rappen gerundet) */
  geleisteteTage: number
  /** Manueller Tagesansatz — übersteuert die automatische Berechnung */
  tagesansatz: number
  umsatzTage: UmsatzTagRow[]
}

/** Stundenlohn rechnet auf DREI Nachkommastellen (Lohnvorlage der Praxis):
 *  Ansatz 30.00 × 1.1063 = 33.189; Zeilenbeträge ebenfalls auf 3 Stellen,
 *  gerundet wird erst in der Anzeige (Brutto 2'614.629 → 2'614.63). */
const r3 = (x: number) => Math.round(x * 1000) / 1000

/** Stundenansatz inkl. Ferienentschädigung, auf 3 Stellen (30 × 1.1063 = 33.189). */
function stundenansatzInkl(stundensatz: number, s: LohnSaetze): number {
  return r3(stundensatz * (1 + s.ferienzuschlag))
}

/** Ansatz mit 3 Stellen anzeigen, ohne überflüssige Nullen (33.189 / 33.19). */
function fmtAnsatz(x: number): string {
  const [int, dec] = x.toFixed(3).split('.')
  const d = dec.replace(/0$/, '')
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${d.length < 2 ? d.padEnd(2, '0') : d}`
}

/** Wirksamer Tagesansatz: manuell eingegebener Wert, sonst automatisch
 *  Umsatzbeteiligung ÷ geleistete Tage (auf Rappen gerundet, wie im Excel). */
function effTagesansatz(b: Bausteine): number {
  if (b.tagesansatz > 0) return b.tagesansatz
  if (b.geleisteteTage > 0 && b.umsatz > 0 && b.umsatzsatz > 0) {
    return Math.round((b.umsatz * b.umsatzsatz) / b.geleisteteTage * 100) / 100
  }
  return 0
}

type AbrDialog = {
  profileId: string
  id: string
  isNew: boolean
  titel: string
  periode: string
  monat: string
  bausteine: Bausteine | null      // null = bestehende Abrechnung, Zeilen direkt bearbeiten
  extraLines: LohnPos[]
  zulagen: Array<LohnPos & { on: boolean }>
  nach: LohnPos[]
  ahv: boolean
  alv: boolean
  nbu: boolean
  ktg: 'standard' | 'erhoeht' | 'keine'
  pkAbzug: number
  qstSatz: number | null
  qstTarif: string | null
  /** Monate, die die Abrechnung umfasst — skaliert den ALV/NBU-Deckel
   *  (Halbjahres-Umsatzabrechnung: 6 × 12'350 statt Monatsdeckel) */
  deckelMonate: number
  /** Von Hand überschriebene Beträge der automatisch erzeugten Lohnzeilen
   *  (Schlüssel = Bezeichnung ohne Klammerzusatz, zum Beispiel «Anteil 13. Monatslohn») */
  zeilenManuell: Record<string, number>
  /** Von Hand überschriebene Abzüge (Basis, Satz, Betrag) */
  manuell: LohnManuell
}

/** Schlüssel einer automatisch erzeugten Zeile: Bezeichnung ohne Klammerzusatz */
const zeilenKey = (label: string) => label.replace(/\s*\(.*$/, '').trim()

export default function LohnClient({
  profiles, saetzeByJahr, stammById, abrechnungenById, abzugsTage = {}, absenzFaelle = {}, planTage = {}, eintritte = {}, bvgKontrolle = [],
}: {
  profiles: Profile[]
  /** Personen, deren gespeicherter BVG-Abzug von der letzten Abrechnung abweicht */
  bvgKontrolle?: Array<{ id: string; name: string; stamm: number; abrechnung: number; periode: string }>
  saetzeByJahr: Record<number, LohnSaetze>
  stammById: Record<string, LohnStamm>
  abrechnungenById: Record<string, LohnAbrechnung[]>
  /** profileId → 'YYYY-MM' → UF-Tage aus dem Arbeitsplan (markierte Arbeitstage) */
  abzugsTage?: Record<string, Record<string, { unbezahlt: number }>>
  /** profileId → Unfall-/Krankheitsfälle des Jahres aus dem Arbeitsplan */
  absenzFaelle?: Record<string, AbsenzFall[]>
  /** profileId → 'YYYY-MM' → persönliche Plantage des Monats (alle Tage mit
   *  Arbeitsplan-Eintrag ausser «%»/Frei) — Divisor der effektiven Methode
   *  für unbezahlte Ferien */
  planTage?: Record<string, Record<string, number>>
  /** profileId → Eintritt im laufenden Jahr: Monat, Datum und Solltage
   *  innerhalb der Anstellung (für die Pro-rata-Vorbefüllung, Fall C) */
  eintritte?: Record<string, { datum: string; monat: string; innerhalbTage: number }>
}) {
  const router = useRouter()
  const [tab, setTab] = useState<'abr' | 'stamm' | 'saetze'>('abr')
  const [monat, setMonat] = useState(currentMonth())
  const [neuId, setNeuId] = useState('')
  const [dialog, setDialog] = useState<AbrDialog | null>(null)
  const [stammDialog, setStammDialog] = useState<{ profileId: string; form: LohnStamm } | null>(null)
  const [saetzeJahr, setSaetzeJahr] = useState(parseInt(currentMonth().slice(0, 4), 10))
  const [saetzeForm, setSaetzeForm] = useState<LohnSaetze | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [bulkProgress, setBulkProgress] = useState('')
  const [bulkResults, setBulkResults] = useState<Array<{ name: string; status: string }> | null>(null)
  // Kontrollansicht «Abgelegte PDFs»: welche Lohn-Dateien liegen in welchem Ordner, passt der Name im PDF
  const [kontrolle, setKontrolle] = useState<{ laeuft: boolean; daten: KontrolleErgebnis | null; fehler: string | null; offen: boolean }>({ laeuft: false, daten: null, fehler: null, offen: false })
  const [sucheName, setSucheName] = useState('')
  const [sucheJahr, setSucheJahr] = useState('alle')
  const [sucheMonat, setSucheMonat] = useState('alle')

  const active = useMemo(() => profiles.filter(p => p.is_active), [profiles])
  const nameById = useMemo(() => new Map(profiles.map(p => [p.id, p.full_name])), [profiles])

  const stammFor = (p: Profile): LohnStamm =>
    korrigiereStamm(p.full_name, stammById[p.id] ?? { ...LOHN_STAMM_DEFAULT, ...(lohnSeedFor(p.full_name) ?? {}), geprueft: false })

  const saetzeFor = (jahr: number): LohnSaetze =>
    saetzeByJahr[jahr] ?? { ...LOHN_SAETZE_2026, jahr }

  const jahr = parseInt(monat.slice(0, 4), 10)
  const saetze = saetzeFor(jahr)
  const saetzeFehlen = !saetzeByJahr[jahr] && jahr !== LOHN_SAETZE_2026.jahr

  // ── Abrechnungen des gewählten Monats (alle Mitarbeiterinnen) ────────────
  const monatsAbrechnungen = useMemo(() => {
    const out: Array<{ profileId: string; abr: LohnAbrechnung }> = []
    for (const [profileId, list] of Object.entries(abrechnungenById)) {
      for (const abr of list) if (abr.monat === monat) out.push({ profileId, abr })
    }
    out.sort((a, b) => (nameById.get(a.profileId) ?? '').localeCompare(nameById.get(b.profileId) ?? ''))
    return out
  }, [abrechnungenById, monat, nameById])

  // ── Wer hat im gewählten Monat noch KEINE gespeicherte Abrechnung? ──────
  //    Fällig ist eine Abrechnung nur für Aktive, die im gewählten Monat
  //    schon eingetreten sind — wer erst später eintritt (z.B. Eintritt
  //    Oktober), erscheint im September weder im Zähler noch unter «Fehlen».
  //    Externe (selbständig, ohne festen Monatslohn) sind nie «fällig» —
  //    ihre Honorarabrechnungen entstehen nur bei effektiven Einsätzen.
  const faelligeImMonat = useMemo(() =>
    active.filter(p => {
      if (p.extern || istExtern(p.full_name)) return false
      const ein = eintritte[p.id]
      return !(ein && ein.monat > monat)
    }),
  [active, eintritte, monat])
  const fehlendeImMonat = useMemo(() =>
    faelligeImMonat
      .filter(p => !(abrechnungenById[p.id] ?? []).some(a => a.monat === monat))
      .map(p => p.full_name),
  [faelligeImMonat, abrechnungenById, monat])

  // ── Alle gespeicherten Abrechnungen (für die Suche), neuste zuerst ───────
  const alleAbrechnungen = useMemo(() => {
    const out: Array<{ profileId: string; abr: LohnAbrechnung }> = []
    for (const [profileId, list] of Object.entries(abrechnungenById)) {
      for (const abr of list) out.push({ profileId, abr })
    }
    out.sort((a, b) => b.abr.monat.localeCompare(a.abr.monat)
      || (nameById.get(a.profileId) ?? '').localeCompare(nameById.get(b.profileId) ?? ''))
    return out
  }, [abrechnungenById, nameById])

  const sucheJahre = useMemo(() =>
    Array.from(new Set(alleAbrechnungen.map(x => x.abr.monat.slice(0, 4)))).sort().reverse(),
  [alleAbrechnungen])

  const suchErgebnis = useMemo(() => {
    const q = sucheName.trim().toLowerCase()
    return alleAbrechnungen.filter(({ profileId, abr }) => {
      if (q && !(nameById.get(profileId) ?? '').toLowerCase().includes(q)) return false
      if (sucheJahr !== 'alle' && abr.monat.slice(0, 4) !== sucheJahr) return false
      if (sucheMonat !== 'alle' && abr.monat.slice(5, 7) !== sucheMonat) return false
      return true
    })
  }, [alleAbrechnungen, nameById, sucheName, sucheJahr, sucheMonat])

  // ── Dialog: Zeilen aus den Bausteinen ─────────────────────────────────────
  const effArt = (b: Bausteine): LohnArt =>
    b.art === 'umsatz_akonto' ? (b.modus === 'umsatz' ? 'umsatzlohn' : 'monatslohn') : b.art

  /** R6.8: Absenzfälle der Umsatzlohn-Behandlerinnen sind Sonderfälle, sie
   *  laufen ausserhalb der automatischen Phasenrechnung und werden manuell
   *  gerechnet (R1.7, V0.5). */
  const istAbsenzSonderfall = (_name: string | undefined, art: LohnArt) =>
    art === 'umsatzlohn' || art === 'umsatz_akonto'
  /** Absenz-Phasenrechnung für den Dialog (null wenn keine Fälle/kein ML). */
  const dialogAbsenz = (d: AbrDialog) => {
    const b = d.bausteine
    if (!b || b.absenzen.length === 0 || b.ml <= 0) return null
    if (!['monatslohn', 'nicht_ahv'].includes(effArt(b)) || b.art === 'umsatz_akonto') return null
    return absenzZeilenFuerMonat(b.absenzen, d.monat, b.ml)
  }

  function generatedLines(d: AbrDialog, s: LohnSaetze): LohnPos[] {
    const b = d.bausteine
    if (!b) return []
    const art = effArt(b)
    const out: LohnPos[] = []
    if (art === 'monatslohn' || art === 'nicht_ahv') {
      const am = dialogAbsenz(d)
      // Monatslohn und Anteil 13. bleiben IMMER voll, der Anteil 13. EXAKT
      // Monatslohn ÷ 12, ungerundet wie im Lohn-Excel (angezeigt auf den
      // Rappen). NICHT runden: 5'120 ÷ 12 als 426.67 ergäbe
      // 5'006.03 statt 5'006.02 (Excel Oktober 2026).
      // Fall C — Ein-/Austritt im Monat: WIE IM LOHN-EXCEL als eigene Zeile
      // «Eintritt unter dem Monat» = (Monatslohn + Anteil 13.) × fehlende
      // Solltage ÷ Solltage des Monats, auf den Rappen (Beispiel:
      // 554.19, Auszahlung 3'876.57). NICHT auf die Zeilen verteilen und
      // einzeln runden, das ergab 3'876.58.
      const proAktiv = b.prorata && b.prorataTage > 0 && b.ufPlanTage > 0 && b.prorataTage < b.ufPlanTage
      let mlZeile = 0
      let anteilZeile = 0
      let eintrittZeile = 0
      if (am && b.art !== 'umsatz_akonto') {
        // Phasen-Lohnarten gemäss Regelwerk (R1.4): Gearbeitet + Karenz/
        // Lohnfortzahlung + Taggeld-Ersatz ersetzen die Monatslohn-Zeile
        out.push(...am.zeilen.map(z => z.frei
          ? { label: z.label, betrag: z.betrag, frei: true as const }
          : { label: z.label, betrag: z.betrag }))
      } else if (b.ml > 0) {
        mlZeile = b.ml
        out.push({ label: b.art === 'umsatz_akonto' ? 'Akontolohn' : 'Monatslohn', betrag: mlZeile })
      }
      // Anteil 13. Monatslohn — Kernprinzip: er folgt der BEZAHLTEN
      // Anstellungszeit, nicht der Anwesenheit. Fall A (Krankheit/Unfall):
      // IMMER voll, nie mit den 80% skalieren — Absicht, nicht «fixen».
      // Fall B (unbezahlte Ferien): Zeile bleibt voll — die Kürzung steckt
      // bereits im UF-Abzug (kombinierte Basis); eine zweite Proration
      // wäre eine Doppelkürzung. Fall C (Ein-/Austritt): Zeile bleibt voll,
      // die Kürzung steht in der Zeile «Eintritt unter dem Monat».
      if (b.dreizehnter && b.ml > 0) {
        anteilZeile = b.ml / 12
        out.push({ label: 'Anteil 13. Monatslohn', betrag: anteilZeile })
      }
      if (proAktiv && mlZeile + anteilZeile > 0) {
        eintrittZeile = eintrittAbzug(mlZeile + anteilZeile, b.prorataTage, b.ufPlanTage)
        if (eintrittZeile !== 0) out.push({
          label: `${b.prorataDatum ? `Eintritt unter dem Monat (${fmtDatumCH(b.prorataDatum)}, ` : 'Ein-/Austritt unter dem Monat ('}${fmtDays(b.prorataTage)} von ${fmtDays(b.ufPlanTage)} Solltagen)`,
          betrag: eintrittZeile,
        })
      }
      // Unbezahlte Ferien — effektive Methode. Kombination mit Ein-/
      // Austritt (Regel 9): ZUERST Pro-rata, dann UF-Abzug auf der
      // proratierten Basis mit Divisor = Solltage INNERHALB der Anstellung
      // — so zählt kein Tag doppelt. Divisor nie ein Pauschalwert.
      const ufDivisor = proAktiv ? b.prorataTage : b.ufPlanTage
      if (b.ufTage > 0 && ufDivisor > 0 && b.ufTage <= ufDivisor) {
        const basis = proAktiv
          ? mlZeile + anteilZeile + eintrittZeile
          : b.ml + (b.dreizehnter ? b.ml / 12 : 0)
        const manuell = b.ufPlanTageAuto == null || b.ufTage !== (b.ufTageAuto ?? -1) || b.ufPlanTage !== b.ufPlanTageAuto
        out.push({
          label: `Unbezahlte Ferien (${fmtDays(b.ufTage)} ${b.ufTage === 1 ? 'Tag' : 'Tage'} à 1/${fmtDays(ufDivisor)} Monatslohn${manuell ? ', manuell angepasst' : ''})`,
          betrag: unbezahltAbzug(basis, b.ufTage, ufDivisor),
        })
      }
    } else if (art === 'stundenlohn') {
      // Grundlohn: mit oder ohne Ferienentschädigung gemäss Stammdaten.
      // Mit Zuschlag (Lohnvorlage der Praxis): 900 × 1.1063 = 995.67.
      const zuschlagPct = `${(s.ferienzuschlag * 100).toFixed(2)}%`
      if (b.grundlohn > 0) out.push(b.ferienAufGrundlohn
        ? { label: `Grundlohn (inkl. ${zuschlagPct} Ferienentschädigung)`, betrag: r3(b.grundlohn * (1 + s.ferienzuschlag)) }
        : { label: 'Grundlohn', betrag: b.grundlohn })
      // Stunden × Gesamtansatz inkl. Ferienentschädigung auf 3 Stellen
      // (45.78 × 33.189 = 1'519.392) — so wie auf der Abrechnung ausgewiesen.
      if (b.stunden > 0 && b.stundensatz > 0) {
        const ansatzInkl = stundenansatzInkl(b.stundensatz, s)
        out.push({
          label: `Stundenlohn ${Math.round(b.stunden * 100) / 100} Std. × CHF ${fmtAnsatz(ansatzInkl)} (inkl. ${zuschlagPct} Ferienentschädigung)`,
          betrag: r3(b.stunden * ansatzInkl),
        })
      }
    } else if (art === 'umsatzlohn') {
      if (b.umsatz > 0 && b.umsatzsatz > 0) out.push({
        label: `Umsatzbeteiligung (${(b.umsatzsatz * 100).toFixed(2)}% von CHF ${fmtLohnChf(b.umsatz)})`,
        betrag: b.umsatz * b.umsatzsatz,
      })
      if (b.akontoMonate > 0 && b.akontoBetrag > 0) out.push({
        // bewusst ohne Detailangaben — die Abrechnung bleibt übersichtlich
        // (Rechnung: Monate × Akontobetrag)
        label: 'Bereits ausbezahlte Akonto-Löhne',
        betrag: -b.akontoMonate * b.akontoBetrag,
      })
      // Tagesvergütungen: pro Zeile auf Rappen gerundet — so summiert auch
      // das bisherige Excel (verifiziert gegen die Abrechnung 1. Hj. 2026).
      // Auf der Abrechnung erscheint nur die Anzahl Tage — Tagesansatz und
      // Prozentfaktor bleiben Rechengrössen im Dialog (Wunsch Bianka:
      // weniger Details, nur bei der Umsatzbeteiligung bleibt die Herleitung)
      const ansatz = effTagesansatz(b)
      if (ansatz > 0) {
        for (const r of b.umsatzTage) {
          if (!r.label.trim() || !(r.tage > 0) || !(r.faktor > 0)) continue
          out.push({
            label: `${r.label} (${r.tage} ${r.tage === 1 ? 'Tag' : 'Tage'})`,
            betrag: Math.round(r.tage * ansatz * (r.faktor / 100) * 100) / 100,
          })
        }
      }
    }
    return out
  }

  function dialogLines(d: AbrDialog, s: LohnSaetze): LohnPos[] {
    const generiert = generatedLines(d, s).map(l => {
      const v = d.zeilenManuell[zeilenKey(l.label)]
      return typeof v === 'number' && Number.isFinite(v) ? { ...l, betrag: v, manuell: true } : l
    })
    return [...generiert, ...d.extraLines.filter(l => l.label.trim() && l.betrag !== 0)]
  }

  function dialogAbr(d: AbrDialog, s: LohnSaetze): Pick<LohnAbrechnung, 'lines' | 'zulagen' | 'nach' | 'ahv' | 'alv' | 'nbu' | 'ktg' | 'pkAbzug' | 'qstSatz' | 'deckelMonate' | 'manuell'> & { monat: string } {
    const base = {
      monat: d.monat,
      manuell: d.manuell,
      lines: dialogLines(d, s),
      zulagen: d.zulagen.filter(z => z.on && z.betrag !== 0).map(z => ({ label: z.label, betrag: z.betrag })),
      nach: d.nach.filter(l => l.label.trim() && l.betrag !== 0),
      ahv: d.ahv, alv: d.alv, nbu: d.nbu, ktg: d.ktg, pkAbzug: d.pkAbzug, qstSatz: d.qstSatz,
      deckelMonate: d.deckelMonate,
    }
    // R5: Lohnpfändung gemäss Verfügung — JEDEN Monat und bei JEDER
    // Bearbeitung frisch gerechnet (R5.2/R5.5): eine allfällige alte
    // Pfändungszeile wird entfernt und durch den aktuell berechneten Wert
    // ersetzt; ein statischer Übertrag aus dem Vormonat ist damit
    // ausgeschlossen. Die Zeile erscheint auch mit 0.00 (R6.6), statt
    // stillschweigend zu fehlen.
    const pf = pfaendungFuer(d, s)
    if (pf) {
      base.nach = [
        ...base.nach.filter(l => !l.label.startsWith('Lohnpfändung')),
        { label: pf.label, betrag: -pf.betrag },
      ]
    }
    return base
  }

  /** R5.2/R5.3: pfändbarer Betrag aus den Stammdaten und dem Netto VOR
   *  Pfändung (alte Pfändungszeilen ausgeklammert). Quote: Netto minus
   *  Existenzminimum, nie unter 0 — das Existenzminimum ist unantastbar,
   *  ein Fehlbetrag wird nie nachgeholt. null = keine Pfändung hinterlegt. */
  function pfaendungFuer(d: AbrDialog, s: LohnSaetze): { betrag: number; netto: number; unterEM: boolean; label: string } | null {
    const p = profiles.find(x => x.id === d.profileId)
    if (!p) return null
    const st = stammFor(p)
    if (st.pfaendungArt !== 'betrag' && st.pfaendungArt !== 'quote') return null
    const ohnePf = {
      monat: d.monat,
      manuell: d.manuell,
      lines: dialogLines(d, s),
      zulagen: d.zulagen.filter(z => z.on && z.betrag !== 0).map(z => ({ label: z.label, betrag: z.betrag })),
      nach: d.nach.filter(l => l.label.trim() && l.betrag !== 0 && !l.label.startsWith('Lohnpfändung')),
      ahv: d.ahv, alv: d.alv, nbu: d.nbu, ktg: d.ktg, pkAbzug: d.pkAbzug, qstSatz: d.qstSatz,
      deckelMonate: d.deckelMonate,
    }
    // Gerechnet wird auf dem RAPPEN-genauen Netto (dem Betrag, der effektiv
    // ausbezahlt werden kann): so ergibt Netto − Pfändung bei der Quote
    // EXAKT das Existenzminimum (z.B. 2'676.46 − 10.46 = 2'666.00) — keine
    // 1-Rappen-Verschiebung durch Float-Reste.
    const netto = rundRappen(berechneLohn(ohnePf, s).auszahlung)
    let betrag: number
    let unterEM = false
    let label: string
    if (st.pfaendungArt === 'betrag') {
      betrag = Math.min(st.pfaendungBetrag ?? 0, Math.max(0, netto))
      label = 'Lohnpfändung Betreibungsamt (gemäss Verfügung)'
    } else {
      const em = st.pfaendungExistenzminimum ?? 0
      betrag = Math.max(0, Math.round((netto - em) * 100) / 100)
      unterEM = netto <= em
      label = unterEM
        ? 'Lohnpfändung Betreibungsamt (Netto unter Existenzminimum — Überweisung 0)'
        : `Lohnpfändung Betreibungsamt (Netto − Existenzminimum Fr. ${fmtLohnChf(em)})`
    }
    return { betrag, netto, unterEM, label }
  }

  /** Vorbefüllung unbezahlte Ferien aus dem Arbeitsplan: UF-Tage und
   *  persönliche Plantage des Monats. Ohne Plan-Daten bleiben beide Felder
   *  leer und müssen vor dem Speichern manuell erfasst werden (nur wenn
   *  überhaupt UF-Tage abgerechnet werden). */
  const ufPrefill = (profileId: string, monat: string) => {
    const plan = planTage[profileId]?.[monat] ?? null
    const uf = plan != null ? (abzugsTage[profileId]?.[monat]?.unbezahlt ?? 0) : null
    // Fall C: Eintritt in diesem Monat → Pro-rata automatisch aktiv
    const ein = eintritte[profileId]
    const eintrittHier = ein != null && ein.monat === monat
    return {
      ufTage: uf ?? 0,
      ufPlanTage: plan ?? 0,
      ufTageAuto: uf,
      ufPlanTageAuto: plan,
      prorata: eintrittHier,
      prorataTage: eintrittHier ? ein.innerhalbTage : (plan ?? 0),
      prorataTageAuto: eintrittHier ? ein.innerhalbTage : null,
      prorataDatum: eintrittHier ? ein.datum : null,
    }
  }

  // ── Dialog öffnen ─────────────────────────────────────────────────────────
  function openNeu(profileId: string) {
    const p = profiles.find(x => x.id === profileId)
    if (!p) return
    const st = stammFor(p)
    const m = parseInt(monat.slice(5, 7), 10)
    // Monatslohn: Stammdaten-Übersteuerung vor dem Wert aus den
    // Mitarbeiter-Standards; Umsatzlohn + Akontolohn nimmt den Akontolohn
    const basisML = st.monatslohn ?? monatslohnOf(p)
    const ml = st.art === 'umsatz_akonto' ? (st.akontoBetrag ?? basisML) : basisML
    const q = Math.ceil(m / 3)
    // Reiner Umsatzlohn startet als Umsatzabrechnung; Umsatzlohn + Akontolohn
    // startet als monatliche Akonto-Abrechnung (umschaltbar im Dialog)
    const periode = st.art === 'umsatzlohn'
      ? (st.umsatzPeriode === 'halbjahr' ? `${m <= 6 ? 1 : 2}. Halbjahr ${jahr}` : `${q}. Quartal ${jahr}`)
      : `${MONTH_NAMES[m - 1]} ${jahr}`
    setError(null)
    setDialog({
      profileId,
      id: newId(),
      isNew: true,
      titel: st.art === 'umsatzlohn' ? 'Umsatzabrechnung' : 'Lohnabrechnung',
      periode,
      monat,
      bausteine: {
        art: st.art,
        modus: 'akonto',
        ml,
        dreizehnter: st.dreizehnter,
        // Absenzfälle des Monats aus dem Arbeitsplan (R1.3/R1.6) — bei
        // Sonderfällen (R6.8) leer, dort wird manuell gerechnet
        absenzen: istAbsenzSonderfall(p.full_name, st.art) ? [] : (absenzFaelle[profileId] ?? [])
          .filter(f => f.ende >= `${monat}-01` && f.beginn <= `${monat}-31`)
          .map(f => ({ ...f })),
        ...ufPrefill(profileId, monat),
        stunden: 0,
        stundensatz: st.stundensatz ?? 0,
        grundlohn: st.grundlohn ?? 0,
        ferienAufGrundlohn: st.ferienAufGrundlohn !== false,
        umsatz: 0,
        umsatzsatz: st.umsatzsatz ?? 0,
        akontoMonate: st.art === 'umsatzlohn' || st.art === 'umsatz_akonto' ? (st.umsatzPeriode === 'halbjahr' ? 6 : 3) : 0,
        akontoBetrag: ml,
        geleisteteTage: 0,
        tagesansatz: 0,
        umsatzTage: UMSATZ_TAGE_DEFAULT.map(r => ({ ...r })),
      },
      extraLines: (st.zuschlaege ?? []).map(z => ({ ...z })),
      zulagen: st.zulagen.map(z => ({
        label: `${z.typ === 'kind' ? 'Kinderzulage' : 'Ausbildungszulage'} ${z.name}`,
        betrag: z.typ === 'kind' ? saetze.kinderzulage : saetze.ausbildungszulage,
        on: true,
      })),
      nach: (st.nachZeilen ?? []).map(z => ({ ...z })),
      ahv: st.ahv, alv: st.alv, nbu: st.nbu, ktg: st.ktg,
      pkAbzug: st.pkAbzug,
      qstSatz: st.qstSatz, qstTarif: st.qstTarif,
      deckelMonate: st.art === 'umsatzlohn' ? (st.umsatzPeriode === 'halbjahr' ? 6 : 3) : 1,
      zeilenManuell: {}, manuell: {},
    })
  }

  /** Bestehende Abrechnung nach dem Regelwerk KOMPLETT neu berechnen: alle
   *  Zeilen entstehen frisch aus Stammdaten, Arbeitsplan-Absenzen, UF-Tagen
   *  und Pfändungs-Verfügung — gleiche ID, «Speichern» ersetzt die alte
   *  Abrechnung. Für Abrechnungen aus der Zeit vor dem Regelwerk (z.B. mit
   *  pauschalem Unfallabzug oder statischer Pfändungszeile). */
  function neuBerechnen(profileId: string, abr: LohnAbrechnung) {
    const p = profiles.find(x => x.id === profileId)
    if (!p) return
    if (!confirm(`«${abr.titel} ${abr.periode}» von ${p.full_name} nach dem Regelwerk neu berechnen?\nAlle Zeilen werden aus Stammdaten und Arbeitsplan neu erzeugt — manuelle Anpassungen der bisherigen Abrechnung gehen beim Speichern verloren.`)) return
    const st = stammFor(p)
    const abrMonat = abr.monat
    const sz = saetzeFor(parseInt(abrMonat.slice(0, 4), 10))
    const basisML = st.monatslohn ?? monatslohnOf(p)
    const ml = st.art === 'umsatz_akonto' ? (st.akontoBetrag ?? basisML) : basisML
    setError(null)
    setDialog({
      profileId,
      id: abr.id,
      isNew: false,
      titel: abr.titel,
      periode: abr.periode,
      monat: abrMonat,
      bausteine: {
        art: st.art,
        modus: 'akonto',
        ml,
        dreizehnter: st.dreizehnter,
        absenzen: istAbsenzSonderfall(p.full_name, st.art) ? [] : (absenzFaelle[profileId] ?? [])
          .filter(f => f.ende >= `${abrMonat}-01` && f.beginn <= `${abrMonat}-31`)
          .map(f => ({ ...f })),
        ...ufPrefill(profileId, abrMonat),
        stunden: 0,
        stundensatz: st.stundensatz ?? 0,
        grundlohn: st.grundlohn ?? 0,
        ferienAufGrundlohn: st.ferienAufGrundlohn !== false,
        umsatz: 0,
        umsatzsatz: st.umsatzsatz ?? 0,
        akontoMonate: st.art === 'umsatzlohn' || st.art === 'umsatz_akonto' ? (st.umsatzPeriode === 'halbjahr' ? 6 : 3) : 0,
        akontoBetrag: ml,
        geleisteteTage: 0,
        tagesansatz: 0,
        umsatzTage: UMSATZ_TAGE_DEFAULT.map(r => ({ ...r })),
      },
      extraLines: (st.zuschlaege ?? []).map(z => ({ ...z })),
      zulagen: st.zulagen.map(z => ({
        label: `${z.typ === 'kind' ? 'Kinderzulage' : 'Ausbildungszulage'} ${z.name}`,
        betrag: z.typ === 'kind' ? sz.kinderzulage : sz.ausbildungszulage,
        on: true,
      })),
      nach: (st.nachZeilen ?? []).map(z => ({ ...z })),
      ahv: st.ahv, alv: st.alv, nbu: st.nbu, ktg: st.ktg,
      pkAbzug: st.pkAbzug,
      qstSatz: st.qstSatz, qstTarif: st.qstTarif,
      deckelMonate: st.art === 'umsatzlohn' ? (st.umsatzPeriode === 'halbjahr' ? 6 : 3) : 1,
      zeilenManuell: {}, manuell: {},
    })
  }

  function openBearbeiten(profileId: string, abr: LohnAbrechnung) {
    setError(null)
    setDialog({
      profileId,
      id: abr.id,
      isNew: false,
      titel: abr.titel,
      periode: abr.periode,
      monat: abr.monat,
      bausteine: null,
      extraLines: abr.lines.map(l => ({ ...l })),
      zulagen: abr.zulagen.map(z => ({ ...z, on: true })),
      nach: abr.nach.map(l => ({ ...l })),
      ahv: abr.ahv, alv: abr.alv, nbu: abr.nbu, ktg: abr.ktg,
      pkAbzug: abr.pkAbzug,
      qstSatz: abr.qstSatz, qstTarif: null,
      deckelMonate: abr.deckelMonate ?? 1,
      zeilenManuell: {}, manuell: { ...(abr.manuell ?? {}) },
    })
  }

  // ── Speichern / Löschen / PDF ─────────────────────────────────────────────
  /** Zeilen mit Betrag, aber ohne Bezeichnung — die würden beim Speichern
   *  stillschweigend wegfallen und die Auszahlung nicht verändern. */
  const unbenannteZeilen = (d: AbrDialog) =>
    d.extraLines.some(l => l.betrag !== 0 && !l.label.trim()) ||
    d.nach.some(l => l.betrag !== 0 && !l.label.trim())

  /** Sperren für unbezahlte Ferien (effektive Methode): Plantage müssen
   *  > 0 sein (ohne Arbeitsplan-Daten Pflicht zur manuellen Erfassung),
   *  und die UF-Tage dürfen die Plantage nie übersteigen. */
  const ufSperre = (d: AbrDialog): string | null => {
    const b = d.bausteine
    if (!b) return null
    // Fall C: Pro-rata-Validierung
    if (b.prorata) {
      if (!(b.ufPlanTage > 0)) {
        return 'Ein-/Austritt: Die Solltage des ganzen Monats (Feld «Plantage im Monat») müssen grösser als 0 sein — ohne Arbeitsplan-Daten bitte manuell erfassen.'
      }
      if (!(b.prorataTage > 0)) {
        return 'Ein-/Austritt: Bitte die Solltage innerhalb der Anstellung erfassen (grösser als 0).'
      }
      if (b.prorataTage > b.ufPlanTage) {
        return `Ein-/Austritt: ${fmtDays(b.prorataTage)} Solltage innerhalb der Anstellung können nicht mehr sein als die ${fmtDays(b.ufPlanTage)} Solltage des Monats.`
      }
      if (b.absenzen.length > 0) {
        return 'Kombination Ein-/Austritt und Krankheits-/Unfall-Phasen im selben Monat ist nicht automatisiert — bitte die Absenzfälle entfernen und die Zeilen manuell erfassen.'
      }
    }
    if (!(b.ufTage > 0)) return null
    const divisor = b.prorata ? b.prorataTage : b.ufPlanTage
    if (!(divisor > 0)) {
      return b.ufPlanTageAuto == null
        ? 'Unbezahlte Ferien: Für diesen Monat gibt es keine Arbeitsplan-Daten — bitte die Plantage des Monats manuell erfassen (grösser als 0), bevor die Abrechnung gespeichert werden kann.'
        : 'Unbezahlte Ferien: Die Plantage des Monats müssen grösser als 0 sein.'
    }
    if (b.ufTage > divisor) {
      return b.prorata
        ? `Unbezahlte Ferien: ${fmtDays(b.ufTage)} UF-Tage können nicht mehr sein als die ${fmtDays(divisor)} Solltage innerhalb der Anstellung — kein Tag darf doppelt kürzen.`
        : `Unbezahlte Ferien: ${fmtDays(b.ufTage)} UF-Tage können nicht mehr sein als die ${fmtDays(divisor)} Plantage des Monats — bitte korrigieren.`
    }
    return null
  }

  /** Pflichtkontrollen des Regelwerks, die das Speichern blockieren:
   *  Datums-/Überschneidungsfehler der Fälle (R6.1) und fehlende
   *  KTG-Klausel bei Krankheitsfällen (R3.7 → Berner Skala, manuell). */
  const absenzSperre = (d: AbrDialog): string | null => {
    const b = d.bausteine
    if (!b || b.absenzen.length === 0) return null
    const am = dialogAbsenz(d)
    if (am && am.fehler.length > 0) return am.fehler[0]
    if (b.absenzen.some(f => f.typ === 'krankheit')) {
      const p = profiles.find(x => x.id === d.profileId)
      if (p && stammFor(p).ktgKlausel === false) {
        return `${p.full_name}: keine KTG-Klausel im Arbeitsvertrag (SSO Ziff. 3.5.1) — es gilt die Berner Skala mit 100% Lohn für beschränkte Zeit. Diesen Krankheitsfall bitte manuell rechnen (R3.7); den Fall hier entfernen und die Zeilen von Hand erfassen.`
      }
    }
    return null
  }

  async function speichern() {
    if (!dialog) return
    if (unbenannteZeilen(dialog)) {
      setError('Bitte für jede Zeile mit Betrag eine Bezeichnung eingeben — Zeilen ohne Bezeichnung werden nicht mitgerechnet.')
      return
    }
    const sperre = absenzSperre(dialog) ?? ufSperre(dialog)
    if (sperre) { setError(sperre); return }
    const s = saetzeFor(parseInt(dialog.monat.slice(0, 4), 10))
    const a = dialogAbr(dialog, s)
    if (a.lines.length === 0) { setError('Bitte mindestens einen Lohnbestandteil erfassen.'); return }
    // R6.9 Pfändungssperre: Lohnpfändungszeile nur bei aktiver Verfügung
    if ([...a.lines, ...a.nach].some(l => l.label.trim().startsWith('Lohnpfändung'))) {
      const p = profiles.find(x => x.id === dialog.profileId)
      const art = p ? stammFor(p).pfaendungArt : 'keine'
      if (art !== 'quote' && art !== 'betrag') {
        setError('Pfändungssperre (R6.9): Diese Person hat keine aktive Pfändungs-Verfügung in den Stammdaten — die Zeile «Lohnpfändung» bitte entfernen oder zuerst die Verfügung hinterlegen.')
        return
      }
    }
    setBusy(true); setError(null)
    try {
      // Audit-Spur unbezahlte Ferien: verwendete Werte + Arbeitsplan-Stand;
      // wer/wann ergänzt der Server — so bleibt jede manuelle Anpassung
      // der Tage nachvollziehbar.
      const b = dialog.bausteine
      const ufAudit = b && b.ufTage > 0 ? {
        tage: b.ufTage,
        planTage: b.ufPlanTage,
        tageAuto: b.ufTageAuto,
        planTageAuto: b.ufPlanTageAuto,
        manuell: b.ufPlanTageAuto == null || b.ufTage !== (b.ufTageAuto ?? -1) || b.ufPlanTage !== b.ufPlanTageAuto,
      } : undefined
      const prorataAudit = b && b.prorata ? {
        tage: b.prorataTage,
        planTage: b.ufPlanTage,
        tageAuto: b.prorataTageAuto,
        datum: b.prorataDatum,
        manuell: b.prorataTageAuto == null || b.prorataTage !== b.prorataTageAuto,
      } : undefined
      const res = await saveLohnAbrechnung(dialog.profileId, {
        id: dialog.id, titel: dialog.titel, periode: dialog.periode,
        ...a, ufAudit, prorataAudit, erstelltAm: '', von: null,
      })
      if (res?.error) setError(res.error)
      else { setDialog(null); setOkMsg('Abrechnung gespeichert.'); router.refresh() }
    } catch { setError('Speichern fehlgeschlagen — bitte erneut versuchen.') }
    setBusy(false)
  }

  /** Alle gespeicherten Abrechnungen des Monats als EIN PDF (eine Seite
   *  pro Abrechnung, alphabetisch) — öffnen zum Drucken oder herunterladen. */
  async function monatPdf(mode: 'inline' | 'download') {
    const fw = mode === 'inline' ? openFileWindow() : null
    setBusy(true); setError(null); setOkMsg(null)
    try {
      const res = await fetch('/api/admin/lohn-monat-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monat, mode }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        fw?.cancel()
        setError((j as { error?: string }).error ?? 'PDF-Erstellung fehlgeschlagen.')
      } else {
        const blob = await res.blob()
        const fname = `Lohnabrechnungen_${MONTH_NAMES[parseInt(monat.slice(5, 7), 10) - 1]}_${jahr}.pdf`
        if (mode === 'inline') fw?.show(URL.createObjectURL(blob))
        else downloadBlob(blob, fname)
      }
    } catch {
      fw?.cancel()
      setError('Netzwerkfehler — bitte erneut versuchen.')
    }
    setBusy(false)
  }

  async function loeschen(profileId: string, abr: LohnAbrechnung) {
    const name = nameById.get(profileId) ?? '?'
    if (!confirm(`${abr.titel} ${abr.periode} von ${name} endgültig löschen?`)) return
    setBusy(true); setError(null)
    try {
      const res = await deleteLohnAbrechnung(profileId, abr.id)
      if (res?.error) setError(res.error)
      else router.refresh()
    } catch { setError('Löschen fehlgeschlagen — bitte erneut versuchen.') }
    setBusy(false)
  }

  async function pdf(profileId: string, abrData: { titel: string; periode: string; monat: string } & ReturnType<typeof dialogAbr>, mode: 'inline' | 'download' | 'ablegen', qstTarif: string | null, abrId: string | null = null) {
    const fw = mode === 'inline' ? openFileWindow() : null
    setBusy(true); setError(null); setOkMsg(null)
    try {
      const post = (replace: boolean) => fetch('/api/admin/lohn-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: profileId, abr: { ...abrData, qstTarif }, mode, replace, abrId }),
      })
      let res = await post(false)
      if (mode === 'ablegen') {
        if (res.status === 409) {
          const name = nameById.get(profileId) ?? '?'
          if (confirm(`Im Ordner von ${name} liegt bereits «${abrData.titel} ${abrData.periode}». Ersetzen?`)) {
            res = await post(true)
          } else { setBusy(false); return }
        }
        const j = await res.json().catch(() => ({}))
        if (!res.ok) setError((j as { error?: string }).error ?? 'Ablegen fehlgeschlagen.')
        else setOkMsg(`Im Lohn-Ordner abgelegt: ${(j as { label?: string }).label ?? ''}`)
      } else {
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          fw?.cancel()
          setError((j as { error?: string }).error ?? 'PDF-Erstellung fehlgeschlagen.')
        } else {
          const blob = await res.blob()
          const fname = `${abrData.titel}_${abrData.periode}`.replace(/[^A-Za-z0-9äöüÄÖÜ]+/g, '_') + '.pdf'
          if (mode === 'inline') fw?.show(URL.createObjectURL(blob))
          else downloadBlob(blob, fname)
        }
      }
    } catch {
      fw?.cancel()
      setError('Netzwerkfehler — bitte erneut versuchen.')
    }
    setBusy(false)
  }

  const abrToData = (abr: LohnAbrechnung) => ({
    titel: abr.titel, periode: abr.periode, monat: abr.monat,
    lines: abr.lines, zulagen: abr.zulagen, nach: abr.nach,
    ahv: abr.ahv, alv: abr.alv, nbu: abr.nbu, ktg: abr.ktg, pkAbzug: abr.pkAbzug, qstSatz: abr.qstSatz,
    deckelMonate: abr.deckelMonate ?? 1, manuell: abr.manuell ?? {},
  })

  /** Alle gespeicherten Abrechnungen des Monats in die Lohn-Ordner ablegen —
   *  eine Anfrage PRO Mitarbeiterin; der Server erzeugt jedes PDF aus der
   *  gespeicherten Zeile __lohn_abr__<profilId>_<id>, deren Schlüssel die
   *  Mitarbeiterin fest enthält. Ordner und Inhalt können damit nie
   *  auseinanderfallen. */
  async function alleAblegen() {
    if (monatsAbrechnungen.length === 0 || busy) return
    const monatLabel = `${MONTH_NAMES[parseInt(monat.slice(5, 7), 10) - 1]} ${jahr}`
    if (!confirm(`Alle ${monatsAbrechnungen.length} Abrechnungen ${monatLabel} als PDF in den Lohn-Ordner der jeweiligen Mitarbeiterin ablegen?\nBestehende Dateien mit gleichem Namen werden ersetzt. Die Mitarbeiterinnen sehen die Datei danach in ihren Dokumenten.`)) return
    setBusy(true); setError(null); setOkMsg(null); setBulkResults(null)
    const results: Array<{ name: string; status: string }> = []
    for (let i = 0; i < monatsAbrechnungen.length; i++) {
      const { profileId, abr } = monatsAbrechnungen[i]
      const name = nameById.get(profileId) ?? '?'
      setBulkProgress(`${i + 1}/${monatsAbrechnungen.length} — ${name}…`)
      try {
        const res = await fetch('/api/admin/lohn-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employeeId: profileId,
            abr: { ...abrToData(abr), qstTarif: stammById[profileId]?.qstTarif ?? null },
            mode: 'ablegen', replace: true, abrId: abr.id,
          }),
        })
        const j = await res.json().catch(() => ({}))
        results.push({ name: `${name} — ${abr.titel} ${abr.periode}`, status: res.ok ? 'abgelegt' : ((j as { error?: string }).error ?? 'Fehler') })
      } catch {
        results.push({ name: `${name} — ${abr.titel} ${abr.periode}`, status: 'Netzwerkfehler' })
      }
    }
    setBulkProgress('')
    setBulkResults(results)
    const okCount = results.filter(r => r.status === 'abgelegt').length
    setOkMsg(`${okCount} von ${results.length} Abrechnungen ${monatLabel} in die Lohn-Ordner abgelegt.`)
    setBusy(false)
  }

  /** Kontrollansicht laden: der Server liest pro Lohn-Datei des Monats den
   *  PDF-Titel («<Titel> <Periode> <Name>») und vergleicht ihn mit der
   *  Ordnerinhaberin. */
  async function ablagePruefen() {
    setKontrolle(k => ({ ...k, laeuft: true, fehler: null, offen: true }))
    try {
      const res = await fetch(`/api/admin/lohn-kontrolle?monat=${monat}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setKontrolle(k => ({ ...k, laeuft: false, fehler: (j as { error?: string }).error ?? 'Prüfung fehlgeschlagen.' })); return }
      setKontrolle({ laeuft: false, daten: j as KontrolleErgebnis, fehler: null, offen: true })
    } catch {
      setKontrolle(k => ({ ...k, laeuft: false, fehler: 'Netzwerkfehler — bitte erneut versuchen.' }))
    }
  }
  async function kontrolleOeffnen(dokId: string) {
    const fw = openFileWindow()   // synchron vor dem await, sonst blockt der Popup-Schutz
    const r = await getDocumentUrl(dokId)
    if ('error' in r && r.error) { fw.cancel(); setError(r.error); return }
    fw.show((r as { url: string }).url)
  }

  // ── Stammdaten speichern ──────────────────────────────────────────────────
  async function stammSpeichern() {
    if (!stammDialog) return
    if (stammDialog.form.zulagen.some(z => !z.name.trim())) {
      setError('Bitte für jede Zulage den Namen des Kindes eingeben (oder die leere Zeile mit × entfernen).')
      return
    }
    if ((stammDialog.form.zuschlaege ?? []).some(z => !z.label.trim() || !z.betrag) ||
        (stammDialog.form.nachZeilen ?? []).some(z => !z.label.trim() || !z.betrag)) {
      setError('Bitte für jede monatliche Zeile Bezeichnung und Betrag eingeben (oder die Zeile mit × entfernen).')
      return
    }
    setBusy(true); setError(null)
    try {
      const res = await saveLohnStamm(stammDialog.profileId, stammDialog.form)
      if (res?.error) setError(res.error)
      else { setStammDialog(null); router.refresh() }
    } catch { setError('Speichern fehlgeschlagen — bitte erneut versuchen.') }
    setBusy(false)
  }

  async function saetzeSpeichern() {
    // Auch UNVERÄNDERTE Vorlage-Werte sind speicherbar — das Speichern
    // bestätigt sie als geprüft für das Jahr.
    const form = saetzeForm ?? saetzeFor(saetzeJahr)
    setBusy(true); setError(null)
    try {
      const res = await saveLohnSaetze({ ...form, jahr: saetzeJahr })
      if (res?.error) setError(res.error)
      else { setSaetzeForm(null); setOkMsg(`Sätze ${saetzeJahr} gespeichert.`); router.refresh() }
    } catch { setError('Speichern fehlgeschlagen — bitte erneut versuchen.') }
    setBusy(false)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const dialogSaetze = dialog ? saetzeFor(parseInt(dialog.monat.slice(0, 4), 10)) : saetze
  const preview = dialog ? berechneLohn(dialogAbr(dialog, dialogSaetze), dialogSaetze) : null
  const dialogName = dialog ? (nameById.get(dialog.profileId) ?? '?') : ''

  /** Wie im Excel: jeder automatisch berechnete Betrag lässt sich überschreiben.
   *  Leeres Feld = berechnet (Wert grau als Platzhalter), eingetragener Wert
   *  = von Hand (orange), ↺ setzt auf die Berechnung zurück. */
  const setManuell = (key: AbzugKey, feld: keyof AbzugManuell, wert: number | null) => setDialog(d => {
    if (!d) return d
    const alt: AbzugManuell = { ...(d.manuell[key] ?? {}) }
    if (wert == null) delete alt[feld]; else alt[feld] = wert
    const manuell: LohnManuell = { ...d.manuell }
    if (Object.keys(alt).length === 0) delete manuell[key]; else manuell[key] = alt
    return { ...d, manuell }
  })
  const setZeile = (key: string, wert: number | null) => setDialog(d => {
    if (!d) return d
    const z = { ...d.zeilenManuell }
    if (wert == null) delete z[key]; else z[key] = wert
    return { ...d, zeilenManuell: z }
  })
  // Zwischenstand während der Eingabe (sonst ginge «426.» sofort verloren)
  const [entwurf, setEntwurf] = useState<Record<string, string>>({})
  const dialogId = dialog?.id
  useEffect(() => { setEntwurf({}) }, [dialogId])
  /** Props für ein Zahlenfeld: zeigt den Entwurf, solange getippt wird, sonst den gespeicherten Wert */
  const feld = (id: string, wert: number | null | undefined, onWert: (n: number | null) => void, anzeige: (n: number) => string = String) => ({
    value: entwurf[id] ?? (wert != null ? anzeige(wert) : ''),
    onChange: (e: ChangeEvent<HTMLInputElement>) => { const raw = e.target.value; setEntwurf(x => ({ ...x, [id]: raw })); onWert(parseZahl(raw)) },
    onBlur: () => setEntwurf(x => { const n = { ...x }; delete n[id]; return n }),
  })
  const parseZahl = (v: string): number | null => {
    const t = v.replace(/'/g, '').replace(',', '.').trim()
    if (t === '') return null
    const n = parseFloat(t)
    return Number.isFinite(n) ? n : null
  }
  const pctText = (satz: number) => String(Math.round(satz * 100 * 10000) / 10000)
  const feldCls = (manuell: boolean) => `w-full px-2 py-1 text-[13px] tnum text-right rounded-md border focus:outline-none focus:ring-1 focus:ring-dusk placeholder:text-ink-4 ${manuell ? 'border-apricot-ink/60 bg-apricot-bg/40 text-ink font-semibold' : 'border-edge-ctl bg-white'}`
  const Zuruck = ({ onClick, titel }: { onClick: () => void; titel: string }) => (
    <button type="button" onClick={onClick} className="text-[12px] text-apricot-ink hover:text-ink px-1" title={titel}>↺</button>
  )

  const uebersicht = (d: AbrDialog, calc: NonNullable<typeof preview>) => {
    const generiert = d.bausteine ? generatedLines(d, dialogSaetze) : []
    const weitere = d.bausteine ? d.extraLines.filter(l => l.label.trim() && l.betrag !== 0) : d.extraLines.filter(l => l.label.trim())
    const abz = calc.abzuege.filter(a => a.key && a.key !== 'pk')
    const pk = calc.abzuege.find(a => a.key === 'pk')
    const zeigeQst = d.qstSatz != null || !!d.manuell.qst
    const anzahlManuell = Object.keys(d.zeilenManuell).length + Object.values(d.manuell).reduce((t, o) => t + Object.keys(o ?? {}).length, 0)
    return (
      <div className="rounded-ctl border border-edge-soft overflow-hidden">
        <div className="px-4 py-2.5 bg-surface border-b border-edge-soft flex flex-wrap items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Abrechnung wie im Excel</p>
          {anzahlManuell > 0 && <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-apricot-bg text-apricot-ink">{anzahlManuell} {anzahlManuell === 1 ? 'Wert' : 'Werte'} von Hand</span>}
          {anzahlManuell > 0 && <button type="button" onClick={() => setDialog(x => x ? { ...x, zeilenManuell: {}, manuell: {} } : x)} className="ml-auto text-[11px] font-semibold text-ink-4 hover:text-ink-2">Alle zurücksetzen</button>}
        </div>
        <div className="p-4 space-y-3 text-sm tnum">
          <p className="text-[11px] text-ink-4">Graue Werte rechnet das Portal. Ein eingetragener Wert überschreibt die Berechnung und gilt auch im PDF, ↺ setzt ihn zurück. Bruttoeinkommen, Totale und Auszahlung ergeben sich aus den Zeilen.</p>

          <div className="space-y-1">
            {generiert.map((l, i) => {
              const key = zeilenKey(l.label)
              const v = d.zeilenManuell[key]
              const man = typeof v === 'number'
              return (
                <div key={`g${i}`} className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 text-ink-2 truncate" title={l.label}>{l.label}</span>
                  {man && <Zuruck onClick={() => setZeile(key, null)} titel={`Berechnet ${fmtLohnChf(l.betrag)}, zurücksetzen`} />}
                  <input type="text" inputMode="decimal" placeholder={fmtLohnChf(l.betrag)}
                    {...feld(`z:${key}`, man ? v : null, n => setZeile(key, n))} className={`${feldCls(man)} !w-32 flex-shrink-0`} />
                </div>
              )
            })}
            {weitere.map((l, i) => (
              <div key={`w${i}`} className="flex items-center gap-2">
                <span className="flex-1 min-w-0 text-ink-2 truncate" title={l.label}>{l.label}</span>
                <span className="w-32 flex-shrink-0 text-right pr-2 text-ink-2" title="Oben unter Lohnbestandteile bearbeiten">{fmtLohnChf(l.betrag)}</span>
              </div>
            ))}
            <div className="flex justify-between pt-1.5 border-t border-edge-soft"><span className="font-semibold text-ink">Bruttoeinkommen</span><span className="font-semibold text-ink pr-2">{fmtLohnChf(calc.brutto)}</span></div>
            {calc.zulagenTotal !== 0 && <div className="flex justify-between"><span className="text-ink-3">Sozialzulagen</span><span className="text-ink-2 pr-2">{fmtLohnChf(calc.zulagenTotal)}</span></div>}
          </div>

          <div>
            <div className="grid grid-cols-[1fr_7rem_5.5rem_7rem_1.25rem] gap-x-2 items-end text-[10px] font-semibold uppercase tracking-wider text-ink-4 pb-1">
              <span>Versicherungsabzüge</span><span className="text-right">Basis</span><span className="text-right">Satz %</span><span className="text-right">Betrag</span><span />
            </div>
            <div className="space-y-1">
              {abz.map(a => {
                const k = a.key as AbzugKey
                const m = d.manuell[k] ?? {}
                const auto = a.auto!
                return (
                  <div key={k} className="grid grid-cols-[1fr_7rem_5.5rem_7rem_1.25rem] gap-x-2 items-center">
                    <span className="text-ink-2 truncate" title={a.label}>{a.label}</span>
                    <input type="text" inputMode="decimal" placeholder={fmtLohnChf(auto.basis)}
                      {...feld(`${k}:basis`, m.basis, n => setManuell(k, 'basis', n))} className={feldCls(m.basis != null)} />
                    <input type="text" inputMode="decimal" placeholder={pctText(auto.satz)}
                      {...feld(`${k}:satz`, m.satz, n => setManuell(k, 'satz', n == null ? null : n / 100), pctText)} className={feldCls(m.satz != null)} />
                    <input type="text" inputMode="decimal" placeholder={fmtLohnChf(Math.abs(m.betrag != null ? auto.betrag : a.betrag))}
                      {...feld(`${k}:betrag`, m.betrag, n => setManuell(k, 'betrag', n))} className={feldCls(m.betrag != null)} />
                    {a.manuell ? <Zuruck onClick={() => setDialog(x => { if (!x) return x; const mm = { ...x.manuell }; delete mm[k]; return { ...x, manuell: mm } })} titel={`Berechnet ${fmtLohnChf(Math.abs(auto.betrag))}, zurücksetzen`} /> : <span />}
                  </div>
                )
              })}
              {pk && (
                <div className="grid grid-cols-[1fr_7rem_5.5rem_7rem_1.25rem] gap-x-2 items-center">
                  <span className="text-ink-2">Pensionskasse</span><span /><span />
                  <input type="text" inputMode="decimal" placeholder="0.00"
                    {...feld('pk', d.pkAbzug || null, n => setDialog(x => x ? { ...x, pkAbzug: n ?? 0 } : x))} className={feldCls(false)} />
                  <span />
                </div>
              )}
              {zeigeQst && (() => {
                const m = d.manuell.qst ?? {}
                return (
                  <div className="grid grid-cols-[1fr_7rem_5.5rem_7rem_1.25rem] gap-x-2 items-center">
                    <span className="text-ink-2">Quellensteuer</span>
                    <input type="text" inputMode="decimal" placeholder={fmtLohnChf(calc.qst.auto.basis)}
                      {...feld('qst:basis', m.basis, n => setManuell('qst', 'basis', n))} className={feldCls(m.basis != null)} />
                    <input type="text" inputMode="decimal" placeholder={calc.qst.auto.satzPct != null ? String(calc.qst.auto.satzPct) : '0'}
                      {...feld('qst:satz', m.satz, n => setManuell('qst', 'satz', n == null ? null : n / 100), pctText)} className={feldCls(m.satz != null)} />
                    <input type="text" inputMode="decimal" placeholder={fmtLohnChf(Math.abs(m.betrag != null ? calc.qst.auto.betrag : calc.qstBetrag))}
                      {...feld('qst:betrag', m.betrag, n => setManuell('qst', 'betrag', n))} className={feldCls(m.betrag != null)} />
                    {calc.qst.manuell ? <Zuruck onClick={() => setDialog(x => { if (!x) return x; const mm = { ...x.manuell }; delete mm.qst; return { ...x, manuell: mm } })} titel={`Berechnet ${fmtLohnChf(Math.abs(calc.qst.auto.betrag))}, zurücksetzen`} /> : <span />}
                  </div>
                )
              })()}
              <div className="flex justify-between pt-1.5 border-t border-edge-soft"><span className="text-ink-3">Total Versicherungsabzüge</span><span className="text-ink-2 pr-2">{fmtLohnChf(calc.abzugTotal + calc.qstBetrag)}</span></div>
            </div>
          </div>

          {calc.nachTotal !== 0 && <div className="flex justify-between"><span className="text-ink-3">Nach den Abzügen</span><span className="text-ink-2 pr-2">{fmtLohnChf(calc.nachTotal)}</span></div>}
          <div className="flex justify-between pt-2 border-t border-edge-soft">
            <span className="font-bold text-ink">Auszahlung</span>
            <span className="font-bold text-mint-ink text-base pr-2">CHF {fmtLohnChf(calc.auszahlung)}</span>
          </div>
        </div>
      </div>
    )
  }

  const posEditor = (list: LohnPos[], set: (l: LohnPos[]) => void, addLabel: string) => (
    <div className="space-y-1.5">
      {list.map((l, i) => (
        <div key={i} className="flex gap-1.5">
          <input type="text" value={l.label} placeholder="Bezeichnung"
            onChange={e => set(list.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
            className={`${inputCls} flex-1 ${l.betrag !== 0 && !l.label.trim() ? '!border-apricot-ink/60' : ''}`} />
          <input type="number" step="0.01" value={l.betrag || ''} placeholder="CHF"
            onChange={e => set(list.map((x, j) => j === i ? { ...x, betrag: parseFloat(e.target.value) || 0, manuell: true } : x))}
            className={`${numCls} !w-32 flex-shrink-0`} />
          <button onClick={() => set(list.filter((_, j) => j !== i))}
            className="px-2 rounded-lg border border-edge-ctl text-ink-4 hover:text-red-500 hover:bg-edge-row" title="Zeile entfernen">×</button>
        </div>
      ))}
      <button onClick={() => set([...list, { label: '', betrag: 0 }])}
        className="text-xs font-semibold text-mint-ink hover:underline underline-offset-2">+ {addLabel}</button>
    </div>
  )

  const renderAbrZeile = (profileId: string, abr: LohnAbrechnung) => {
    const sz = saetzeFor(parseInt(abr.monat.slice(0, 4), 10))
    const calc = berechneLohn(abr, sz)
    return (
      <li key={`${profileId}-${abr.id}`} className="px-6 py-3.5 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <p className="text-sm font-semibold text-ink">{nameById.get(profileId) ?? '?'}</p>
          <p className="text-xs text-ink-4">{abr.titel} · {abr.periode} · erstellt am {abr.erstelltAm.split('-').reverse().join('.')}
            {(Object.keys(abr.manuell ?? {}).length > 0 || abr.lines.some(l => l.manuell)) && (
              <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-apricot-bg text-apricot-ink" title="Enthält von Hand überschriebene Werte">von Hand angepasst</span>
            )}
          </p>
        </div>
        <p className="text-sm font-bold text-ink-2 tnum">CHF {fmtLohnChf(calc.auszahlung)}</p>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={() => pdf(profileId, abrToData(abr), 'inline', stammById[profileId]?.qstTarif ?? null)} disabled={busy} className="btn-secondary text-xs px-3 py-1.5">Öffnen</button>
          <button onClick={() => pdf(profileId, abrToData(abr), 'download', stammById[profileId]?.qstTarif ?? null)} disabled={busy} className="btn-secondary text-xs px-3 py-1.5">Herunterladen</button>
          <button onClick={() => pdf(profileId, abrToData(abr), 'ablegen', stammById[profileId]?.qstTarif ?? null, abr.id)} disabled={busy} className="btn-secondary text-xs px-3 py-1.5"
            title="PDF in den Lohn-Ordner der Mitarbeiterin ablegen (für sie sichtbar)">In Ordner ablegen</button>
          <button onClick={() => neuBerechnen(profileId, abr)} disabled={busy} className="btn-secondary text-xs px-3 py-1.5"
            title="Alle Zeilen nach dem Regelwerk frisch aus Stammdaten und Arbeitsplan erzeugen — ersetzt die bisherige Abrechnung beim Speichern">Neu berechnen</button>
          <button onClick={() => openBearbeiten(profileId, abr)} disabled={busy} className="btn-secondary text-xs px-3 py-1.5">Bearbeiten</button>
          <button onClick={() => loeschen(profileId, abr)} disabled={busy}
            className="p-1.5 rounded-lg border border-edge-ctl bg-white text-ink-4 hover:text-red-500 hover:bg-edge-row" title="Löschen">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </li>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Lohnabrechnungen</h1>
          <p className="page-subtitle">Abrechnungen erstellen, Lohn-Stammdaten und Sätze pflegen — nur für Admins sichtbar</p>
        </div>
        <div className="flex rounded-lg border border-edge-ctl overflow-hidden">
          {([['abr', 'Abrechnung'], ['stamm', 'Stammdaten'], ['saetze', 'Sätze']] as const).map(([key, label]) => (
            <button key={key} onClick={() => { setTab(key); setError(null); setOkMsg(null) }}
              className={`px-4 py-2 text-[13px] font-semibold transition-colors ${tab === key ? 'bg-dusk-night text-white' : 'bg-white text-ink-3 hover:bg-edge-row'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink">⚠ {error}</p>}
      {okMsg && <p className="text-xs px-3 py-2 rounded-ctl bg-mint-bg text-mint-ink">✓ {okMsg}</p>}
      {bvgKontrolle.length > 0 && (
        <div className="card p-4 border-apricot-ink/25">
          <p className="text-sm font-semibold text-apricot-ink">
            ⚠ BVG-Kontrolle: Bei {bvgKontrolle.length} {bvgKontrolle.length === 1 ? 'Person weicht' : 'Personen weicht'} der gespeicherte
            BVG-Abzug (HR / Stammdaten) von der letzten Lohnabrechnung ab.
          </p>
          <ul className="mt-2 space-y-1">
            {bvgKontrolle.map(k => (
              <li key={k.id} className="text-xs text-ink-3 tnum">
                <span className="font-semibold text-ink-2">{k.name}</span> — gespeichert {fmtLohnChf(k.stamm)}, letzte Abrechnung ({k.periode}) {fmtLohnChf(k.abrechnung)}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-ink-4 mt-2">
            Der gespeicherte Wert belegt neue Abrechnungen vor. Stimmt die Abrechnung, den Betrag in den Stammdaten oder im HR der Person
            anpassen — oder in der nächsten Abrechnung eingeben, dann wird er automatisch übernommen.
          </p>
        </div>
      )}

      {/* ═══ Tab Abrechnung ═══ */}
      {tab === 'abr' && (
        <>
          <div className="card p-5 flex items-end gap-4 flex-wrap">
            <div>
              <p className="field-label">Monat</p>
              <input type="month" value={monat} onChange={e => e.target.value && setMonat(e.target.value)} className={inputCls} />
            </div>
            <div className="flex-1 min-w-[220px]">
              <p className="field-label">Neue Abrechnung für</p>
              <div className="flex gap-2">
                <select value={neuId} onChange={e => setNeuId(e.target.value)} className={`${inputCls} flex-1`}>
                  <option value="">Mitarbeiterin wählen…</option>
                  {active.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
                <button onClick={() => neuId && openNeu(neuId)} disabled={!neuId || busy} className="btn-primary text-sm whitespace-nowrap">
                  Erstellen
                </button>
              </div>
            </div>
          </div>
          {saetzeFehlen && (
            <p className="text-xs px-3 py-2 rounded-ctl bg-apricot-bg text-apricot-ink">
              ⚠ Für {jahr} sind noch keine Sätze erfasst — es gelten die Werte {LOHN_SAETZE_2026.jahr}. Bitte im Reiter «Sätze» prüfen und speichern.
            </p>
          )}

          <div className="card overflow-hidden">
            <div className="px-6 py-4 border-b border-edge-soft flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-sm font-semibold text-ink-2 flex items-center gap-2 flex-wrap">
                Abrechnungen {MONTH_NAMES[parseInt(monat.slice(5, 7), 10) - 1]} {jahr}
                <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${fehlendeImMonat.length === 0 ? 'bg-mint-bg text-mint-ink' : 'bg-apricot-bg text-apricot-ink'}`}>
                  {faelligeImMonat.length - fehlendeImMonat.length} von {faelligeImMonat.length} gespeichert
                </span>
              </h2>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button onClick={ablagePruefen} disabled={busy || kontrolle.laeuft} className="btn-secondary !px-3.5 !py-2 !text-xs"
                  title="Welche Lohn-PDFs liegen in welchem Dokumentenordner, und passt der Name im PDF zur Person">
                  {kontrolle.laeuft ? 'Prüft…' : 'Abgelegte PDFs prüfen'}
                </button>
                {monatsAbrechnungen.length > 0 && (<>
                  <button onClick={() => monatPdf('inline')} disabled={busy} className="btn-secondary !px-3.5 !py-2 !text-xs"
                    title="Alle gespeicherten Abrechnungen des Monats als EIN PDF öffnen — zum Kontrollieren oder Drucken in einem Zug">
                    Gesamt-PDF öffnen
                  </button>
                  <button onClick={() => monatPdf('download')} disabled={busy} className="btn-secondary !px-3.5 !py-2 !text-xs"
                    title="Alle gespeicherten Abrechnungen des Monats als EINE Datei herunterladen">
                    Gesamt-PDF herunterladen
                  </button>
                  <button onClick={alleAblegen} disabled={busy} className="btn-primary !px-3.5 !py-2 !text-xs"
                    title="Jedes PDF wird serverseitig aus der gespeicherten Abrechnung erzeugt und in den Lohn-Ordner der jeweiligen Mitarbeiterin gelegt">
                    {bulkProgress ? bulkProgress : `Alle ${monatsAbrechnungen.length} in Lohn-Ordner ablegen`}
                  </button>
                </>)}
              </div>
            </div>
            <div className="px-6 py-2.5 border-b border-edge-soft bg-surface">
              {fehlendeImMonat.length === 0 ? (
                <p className="text-xs font-semibold text-mint-ink">✓ Für alle aktiven Mitarbeiterinnen ist eine Abrechnung gespeichert.</p>
              ) : (
                <p className="text-xs text-apricot-ink">
                  <span className="font-semibold">Fehlen noch ({fehlendeImMonat.length}):</span> {fehlendeImMonat.join(', ')}
                </p>
              )}
            </div>
            {bulkResults && (
              <div className="px-6 py-3 border-b border-edge-soft bg-surface">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4 mb-1.5">Ablage-Ergebnis</p>
                <ul className="space-y-0.5">
                  {bulkResults.map((r, i) => (
                    <li key={i} className={`text-xs ${r.status === 'abgelegt' ? 'text-mint-ink' : 'text-blush-ink font-semibold'}`}>
                      {r.status === 'abgelegt' ? '✓' : '⚠'} {r.name}{r.status !== 'abgelegt' ? ` — ${r.status}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {kontrolle.offen && (
              <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true">
                <div className="bg-white w-full sm:rounded-card sm:max-w-3xl shadow-xl overflow-hidden rounded-t-card border border-edge max-h-[90vh] flex flex-col">
                  <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-edge-soft bg-surface">
                    <div>
                      <h3 className="text-sm font-bold text-ink">Abgelegte PDFs {kontrolle.daten?.label ?? `${MONTH_NAMES[parseInt(monat.slice(5, 7), 10) - 1]} ${jahr}`}</h3>
                      <p className="text-xs text-ink-4 mt-0.5">
                        Pro Person die Lohn-Dateien in ihrem Dokumentenordner. Der Name wird aus dem PDF selbst gelesen (Titel, den das Portal beim Erzeugen setzt) und mit der Ordnerinhaberin verglichen.
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 ml-4">
                      <button onClick={ablagePruefen} disabled={kontrolle.laeuft} className="btn-secondary !px-3 !py-1.5 !text-xs">{kontrolle.laeuft ? 'Prüft…' : 'Neu prüfen'}</button>
                      <button onClick={() => setKontrolle(k => ({ ...k, offen: false }))} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4">✕</button>
                    </div>
                  </div>
                  {kontrolle.daten && !kontrolle.laeuft && (() => {
                    const z = kontrolle.daten.zaehler
                    const chip = (n: number, text: string, cls: string) => n > 0 ? <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{n} {text}</span> : null
                    return (
                      <div className="px-6 py-2.5 border-b border-edge-soft flex flex-wrap items-center gap-1.5">
                        {chip(z.ok, 'in Ordnung', 'bg-mint-bg text-mint-ink')}
                        {chip(z.fremd, z.fremd === 1 ? 'im falschen Ordner' : 'im falschen Ordner', 'bg-red-100 text-red-700')}
                        {chip(z.fehlt, 'ohne PDF', 'bg-apricot-bg text-apricot-ink')}
                        {chip(z.doppelt, 'mit mehreren PDFs', 'bg-apricot-bg text-apricot-ink')}
                        {chip(z.unbekannt, 'nicht prüfbar', 'bg-edge-row text-ink-3')}
                        {z.fremd === 0 && z.fehlt === 0 && z.doppelt === 0 && z.unbekannt === 0 && (
                          <span className="text-[11.5px] text-mint-ink font-semibold">✓ Jede fällige Person hat genau ein PDF mit ihrem eigenen Namen im Ordner.</span>
                        )}
                        <span className="ml-auto text-[10.5px] text-ink-4 tnum">geprüft {new Date(kontrolle.daten.geprueftAm).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }).replace(':', '.')} Uhr</span>
                      </div>
                    )
                  })()}
                  <div className="overflow-auto">
                    {kontrolle.fehler && <p className="m-6 text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {kontrolle.fehler}</p>}
                    {kontrolle.laeuft && <p className="px-6 py-8 text-sm text-ink-3">Die PDFs werden gelesen…</p>}
                    {kontrolle.daten && !kontrolle.laeuft && (
                      <table className="w-full min-w-[640px]">
                        <thead>
                          <tr>
                            {['Person', 'Ergebnis', 'Dateien im Lohn-Ordner', ''].map((h, i) => (
                              <th key={i} className="px-4 py-2 border-b-[1.5px] border-edge-ctl text-[10px] font-semibold uppercase tracking-[.1em] text-ink-4 text-left">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {kontrolle.daten.personen.map(p => {
                            const cls: Record<Urteil, string> = {
                              ok: 'bg-mint-bg text-mint-ink', fremd: 'bg-red-100 text-red-700', fehlt: 'bg-apricot-bg text-apricot-ink',
                              doppelt: 'bg-apricot-bg text-apricot-ink', unbekannt: 'bg-edge-row text-ink-3', nicht_faellig: 'bg-edge-row text-ink-4',
                            }
                            return (
                              <tr key={p.profileId} className={p.urteil === 'fremd' ? 'bg-red-50' : ''}>
                                <td className="px-4 py-2.5 border-b border-edge-row align-top">
                                  <p className="text-[12.5px] font-semibold text-ink">{p.name}</p>
                                  <p className="text-[10.5px] text-ink-4">{p.abrechnungGespeichert ? 'Abrechnung gespeichert' : p.faellig ? 'keine Abrechnung gespeichert' : 'nicht fällig'}{!p.aktiv ? ' · inaktiv' : ''}</p>
                                </td>
                                <td className="px-4 py-2.5 border-b border-edge-row align-top">
                                  <span className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${cls[p.urteil]}`}>{URTEIL_TEXT[p.urteil]}</span>
                                </td>
                                <td className="px-4 py-2.5 border-b border-edge-row align-top" colSpan={2}>
                                  {p.dateien.length === 0 ? (
                                    <span className="text-[11.5px] text-ink-4">—</span>
                                  ) : p.dateien.map(d => (
                                    <div key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5">
                                      <span className="text-[12px] text-ink">{d.label}</span>
                                      {d.pruefung.status === 'ok' && <span className="text-[10.5px] font-semibold text-mint-ink">✓ Name im PDF stimmt</span>}
                                      {d.pruefung.status === 'fremd' && <span className="text-[10.5px] font-bold text-red-700">✖ Name im PDF: {d.pruefung.name}</span>}
                                      {d.pruefung.status === 'unbekannt' && <span className="text-[10.5px] text-ink-4" title={d.titel ? `Titel im PDF: ${d.titel}` : 'Das PDF hat keinen lesbaren Titel (nicht vom Portal erzeugt)'}>? Name nicht prüfbar</span>}
                                      <span className="text-[10.5px] text-ink-4 tnum">
                                        abgelegt {new Date(d.createdAt).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })}{d.abgelegtVon ? ` von ${d.abgelegtVon.split(' ')[0]}` : ''}
                                      </span>
                                      <button onClick={() => kontrolleOeffnen(d.id)} className="text-[10.5px] font-semibold text-ink-3 hover:text-ink underline">Öffnen</button>
                                    </div>
                                  ))}
                                </td>
                              </tr>
                            )
                          })}
                          {kontrolle.daten.personen.length === 0 && (
                            <tr><td colSpan={4} className="px-4 py-6 text-center text-[12.5px] text-ink-3">Für diesen Monat gibt es weder fällige Personen noch abgelegte Lohn-Dateien.</td></tr>
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div className="px-6 py-3 border-t border-edge-soft bg-surface text-[11px] text-ink-4">
                    «Im falschen Ordner» heisst: Im PDF steht der Name einer anderen Person. Dann die Datei im Ordner löschen und die Abrechnung über «In Ordner ablegen» neu ablegen. «Nicht prüfbar» sind von Hand hochgeladene Fremd-PDFs ohne Titel, die bitte kurz öffnen.
                  </div>
                </div>
              </div>
            )}
            {monatsAbrechnungen.length === 0 ? (
              <p className="px-6 py-6 text-sm text-ink-4">Für diesen Monat wurden noch keine Abrechnungen erstellt.</p>
            ) : (
              <ul className="divide-y divide-edge-row">
                {monatsAbrechnungen.map(({ profileId, abr }) => renderAbrZeile(profileId, abr))}
              </ul>
            )}
          </div>

          {/* ── Suche in allen gespeicherten Abrechnungen ── */}
          <div className="card overflow-hidden">
            <div className="px-6 py-4 border-b border-edge-soft">
              <h2 className="text-sm font-semibold text-ink-2">Gespeicherte Abrechnungen suchen</h2>
              <p className="text-xs text-ink-4 mt-0.5">Alle je erstellten Abrechnungen, filterbar nach Mitarbeiterin, Jahr und Monat.</p>
            </div>
            <div className="px-6 py-4 flex items-end gap-3 flex-wrap border-b border-edge-soft">
              <div className="flex-1 min-w-[180px]">
                <p className="field-label">Mitarbeiterin</p>
                <input type="text" value={sucheName} onChange={e => setSucheName(e.target.value)}
                  placeholder="Name eingeben…" className={inputCls} />
              </div>
              <div>
                <p className="field-label">Jahr</p>
                <select value={sucheJahr} onChange={e => setSucheJahr(e.target.value)} className={inputCls}>
                  <option value="alle">Alle</option>
                  {sucheJahre.map(j => <option key={j} value={j}>{j}</option>)}
                </select>
              </div>
              <div>
                <p className="field-label">Monat</p>
                <select value={sucheMonat} onChange={e => setSucheMonat(e.target.value)} className={inputCls}>
                  <option value="alle">Alle</option>
                  {MONTH_NAMES.map((m, i) => (
                    <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
            {suchErgebnis.length === 0 ? (
              <p className="px-6 py-6 text-sm text-ink-4">
                {alleAbrechnungen.length === 0 ? 'Noch keine Abrechnungen gespeichert.' : 'Keine Abrechnungen für diese Filter gefunden.'}
              </p>
            ) : (
              <>
                <ul className="divide-y divide-edge-row">
                  {suchErgebnis.slice(0, 60).map(({ profileId, abr }) => renderAbrZeile(profileId, abr))}
                </ul>
                {suchErgebnis.length > 60 && (
                  <p className="px-6 py-3 text-xs text-ink-4 border-t border-edge-soft">
                    {suchErgebnis.length - 60} weitere Treffer — bitte Filter eingrenzen.
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ═══ Tab Stammdaten ═══ */}
      {tab === 'stamm' && (
        <div className="card overflow-hidden">
          <div className="px-6 py-4 border-b border-edge-soft">
            <h2 className="text-sm font-semibold text-ink-2">Lohn-Stammdaten pro Mitarbeiterin</h2>
            <p className="text-xs text-ink-4 mt-0.5">Einträge mit «Vorschlag» stammen aus dem bisherigen Lohn-Excel und gelten erst nach dem Speichern als geprüft.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider border-b border-edge-soft">
                  <th className="text-left px-6 py-2.5 font-semibold">Name</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Lohnart</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Monatslohn</th>
                  <th className="text-center px-3 py-2.5 font-semibold">13.</th>
                  <th className="text-left px-3 py-2.5 font-semibold">KTG</th>
                  <th className="text-right px-3 py-2.5 font-semibold">PK-Abzug</th>
                  <th className="text-left px-3 py-2.5 font-semibold">QST</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Zuschläge</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Zulagen</th>
                  <th className="px-6 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-edge-row">
                {active.map(p => {
                  const st = stammFor(p)
                  return (
                    <tr key={p.id}>
                      <td className="px-6 py-2.5">
                        <p className="font-medium text-ink">{p.full_name}</p>
                        {!st.geprueft && (
                          <span className="inline-flex px-1.5 py-0.5 rounded-full bg-apricot-bg text-apricot-ink text-[10px] font-semibold">Vorschlag — bitte prüfen</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-ink-2">{LOHN_ART_LABEL[st.art]}</td>
                      <td className="px-3 py-2.5 text-right tnum text-ink-2">
                        {(st.art === 'monatslohn' || st.art === 'nicht_ahv') && (st.monatslohn ?? monatslohnOf(p)) > 0 ? (
                          <>
                            {fmtLohnChf(st.monatslohn ?? monatslohnOf(p))}
                            {st.monatslohn != null && (
                              <span className="block text-[10px] font-semibold text-apricot-ink">angepasst</span>
                            )}
                          </>
                        ) : '–'}
                      </td>
                      <td className="px-3 py-2.5 text-center">{st.dreizehnter ? '✓' : '–'}</td>
                      <td className="px-3 py-2.5 text-ink-2">{st.ktg === 'keine' ? '–' : st.ktg === 'erhoeht' ? 'erhöht' : 'Standard'}</td>
                      <td className="px-3 py-2.5 text-right tnum text-ink-2">
                        {st.pkAbzug > 0 ? fmtLohnChf(st.pkAbzug) : '–'}
                        {bvgKontrolle.some(k => k.id === p.id) && (
                          <span className="block text-[10px] font-semibold text-apricot-ink" title="weicht von der letzten Abrechnung ab">≠ letzte Abrechnung</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-ink-2">{st.qstSatz ? `${st.qstSatz}%${st.qstTarif ? ` (${st.qstTarif})` : ''}` : '–'}</td>
                      <td className="px-3 py-2.5 text-ink-2 whitespace-nowrap">
                        {[
                          ...(st.zuschlaege ?? []).map(z => `${z.label} ${fmtLohnChf(z.betrag)}`),
                          ...(st.nachZeilen ?? []).map(z => `${z.label} ${fmtLohnChf(z.betrag)} (nach Abz.)`),
                        ].join(', ') || '–'}
                      </td>
                      <td className="px-3 py-2.5 text-ink-2">{st.zulagen.length > 0 ? st.zulagen.map(z => z.name).join(', ') : '–'}</td>
                      <td className="px-6 py-2.5 text-right">
                        <button onClick={() => setStammDialog({ profileId: p.id, form: { ...st, zulagen: st.zulagen.map(z => ({ ...z })), zuschlaege: (st.zuschlaege ?? []).map(z => ({ ...z })), nachZeilen: (st.nachZeilen ?? []).map(z => ({ ...z })) } })}
                          className="btn-secondary text-xs px-3 py-1.5">Bearbeiten</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ Tab Sätze ═══ */}
      {tab === 'saetze' && (() => {
        const form = saetzeForm ?? saetzeFor(saetzeJahr)
        const set = (patch: Partial<LohnSaetze>) => setSaetzeForm({ ...form, ...patch })
        const pctField = (label: string, key: 'ahv' | 'alv' | 'nbu' | 'ktgStandard' | 'ktgErhoeht' | 'ferienzuschlag') => (
          <div>
            <p className="field-label">{label} (%)</p>
            <input type="number" step="0.0001" value={Math.round(form[key] * 1000000) / 10000}
              onChange={e => set({ [key]: (parseFloat(e.target.value) || 0) / 100 } as Partial<LohnSaetze>)} className={numCls} />
          </div>
        )
        const chfField = (label: string, key: 'alvDeckelMonat' | 'kinderzulage' | 'ausbildungszulage') => (
          <div>
            <p className="field-label">{label} (CHF)</p>
            <input type="number" step="0.05" value={form[key]}
              onChange={e => set({ [key]: parseFloat(e.target.value) || 0 } as Partial<LohnSaetze>)} className={numCls} />
          </div>
        )
        return (
          <div className="card p-6 space-y-5 max-w-2xl">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <p className="field-label">Jahr</p>
                <select value={saetzeJahr} onChange={e => { setSaetzeJahr(parseInt(e.target.value, 10)); setSaetzeForm(null) }} className={inputCls}>
                  {Array.from(new Set([...Object.keys(saetzeByJahr).map(Number), jahr, jahr + 1])).sort().map(j => (
                    <option key={j} value={j}>{j}{saetzeByJahr[j] ? '' : ' (noch nicht gespeichert)'}</option>
                  ))}
                </select>
              </div>
              {!saetzeByJahr[saetzeJahr] && (
                <p className="text-xs text-apricot-ink font-semibold">Noch nicht gespeichert — Vorlage: Werte {LOHN_SAETZE_2026.jahr}</p>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {pctField('AHV/IV/EO Arbeitnehmer', 'ahv')}
              {pctField('ALV Arbeitnehmer', 'alv')}
              {pctField('UVG-NBU Arbeitnehmer', 'nbu')}
              {pctField('KTG Standard (AN-Hälfte)', 'ktgStandard')}
              {pctField('KTG erhöht (AN-Hälfte)', 'ktgErhoeht')}
              {pctField('Ferienentschädigung Stundenlohn', 'ferienzuschlag')}
              {chfField('ALV/NBU-Deckel pro Monat', 'alvDeckelMonat')}
              {chfField('Kinderzulage pro Monat', 'kinderzulage')}
              {chfField('Ausbildungszulage pro Monat', 'ausbildungszulage')}
            </div>
            <div className="rounded-ctl border border-edge-soft bg-surface px-4 py-3 text-[12px] text-ink-3 leading-relaxed">
              <span className="font-semibold text-ink-2">Unbezahlte Ferien — effektive Methode (verbindlich):</span>{' '}
              Abzug = (Monatslohn + Anteil 13.) × UF-Tage ÷ persönliche Plantage des
              konkreten Monats gemäss Arbeitsplan (alle Tage mit Eintrag; «%»/Frei zählt
              nicht), gerundet auf 0.01 CHF. Kein Pauschal-Divisor wie 21.75.
              Die Prozentabzüge (AHV/IV/EO, ALV, UVG-NBU, KTG) rechnen auf dem so
              reduzierten Bruttoeinkommen; die Pensionskasse bleibt beim fixen
              Monatsbetrag. Dasselbe Prinzip gilt sinngemäss für Ein- und Austritte
              während eines Monats (anteilige Plantage). Halbe Tage in 0.5er-Schritten
              erlaubt; mehrere UF-Perioden im Monat ergeben eine Zeile.
              <span className="block mt-1.5">
                <span className="font-semibold text-ink-2">Anteil 13. Monatslohn:</span>{' '}
                bleibt bei bezahlten Absenzen (Krankheit, Unfall) voll — er wird nie mit
                den 80% der Lohnfortzahlung skaliert. Gekürzt wird er nur für Zeit ohne
                Lohn: bei unbezahlten Ferien über die kombinierte Abzugsbasis (keine
                zweite Proration der Zeile!) und bei Ein-/Austritt während des Monats
                über die Pro-rata beider Zeilen.
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={saetzeSpeichern} disabled={busy} className="btn-primary text-sm">
                {busy ? 'Speichert…' : `Sätze ${saetzeJahr} speichern`}
              </button>
            </div>
          </div>
        )
      })()}

      {/* ═══ Dialog: Abrechnung ═══ */}
      {dialog && preview && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setDialog(null)} />
          <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-2xl my-6">
            <div className="px-6 py-4 border-b border-edge-soft bg-surface flex items-start justify-between">
              <div>
                <h3 className="text-sm font-bold text-ink">{dialog.isNew ? 'Neue Abrechnung' : 'Abrechnung bearbeiten'} — {dialogName}</h3>
                <p className="text-xs text-ink-4 mt-0.5">Alle Beträge exakt in CHF, keine Rundung</p>
              </div>
              <button onClick={() => setDialog(null)} className="w-7 h-7 rounded-lg hover:bg-edge-row text-ink-4 hover:text-ink-2 flex items-center justify-center text-lg leading-none" aria-label="Schliessen">×</button>
            </div>

            <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="field-label">Titel</p>
                  <select value={dialog.titel} onChange={e => setDialog({ ...dialog, titel: e.target.value })} className={inputCls}>
                    {[...LOHN_TITEL].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <p className="field-label">Periode (auf dem PDF)</p>
                  <input type="text" value={dialog.periode} onChange={e => setDialog({ ...dialog, periode: e.target.value })} className={inputCls} />
                </div>
              </div>

              {/* Bausteine (nur neue Abrechnung) */}
              {dialog.bausteine && (
                <div className="rounded-ctl border border-edge-soft bg-surface p-4 space-y-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Lohnbausteine ({LOHN_ART_LABEL[dialog.bausteine.art]})</p>
                  {dialog.bausteine.art === 'umsatz_akonto' && (
                    <div className="flex rounded-lg border border-edge-ctl overflow-hidden w-fit">
                      {([['akonto', 'Monatlicher Akontolohn'], ['umsatz', 'Umsatzabrechnung']] as const).map(([mo, label]) => (
                        <button key={mo}
                          onClick={() => {
                            const b = dialog.bausteine!
                            const m2 = parseInt(dialog.monat.slice(5, 7), 10)
                            const j2 = parseInt(dialog.monat.slice(0, 4), 10)
                            const periode = mo === 'umsatz'
                              ? (b.akontoMonate === 6 ? `${m2 <= 6 ? 1 : 2}. Halbjahr ${j2}` : `${Math.ceil(m2 / 3)}. Quartal ${j2}`)
                              : `${MONTH_NAMES[m2 - 1]} ${j2}`
                            setDialog({
                              ...dialog,
                              bausteine: { ...b, modus: mo },
                              titel: mo === 'umsatz' ? 'Umsatzabrechnung' : 'Lohnabrechnung',
                              periode,
                              deckelMonate: mo === 'umsatz' ? (b.akontoMonate === 6 ? 6 : 3) : 1,
                            })
                          }}
                          className={`px-3 py-1.5 text-xs font-semibold transition-colors ${dialog.bausteine!.modus === mo ? 'bg-dusk-night text-white' : 'bg-white text-ink-3 hover:bg-edge-row'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  {['monatslohn', 'nicht_ahv'].includes(effArt(dialog.bausteine)) && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <p className="field-label">{dialog.bausteine.art === 'umsatz_akonto' ? 'Akontolohn (CHF/Monat)' : 'Monatslohn (CHF)'}</p>
                        <input type="number" step="0.01" value={dialog.bausteine.ml || ''}
                          onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, ml: parseFloat(e.target.value) || 0 } })} className={numCls} />
                      </div>
                      <div>
                        <p className="field-label">13. Monatslohn</p>
                        <label className="flex items-center gap-2 py-2 text-sm text-ink-2">
                          <input type="checkbox" checked={dialog.bausteine.dreizehnter}
                            onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, dreizehnter: e.target.checked } })} />
                          anteilig (÷12)
                        </label>
                      </div>
                      <div>
                        <p className="field-label" title="Effektive Methode: Abzug = (Monatslohn + 13.-Anteil) × UF-Tage ÷ Plantage dieses Monats. Aus dem Arbeitsplan vorbefüllt, manuell anpassbar (halbe Tage erlaubt); mehrere UF-Perioden im Monat werden summiert.">Unbez. Ferien (Tage)</p>
                        <input type="number" step="0.5" min="0" value={dialog.bausteine.ufTage || ''}
                          onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, ufTage: parseFloat(e.target.value) || 0 } })}
                          className={`${numCls} ${dialog.bausteine.ufTageAuto != null && dialog.bausteine.ufTage !== dialog.bausteine.ufTageAuto ? '!border-apricot-mid' : ''}`} />
                        {dialog.bausteine.ufTageAuto != null ? (
                          <p className={`text-[11px] mt-1 ${dialog.bausteine.ufTage !== dialog.bausteine.ufTageAuto ? 'text-apricot-ink font-semibold' : 'text-ink-4'}`}>
                            Arbeitsplan: {fmtDays(dialog.bausteine.ufTageAuto)}{dialog.bausteine.ufTage !== dialog.bausteine.ufTageAuto ? ' · manuell angepasst' : ''}
                          </p>
                        ) : (
                          <p className="text-[11px] mt-1 text-apricot-ink">Kein Arbeitsplan für diesen Monat — manuell erfassen</p>
                        )}
                      </div>
                      <div>
                        <p className="field-label" title="Persönliche Plantage dieses Monats: alle Tage mit einem Arbeitsplan-Eintrag (Arbeit und Absenzen; «%»/Frei zählt nicht). Divisor der UF-Rechnung — immer der Wert des konkreten Monats, nie ein Pauschalwert.">Plantage im Monat</p>
                        <input type="number" step="0.5" min="0" value={dialog.bausteine.ufPlanTage || ''}
                          onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, ufPlanTage: parseFloat(e.target.value) || 0 } })}
                          className={`${numCls} ${dialog.bausteine.ufPlanTageAuto != null && dialog.bausteine.ufPlanTage !== dialog.bausteine.ufPlanTageAuto ? '!border-apricot-mid' : ''}`} />
                        {dialog.bausteine.ufPlanTageAuto != null ? (
                          <p className={`text-[11px] mt-1 ${dialog.bausteine.ufPlanTage !== dialog.bausteine.ufPlanTageAuto ? 'text-apricot-ink font-semibold' : 'text-ink-4'}`}>
                            Arbeitsplan: {fmtDays(dialog.bausteine.ufPlanTageAuto)}{dialog.bausteine.ufPlanTage !== dialog.bausteine.ufPlanTageAuto ? ' · manuell angepasst' : ''}
                          </p>
                        ) : (
                          <p className="text-[11px] mt-1 text-apricot-ink">Kein Arbeitsplan für diesen Monat — manuell erfassen</p>
                        )}
                      </div>
                    </div>
                  )}
                  {/* Fall C: Ein-/Austritt im Monat — Pro-rata beider Zeilen */}
                  {['monatslohn', 'nicht_ahv'].includes(effArt(dialog.bausteine)) && dialog.bausteine.art !== 'umsatz_akonto' && (
                    <div className="rounded-ctl border border-edge-soft bg-surface p-4 space-y-2">
                      <label className="flex items-start gap-2 text-sm text-ink-2">
                        <input type="checkbox" checked={dialog.bausteine.prorata}
                          onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, prorata: e.target.checked } })} className="mt-0.5" />
                        <span>
                          Ein- oder Austritt in diesem Monat — Monatslohn und Anteil 13. pro rata
                          <span className="block text-[11px] text-ink-4 mt-0.5">
                            Beide Zeilen × Solltage innerhalb der Anstellung ÷ Solltage des Monats
                            (effektive Methode). Bei einem Eintritt im Monat automatisch aktiviert.
                          </span>
                        </span>
                      </label>
                      {dialog.bausteine.prorata && (
                        <div className="max-w-[260px]">
                          <p className="field-label" title="Solltage gemäss Arbeitsplan, die in die Anstellungszeit fallen. Divisor ist das Feld «Plantage im Monat».">Solltage innerhalb der Anstellung</p>
                          <input type="number" step="0.5" min="0" value={dialog.bausteine.prorataTage || ''}
                            onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, prorataTage: parseFloat(e.target.value) || 0 } })}
                            className={`${numCls} ${dialog.bausteine.prorataTageAuto != null && dialog.bausteine.prorataTage !== dialog.bausteine.prorataTageAuto ? '!border-apricot-mid' : ''}`} />
                          {dialog.bausteine.prorataTageAuto != null ? (
                            <p className={`text-[11px] mt-1 ${dialog.bausteine.prorataTage !== dialog.bausteine.prorataTageAuto ? 'text-apricot-ink font-semibold' : 'text-ink-4'}`}>
                              Arbeitsplan: {fmtDays(dialog.bausteine.prorataTageAuto)}
                              {dialog.bausteine.prorataDatum ? ` (ab Eintritt ${fmtDatumCH(dialog.bausteine.prorataDatum)})` : ''}
                              {dialog.bausteine.prorataTage !== dialog.bausteine.prorataTageAuto ? ' · manuell angepasst' : ''}
                            </p>
                          ) : (
                            <p className="text-[11px] mt-1 text-apricot-ink">Kein Plan-Wert ableitbar (z.B. Austritt) — manuell erfassen</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {['monatslohn', 'nicht_ahv'].includes(effArt(dialog.bausteine)) && ufSperre(dialog) && (
                    <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink">⚠ {ufSperre(dialog)}</p>
                  )}

                  {/* Absenzfälle Unfall/Krankheit — Phasen-Lohnarten gemäss Regelwerk */}
                  {['monatslohn', 'nicht_ahv'].includes(effArt(dialog.bausteine)) && dialog.bausteine.art !== 'umsatz_akonto' && (() => {
                    const b = dialog.bausteine!
                    const am = dialogAbsenz(dialog)
                    const p = profiles.find(x => x.id === dialog.profileId)
                    const keineKtgKlausel = p ? stammFor(p).ktgKlausel === false : false
                    const setAbs = (absenzen: AbsenzFall[]) => setDialog({ ...dialog, bausteine: { ...b, absenzen } })
                    return (
                      <div className="rounded-ctl border border-edge-soft bg-surface p-4 space-y-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4"
                          title="Kalendertage, pro Fall über Monatsgrenzen. Unfall: Tag 1–3 Karenz 80% (abzugspflichtig), ab Tag 4 UVG-Taggeld-Ersatz 80% (abgabefrei). Krankheit: Tag 1–2 100%, Tag 3–30 80% (Lohnfortzahlung, abzugspflichtig), ab Tag 31 KTG-Taggeld-Ersatz 80% (abgabefrei).">
                          Absenzfälle Unfall / Krankheit (Kalendertage)</p>
                        {b.absenzen.map((f, i) => (
                          <div key={i} className="flex flex-wrap items-center gap-1.5">
                            <select value={f.typ}
                              onChange={e => setAbs(b.absenzen.map((x, j) => j === i ? { ...x, typ: e.target.value as AbsenzFall['typ'] } : x))}
                              className="px-2 py-2 text-sm border border-edge-ctl rounded-ctl bg-white">
                              <option value="unfall">Unfall</option>
                              <option value="krankheit">Krankheit</option>
                            </select>
                            <label className="text-xs text-ink-4">Fallbeginn</label>
                            <input type="date" value={f.beginn}
                              onChange={e => setAbs(b.absenzen.map((x, j) => j === i ? { ...x, beginn: e.target.value } : x))}
                              className={`${inputCls} !w-40 flex-shrink-0`} title="Unfalltag bzw. erster ärztlich attestierter Tag (R1.3) — kann im Vormonat liegen" />
                            <label className="text-xs text-ink-4">bis</label>
                            <input type="date" value={f.ende}
                              onChange={e => setAbs(b.absenzen.map((x, j) => j === i ? { ...x, ende: e.target.value } : x))}
                              className={`${inputCls} !w-40 flex-shrink-0`} title="Attestiertes Ende der Arbeitsunfähigkeit" />
                            <button onClick={() => setAbs(b.absenzen.filter((_, j) => j !== i))}
                              className="px-2 py-1.5 rounded-lg border border-edge-ctl text-ink-4 hover:text-red-500 hover:bg-edge-row" title="Fall entfernen">×</button>
                          </div>
                        ))}
                        <button onClick={() => setAbs([...b.absenzen, { typ: 'krankheit', beginn: `${dialog.monat}-01`, ende: `${dialog.monat}-01` }])}
                          className="text-xs font-semibold text-mint-ink hover:underline underline-offset-2">+ Absenzfall hinzufügen</button>
                        {am && am.fehler.map((f, i) => (
                          <p key={i} className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink">⚠ {f}</p>
                        ))}
                        {keineKtgKlausel && b.absenzen.some(f => f.typ === 'krankheit') && (
                          <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink">
                            ⚠ Keine KTG-Klausel im Arbeitsvertrag hinterlegt (Stammdaten) — es gilt die Berner
                            Skala (100% für beschränkte Zeit). Krankheitsfall manuell rechnen; das Speichern ist gesperrt (R3.7).
                          </p>
                        )}
                        {am && am.fehler.length === 0 && (
                          <p className="text-[11px] text-ink-4">
                            Tagesbilanz: {am.gearbeitetTage} Tage gearbeitet + {am.absenzTage} Tage Absenz
                            = {am.kalendertage} Kalendertage · Tagessatz CHF {fmtLohnChf(am.tagessatz)} (Monatslohn ÷ {am.kalendertage})
                          </p>
                        )}
                        {am && am.kontrollwerte.map((k, i) => (
                          <p key={i} className="text-[11px] px-3 py-2 rounded-ctl bg-mint-bg text-mint-ink">
                            Kontrollwert erwartete UVG-Rückerstattung (Fall vom {k.beginn.slice(8, 10)}.{k.beginn.slice(5, 7)}.):
                            CHF {fmtLohnChf(k.betrag)} für {k.tageB} Taggeld-Tage in diesem Monat — beim Eingang
                            der Taggeldabrechnung abgleichen; Differenz über 5 Franken prüfen (R2.7/R6.5).
                          </p>
                        ))}
                        {b.absenzen.length > 0 && (
                          <p className="text-[11px] text-ink-4">
                            Hinweise: Geplante Ferien während der attestierten Arbeitsunfähigkeit im Arbeitsplan
                            auf U/K umstellen — sie gehen zurück ins Ferienguthaben (R2.8). Ferienkürzung erst
                            ab dem 2. vollen Absenzmonat, 1/12 pro weiterem vollem Monat (Art. 329b OR, R2.9).
                            Bei Absenzen über 30 Tagen: Meldung an die Pensionskasse (R4.4).
                          </p>
                        )}
                      </div>
                    )
                  })()}
                  {effArt(dialog.bausteine) === 'stundenlohn' && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <p className="field-label">Geleistete Stunden</p>
                        <input type="number" step="0.01" value={dialog.bausteine.stunden || ''}
                          onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, stunden: parseFloat(e.target.value) || 0 } })} className={numCls} />
                      </div>
                      <div>
                        <p className="field-label">Stundensatz (CHF, ohne Zuschlag)</p>
                        <input type="number" step="0.01" value={dialog.bausteine.stundensatz || ''}
                          onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, stundensatz: parseFloat(e.target.value) || 0 } })} className={numCls} />
                      </div>
                      <div>
                        <p className="field-label">Grundlohn (CHF/Monat)</p>
                        <input type="number" step="0.01" value={dialog.bausteine.grundlohn || ''}
                          onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, grundlohn: parseFloat(e.target.value) || 0 } })} className={numCls} />
                      </div>
                      {dialog.bausteine.stundensatz > 0 && (
                        <p className="col-span-2 sm:col-span-3 text-[11px] text-ink-4">
                          Gerechnet wird mit CHF {fmtAnsatz(stundenansatzInkl(dialog.bausteine.stundensatz, dialogSaetze))} pro Stunde
                          (CHF {fmtLohnChf(dialog.bausteine.stundensatz)} + {(dialogSaetze.ferienzuschlag * 100).toFixed(2)}% Ferienentschädigung, auf 3 Stellen).
                        </p>
                      )}
                      <label className="col-span-2 sm:col-span-3 flex items-center gap-2 text-[12px] text-ink-2">
                        <input type="checkbox" checked={dialog.bausteine.ferienAufGrundlohn}
                          onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, ferienAufGrundlohn: e.target.checked } })} />
                        Ferienentschädigung auch auf dem Grundlohn
                      </label>
                    </div>
                  )}
                  {effArt(dialog.bausteine) === 'umsatzlohn' && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="field-label">Geleisteter Umsatz (CHF)</p>
                          <input type="number" step="0.01" value={dialog.bausteine.umsatz || ''}
                            onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, umsatz: parseFloat(e.target.value) || 0 } })} className={numCls} />
                        </div>
                        <div>
                          <p className="field-label">Beteiligung (Anteil, z.B. 0.33 = 33%)</p>
                          <input type="number" step="0.0001" value={dialog.bausteine.umsatzsatz || ''}
                            onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, umsatzsatz: parseFloat(e.target.value) || 0 } })} className={numCls} />
                          {dialog.bausteine.umsatzsatz > 1 && (
                            <p className="text-[11px] font-semibold text-blush-ink mt-1">⚠ Bitte als Anteil eingeben: 0.33 statt 33.</p>
                          )}
                        </div>
                        <div>
                          <p className="field-label">Akonto-Monate (bereits ausbezahlt)</p>
                          <input type="number" step="1" min="0" value={dialog.bausteine.akontoMonate || ''}
                            onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, akontoMonate: parseInt(e.target.value, 10) || 0 } })} className={numCls} />
                        </div>
                        <div>
                          <p className="field-label">Akonto-Betrag pro Monat (CHF)</p>
                          <input type="number" step="0.01" value={dialog.bausteine.akontoBetrag || ''}
                            onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, akontoBetrag: parseFloat(e.target.value) || 0 } })} className={numCls} />
                        </div>
                        <div>
                          <p className="field-label" title="Skaliert den ALV/NBU-Deckel: Halbjahr = 6 × 12'350, Quartal = 3 × 12'350">Abrechnung umfasst (Monate)</p>
                          <input type="number" step="1" min="1" max="12" value={dialog.deckelMonate || ''}
                            onChange={e => setDialog({ ...dialog, deckelMonate: parseInt(e.target.value, 10) || 1 })} className={numCls} />
                        </div>
                      </div>
                      <div className="rounded-ctl border border-edge-soft bg-surface p-3 space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Tagesvergütungen (Ferien, Fortbildung, Krankheit …)</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="field-label">Geleistete Arbeitstage der Periode</p>
                            <input type="number" step="0.01" min="0" value={dialog.bausteine.geleisteteTage || ''}
                              onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, geleisteteTage: parseFloat(e.target.value) || 0 } })}
                              className={numCls} />
                          </div>
                          <div>
                            <p className="field-label">Tagesansatz (CHF pro Tag)</p>
                            <input type="number" step="0.01" value={dialog.bausteine.tagesansatz || ''}
                              placeholder={effTagesansatz({ ...dialog.bausteine, tagesansatz: 0 }) > 0 ? fmtLohnChf(effTagesansatz({ ...dialog.bausteine, tagesansatz: 0 })) : ''}
                              onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, tagesansatz: parseFloat(e.target.value) || 0 } })}
                              className={numCls} />
                          </div>
                        </div>
                        <p className="text-[11px] text-ink-4">
                          Tagesansatz = durchschnittliche Umsatzbeteiligung pro geleistetem Arbeitstag.
                          {effTagesansatz({ ...dialog.bausteine, tagesansatz: 0 }) > 0 && (
                            <> Automatisch berechnet: Beteiligung ÷ {dialog.bausteine.geleisteteTage} Tage = <span className="font-semibold text-ink-2">CHF {fmtLohnChf(effTagesansatz({ ...dialog.bausteine, tagesansatz: 0 }))}</span> — Tagesansatz-Feld leer lassen, um diesen Wert zu verwenden.</>
                          )}
                          {' '}Jede Zeile rechnet Tage × Tagesansatz × Prozent; Zeilen mit 0 Tagen erscheinen nicht.
                          Die Bezeichnung ist frei anpassbar und erscheint so auf der Abrechnung —
                          z.B. «Ferien (inkl. 1 Woche Jubiläum 15 Dienstjahre)» oder als eigene Zeile «Jubiläumsferien».
                        </p>
                        <div className="space-y-1.5">
                          {dialog.bausteine.umsatzTage.map((r, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <input value={r.label}
                                onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, umsatzTage: dialog.bausteine!.umsatzTage.map((x, j) => j === i ? { ...x, label: e.target.value } : x) } })}
                                className="input-field !py-1.5 text-sm flex-1 min-w-[110px]"
                                placeholder="Bezeichnung (erscheint auf der Abrechnung)" />
                              <input type="number" step="0.01" min="0" value={r.tage || ''} placeholder="0"
                                onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, umsatzTage: dialog.bausteine!.umsatzTage.map((x, j) => j === i ? { ...x, tage: parseFloat(e.target.value) || 0 } : x) } })}
                                className={`${numCls} !w-20 flex-shrink-0`} />
                              <span className="text-xs text-ink-4 whitespace-nowrap">Tage ×</span>
                              <input type="number" step="0.5" min="0" value={r.faktor || ''}
                                onChange={e => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, umsatzTage: dialog.bausteine!.umsatzTage.map((x, j) => j === i ? { ...x, faktor: parseFloat(e.target.value) || 0 } : x) } })}
                                className={`${numCls} !w-20 flex-shrink-0`} />
                              <span className="text-xs text-ink-4">%</span>
                              <button onClick={() => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, umsatzTage: dialog.bausteine!.umsatzTage.filter((_, j) => j !== i) } })}
                                className="text-ink-5 hover:text-red-500 px-1 flex-shrink-0" title="Zeile entfernen">✕</button>
                            </div>
                          ))}
                          <button
                            onClick={() => setDialog({ ...dialog, bausteine: { ...dialog.bausteine!, umsatzTage: [...dialog.bausteine!.umsatzTage, { label: '', tage: 0, faktor: 100 }] } })}
                            className="text-[11.5px] font-semibold text-steel-ink hover:underline">
                            ＋ Zeile hinzufügen (z.B. Jubiläumsferien, Sonderferien)
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Zeilen */}
              <div>
                <p className="field-label">{dialog.bausteine ? 'Zusätzliche Lohnbestandteile (z.B. Überstunden, Ferienguthaben, Bonus)' : 'Lohnbestandteile'}</p>
                {posEditor(dialog.extraLines, l => setDialog({ ...dialog, extraLines: l }), 'Zeile hinzufügen')}
              </div>

              {/* Zulagen */}
              <div>
                <p className="field-label">Sozialzulagen (nicht AHV-pflichtig)</p>
                <div className="space-y-1.5">
                  {dialog.zulagen.map((z, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input type="checkbox" checked={z.on}
                        onChange={e => setDialog({ ...dialog, zulagen: dialog.zulagen.map((x, j) => j === i ? { ...x, on: e.target.checked } : x) })} />
                      <input type="text" value={z.label}
                        onChange={e => setDialog({ ...dialog, zulagen: dialog.zulagen.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })}
                        className={`${inputCls} flex-1`} />
                      <input type="number" step="0.05" value={z.betrag || ''}
                        onChange={e => setDialog({ ...dialog, zulagen: dialog.zulagen.map((x, j) => j === i ? { ...x, betrag: parseFloat(e.target.value) || 0 } : x) })}
                        className={`${numCls} !w-28 flex-shrink-0`} />
                    </div>
                  ))}
                  <div className="flex gap-3">
                    <button onClick={() => setDialog({ ...dialog, zulagen: [...dialog.zulagen, { label: 'Kinderzulage ', betrag: dialogSaetze.kinderzulage, on: true }] })}
                      className="text-xs font-semibold text-mint-ink hover:underline underline-offset-2"
                      title="Zeile mit dem aktuellen Kinderzulagen-Betrag — nur noch den Namen des Kindes ergänzen">+ Kinderzulage</button>
                    <button onClick={() => setDialog({ ...dialog, zulagen: [...dialog.zulagen, { label: 'Ausbildungszulage ', betrag: dialogSaetze.ausbildungszulage, on: true }] })}
                      className="text-xs font-semibold text-mint-ink hover:underline underline-offset-2"
                      title="Zeile mit dem aktuellen Ausbildungszulagen-Betrag — nur noch den Namen des Kindes ergänzen">+ Ausbildungszulage</button>
                  </div>
                </div>
              </div>

              {/* Abzüge */}
              <div className="rounded-ctl border border-edge-soft bg-surface p-4 space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Abzüge</p>
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-2">
                  {([['ahv', 'AHV/IV/EO'], ['alv', 'ALV'], ['nbu', 'UVG-NBU']] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-1.5">
                      <input type="checkbox" checked={dialog[key]} onChange={e => setDialog({ ...dialog, [key]: e.target.checked })} />
                      {label}
                    </label>
                  ))}
                  <label className="flex items-center gap-1.5">
                    KTG
                    <select value={dialog.ktg} onChange={e => setDialog({ ...dialog, ktg: e.target.value as AbrDialog['ktg'] })}
                      className="px-2 py-1 text-sm border border-edge-ctl rounded-ctl bg-white">
                      <option value="standard">Standard</option>
                      <option value="erhoeht">erhöht</option>
                      <option value="keine">keine</option>
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="field-label">Pensionskasse (CHF/Monat)</p>
                    <input type="number" step="0.01" value={dialog.pkAbzug || ''}
                      onChange={e => setDialog({ ...dialog, pkAbzug: parseFloat(e.target.value) || 0 })} className={numCls} />
                    {(() => {
                      const p = profiles.find(x => x.id === dialog.profileId)
                      const bisher = p ? stammFor(p).pkAbzug : null
                      const anders = bisher != null && Math.abs(bisher - dialog.pkAbzug) > 0.004
                      return (
                        <p className={`text-[10px] mt-0.5 ${anders ? 'text-apricot-ink' : 'text-ink-4'}`}>
                          {anders
                            ? `Bisher ${fmtLohnChf(bisher)} — beim Speichern wird ${fmtLohnChf(dialog.pkAbzug)} als neuer Standard für die folgenden Monate übernommen.`
                            : 'Gespeicherter Standard — gilt für die folgenden Monate, bis er hier oder in den Stammdaten geändert wird.'}
                        </p>
                      )
                    })()}
                  </div>
                  <div>
                    <p className="field-label">Quellensteuer (% vom Brutto)</p>
                    <input type="number" step="0.01" value={dialog.qstSatz ?? ''}
                      onChange={e => setDialog({ ...dialog, qstSatz: e.target.value === '' ? null : parseFloat(e.target.value) || 0 })} className={numCls} />
                    {dialog.qstSatz != null && (
                      <p className="text-[11px] text-ink-4 mt-1">
                        {dialog.qstTarif ? `Tarif ${dialog.qstTarif} — ` : ''}Satz gemäss Quellensteuertabelle; bei Lohnänderung prüfen.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Nach den Abzügen */}
              <div>
                <p className="field-label">Nach den Abzügen (z.B. «Bereits ausbezahlt» bei einer Endabrechnung)</p>
                {posEditor(dialog.nach, l => setDialog({ ...dialog, nach: l }), 'Zeile hinzufügen')}
              </div>

              {/* Lohnpfändung (R5/R6.6) — jeden Monat frisch gerechnet */}
              {(() => {
                const pfInfo = pfaendungFuer(dialog, dialogSaetze)
                if (!pfInfo) return null
                return (
                  <p className={`text-xs px-3 py-2 rounded-ctl ${pfInfo.unterEM ? 'bg-apricot-bg text-apricot-ink' : 'bg-surface border border-edge-soft text-ink-3'}`}>
                    Lohnpfändung (monatlich neu berechnet): {pfInfo.unterEM
                      ? `Netto CHF ${fmtLohnChf(pfInfo.netto)} liegt auf oder unter dem Existenzminimum — Überweisung 0.00, kein Nachholen in Folgemonaten (R5.3/R6.6).`
                      : pfInfo.betrag > 0
                        ? `CHF ${fmtLohnChf(pfInfo.betrag)} werden als Zeile «Lohnpfändung Betreibungsamt» abgezogen.`
                        : 'gemäss Verfügung 0.00 in diesem Monat.'}
                    {' '}Aufgabe (R5.4): Bei jeder Einkommensänderung schriftliche Meldung ans Betreibungsamt mit Kopie der Lohnabrechnung.
                  </p>
                )
              })()}

              {/* Vorschau */}
              {unbenannteZeilen(dialog) && (
                <p className="text-xs px-3 py-2 rounded-ctl bg-apricot-bg text-apricot-ink">
                  ⚠ Zeilen ohne Bezeichnung werden nicht mitgerechnet — bitte die Bezeichnung ergänzen (orange markiert).
                </p>
              )}
              {uebersicht(dialog, preview)}
            </div>

            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2 flex-wrap">
              <button onClick={() => setDialog(null)} className="btn-secondary flex-1 min-w-[120px]">Abbrechen</button>
              <button
                onClick={() => {
                  if (unbenannteZeilen(dialog)) {
                    setError('Bitte für jede Zeile mit Betrag eine Bezeichnung eingeben — Zeilen ohne Bezeichnung erscheinen nicht auf dem PDF.')
                    return
                  }
                  const sperre = absenzSperre(dialog) ?? ufSperre(dialog)
                  if (sperre) { setError(sperre); return }
                  pdf(dialog.profileId, { titel: dialog.titel, periode: dialog.periode, ...dialogAbr(dialog, dialogSaetze) }, 'inline', dialog.qstTarif, null)
                }}
                disabled={busy} className="btn-secondary flex-1 min-w-[120px]">Vorschau (PDF)</button>
              <button onClick={speichern} disabled={busy} className="btn-primary flex-1 min-w-[120px]">
                {busy ? 'Speichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Dialog: Stammdaten ═══ */}
      {stammDialog && (() => {
        const f = stammDialog.form
        const set = (patch: Partial<LohnStamm>) => setStammDialog({ ...stammDialog, form: { ...f, ...patch } })
        const stammProfil = profiles.find(x => x.id === stammDialog.profileId)
        const standardML = stammProfil ? monatslohnOf(stammProfil) : 0
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-ink/30" onClick={() => setStammDialog(null)} />
            <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-xl my-6">
              <div className="px-6 py-4 border-b border-edge-soft bg-surface flex items-start justify-between">
                <h3 className="text-sm font-bold text-ink">Lohn-Stammdaten — {nameById.get(stammDialog.profileId) ?? '?'}</h3>
                <button onClick={() => setStammDialog(null)} className="w-7 h-7 rounded-lg hover:bg-edge-row text-ink-4 hover:text-ink-2 flex items-center justify-center text-lg leading-none" aria-label="Schliessen">×</button>
              </div>
              <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="field-label">Lohnart</p>
                    <select value={f.art} onChange={e => set({ art: e.target.value as LohnArt })} className={inputCls}>
                      {(Object.keys(LOHN_ART_LABEL) as LohnArt[]).map(a => <option key={a} value={a}>{LOHN_ART_LABEL[a]}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="field-label">13. Monatslohn</p>
                    <label className="flex items-center gap-2 py-2 text-sm text-ink-2">
                      <input type="checkbox" checked={f.dreizehnter} onChange={e => set({ dreizehnter: e.target.checked })} />
                      ja, anteilig pro Monat
                    </label>
                  </div>
                </div>
                {(f.art === 'monatslohn' || f.art === 'nicht_ahv') && (
                  <div>
                    <p className="field-label">Monatslohn brutto (CHF/Monat)</p>
                    <input type="number" step="0.01" value={f.monatslohn ?? ''}
                      placeholder={standardML > 0 ? fmtLohnChf(standardML) : ''}
                      onChange={e => set({ monatslohn: e.target.value === '' ? null : parseFloat(e.target.value) || 0 })} className={numCls} />
                    <p className="text-[11px] text-ink-4 mt-1">
                      {standardML > 0
                        ? <>Leer = CHF {fmtLohnChf(standardML)} aus den Mitarbeiter-Standards. Ein Wert hier gilt nur für die Lohnabrechnung und ändert die Mitarbeiter-Standards nicht.</>
                        : <>In den Mitarbeiter-Standards ist kein Lohn hinterlegt — hier den Bruttolohn für die Abrechnung erfassen.</>}
                    </p>
                  </div>
                )}
                {f.art === 'stundenlohn' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="field-label">Stundensatz (CHF, ohne Zuschlag)</p>
                      <input type="number" step="0.01" value={f.stundensatz ?? ''}
                        onChange={e => set({ stundensatz: e.target.value === '' ? null : parseFloat(e.target.value) || 0 })} className={numCls} />
                    </div>
                    <div>
                      <p className="field-label">Grundlohn (CHF/Monat, optional)</p>
                      <input type="number" step="0.01" value={f.grundlohn ?? ''}
                        onChange={e => set({ grundlohn: e.target.value === '' ? null : parseFloat(e.target.value) || 0 })} className={numCls} />
                    </div>
                    <label className="col-span-2 flex items-start gap-2 text-[12px] text-ink-2">
                      <input type="checkbox" className="mt-0.5" checked={f.ferienAufGrundlohn !== false}
                        onChange={e => set({ ferienAufGrundlohn: e.target.checked })} />
                      <span>
                        Ferienentschädigung auch auf dem Grundlohn
                        <span className="block text-[11px] text-ink-4">
                          An: (Grundlohn + Stunden × Satz) × Zuschlag, wie in der bisherigen Lohnvorlage.
                          Aus: Zuschlag nur auf den Stunden (der Grundlohn läuft in den Ferien weiter).
                        </span>
                      </span>
                    </label>
                  </div>
                )}
                {(f.art === 'umsatzlohn' || f.art === 'umsatz_akonto') && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="field-label">Umsatzbeteiligung (Anteil, z.B. 0.4)</p>
                      <input type="number" step="0.0001" value={f.umsatzsatz ?? ''}
                        onChange={e => set({ umsatzsatz: e.target.value === '' ? null : parseFloat(e.target.value) || 0 })} className={numCls} />
                    </div>
                    <div>
                      <p className="field-label">Abrechnungsperiode</p>
                      <select value={f.umsatzPeriode ?? 'quartal'} onChange={e => set({ umsatzPeriode: e.target.value as 'quartal' | 'halbjahr' })} className={inputCls}>
                        <option value="quartal">quartalsweise</option>
                        <option value="halbjahr">halbjährlich</option>
                      </select>
                    </div>
                    {f.art === 'umsatz_akonto' && (
                      <div>
                        <p className="field-label">Akontolohn (CHF/Monat)</p>
                        <input type="number" step="0.01" value={f.akontoBetrag ?? ''}
                          onChange={e => set({ akontoBetrag: e.target.value === '' ? null : parseFloat(e.target.value) || 0 })} className={numCls} />
                        <p className="text-[11px] text-ink-4 mt-1">Wird monatlich fix ausbezahlt und bei der Umsatzabrechnung abgezogen.</p>
                      </div>
                    )}
                  </div>
                )}
                <div className="rounded-ctl border border-edge-soft bg-surface p-4 space-y-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Abzüge</p>
                  <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-2">
                    {([['ahv', 'AHV/IV/EO'], ['alv', 'ALV'], ['nbu', 'UVG-NBU']] as const).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-1.5">
                        <input type="checkbox" checked={f[key]} onChange={e => set({ [key]: e.target.checked } as Partial<LohnStamm>)} />
                        {label}
                      </label>
                    ))}
                    <label className="flex items-center gap-1.5">
                      KTG
                      <select value={f.ktg} onChange={e => set({ ktg: e.target.value as LohnStamm['ktg'] })}
                        className="px-2 py-1 text-sm border border-edge-ctl rounded-ctl bg-white">
                        <option value="standard">Standard</option>
                        <option value="erhoeht">erhöht</option>
                        <option value="keine">keine</option>
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="field-label">Pensionskasse (CHF/Monat)</p>
                      <input type="number" step="0.01" value={f.pkAbzug || ''}
                        onChange={e => set({ pkAbzug: parseFloat(e.target.value) || 0 })} className={numCls} />
                    </div>
                    <div>
                      <p className="field-label">QST-Tarif (z.B. A0N)</p>
                      <input type="text" value={f.qstTarif ?? ''} onChange={e => set({ qstTarif: e.target.value || null })} className={inputCls} />
                    </div>
                    <div>
                      <p className="field-label">QST-Satz (%)</p>
                      <input type="number" step="0.01" value={f.qstSatz ?? ''}
                        onChange={e => set({ qstSatz: e.target.value === '' ? null : parseFloat(e.target.value) || 0 })} className={numCls} />
                    </div>
                  </div>
                </div>
                <div className="rounded-ctl border border-edge-soft bg-surface p-4 space-y-3">
                  <label className="flex items-start gap-2 text-sm text-ink-2">
                    <input type="checkbox" checked={f.ktgKlausel !== false}
                      onChange={e => set({ ktgKlausel: e.target.checked })} className="mt-0.5" />
                    <span>
                      KTG-Klausel im Arbeitsvertrag (SSO Ziff. 3.5.1, Art. 324a Abs. 4 OR)
                      <span className="block text-[11px] text-ink-4 mt-0.5">
                        Angekreuzt = 80%-Lösung bei Krankheit gilt. Ohne Klausel gilt die Berner Skala —
                        Krankheitsfälle werden dann in der Abrechnung gesperrt und manuell gerechnet (R3.7).
                      </span>
                    </span>
                  </label>
                  <div>
                    <p className="field-label">Lohnpfändung (Verfügung Betreibungsamt)</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <select value={f.pfaendungArt ?? 'keine'}
                        onChange={e => set({ pfaendungArt: e.target.value as LohnStamm['pfaendungArt'] })}
                        className={`${inputCls} !w-56 flex-shrink-0`}>
                        <option value="keine">keine</option>
                        <option value="betrag">fester Monatsbetrag</option>
                        <option value="quote">Quote über Existenzminimum</option>
                      </select>
                      {f.pfaendungArt === 'betrag' && (
                        <input type="number" step="0.05" value={f.pfaendungBetrag ?? ''} placeholder="CHF/Monat"
                          onChange={e => set({ pfaendungBetrag: e.target.value === '' ? null : parseFloat(e.target.value) || 0 })}
                          className={`${numCls} !w-36 flex-shrink-0`} />
                      )}
                      {f.pfaendungArt === 'quote' && (
                        <input type="number" step="0.05" value={f.pfaendungExistenzminimum ?? ''} placeholder="Existenzminimum CHF"
                          onChange={e => set({ pfaendungExistenzminimum: e.target.value === '' ? null : parseFloat(e.target.value) || 0 })}
                          className={`${numCls} !w-44 flex-shrink-0`} />
                      )}
                    </div>
                    {f.pfaendungArt !== 'keine' && f.pfaendungArt != null && (
                      <p className="text-[11px] text-ink-4 mt-1">
                        Quote: pfändbar = Netto − Existenzminimum, nie unter 0; jeder Monat einzeln, kein
                        Nachholen (R5.2/R5.3/R5.5). Die Zeile «Lohnpfändung Betreibungsamt» wird bei jeder
                        neuen Abrechnung automatisch berechnet.
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <p className="field-label">Kinder-/Ausbildungszulagen</p>
                  <div className="space-y-1.5">
                    {f.zulagen.map((z, i) => (
                      <div key={i} className="flex gap-1.5">
                        <input type="text" value={z.name} placeholder="Name des Kindes"
                          onChange={e => set({ zulagen: f.zulagen.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })}
                          className={`${inputCls} flex-1`} />
                        <select value={z.typ}
                          onChange={e => set({ zulagen: f.zulagen.map((x, j) => j === i ? { ...x, typ: e.target.value as 'kind' | 'ausbildung' } : x) })}
                          className={`${inputCls} !w-44 flex-shrink-0`}>
                          <option value="kind">Kinderzulage</option>
                          <option value="ausbildung">Ausbildungszulage</option>
                        </select>
                        <button onClick={() => set({ zulagen: f.zulagen.filter((_, j) => j !== i) })}
                          className="px-2 rounded-lg border border-edge-ctl text-ink-4 hover:text-red-500 hover:bg-edge-row" title="Entfernen">×</button>
                      </div>
                    ))}
                    <button onClick={() => set({ zulagen: [...f.zulagen, { name: '', typ: 'kind' }] })}
                      className="text-xs font-semibold text-mint-ink hover:underline underline-offset-2">+ Kind hinzufügen</button>
                  </div>
                </div>
                <div>
                  <p className="field-label">Monatlich vor den Abzügen (AHV-pflichtig, z.B. Leitungszuschlag; negativ = Abzug)</p>
                  <div className="space-y-1.5">
                    {(f.zuschlaege ?? []).map((z, i) => (
                      <div key={i} className="flex gap-1.5">
                        <input type="text" value={z.label} placeholder="Bezeichnung, z.B. Leitungszuschlag"
                          onChange={e => set({ zuschlaege: f.zuschlaege.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })}
                          className={`${inputCls} flex-1`} />
                        <input type="number" step="0.05" value={z.betrag || ''} placeholder="CHF"
                          onChange={e => set({ zuschlaege: f.zuschlaege.map((x, j) => j === i ? { ...x, betrag: parseFloat(e.target.value) || 0 } : x) })}
                          className={`${numCls} !w-28 flex-shrink-0`} />
                        <button onClick={() => set({ zuschlaege: f.zuschlaege.filter((_, j) => j !== i) })}
                          className="px-2 rounded-lg border border-edge-ctl text-ink-4 hover:text-red-500 hover:bg-edge-row" title="Entfernen">×</button>
                      </div>
                    ))}
                    <button onClick={() => set({ zuschlaege: [...(f.zuschlaege ?? []), { label: 'Leitungszuschlag', betrag: 0 }] })}
                      className="text-xs font-semibold text-mint-ink hover:underline underline-offset-2">+ Zeile hinzufügen</button>
                  </div>
                </div>
                <div>
                  <p className="field-label">Monatlich nach den Abzügen (nicht AHV-pflichtig; negativ = Abzug, z.B. Parkplatz)</p>
                  <div className="space-y-1.5">
                    {(f.nachZeilen ?? []).map((z, i) => (
                      <div key={i} className="flex gap-1.5">
                        <input type="text" value={z.label} placeholder="Bezeichnung, z.B. Parkplatz-Miete"
                          onChange={e => set({ nachZeilen: f.nachZeilen.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })}
                          className={`${inputCls} flex-1`} />
                        <input type="number" step="0.05" value={z.betrag || ''} placeholder="CHF"
                          onChange={e => set({ nachZeilen: f.nachZeilen.map((x, j) => j === i ? { ...x, betrag: parseFloat(e.target.value) || 0 } : x) })}
                          className={`${numCls} !w-28 flex-shrink-0`} />
                        <button onClick={() => set({ nachZeilen: f.nachZeilen.filter((_, j) => j !== i) })}
                          className="px-2 rounded-lg border border-edge-ctl text-ink-4 hover:text-red-500 hover:bg-edge-row" title="Entfernen">×</button>
                      </div>
                    ))}
                    <button onClick={() => set({ nachZeilen: [...(f.nachZeilen ?? []), { label: '', betrag: 0 }] })}
                      className="text-xs font-semibold text-mint-ink hover:underline underline-offset-2">+ Zeile hinzufügen</button>
                  </div>
                  <p className="text-[11px] text-ink-4 mt-1">Beide Bereiche werden bei jeder neuen Abrechnung automatisch als Zeilen vorbefüllt und sind dort anpassbar oder entfernbar.</p>
                </div>
                <div>
                  <p className="field-label">Notiz (intern)</p>
                  <input type="text" value={f.notiz ?? ''} onChange={e => set({ notiz: e.target.value || null })} maxLength={200} className={inputCls} />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
                <button onClick={() => setStammDialog(null)} className="btn-secondary flex-1">Abbrechen</button>
                <button onClick={stammSpeichern} disabled={busy} className="btn-primary flex-1">{busy ? 'Speichert…' : 'Speichern'}</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
