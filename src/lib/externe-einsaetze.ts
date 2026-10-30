// Einsätze externer Mitarbeitender (zum Beispiel Fritz Fahrländer) für die
// Mitarbeiterseite der Admins: die festen Donnerstage im November und
// Dezember 2026, ab 2027 die Vertretungswochen (Dienstag und Donnerstag
// 13 bis 17 Uhr in jeder Woche mit Ferienvertretung) und die in der
// Ferienplanung gespeicherten Einsätze, die am selben Tag die Zeiten
// übersteuern. Dazu der Status pro Einsatz: offen, erledigt, abgesagt.
//
// Ablage des Status: __einsatz_erledigt__<profileId> @ Datum
//   → { status: { [einsatzId]: 'erledigt' | 'abgesagt' } }
//   (ältere Zeilen: { erledigt: { [einsatzId]: {...} } } gelten als erledigt)
// Zeiten eines Einsatzes liegen wie in der Ferienplanung unter
//   __ferien_einsatz__ @ Datum (siehe ferien-regeln.ts).

import { FRITZ, vertretungsEinsaetze, type Einsatz } from './ferien-regeln'
import type { FerienVertretung } from './ferien-vertretung'
import { montagVon } from './ferien-wochen'

export const ERLEDIGT_PREFIX = '__einsatz_erledigt__'
export const erledigtKey = (profileId: string) => `${ERLEDIGT_PREFIX}${profileId}`

export type EinsatzStatus = 'offen' | 'erledigt' | 'abgesagt'

export type ExternEinsatz = {
  id: string
  datum: string
  /** HH:MM; null = Zeit noch offen */
  von: string | null
  bis: string | null
  art: 'fest' | 'vertretung'
  /** Zum Beispiel «Fester Einsatz» oder «Vertretung für Valérie» */
  titel: string
  /** regel = aus der Vereinbarung berechnet, gespeichert = in der Ferienplanung erfasst */
  quelle: 'regel' | 'gespeichert' | 'vertretung'
  status: EinsatzStatus
}

/** Donnerstage, an denen Fritz Ende 2026 nicht arbeitet. */
export const FRITZ_DONNERSTAGE_AUSSER = ['2026-12-24', '2026-12-31']

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Fritz arbeitet im November und Dezember 2026 jeden Donnerstag, ausser am 24.12. und am 31.12. */
export function fritzDonnerstage2026(): string[] {
  const out: string[] = []
  const d = new Date('2026-11-01T12:00:00')
  while (d.getFullYear() === 2026) {
    const tag = iso(d)
    if (d.getDay() === 4 && !FRITZ_DONNERSTAGE_AUSSER.includes(tag)) out.push(tag)
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** Die fest vereinbarten Einsätze einer externen Person (heute nur Fritz, nur 2026). */
export function vereinbarteEinsaetze(name: string): Array<Pick<ExternEinsatz, 'id' | 'datum' | 'von' | 'bis'>> {
  if (name !== FRITZ) return []
  return fritzDonnerstage2026().map(datum => ({ id: `fritz-${datum}`, datum, von: null, bis: null }))
}

/** Gespeicherte Einsätze aus der früheren Vereinbarung 2027 (feste Wochen), die nicht mehr gelten. */
export const istAlteVereinbarung = (e: Pick<ExternEinsatz, 'id' | 'quelle'>) => e.quelle === 'gespeichert' && /^fritz-2027-\d{2}-\d{2}$/.test(e.id)

export function parseStatusRows(rows: Array<{ schedule_date: string; comment: string }>): Map<string, EinsatzStatus> {
  const out = new Map<string, EinsatzStatus>()
  for (const r of rows) {
    try {
      const j = JSON.parse(r.comment) as { status?: unknown; erledigt?: unknown }
      if (j.status && typeof j.status === 'object') {
        for (const [id, v] of Object.entries(j.status as Record<string, unknown>)) if (v === 'erledigt' || v === 'abgesagt') out.set(id, v)
      }
      if (j.erledigt && typeof j.erledigt === 'object') {
        for (const id of Object.keys(j.erledigt as Record<string, unknown>)) if (!out.has(id)) out.set(id, 'erledigt')
      }
    } catch { /* kaputte Zeile überspringen */ }
  }
  return out
}

/** Alle Einsätze einer externen Person: Vereinbarung 2026, Vertretungswochen
 *  2027 und gespeicherte Einsätze (übersteuern am selben Tag die Zeiten),
 *  mit Status, nach Datum sortiert. */
export function externeEinsaetze(opts: {
  name: string
  gespeichert: Einsatz[]
  vertretungen: FerienVertretung[]
  /** Profil ID → Name der vertretenen Person */
  namen: Record<string, string>
  status: Map<string, EinsatzStatus>
}): ExternEinsatz[] {
  const proTag = new Map<string, ExternEinsatz>()
  for (const e of vereinbarteEinsaetze(opts.name)) proTag.set(e.datum, { ...e, art: 'fest', titel: 'Fester Einsatz', quelle: 'regel', status: 'offen' })
  const eigene = opts.vertretungen.filter(v => v.name === opts.name)
  for (const e of vertretungsEinsaetze(opts.name, eigene.map(v => v.date))) {
    const montag = montagVon(e.datum)
    const personen = Array.from(new Set(eigene.filter(v => montagVon(v.date) === montag).map(v => opts.namen[v.employeeId] || 'eine Zahnärztin')))
    proTag.set(e.datum, { id: e.id, datum: e.datum, von: e.von, bis: e.bis, art: 'vertretung', titel: `Vertretung für ${personen.join(' und ')}`, quelle: 'vertretung', status: 'offen' })
  }
  for (const e of opts.gespeichert) {
    if (e.name !== opts.name) continue
    const alt = proTag.get(e.datum)
    proTag.set(e.datum, { id: e.id, datum: e.datum, von: e.von, bis: e.bis, art: alt?.art ?? 'fest', titel: alt?.titel ?? 'Fester Einsatz', quelle: 'gespeichert', status: 'offen' })
  }
  const out = Array.from(proTag.values())
  for (const e of out) e.status = opts.status.get(e.id) ?? 'offen'
  return out.sort((a, b) => a.datum.localeCompare(b.datum))
}

const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
/** «Do 05.11.2026» */
export const datumLang = (d: string) => `${WOCHENTAGE[new Date(`${d}T12:00:00`).getDay()]} ${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`
/** «13.00 bis 17.00 Uhr» */
export const zeitText = (von: string, bis: string) => `${von.replace(':', '.')} bis ${bis.replace(':', '.')} Uhr`
