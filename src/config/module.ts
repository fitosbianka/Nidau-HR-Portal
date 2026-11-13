// Module dieser Installation. Abgeschaltete Module verschwinden aus dem Menü,
// ihre Seiten leiten um. Einschalten heisst, das Modul aus MODULE_AUS nehmen.
//   hrDokumente  Admin Seite «HR Dokumente» (allgemeine Vorlagen); die
//                Dokumente in der Personalakte und «Meine Dokumente» bleiben
//   kontrolle    «Kontrolle Vormonat» samt Kontroll-Regeln
//   anwesend     «Jetzt anwesend» (braucht den TimeMoto Webhook)
//   lohn         Lohnabrechnungen

export type Modul = 'hrDokumente' | 'kontrolle' | 'anwesend' | 'lohn'

export const MODULE_AUS: ReadonlySet<Modul> = new Set<Modul>(['hrDokumente', 'kontrolle', 'anwesend', 'lohn'])

export const modulAktiv = (m: Modul) => !MODULE_AUS.has(m)

/** Menüpunkte (exakte Pfade) der Module */
const MODUL_PFADE: Record<Modul, string[]> = {
  hrDokumente: ['/admin/hr-dokumente'],
  kontrolle: ['/admin/zeiterfassung/kontrolle', '/admin/zeiterfassung/korrekturen/regeln'],
  anwesend: ['/admin/zeiterfassung'],
  lohn: ['/admin/lohn'],
}

export const pfadGesperrt = (href: string) => Array.from(MODULE_AUS).some(m => MODUL_PFADE[m].includes(href))
