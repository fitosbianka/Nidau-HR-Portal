// Samstagsöffnungen: die Praxis ist an einzelnen Samstagen offen. Drei
// Rollen tragen sich ein: Zahnarzt (ZAZ), DH / PA (DH / PA, DH, PA) und
// Assistenz (DA, Leitende DA, Lernende). Admins und Laura pflegen die
// Samstage (anlegen, bearbeiten, löschen) und tragen Personen direkt ein.
// Ablage als reservierte Zeilen in zeiterfassung_comments:
//   __samstag__                     @ <Datum> → { notiz, bedarf: { zahnarzt, dhpa, assistenz } }
//   __samstag_anmeldung__<profileId> @ <Datum> → { rolle, am, durchAdmin, von }
// Ältere Daten mit den Rollen Behandler und Assistenz werden beim Lesen
// umgesetzt: Bedarf Behandler gilt als Zahnarzt, DH / PA bekommt den
// Standardbedarf 1, eine Anmeldung als Behandler wird über die Kategorie
// der Person der Rolle Zahnarzt oder DH / PA zugeordnet.

export const SAMSTAG_PREFIX = '__samstag__'
export const SAMSTAG_ANMELDUNG_PREFIX = '__samstag_anmeldung__'
/** LIKE Muster, das beide Zeilenarten trifft (escapte Unterstriche). */
export const SAMSTAG_LIKE = '\\_\\_samstag\\_%'
export const anmeldungKey = (profileId: string) => `${SAMSTAG_ANMELDUNG_PREFIX}${profileId}`

export type SamstagRolle = 'zahnarzt' | 'dhpa' | 'assistenz'
export const ROLLEN: SamstagRolle[] = ['zahnarzt', 'dhpa', 'assistenz']
export const ROLLE_LABEL: Record<SamstagRolle, string> = { zahnarzt: 'Zahnarzt', dhpa: 'DH / PA', assistenz: 'Assistenz' }
export type SamstagBedarf = Record<SamstagRolle, number | null>
export const BEDARF_STANDARD: SamstagBedarf = { zahnarzt: 1, dhpa: 1, assistenz: 1 }
export type SamstagAnmeldung = { profileId: string; name: string; jobTitle: string | null; rolle: SamstagRolle; am: string; durchAdmin: boolean }
export type Samstag = { datum: string; notiz: string; bedarf: SamstagBedarf; anmeldungen: SamstagAnmeldung[] }

/** Rolle aus der Kategorie; andere (z. B. Admin) null. */
export function samstagRolle(jobTitle: string | null | undefined): SamstagRolle | null {
  const t = (jobTitle ?? '').trim()
  if (t === 'ZAZ') return 'zahnarzt'
  if (t === 'DH / PA' || t === 'DH' || t === 'PA') return 'dhpa'
  if (t === 'DA' || t === 'Leitende DA' || t === 'Lernende') return 'assistenz'
  return null
}
export const istRolle = (v: unknown): v is SamstagRolle => v === 'zahnarzt' || v === 'dhpa' || v === 'assistenz'

export const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/
export const istSamstag = (ds: string) => DATUM_RE.test(ds) && new Date(`${ds}T12:00:00`).getDay() === 6
export const fmtSamstag = (ds: string) => `Sa ${ds.slice(8, 10)}.${ds.slice(5, 7)}.${ds.slice(0, 4)}`

const zahl = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(20, Math.round(v)) : null)

export function parseSamstagRow(comment: string | null | undefined): { notiz: string; bedarf: SamstagBedarf } {
  try {
    const j = comment ? (JSON.parse(comment) as { notiz?: unknown; bedarf?: Record<string, unknown> }) : {}
    const b = j.bedarf ?? {}
    const alt = 'behandler' in b && !('zahnarzt' in b)
    return {
      notiz: typeof j.notiz === 'string' ? j.notiz.trim().slice(0, 300) : '',
      bedarf: {
        zahnarzt: alt ? zahl(b.behandler) : zahl(b.zahnarzt),
        dhpa: 'dhpa' in b ? zahl(b.dhpa) : BEDARF_STANDARD.dhpa,
        assistenz: zahl(b.assistenz),
      },
    }
  } catch { return { notiz: '', bedarf: { ...BEDARF_STANDARD } } }
}

/** Anmeldung lesen; alte Rolle Behandler über die Kategorie der Person zuordnen. */
export function parseAnmeldungRow(comment: string | null | undefined, jobTitle: string | null | undefined): { rolle: SamstagRolle; am: string; durchAdmin: boolean } | null {
  try {
    const j = comment ? (JSON.parse(comment) as { rolle?: unknown; am?: unknown; durchAdmin?: unknown }) : {}
    let rolle: SamstagRolle | null = null
    if (istRolle(j.rolle)) rolle = j.rolle
    else if (j.rolle === 'behandler') rolle = samstagRolle(jobTitle) === 'dhpa' ? 'dhpa' : 'zahnarzt'
    if (!rolle) return null
    return { rolle, am: typeof j.am === 'string' ? j.am : '', durchAdmin: j.durchAdmin === true }
  } catch { return null }
}

/** Zahlen für die Mitarbeiterseite: Bedarf und Angemeldete pro Rolle, eigener
 *  Status, keine Namen oder IDs anderer Personen. */
export type SamstagZahlen = { datum: string; notiz: string; bedarf: SamstagBedarf; anzahl: Record<SamstagRolle, number>; ichDabei: boolean }
export function samstagZahlen(s: Samstag, meinId: string): SamstagZahlen {
  const anzahl: Record<SamstagRolle, number> = { zahnarzt: 0, dhpa: 0, assistenz: 0 }
  for (const a of s.anmeldungen) anzahl[a.rolle]++
  return { datum: s.datum, notiz: s.notiz, bedarf: s.bedarf, anzahl, ichDabei: s.anmeldungen.some(a => a.profileId === meinId) }
}
