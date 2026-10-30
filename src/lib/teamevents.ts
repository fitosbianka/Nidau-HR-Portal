// Teamevent-Fotos: gemeinsame «Cloud» pro Teamevent (Ordner), darin die
// Fotos nach Upload-Datum gruppiert. Ablage im privaten Bucket
// employee-documents unter _teamevents/<slug>/<YYYY-MM-DD>/orig|thumb/…,
// Metadaten als reservierte Zeilen in zeiterfassung_comments (kein DDL):
//   __teamevent__<slug>            @ 1970-01-01   → Ordner {name, datum, erstelltVon, erstelltAm}
//   __teamevent_foto__<slug>__<id> @ Upload-Datum → Foto  {name, mime, bytes, von, am, thumb}
// Zugriff: siehe TE_FREIGABE (vorerst nur die Organisatorin); sobald alle
// Mitarbeitenden hochladen und herunterladen sollen, den Schalter umstellen
// und die Seite im Mitarbeiter-Bereich einhängen.

export const TE_BUCKET = 'employee-documents'
export const TE_BASIS = '_teamevents'
/** Gemeinsamer Präfix ALLER Teamevent-Zeilen (Ordner, Fotos, Texte,
 *  Teilnehmende, Checklisten) — damit eine LIKE Abfrage alles liefert. */
export const TE_PREFIX = '__teamevent_'
export const TE_ORDNER_PREFIX = '__teamevent__'
export const TE_FOTO_PREFIX = '__teamevent_foto__'
export const TE_ANCHOR = '1970-01-01'
export const TE_MAX_BYTES = 30 * 1024 * 1024

/** Organisatorin der Teamevents: verwaltet Ordner, Sichtbarkeit,
 *  Teilnehmende, Infotexte und sieht als Einzige die Ausweis und
 *  Allergieangaben aller Teilnehmenden sowie ihre Admin Checkliste. Die
 *  Admin Rolle allein reicht bewusst nicht (wie bei den Finanzen). */
export const TE_ORGANISATORIN = 'Bianka Fitos'
export const istOrganisatorin = (fullName: string | null | undefined) => (fullName ?? '') === TE_ORGANISATORIN

/** Freigabe der Teamevent Seiten: 'organisatorin' = nur Bianka,
 *  'admins' = alle Admins, 'alle' = das ganze Team (seit 8. Oktober 2026).
 *  Die Sichtbarkeit pro Ordner und der Schutz der persönlichen Daten
 *  gelten unabhängig davon. */
export const TE_FREIGABE: 'organisatorin' | 'admins' | 'alle' = 'alle'
export function hatTeameventZugang(role: string | null | undefined, fullName: string | null | undefined): boolean {
  if (istOrganisatorin(fullName)) return true
  if (TE_FREIGABE === 'alle') return role === 'admin' || role === 'employee'
  if (TE_FREIGABE === 'admins') return role === 'admin'
  return false
}

export const TE_START_ORDNER: Array<{ slug: string; name: string; datum: string | null }> = [
  { slug: 'europapark-2026', name: 'Europapark 2026', datum: null },
]

/** Sichtbarkeit eines Ordners: 'alle' = ganzes Team, sonst Profil-IDs.
 *  Die Organisatorin sieht immer alle Ordner. */
export type TeSichtbar = 'alle' | string[]
export type TeOrdner = { slug: string; name: string; datum: string | null; erstelltVon: string; erstelltAm: string; sichtbar: TeSichtbar }

export function darfOrdnerSehen(o: TeOrdner, viewerId: string, verwaltet: boolean): boolean {
  return verwaltet || o.sichtbar === 'alle' || o.sichtbar.includes(viewerId)
}
export function sichtbarBereinigen(v: unknown): TeSichtbar {
  if (!Array.isArray(v)) return 'alle'
  const ids = v.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{8,64}$/i.test(x))
  return Array.from(new Set(ids)).slice(0, 200)
}
export type TeFoto = {
  id: string
  slug: string
  datum: string            // Upload-Datum YYYY-MM-DD (Zürich)
  name: string             // Original-Dateiname
  mime: string
  bytes: number
  von: string
  am: string               // ISO
  thumb: boolean           // Vorschaubild vorhanden
  /** Beschreibung der hochladenden Person (optional, bis 300 Zeichen) */
  beschreibung: string
}

/** Einleitung oben im Fotoalbum eines Anlasses. */
export function fotoalbumIntro(o: Pick<TeOrdner, 'slug' | 'name'>): string {
  const schluss = 'Lade gern deine Fotos vom Anlass hoch, damit auch die anderen im Team sie als Erinnerung sehen können. Die Fotos sind nur hier auf dem Portal für die Mitarbeitenden der Praxis zugänglich.'
  if (o.slug === 'europapark-2026') return `Das ist der Fotoordner unseres Ausflugs in den Europapark im Oktober 2026. ${schluss}`
  return `Das ist der Fotoordner zu «${o.name}». ${schluss}`
}

