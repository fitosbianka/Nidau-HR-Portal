import { PRAXIS } from '@/config/praxis'
// Bestellwesen (Material-Bestellungen) — gemeinsame Typen und Helfer.
//
// Gespeichert als reservierte zeiterfassung_comments-Zeilen (kein DDL
// möglich — gleiches Muster wie __konto__/__lohn__):
//   __bestell_produkt__<id>  @ 2000-01-01  → JSON Produkt (Stammdaten)
//   __bestell_firmen__       @ 2000-01-01  → JSON string[] (Firmenliste)
//   __bestell_liste__<id>    @ <erstellt>  → JSON Bestellliste (offen/geschlossen)
//   __bestell_log__<id>      @ <datum>     → JSON { am, von, text } (Protokoll)
//   __bestell_beobachten__<id> @ 2000-01-01 → JSON «Im Auge behalten» (inkl. Erinnerung)
//
// Zugang: Admins, Leitende DA und die Bestell-Verantwortliche.

export const PRODUKT_PREFIX = '__bestell_produkt__'
export const LISTE_PREFIX = '__bestell_liste__'
export const BESTELL_LOG_PREFIX = '__bestell_log__'
export const FIRMEN_KEY = '__bestell_firmen__'
export const BEOBACHTEN_PREFIX = '__bestell_beobachten__'
export const BESTELL_ANCHOR = '2000-01-01'

/** Verantwortlich für die Bestellungen (zusätzlich zu Admins und Leitenden). */
export const BESTELLER_NAME = PRAXIS.bestellerName

/** Empfohlene Firmen — vorbelegt, erweiterbar über die Seite. */
export const FIRMEN_EMPFOHLEN = [
  'Kaladent', 'Curaden', 'DentalVersender', 'OrthoDepot', 'Apotheke Gurten', 'ABC',
]

export function hatBestellZugang(role: string | null | undefined, jobTitle: string | null | undefined, fullName: string | null | undefined, leitendeTitle: string): boolean {
  return role === 'admin' || jobTitle === leitendeTitle || fullName === BESTELLER_NAME
}

export type Produkt = {
  id: string
  name: string
  artikelNr: string
  firma: string
  /** Übliche Bestellmenge (frei, z.B. «2 Pack») — optional */
  menge: string | null
  /** Bestell-Turnus in Wochen — optional; steuert die Empfehlungen */
  intervallWochen: number | null
  bestellCount: number
  zuletztBestellt: string | null   // YYYY-MM-DD (letzter Listen-Abschluss)
  /** Empfehlung abgelehnt am — schiebt die nächste Empfehlung um den Turnus */
  abgelehntAm: string | null
  erstellt: string                 // YYYY-MM-DD
}

export type BestellItem = {
  produktId: string | null
  name: string
  artikelNr: string
  firma: string
  menge: string
  quelle: 'manuell' | 'empfehlung'
}

export type BestellListe = {
  id: string
  /** 'normal' = Firmen-Bestellung · 'whatsapp' = Bestellung per WhatsApp beim Lieferanten */
  typ: 'normal' | 'whatsapp'
  status: 'offen' | 'geschlossen'
  items: BestellItem[]
  erstellt: string                 // YYYY-MM-DD
  geschlossenAm: string | null
  geschlossenVon: string | null
}

export type BestellLog = { am: string; von: string; text: string }

/** «Im Auge behalten»: Produkte ohne festen Turnus, bei denen vor jeder
 *  Bestellung kurz geprüft wird, ob noch Vorrat da ist. */
export type BeobachtenProdukt = {
  id: string
  name: string
  artikelNr: string
  firma: string
  /** Übliche Bestellmenge (frei) — wird beim «Auf die Liste» vorgeschlagen */
  menge: string | null
  erstellt: string          // ISO-Zeitpunkt (sortiert «zuletzt hinzugefügt»)
  erstelltVon: string
  /** Erinnerung «jetzt kontrollieren und bestellen» — null: keine */
  erinnerung: Erinnerung | null
}

// ── Erinnerungen «Im Auge behalten» ──────────────────────────────────────
// Pro beobachtetem Produkt lässt sich eine Erinnerung setzen: ab einem
// Datum in einem festen Rhythmus oder einmalig an einem Stichtag. Am
// Stichtag erscheint das Produkt auf der Bestellseite rot, und die Bestell-
// Verantwortliche sieht beim Anmelden und beim Öffnen der Seite ein
// Fenster mit allen fälligen Produkten. «Auf die Liste» und «Überspringen»
// rücken die Erinnerung auf den nächsten Termin nach heute (einmalig:
// damit erledigt). Das Fenster bekommt NUR sie — Admins und die übrigen
// Berechtigten sehen auf der Seite dieselben roten Zeilen, aber kein Fenster.

