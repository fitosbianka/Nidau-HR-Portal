// Serverseitiges Laden der Teamevent-Ordner und Fotos (Admin-Client), mit
// Sichtbarkeit pro Ordner. Vorschaubilder als signierte Links (1 Stunde).

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  TE_BUCKET, TE_PREFIX, TE_ORDNER_PREFIX, TE_ANCHOR, TE_START_ORDNER, thumbPfad, titelbildPfad, darfOrdnerSehen, escLike,
  parseOrdner, parseFotos, type TeOrdner, type TeFoto,
} from './teamevents'

/** cover / coverAnweisungen = hochgeladene Titelbilder (signiert, 1 Stunde), sonst null. */
export type OrdnerUebersicht = TeOrdner & { anzahl: number; neuestes: string | null; vorschau: string | null; cover: string | null; coverAnweisungen: string | null }
export type GalerieFoto = TeFoto & { vorschauUrl: string | null }
/** verwaltet = Organisatorin (sieht alle Ordner, unabhängig von der Sichtbarkeit). */
export type Viewer = { id: string; verwaltet: boolean }
export type TeamPerson = { id: string; full_name: string }

export type Row = { user_full_name: string; schedule_date: string; comment: string }

/** Alle Teamevent-Zeilen (Ordner, Fotos, Texte, Teilnehmende, Checklisten).
 *  LIKE mit escaptem Unterstrich wie im übrigen Portal; ein Fehler wird
 *  gemeldet statt als leere Liste verschluckt. */
export async function ladeTeameventRows(admin: SupabaseClient, slug?: string): Promise<Row[]> {
  // Mit slug nur die Zeilen dieses Anlasses (alle Schlüssel enthalten den Slug)
  const muster = slug ? `${escLike(TE_PREFIX)}%${escLike(slug)}%` : `${escLike(TE_PREFIX)}%`
  // Paginiert: ein Request liefert höchstens 1000 Zeilen, mit den Bingo
  // Fotos können es mehr sein; fehlende Zeilen hiessen fehlende Fotos.
  const out: Row[] = []
  for (let von = 0; ; von += 1000) {
    const { data, error } = await admin.from('zeiterfassung_comments')
      .select('user_full_name, schedule_date, comment')
      .like('user_full_name', muster)
      .order('user_full_name').order('schedule_date').range(von, von + 999)
    if (error) throw new Error(`Teamevents konnten nicht geladen werden: ${error.message}`)
    const rows = (data ?? []) as Row[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

async function signiere(admin: SupabaseClient, pfade: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (let i = 0; i < pfade.length; i += 100) {
    const { data } = await admin.storage.from(TE_BUCKET).createSignedUrls(pfade.slice(i, i + 100), 3600)
    for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl
  }
  return out
}

/** Aktive Mitarbeitende (für die Sichtbarkeits-Auswahl). */
export async function ladeTeam(admin: SupabaseClient): Promise<TeamPerson[]> {
  const { data } = await admin.from('profiles').select('id, full_name')
    .in('role', ['employee', 'admin']).eq('is_active', true).order('full_name')
  return (data ?? []) as TeamPerson[]
}

/** Ordner-Übersicht für eine Person; legt beim allerersten Aufruf die
 *  Startordner an — OHNE erneutes Lesen: Next.js dedupliziert identische
 *  GET-Anfragen innerhalb eines Seitenaufbaus, ein zweites Lesen gäbe das
 *  alte (leere) Ergebnis zurück und die Seite zeigte «Noch keine
 *  Teamevents», obwohl der Ordner existiert. */
export async function ladeTeamevents(admin: SupabaseClient, viewer: Viewer): Promise<OrdnerUebersicht[]> {
  const rows = await ladeTeameventRows(admin)
  const ordner = parseOrdner(rows)
  if (ordner.length === 0) {
    const am = new Date().toISOString()
    for (const s of TE_START_ORDNER) {
      const { error } = await admin.from('zeiterfassung_comments').upsert(
        {
          user_full_name: `${TE_ORDNER_PREFIX}${s.slug}`, schedule_date: TE_ANCHOR,
          comment: JSON.stringify({ name: s.name, datum: s.datum, erstelltVon: 'System', erstelltAm: am, sichtbar: 'alle' }),
          updated_at: am,
        },
        { onConflict: 'user_full_name,schedule_date' },
      )
      if (!error) ordner.push({ slug: s.slug, name: s.name, datum: s.datum, erstelltVon: 'System', erstelltAm: am, sichtbar: 'alle' })
    }
  }
  const sichtbare = ordner.filter(o => darfOrdnerSehen(o, viewer.id, viewer.verwaltet))
  const fotos = parseFotos(rows)
  const proOrdner = new Map<string, TeFoto[]>()
  for (const f of fotos) proOrdner.set(f.slug, [...(proOrdner.get(f.slug) ?? []), f])
  const vorschauJeSlug: Record<string, string> = {}
  for (const o of sichtbare) {
    const mitThumb = (proOrdner.get(o.slug) ?? []).find(f => f.thumb)
    if (mitThumb) vorschauJeSlug[o.slug] = thumbPfad(o.slug, mitThumb.datum, mitThumb.id)
  }
  const coverPfade = sichtbare.flatMap(o => [titelbildPfad(o.slug, 'ordner'), titelbildPfad(o.slug, 'anweisungen')])
  const urls = await signiere(admin, [...Object.values(vorschauJeSlug), ...coverPfade])
  return sichtbare
    .map(o => {
      const list = proOrdner.get(o.slug) ?? []
      return {
        ...o, anzahl: list.length, neuestes: list[0]?.datum ?? null,
        vorschau: vorschauJeSlug[o.slug] ? (urls[vorschauJeSlug[o.slug]] ?? null) : null,
        cover: urls[titelbildPfad(o.slug, 'ordner')] ?? null,
        coverAnweisungen: urls[titelbildPfad(o.slug, 'anweisungen')] ?? null,
      }
    })
    .sort((a, b) => (b.datum ?? b.erstelltAm).localeCompare(a.datum ?? a.erstelltAm) || a.name.localeCompare(b.name, 'de-CH'))
}

/** Ein einzelner Ordner mit Kennzahlen — null, wenn es ihn nicht gibt oder
 *  die Person ihn nicht sehen darf. */
export async function ladeOrdnerUebersicht(admin: SupabaseClient, slug: string, viewer: Viewer): Promise<OrdnerUebersicht | null> {
  const alle = await ladeTeamevents(admin, viewer)
  return alle.find(o => o.slug === slug) ?? null
}

/** Galerie eines Ordners — null, wenn es ihn nicht gibt oder die Person ihn nicht sehen darf. */
export async function ladeGalerie(admin: SupabaseClient, slug: string, viewer: Viewer): Promise<{ ordner: TeOrdner; fotos: GalerieFoto[] } | null> {
  const rows = await ladeTeameventRows(admin, slug)
  const ordner = parseOrdner(rows).find(o => o.slug === slug)
  if (!ordner || !darfOrdnerSehen(ordner, viewer.id, viewer.verwaltet)) return null
  const fotos = parseFotos(rows).filter(f => f.slug === slug)
  const urls = await signiere(admin, fotos.filter(f => f.thumb).map(f => thumbPfad(slug, f.datum, f.id)))
  return {
    ordner,
    fotos: fotos.map(f => ({ ...f, vorschauUrl: f.thumb ? (urls[thumbPfad(slug, f.datum, f.id)] ?? null) : null })),
  }
}
