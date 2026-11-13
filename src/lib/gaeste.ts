// Gäste: Personen ohne Anstellung mit einem Konto, das nur die Passwortseite
// sieht (Rolle employee, Kategorie «Gast», Markierung __gast__<profileId>
// @ 1970-01-01 in zeiterfassung_comments). In allen Listen des Portals
// (Arbeitsplan, Mitarbeiter, Konto, Ferienplanung, Zeiterfassung, Samstage)
// werden sie über die Kategorie herausgefiltert: ohneGaeste(...). Diese
// Installation legt keine Gäste an; der Filter bleibt als Sicherheit.

export const GAST_JOB_TITLE = 'Gast'
export const GAST_PREFIX = '__gast__'
export const GAST_ANCHOR = '1970-01-01'
export const gastKey = (profileId: string) => `${GAST_PREFIX}${profileId}`

export const istGast = (jobTitle: string | null | undefined) => (jobTitle ?? '').trim() === GAST_JOB_TITLE

/** Gäste aus einer Profilliste entfernen (die Liste muss job_title enthalten). */
export function ohneGaeste<T extends { job_title?: string | null }>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).filter(r => !istGast(r.job_title))
}

/** Seiten, die ein Gast im Mitarbeiterbereich öffnen darf. */
export const GAST_PFADE = ['/employee/passwort']
export const GAST_START = '/employee/passwort'
export const gastDarfPfad = (pathname: string) =>
  GAST_PFADE.some(p => pathname === p || pathname.startsWith(`${p}/`))

/** Für Promise.all mit Supabase Abfragen: `.then(ohneGaesteErgebnis)` entfernt
 *  Gäste aus dem Ergebnis und lässt alles andere (error, count) unverändert. */
export function ohneGaesteErgebnis<R extends { data: Array<{ job_title?: string | null }> | null }>(r: R): R {
  if (!r.data) return r
  return { ...r, data: ohneGaeste(r.data) } as R
}