export const ERINNERUNG_RHYTHMEN = [
  { key: 'einmalig', label: 'Einmalig an einem Datum', kurz: 'einmalig' },
  { key: 'w1', label: 'Wöchentlich', kurz: 'wöchentlich' },
  { key: 'w2', label: 'Alle 2 Wochen', kurz: 'alle 2 Wochen' },
  { key: 'w3', label: 'Alle 3 Wochen', kurz: 'alle 3 Wochen' },
  { key: 'm1', label: 'Monatlich', kurz: 'monatlich' },
  { key: 'm2', label: 'Alle 2 Monate', kurz: 'alle 2 Monate' },
  { key: 'm3', label: 'Alle 3 Monate', kurz: 'alle 3 Monate' },
  { key: 'm6', label: 'Alle 6 Monate', kurz: 'alle 6 Monate' },
  { key: 'j1', label: 'Jährlich', kurz: 'jährlich' },
] as const
export type ErinnerungRhythmus = typeof ERINNERUNG_RHYTHMEN[number]['key']

export type Erinnerung = {
  /** Erster Termin — Anker der Reihe (Monatsrhythmen behalten diesen Tag) */
  ab: string                    // YYYY-MM-DD
  rhythmus: ErinnerungRhythmus
  /** Nächster Termin — fällig, sobald heute ≥ naechste */
  naechste: string              // YYYY-MM-DD
}

export function istErinnerungRhythmus(x: unknown): x is ErinnerungRhythmus {
  return typeof x === 'string' && ERINNERUNG_RHYTHMEN.some(r => r.key === x)
}

export function rhythmusKurz(r: ErinnerungRhythmus): string {
  return ERINNERUNG_RHYTHMEN.find(x => x.key === r)?.kurz ?? r
}

