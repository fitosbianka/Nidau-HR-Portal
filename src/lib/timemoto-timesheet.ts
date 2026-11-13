// TimeMoto «Timesheet» (PDF Bericht, auch mit allen Mitarbeitenden in einer
// Datei) in Stempelzeilen. Aufbau pro Person:
//
//   Name:   Vorname Nachname     Department: …     Schedule:
//   Employee No.:  162
//   Date   Day   IN      OUT     Planned  Achieved  Balance  Comments/Codes
//   Week   27    2026
//   01/07  Wed   07:47   12:06   08:30    08:21     -00:09
//                13:02   17:04                               ← zweites Paar desselben Tags
//   20/07  Mon   Ferien  08:30   08:30    08:30     00:00    Ferien   ← Absenz, keine Zeit
//                        34:00   34:21    00:21              ← Wochensumme
//
// Jeder Abschnitt beginnt mit «Name:»; alle Tageszeilen bis zum nächsten
// «Name:» gehören dieser Person. Die Spalten IN und OUT werden über die x
// Position der Kopfzeile gefunden (die Werte stehen linksbündig unter den
// Titeln), nie über die Reihenfolge der Wörter. Das Jahr kommt aus der
// Zeile «Week N YYYY», sonst aus dem Zeitraum im Seitenkopf.

import type { ImportZeile } from './timemoto-import'

export type PdfWort = { x: number; y: number; w: number; s: string }
export type PdfZeile = { y: number; woerter: PdfWort[] }
export type PdfSeite = PdfZeile[]

export type TimesheetErgebnis = {
  zeilen: ImportZeile[]
  /** Namen der Abschnitte in der Reihenfolge der Datei */
  personen: string[]
  uebersprungen: number
  fehler: string[]
}

const ZEIT_RE = /^(\d{1,2}):(\d{2})$/
const TAG_RE = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/
const pad = (n: number) => String(n).padStart(2, '0')

type Spalten = { tag: number; day: number; ein: number; aus: number; ende: number }

/** Spaltengrenzen aus der Kopfzeile: ein Wert gehört zur Spalte, deren Titel
 *  am nächsten links von ihm beginnt (Toleranz 6 Punkt nach links). */
function spaltenAus(z: PdfZeile): Spalten | null {
  const finde = (re: RegExp) => z.woerter.find(w => re.test(w.s.toLowerCase()))
  const tag = finde(/^(date|datum)$/), day = finde(/^(day|tag)$/), ein = finde(/^(in|ein)$/), aus = finde(/^(out|aus)$/)
  const ende = finde(/^(planned|soll|geplant|achieved|ist|erreicht|balance|saldo)$/)
  if (!tag || !ein || !aus) return null
  return { tag: tag.x, day: day?.x ?? ein.x, ein: ein.x, aus: aus.x, ende: ende?.x ?? aus.x + 60 }
}

const inSpalte = (w: PdfWort, von: number, bis: number) => w.x >= von - 6 && w.x < bis - 6

