// Kategorien, Regeln und die Zuordnung der Buchungen — reine Funktionen,
// damit Server (Seiten-Aggregate) und Prüfskript denselben Code nutzen.
//
// Die Kategorie wird beim ANZEIGEN berechnet und nicht in der Buchung
// gespeichert — eine Regeländerung wirkt sofort auch rückwirkend.
// Gespeichert wird nur kategorieManuell (in der Jahresdatei) sowie die
// Kategorien-/Regel-Listen als JSON in __finanz_kategorien__ und
// __finanz_regeln__ (schedule_date 1970-01-01).

import type { Buchung } from './types'

// Die GRUPPEN sind fest im Code — die Analyse baut darauf auf.
export type Gruppe =
  | 'EINNAHMEN_BETRIEB'    // zählt ins Betriebsergebnis
  | 'RUECKERSTATTUNGEN'    // zählt ins Betriebsergebnis, separat gezeigt
  | 'AUSGABEN_BETRIEB'     // zählt ins Betriebsergebnis
  | 'STEUERN'              // separat, nicht im Betriebsergebnis
  | 'INVESTITIONEN'        // Investitionen und andere Standorte
  | 'FINANZIERUNG'         // Darlehen, Amortisation, Kapital
  | 'INTERN'               // Umbuchungen zwischen eigenen Konten, zählt nirgends
  | 'UNKLASSIERT'

export const GRUPPEN_META: Record<Gruppe, { label: string; kurz: string }> = {
  EINNAHMEN_BETRIEB: { label: 'Einnahmen Betrieb', kurz: 'Einnahmen' },
  RUECKERSTATTUNGEN: { label: 'Rückerstattungen', kurz: 'Rückerst.' },
  AUSGABEN_BETRIEB:  { label: 'Ausgaben Betrieb', kurz: 'Ausgaben' },
  STEUERN:           { label: 'Steuern', kurz: 'Steuern' },
  INVESTITIONEN:     { label: 'Investitionen', kurz: 'Invest.' },
  FINANZIERUNG:      { label: 'Finanzierung', kurz: 'Finanz.' },
  INTERN:            { label: 'Interne Umbuchungen', kurz: 'Intern' },
  UNKLASSIERT:       { label: 'Unklassiert', kurz: 'Unklass.' },
}

export const GRUPPEN_REIHENFOLGE: Gruppe[] = [
  'EINNAHMEN_BETRIEB', 'RUECKERSTATTUNGEN', 'AUSGABEN_BETRIEB',
  'STEUERN', 'INVESTITIONEN', 'FINANZIERUNG', 'INTERN', 'UNKLASSIERT',
]

export type Kategorie = { id: string; name: string; gruppe: Gruppe; aktiv: boolean }

export type Regel = {
  id: string
  /** ohne Gross-/Kleinschreibung, mehrere Begriffe mit | getrennt, sucht in
   *  text1 bis text3; leer = passt auf alles (für die Auffang-Regel) */
  suchtext: string
  richtung: 'einnahme' | 'ausgabe' | 'beide'
  betragMin: number | null   // in CHF
  betragMax: number | null   // in CHF
  kategorieId: string
  prioritaet: number         // kleiner = zuerst
  aktiv: boolean
}

export const UNKLASSIERT_ID = 'kat_unklassiert'
export const INTERN_ID = 'kat_intern'

// ── Startkategorien (Namen änderbar, neue können dazukommen) ─────────────