function isoDatum(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Gültiges Kalenderdatum YYYY-MM-DD (kein 31.02.) */
export function gueltigesDatum(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00`)
  return !Number.isNaN(d.getTime()) && isoDatum(d) === s
}

/** Datum als dd.mm.yyyy — ohne Zeitzone, rein aus der Zeichenkette */
export function datumCH(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

/** k-ter Termin der Reihe (k = 0 → ab). Monats- und Jahresrhythmen behalten
 *  den Tag des Ankers und kappen am Monatsende: 31.01. → 28.02. → 31.03. */
export function erinnerungTermin(ab: string, rhythmus: ErinnerungRhythmus, k: number): string {
  if (rhythmus === 'einmalig' || k <= 0) return ab
  const d = new Date(`${ab}T00:00:00`)
  if (rhythmus.startsWith('w')) {
    d.setDate(d.getDate() + 7 * Number(rhythmus.slice(1)) * k)
    return isoDatum(d)
  }
  const monate = rhythmus === 'j1' ? 12 : Number(rhythmus.slice(1))
  const ziel = new Date(d.getFullYear(), d.getMonth() + monate * k, 1)
  const letzter = new Date(ziel.getFullYear(), ziel.getMonth() + 1, 0).getDate()
  ziel.setDate(Math.min(d.getDate(), letzter))
  return isoDatum(ziel)
}

/** Erster Termin der Reihe, der NACH heute liegt — null bei einer
 *  einmaligen Erinnerung (sie ist mit dem Abhaken erledigt). */
export function naechsteErinnerung(e: Pick<Erinnerung, 'ab' | 'rhythmus'>, heute: string): string | null {
  if (e.rhythmus === 'einmalig') return null
  return ersterTerminAb(e, heute, true)
}

/** Erster Termin der Reihe am oder nach dem Datum (strikt danach: `nach`). */
export function ersterTerminAb(e: Pick<Erinnerung, 'ab' | 'rhythmus'>, datum: string, nach = false): string {
  if (e.rhythmus === 'einmalig') return e.ab
  // grob vorspringen, dann genau suchen — bleibt auch nach Jahrzehnten billig
  const tage = Math.max(0, (new Date(`${datum}T00:00:00`).getTime() - new Date(`${e.ab}T00:00:00`).getTime()) / 86400000)
  const schritt = e.rhythmus.startsWith('w') ? 7 * Number(e.rhythmus.slice(1)) : (e.rhythmus === 'j1' ? 365 : 28 * Number(e.rhythmus.slice(1)))
  let k = Math.max(0, Math.floor(tage / schritt) - 2)
  for (let i = 0; i < 10000; i++, k++) {
    const t = erinnerungTermin(e.ab, e.rhythmus, k)
    if (nach ? t > datum : t >= datum) return t
  }
  return erinnerungTermin(e.ab, e.rhythmus, k)
}

export function erinnerungFaellig(b: Pick<BeobachtenProdukt, 'erinnerung'>, heute: string): boolean {
  return !!b.erinnerung && b.erinnerung.naechste <= heute
}

function parseErinnerung(x: unknown): Erinnerung | null {
  if (!x || typeof x !== 'object') return null
  const e = x as Partial<Erinnerung>
  if (!gueltigesDatum(e.ab) || !istErinnerungRhythmus(e.rhythmus)) return null
  return { ab: e.ab, rhythmus: e.rhythmus, naechste: gueltigesDatum(e.naechste) ? e.naechste : e.ab }
}

export function parseBeobachtenRow(userFullName: string, comment: string): BeobachtenProdukt | null {
  if (!userFullName.startsWith(BEOBACHTEN_PREFIX)) return null
  try {
    const p = JSON.parse(comment) as Partial<BeobachtenProdukt>
    if (!p.name) return null
    return {
      id: userFullName.slice(BEOBACHTEN_PREFIX.length),
      name: p.name,
      artikelNr: p.artikelNr ?? '',
      firma: p.firma ?? '',
      menge: p.menge ?? null,
      erstellt: p.erstellt ?? '',
      erstelltVon: p.erstelltVon ?? '',
      erinnerung: parseErinnerung(p.erinnerung),
    }
  } catch { return null }
}

export const bestellHeute = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })

/** Ist ein Produkt zur Bestellung fällig? Basis ist der jüngste der
 *  Zeitpunkte «zuletzt bestellt», «Empfehlung abgelehnt» und «erfasst am»
 *  — ein frisch erfasstes Produkt wird also erstmals einen Turnus nach
 *  dem Erfassen empfohlen (wer es sofort braucht, setzt es direkt auf
 *  die Liste). */
export function empfehlungFaellig(p: Produkt, heute: string): boolean {
  if (!p.intervallWochen || p.intervallWochen <= 0) return false
  const basis = [p.zuletztBestellt, p.abgelehntAm, p.erstellt].filter((x): x is string => !!x).sort().pop()
  if (!basis) return true
  const d = new Date(`${basis}T00:00:00`)
  d.setDate(d.getDate() + p.intervallWochen * 7)
  const faelligAb = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return heute >= faelligAb
}

/** Items nach Firma gruppieren (Reihenfolge: Firmenliste, dann Übrige). */
export function itemsNachFirma(items: BestellItem[], firmen: string[]): Array<{ firma: string; items: BestellItem[] }> {
  const reihenfolge = [...firmen]
  for (const it of items) if (!reihenfolge.includes(it.firma)) reihenfolge.push(it.firma)
  return reihenfolge
    .map(f => ({ firma: f, items: items.filter(it => it.firma === f) }))
    .filter(g => g.items.length > 0)
}

export function parseProduktRow(userFullName: string, comment: string): Produkt | null {
  if (!userFullName.startsWith(PRODUKT_PREFIX)) return null
  try {
    const p = JSON.parse(comment) as Partial<Produkt>
    if (!p.name || !p.firma) return null
    return {
      id: userFullName.slice(PRODUKT_PREFIX.length),
      name: p.name,
      artikelNr: p.artikelNr ?? '',
      firma: p.firma,
      menge: p.menge ?? null,
      intervallWochen: typeof p.intervallWochen === 'number' && p.intervallWochen > 0 ? p.intervallWochen : null,
      bestellCount: typeof p.bestellCount === 'number' ? p.bestellCount : 0,
      zuletztBestellt: p.zuletztBestellt ?? null,
      abgelehntAm: p.abgelehntAm ?? null,
      erstellt: p.erstellt ?? '',
    }
  } catch { return null }
}

export function parseListeRow(userFullName: string, comment: string): BestellListe | null {
  if (!userFullName.startsWith(LISTE_PREFIX)) return null
  try {
    const p = JSON.parse(comment) as Partial<BestellListe>
    if (!p.erstellt) return null
    return {
      id: userFullName.slice(LISTE_PREFIX.length),
      typ: p.typ === 'whatsapp' ? 'whatsapp' : 'normal',
      status: p.status === 'geschlossen' ? 'geschlossen' : 'offen',
      items: Array.isArray(p.items) ? p.items.map(it => ({
        produktId: it.produktId ?? null,
        name: it.name ?? '',
        artikelNr: it.artikelNr ?? '',
        firma: it.firma ?? '',
        menge: it.menge ?? '',
        quelle: it.quelle === 'empfehlung' ? 'empfehlung' : 'manuell',
      })) : [],
      erstellt: p.erstellt,
      geschlossenAm: p.geschlossenAm ?? null,
      geschlossenVon: p.geschlossenVon ?? null,
    }
  } catch { return null }
}
