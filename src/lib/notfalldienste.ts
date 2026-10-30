// Notfalldienste mit Anmeldung, gleich aufgebaut wie die Samstage. Admins
// und Laura legen Dienste an (Von, Bis, Notiz, Bedarf Zahnarzt und
// Assistenz); Zahnärztinnen (ZAZ) und Assistenz (DA, Leitende DA, Lernende)
// melden sich an, DH / PA nicht. Jede Anmeldung schreibt ND sofort in den
// Arbeitsplan, nie über ein F. ND Tage, die direkt im Arbeitsplan stehen,
// erscheinen in der Liste als Dienst «aus Arbeitsplan».
// Ablage in zeiterfassung_comments:
//   __notfalldienst__                     @ Von → { bis, notiz, bedarf: { zahnarzt, assistenz } }
//   __notfalldienst_anmeldung__<profileId> @ Von → { rolle, am, status, durchAdmin, von }

export const ND_PREFIX = '__notfalldienst__'
export const ND_ANMELDUNG_PREFIX = '__notfalldienst_anmeldung__'
export const ND_LIKE = '\\_\\_notfalldienst\\_%'
export const ndAnmeldungKey = (profileId: string) => `${ND_ANMELDUNG_PREFIX}${profileId}`

export type NdRolle = 'zahnarzt' | 'assistenz'
export const ND_ROLLEN: NdRolle[] = ['zahnarzt', 'assistenz']
export const ND_ROLLE_LABEL: Record<NdRolle, string> = { zahnarzt: 'Zahnarzt', assistenz: 'Assistenz' }
export type NdBedarf = Record<NdRolle, number | null>
export const ND_BEDARF_STANDARD: NdBedarf = { zahnarzt: 1, assistenz: 1 }
export type NdStatus = 'offen' | 'bestaetigt'
export type NdAnmeldung = {
  profileId: string; name: string; jobTitle: string | null; rolle: NdRolle; am: string; status: NdStatus; durchAdmin: boolean
  /** Nur ND Tage im Arbeitsplan, ohne Anmeldungszeile */
  ausArbeitsplan?: boolean
}
export type Notfalldienst = {
  von: string; bis: string; notiz: string; bedarf: NdBedarf; anmeldungen: NdAnmeldung[]
  /** Aus ND Tagen im Arbeitsplan abgeleitet, ohne eigene Zeile __notfalldienst__ */
  ausArbeitsplan?: boolean
}

export function ndRolle(jobTitle: string | null | undefined): NdRolle | null {
  const t = (jobTitle ?? '').trim()
  if (t === 'ZAZ') return 'zahnarzt'
  if (t === 'DA' || t === 'Leitende DA' || t === 'Lernende') return 'assistenz'
  return null
}
export const istNdRolle = (v: unknown): v is NdRolle => v === 'zahnarzt' || v === 'assistenz'

const zahl = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(20, Math.round(v)) : null)
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/

export function parseNdRow(von: string, comment: string | null | undefined): Omit<Notfalldienst, 'anmeldungen'> | null {
  try {
    const j = comment ? (JSON.parse(comment) as { bis?: unknown; notiz?: unknown; bedarf?: Record<string, unknown> }) : {}
    const bis = typeof j.bis === 'string' && DATUM_RE.test(j.bis) && j.bis >= von ? j.bis : von
    return {
      von, bis,
      notiz: typeof j.notiz === 'string' ? j.notiz.trim().slice(0, 300) : '',
      bedarf: { zahnarzt: zahl(j.bedarf?.zahnarzt), assistenz: zahl(j.bedarf?.assistenz) },
    }
  } catch { return null }
}

export function parseNdAnmeldungRow(comment: string | null | undefined): { rolle: NdRolle; am: string; status: NdStatus; durchAdmin: boolean } | null {
  try {
    const j = comment ? (JSON.parse(comment) as { rolle?: unknown; am?: unknown; status?: unknown; durchAdmin?: unknown }) : {}
    if (!istNdRolle(j.rolle)) return null
    return { rolle: j.rolle, am: typeof j.am === 'string' ? j.am : '', status: j.status === 'bestaetigt' ? 'bestaetigt' : 'offen', durchAdmin: j.durchAdmin === true }
  } catch { return null }
}

export const fmtNdZeitraum = (von: string, bis: string) => (von === bis ? `${von.slice(8, 10)}.${von.slice(5, 7)}.${von.slice(0, 4)}` : `${von.slice(8, 10)}.${von.slice(5, 7)}. bis ${bis.slice(8, 10)}.${bis.slice(5, 7)}.${bis.slice(0, 4)}`)

/** Zahlen für die Mitarbeiterseite, ohne Namen und IDs anderer Personen. */
export type NdZahlen = { von: string; bis: string; notiz: string; bedarf: NdBedarf; anzahl: Record<NdRolle, number>; bestaetigt: Record<NdRolle, number>; mein: NdStatus | null }
export function ndZahlen(n: Notfalldienst, meinId: string): NdZahlen {
  const anzahl: Record<NdRolle, number> = { zahnarzt: 0, assistenz: 0 }
  const bestaetigt: Record<NdRolle, number> = { zahnarzt: 0, assistenz: 0 }
  for (const a of n.anmeldungen) { anzahl[a.rolle]++; if (a.status === 'bestaetigt') bestaetigt[a.rolle]++ }
  return { von: n.von, bis: n.bis, notiz: n.notiz, bedarf: n.bedarf, anzahl, bestaetigt, mein: n.anmeldungen.find(a => a.profileId === meinId)?.status ?? null }
}