export const START_KATEGORIEN: Kategorie[] = [
  // Einnahmen Betrieb
  { id: 'kat_patienten',   name: 'Patientenzahlungen',              gruppe: 'EINNAHMEN_BETRIEB', aktiv: true },
  { id: 'kat_karte',       name: 'Kartenterminal und TWINT',        gruppe: 'EINNAHMEN_BETRIEB', aktiv: true },
  { id: 'kat_versicherer', name: 'Versicherer und Kostenträger',    gruppe: 'EINNAHMEN_BETRIEB', aktiv: true },
  { id: 'kat_uebrige_ein', name: 'Übrige Einnahmen',                gruppe: 'EINNAHMEN_BETRIEB', aktiv: true },
  // Rückerstattungen
  { id: 'kat_taggeld',     name: 'Taggelder und Versicherungsleistungen', gruppe: 'RUECKERSTATTUNGEN', aktiv: true },
  { id: 'kat_uebrige_rueck', name: 'Übrige Rückerstattungen',       gruppe: 'RUECKERSTATTUNGEN', aktiv: true },
  // Ausgaben Betrieb
  { id: 'kat_loehne',      name: 'Löhne',                           gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_sozial',      name: 'Sozialversicherungen und Quellensteuer', gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_versicherungen', name: 'Versicherungen',               gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_miete',       name: 'Miete Nebenkosten und Parkplätze', gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_material',    name: 'Praxismaterial',                  gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_labor',       name: 'Zahntechnik und Labor',           gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_it',          name: 'IT Software und Telefonie',       gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_unterhalt',   name: 'Unterhalt und Reparaturen',       gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_fahrzeug',    name: 'Fahrzeug laufend',                gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_wohnung',     name: 'Wohnung laufend',                 gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_kreditkarte', name: 'Kreditkarte',                     gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_bankspesen',  name: 'Bankspesen',                      gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_bueromaterial', name: 'Büromaterial',                  gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_lieferung',   name: 'Lieferung',                       gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_mitglied',    name: 'Mitgliedschaftsbeiträge',         gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_ausbildung_kinder', name: 'Ausbildung Kinder',         gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_verwaltung',  name: 'Verwaltung und Treuhand',         gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_marketing',   name: 'Marketing und Sponsoring',        gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_weiterbildung', name: 'Weiterbildung',                 gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_personal',    name: 'Übriger Personalaufwand',         gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  { id: 'kat_uebrige_aus', name: 'Übrige Ausgaben',                 gruppe: 'AUSGABEN_BETRIEB', aktiv: true },
  // Steuern
  { id: 'kat_steuern',     name: 'Steuern',                         gruppe: 'STEUERN', aktiv: true },
  // Investitionen
  { id: 'kat_nidau',       name: 'Praxis Nidau',                    gruppe: 'INVESTITIONEN', aktiv: true },
  { id: 'kat_koeniz',      name: 'Praxis Köniz',                    gruppe: 'INVESTITIONEN', aktiv: true },
  { id: 'kat_auto_kauf',   name: 'Fahrzeug Kauf',                   gruppe: 'INVESTITIONEN', aktiv: true },
  { id: 'kat_wohnung_kauf', name: 'Wohnung Kauf',                   gruppe: 'INVESTITIONEN', aktiv: true },
  { id: 'kat_anschaffung', name: 'Grössere Anschaffungen',          gruppe: 'INVESTITIONEN', aktiv: true },
  // Finanzierung
  { id: 'kat_darlehen',    name: 'Darlehen und Amortisation',       gruppe: 'FINANZIERUNG', aktiv: true },
  // Intern
  { id: INTERN_ID,         name: 'Interne Umbuchung',               gruppe: 'INTERN', aktiv: true },
]

// ── Startregeln — Reihenfolge = Priorität von oben nach unten ────────────

const R = (suchtext: string, richtung: Regel['richtung'], kategorieId: string, i: number): Regel => ({
  id: `regel_start_${i}`, suchtext, richtung, betragMin: null, betragMax: null,
  kategorieId, prioritaet: (i + 1) * 10, aktiv: true,
})

export const START_REGELN: Regel[] = [
  R('Quellensteuer', 'ausgabe', 'kat_sozial', 0),
  R('Ausgleichskasse|AHV|Medisuisse|Pensionskasse|BVG|Vorsorgestiftung', 'ausgabe', 'kat_sozial', 1),
  R('Sammelauftrag|Lohn|Salär', 'ausgabe', 'kat_loehne', 2),
  R('Taggeld|AXA|Zürich|Zurich|SUVA', 'einnahme', 'kat_taggeld', 3),
  R('AXA|Zürich|Zurich|Allianz|Mobiliar|Helvetia|Baloise|Generali|ARAG|Orion', 'ausgabe', 'kat_versicherungen', 4),
  R('Helsana|CSS|Swica|Sanitas|Visana|Groupe Mutuel|Concordia|KPT|Atupri|Sympany|IV Stelle|Invalidenversicherung', 'einnahme', 'kat_versicherer', 5),
  R('Worldline|SIX Payment|SumUp|Payrexx|Wallee|TWINT|Stripe', 'einnahme', 'kat_karte', 6),
  R('Mietzins|Miete|Nebenkosten|Parkplatz|Einstellhalle', 'ausgabe', 'kat_miete', 7),
  R('Kaladent|Abc Dental|Henry Schein|Curaden|Straumann|Ivoclar|Dentsply|Kulzer|Dentalbedarf|Verbrauchsmaterial', 'ausgabe', 'kat_material', 8),
  R('Dentallabor|Zahntechnik|Labor', 'ausgabe', 'kat_labor', 9),
  R('Martin Engineering|ZaWin|PC-Profi|3CX|Novatrend|Swisscom|Sunrise|Salt|Microsoft|Adobe|Google|Vercel|Supabase|Anthropic', 'ausgabe', 'kat_it', 10),
  R('Card Center|Kreditkarte|Viseca|Swisscard', 'ausgabe', 'kat_kreditkarte', 11),
  R('Steuerverwaltung|ESTV|Steueramt|Steuern', 'ausgabe', 'kat_steuern', 12),
  R('Leasing|Tankstelle|Shell|Avia|Migrol|Socar|Strassenverkehrsamt', 'ausgabe', 'kat_fahrzeug', 13),
  R('Hypothekarzins', 'ausgabe', 'kat_wohnung', 14),
  R('Amortisation|Darlehen', 'ausgabe', 'kat_darlehen', 15),
  R('Spesen|Kontoführung|Bankspesen|Preis-/Leistung|Preis- und Leistung|Depotgebühr', 'ausgabe', 'kat_bankspesen', 16),
  R('Gebühr|Treuhand', 'ausgabe', 'kat_verwaltung', 17),
  R('Büromaterial|Lyreco|Office World|Papeterie', 'ausgabe', 'kat_bueromaterial', 18),
  R('Lieferung|Versand|Porto|Post CH|DHL|DPD|Planzer', 'ausgabe', 'kat_lieferung', 19),
  R('Mitglied|Jahresbeitrag', 'ausgabe', 'kat_mitglied', 20),
  R('Schulgeld|Studiengebühr|Semestergebühr', 'ausgabe', 'kat_ausbildung_kinder', 21),
  R('Weiterbildung|Fortbildung|Kongress|Seminar', 'ausgabe', 'kat_weiterbildung', 22),
  // Auffang-Regel: alle übrigen Gutschriften → Patientenzahlungen
  { id: 'regel_start_uebrige_gutschriften', suchtext: '', richtung: 'einnahme', betragMin: null, betragMax: null, kategorieId: 'kat_patienten', prioritaet: 9000, aktiv: true },
]

// ── Zuordnung ────────────────────────────────────────────────────────────

export type KategorisierKontext = {
  kategorien: Kategorie[]
  regeln: Regel[]
  /** IBANs der eigenen Konten, normalisiert (ohne Leerzeichen, gross) */
  eigeneIbans: string[]
  /** Gegenbuchungs-Schlüssel «datum|betragRp» ANDERER eigener Konten —
   *  gleicher Betrag mit umgekehrtem Vorzeichen am selben Tag = intern */
  gegenpaare: Set<string>
}

export function baueKontext(
  kategorien: Kategorie[], regeln: Regel[], eigeneIbans: string[],
  alleBuchungen?: Array<{ kontoKey: string; buchungsdatum: string; betragRp: number }>,
): KategorisierKontext {
  const gegenpaare = new Set<string>()
  if (alleBuchungen) {
    const proKonto = new Map<string, Set<string>>()
    for (const b of alleBuchungen) {
      const s = proKonto.get(b.kontoKey) ?? new Set<string>()
      s.add(`${b.buchungsdatum}|${b.betragRp}`)
      proKonto.set(b.kontoKey, s)
    }
    // ein Paar zählt nur über KONTO-GRENZEN hinweg
    for (const b of alleBuchungen) {
      const gegner = `${b.buchungsdatum}|${-b.betragRp}`
      proKonto.forEach((menge, konto) => {
        if (konto !== b.kontoKey && menge.has(gegner)) gegenpaare.add(`${b.buchungsdatum}|${b.betragRp}`)
      })
    }
  }
  return {
    kategorien,
    regeln: [...regeln].filter(r => r.aktiv).sort((a, b) => a.prioritaet - b.prioritaet),
    eigeneIbans: eigeneIbans.map(i => i.replace(/\s+/g, '').toUpperCase()).filter(Boolean),
    gegenpaare,
  }
}

function istInternAutomatisch(b: Buchung, ctx: KategorisierKontext): boolean {
  if (ctx.gegenpaare.has(`${b.buchungsdatum}|${b.betragRp}`)) return true
  if (ctx.eigeneIbans.length === 0) return false
  const text = `${b.text1} ${b.text2} ${b.text3}`.replace(/\s+/g, '').toUpperCase()
  return ctx.eigeneIbans.some(iban => text.includes(iban))
}

// Vergleich ohne Gross-/Kleinschreibung und mit vereinheitlichten
// Leerzeichen — «Kaladent  AG» (Doppel-Leerzeichen im Bankexport) soll
// von «Kaladent AG» trotzdem getroffen werden.
const normText = (s: string) => s.toLowerCase().replace(/\s+/g, ' ')

export function passtRegel(b: Buchung, r: Regel): boolean {
  if (r.richtung === 'einnahme' && b.betragRp < 0) return false
  if (r.richtung === 'ausgabe' && b.betragRp >= 0) return false
  const chf = Math.abs(b.betragRp) / 100
  if (r.betragMin != null && chf < r.betragMin) return false
  if (r.betragMax != null && chf > r.betragMax) return false
  const such = r.suchtext.trim()
  if (!such) return true
  const text = normText(`${b.text1} ${b.text2} ${b.text3}`)
  return such.split('|').map(t => normText(t).trim()).filter(Boolean).some(t => text.includes(t))
}

/** Kategorie einer Buchung: manuell → interne Umbuchung → Regeln → unklassiert. */
export function kategorieVon(b: Buchung, ctx: KategorisierKontext): { kategorieId: string; gruppe: Gruppe; quelle: 'manuell' | 'intern' | 'regel' | 'unklassiert' } {
  const gruppeVon = (id: string): Gruppe => ctx.kategorien.find(k => k.id === id)?.gruppe ?? 'UNKLASSIERT'
  if (b.kategorieManuell) return { kategorieId: b.kategorieManuell, gruppe: gruppeVon(b.kategorieManuell), quelle: 'manuell' }
  if (istInternAutomatisch(b, ctx)) return { kategorieId: INTERN_ID, gruppe: 'INTERN', quelle: 'intern' }
  for (const r of ctx.regeln) {
    if (passtRegel(b, r)) return { kategorieId: r.kategorieId, gruppe: gruppeVon(r.kategorieId), quelle: 'regel' }
  }
  return { kategorieId: UNKLASSIERT_ID, gruppe: 'UNKLASSIERT', quelle: 'unklassiert' }
}

/** Wie oft greift welche Regel? (Buchungen mit manueller Kategorie oder
 *  automatischer interner Umbuchung zählen nicht — dort kommt keine Regel
 *  zum Zug.) Für die Treffer-Spalte auf der Regeln-Seite. */
export function zaehleRegelTreffer(buchungen: Buchung[], ctx: KategorisierKontext): Map<string, number> {
  const out = new Map<string, number>()
  for (const b of buchungen) {
    const z = kategorieVon(b, ctx)
    if (z.quelle !== 'regel') continue
    for (const r of ctx.regeln) {
      if (passtRegel(b, r)) { out.set(r.id, (out.get(r.id) ?? 0) + 1); break }
    }
  }
  return out
}

/** «Grosse Buchung» für die Prüfliste: einzeln über CHF 5'000, nicht in
 *  INVESTITIONEN/FINANZIERUNG/STEUERN/INTERN und nicht Löhne/Sozialvers. */
export function istGrosseBuchung(b: Buchung, zuordnung: { kategorieId: string; gruppe: Gruppe }): boolean {
  if (Math.abs(b.betragRp) <= 500000) return false
  if (['INVESTITIONEN', 'FINANZIERUNG', 'STEUERN', 'INTERN'].includes(zuordnung.gruppe)) return false
  if (zuordnung.kategorieId === 'kat_loehne' || zuordnung.kategorieId === 'kat_sozial') return false
  return true
}

/** Suchtext-Vorschlag für «als Regel speichern»: das LÄNGSTE
 *  zusammenhängende Textstück aus text1 ohne Zahlen und Referenzen.
 *  Wichtig: Das Ergebnis ist garantiert ein Teilstück des Originaltexts
 *  (bei vereinheitlichten Leerzeichen) — eine daraus gespeicherte Regel
 *  trifft die Buchung also sicher. Früher wurden die Zahlen aus der MITTE
 *  entfernt («Gutschrift 123 Kaladent» → «Gutschrift Kaladent»), was kein
 *  Teilstück mehr war und die Regel wirkungslos machte. */
export function suchtextVorschlag(text1: string): string {
  const stuecke = text1
    .replace(/QRR:?\s*[\d\s]+/gi, ';')
    .split(/\b\d[\d\s.'-]*\b|[;,:]+/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 3)
  if (stuecke.length === 0) return ''
  return stuecke.sort((a, b) => b.length - a.length)[0].slice(0, 60).trim()
}