export function zeilenAusTimesheet(seiten: PdfSeite[]): TimesheetErgebnis {
  const zeilen: ImportZeile[] = []
  const personen: string[] = []
  const fehler: string[] = []
  let uebersprungen = 0
  let name = ''
  let jahr: number | null = null
  let jahrZeitraum: number | null = null
  let spalten: Spalten | null = null
  let datum = ''
  let ohnePerson = 0
  let zeilenNr = 0
  const proPerson = new Map<string, number>()

  for (const seite of seiten) {
    for (const z of seite) {
      zeilenNr++
      const texte = z.woerter.map(w => w.s)
      const text = texte.join(' ')

      // Neuer Abschnitt: «Name:  Vorname Nachname   Department: …»
      const iName = z.woerter.findIndex(w => /^name:?$/i.test(w.s) && (w.s.endsWith(':') || z.woerter[z.woerter.indexOf(w) + 1]?.s === ':'))
      if (iName >= 0 && !spaltenAus(z)) {
        const nach = z.woerter.slice(iName + 1).filter(w => w.s !== ':')
        const ende = nach.findIndex(w => /^(department|abteilung|schedule|arbeitsplan|employee|mitarbeiter)/i.test(w.s))
        const teil = (ende >= 0 ? nach.slice(0, ende) : nach).map(w => w.s).join(' ').replace(/\s+/g, ' ').trim()
        if (teil) {
          name = teil
          datum = ''
          if (!personen.includes(name)) personen.push(name)
          if (!proPerson.has(name)) proPerson.set(name, 0)
        }
        continue
      }

      // Zeitraum im Seitenkopf: 01-07-2026 - 31-07-2026
      const zr = text.match(/(\d{2})[-./](\d{2})[-./](\d{4})\s*-\s*(\d{2})[-./](\d{2})[-./](\d{4})/)
      if (zr && jahrZeitraum == null) jahrZeitraum = +zr[3]

      // Kopfzeile der Tabelle
      const sp = spaltenAus(z)
      if (sp) { spalten = sp; continue }

      // Wochenzeile: Week 27 2026 (oder KW 27 2026)
      const wk = text.match(/^(?:week|woche|kw)\s+(\d{1,2})\s+(\d{4})\b/i)
      if (wk) { jahr = +wk[2]; continue }

      if (!spalten) continue

      // Tageszeile: Datum in der Datumsspalte, sonst Fortsetzung des letzten Tags
      const tagWort = z.woerter.find(w => inSpalte(w, spalten!.tag, spalten!.day) && TAG_RE.test(w.s))
      const einWort = z.woerter.find(w => inSpalte(w, spalten!.ein, spalten!.aus))
      const ausWort = z.woerter.find(w => inSpalte(w, spalten!.aus, spalten!.ende))
      if (tagWort) {
        const m = tagWort.s.match(TAG_RE)!
        const j = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : (jahr ?? jahrZeitraum)
        if (j == null) { fehler.push(`Zeile ${zeilenNr}: Datum ${tagWort.s} ohne Jahr (keine Zeile «Week … Jahr» davor).`); uebersprungen++; continue }
        datum = `${j}-${pad(+m[2])}-${pad(+m[1])}`
      } else if (!einWort || !ZEIT_RE.test(einWort.s)) {
        continue   // Summen, Leerzeilen, Fusszeile: eine Fortsetzung beginnt immer mit IN
      }
      if (!datum) continue
      if (!name) { ohnePerson++; continue }

      const ein = einWort && ZEIT_RE.test(einWort.s) ? einWort.s : null
      const aus = ausWort && ZEIT_RE.test(ausWort.s) ? ausWort.s : null
      if (einWort && !ein && tagWort) { uebersprungen++; continue }   // Absenz (Ferien, Krank …)
      if (!ein && !aus) { if (tagWort) uebersprungen++; continue }
      const norm = (t: string) => { const m = t.match(ZEIT_RE)!; return `${pad(+m[1])}:${m[2]}` }
      if (ein) zeilen.push({ name, datum, zeit: norm(ein), typ: 'In', userId: null, zeile: zeilenNr })
      if (aus) zeilen.push({ name, datum, zeit: norm(aus), typ: 'Out', userId: null, zeile: zeilenNr })
      proPerson.set(name, (proPerson.get(name) ?? 0) + 1)
    }
  }

  if (personen.length === 0) fehler.push('Kein Abschnitt «Name:» gefunden. Erwartet wird der TimeMoto Timesheet Bericht (pro Person ein Abschnitt mit Name, Datum, IN und OUT).')
  if (ohnePerson > 0) fehler.push(`${ohnePerson} Tageszeilen stehen vor dem ersten «Name:» und wurden übersprungen.`)
  for (const [p, n] of Array.from(proPerson.entries())) if (n === 0) fehler.push(`Abschnitt «${p}» enthält keine Stempelzeiten.`)
  return { zeilen, personen, uebersprungen, fehler }
}