/** LIKE Muster mit escaptem Unterstrich/Prozent (gleiches Muster wie im
 *  übrigen Portal; Bereichsabfragen mit Sonderzeichen wären von der
 *  Datenbank Kollation abhängig). */
export const escLike = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`)

/** Titelbilder: von der Organisatorin hochgeladen (fester Pfad im Bucket),
 *  sonst die mitgelieferte Illustration (für Ordner ohne Illustration das
 *  Ordnersymbol). */
export type TeTitelbildZiel = 'ordner' | 'anweisungen'
export const titelbildPfad = (slug: string, ziel: TeTitelbildZiel) => `${TE_BASIS}/${slug}/cover/${ziel}.jpg`
export const TE_ILLUSTRATION: Record<string, Record<TeTitelbildZiel, string>> = {
  'europapark-2026': { ordner: '/teamevents/europapark.svg', anweisungen: '/teamevents/anweisungen.svg' },
}
export const illustration = (slug: string, ziel: TeTitelbildZiel): string | null => TE_ILLUSTRATION[slug]?.[ziel] ?? (ziel === 'anweisungen' ? '/teamevents/anweisungen.svg' : null)

export function slugify(name: string): string {
  const map: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue' }
  return name.toLowerCase()
    .replace(/[äöü]/g, c => map[c] ?? c)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export const sicherName = (n: string) => (n.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(0, 80) || 'foto')
export const fotoPfad = (slug: string, datum: string, id: string, name: string) => `${TE_BASIS}/${slug}/${datum}/orig/${id}_${sicherName(name)}`
export const thumbPfad = (slug: string, datum: string, id: string) => `${TE_BASIS}/${slug}/${datum}/thumb/${id}.jpg`
export const fotoKey = (slug: string, id: string) => `${TE_FOTO_PREFIX}${slug}__${id}`

export const istBild = (name: string, mime: string) =>
  mime.startsWith('image/') || /\.(heic|heif|jpe?g|png|gif|webp|avif|bmp|tiff?)$/i.test(name)

export function parseOrdner(rows: Array<{ user_full_name: string; schedule_date: string; comment: string }>): TeOrdner[] {
  const out: TeOrdner[] = []
  for (const r of rows) {
    if (!r.user_full_name.startsWith(TE_ORDNER_PREFIX) || r.user_full_name.startsWith(TE_FOTO_PREFIX)) continue
    try {
      const j = JSON.parse(r.comment) as Partial<TeOrdner>
      if (!j.name) continue
      out.push({
        slug: r.user_full_name.slice(TE_ORDNER_PREFIX.length),
        name: j.name, datum: j.datum ?? null,
        erstelltVon: j.erstelltVon ?? '', erstelltAm: j.erstelltAm ?? '',
        sichtbar: sichtbarBereinigen(j.sichtbar),
      })
    } catch { /* kaputte Zeile überspringen */ }
  }
  return out
}

export function parseFotos(rows: Array<{ user_full_name: string; schedule_date: string; comment: string }>): TeFoto[] {
  const out: TeFoto[] = []
  for (const r of rows) {
    if (!r.user_full_name.startsWith(TE_FOTO_PREFIX)) continue
    const rest = r.user_full_name.slice(TE_FOTO_PREFIX.length)
    const sep = rest.lastIndexOf('__')
    if (sep <= 0) continue
    try {
      const j = JSON.parse(r.comment) as Partial<TeFoto>
      if (!j.name) continue
      out.push({
        id: rest.slice(sep + 2), slug: rest.slice(0, sep), datum: r.schedule_date.slice(0, 10),
        name: j.name, mime: j.mime ?? 'application/octet-stream', bytes: typeof j.bytes === 'number' ? j.bytes : 0,
        von: j.von ?? '', am: j.am ?? '', thumb: !!j.thumb,
        beschreibung: typeof j.beschreibung === 'string' ? j.beschreibung.trim().slice(0, 300) : '',
      })
    } catch { /* überspringen */ }
  }
  return out.sort((a, b) => b.datum.localeCompare(a.datum) || b.am.localeCompare(a.am))
}

export function fmtBytes(b: number): string {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
  if (b >= 1024) return `${Math.round(b / 1024)} KB`
  return `${b} B`
}

const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
/** «Montag, 06.10.2026» */
export function datumLang(d: string): string {
  const dt = new Date(`${d}T00:00:00`)
  return `${WOCHENTAGE[dt.getDay()]}, ${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`
}
export const datumKurz = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`
