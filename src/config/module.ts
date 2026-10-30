// Module dieser Installation. Abgeschaltete Module verschwinden aus dem Menü,
// ihre Seiten leiten auf die Startseite um. Für den Prototyp Nidau sind
// Parkplätze, Geschäftsanalyse (Finanzen), Teamevents, Lohnabrechnungen,
// «Jetzt anwesend» und HR Dokumente abgeschaltet.

export type Modul = 'parkplaetze' | 'finanzen' | 'teamevents' | 'lohn' | 'anwesend' | 'hrDokumente'

export const MODULE_AUS: ReadonlySet<Modul> = new Set<Modul>(['parkplaetze', 'finanzen', 'teamevents', 'lohn', 'anwesend', 'hrDokumente'])

export const modulAktiv = (m: Modul) => !MODULE_AUS.has(m)

/** Menüpunkte (exakte Pfade) der Module */
const MODUL_PFADE: Record<Modul, string[]> = {
  parkplaetze: ['/admin/parkplaetze'],
  finanzen: ['/admin/finanzen', '/admin/finanzen/regeln'],
  teamevents: ['/admin/teamevents', '/employee/teamevents'],
  lohn: ['/admin/lohn'],
  anwesend: ['/admin/zeiterfassung'],
  hrDokumente: ['/admin/hr-dokumente', '/employee'],
}

export const pfadGesperrt = (href: string) => Array.from(MODULE_AUS).some(m => MODUL_PFADE[m].includes(href))
