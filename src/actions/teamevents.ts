'use server'

// Teamevent-Fotos: Ordner anlegen, Sichtbarkeit setzen, Fotos hochladen
// (signierte Upload-URLs, direkt vom Browser in den Storage), registrieren,
// öffnen/herunterladen, löschen. Zugriff siehe TE_FREIGABE in
// src/lib/teamevents.ts. Jede Aktion prüft serverseitig, ob die Person den
// Ordner überhaupt sehen darf (die Organisatorin immer); Ordner verwalten
// darf nur die Organisatorin.

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { zurichToday } from '@/lib/salary-sync'
import {
  TE_BUCKET, TE_ORDNER_PREFIX, TE_ANCHOR, TE_MAX_BYTES, hatTeameventZugang, istOrganisatorin, escLike,
  slugify, fotoPfad, thumbPfad, titelbildPfad, fotoKey, istBild, parseOrdner, parseFotos, darfOrdnerSehen, sichtbarBereinigen, sicherName,
  type TeFoto, type TeOrdner, type TeSichtbar, type TeTitelbildZiel,
} from '@/lib/teamevents'
import { hatBingo, bingoRolle } from '@/lib/teamevent-bingo'
import { ladeEinstellungen } from '@/lib/teamevent-bingo-data'
import { ladeTeameventRows } from '@/lib/teamevents-data'

async function requireZugang() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (!hatTeameventZugang(p?.role, p?.full_name)) throw new Error('Keine Berechtigung')
  return { admin: await createAdminClient(), verwaltet: istOrganisatorin(p?.full_name), userId: user.id, name: p?.full_name ?? 'Unbekannt', role: p?.role ?? null }
}

/** Fotoalbum eines Anlasses mit Fotobingo: für alle Mitarbeitenden offen
 *  (hochladen, anschauen, herunterladen), ausser die Organisatorin hat es
 *  gesperrt; Admins und die Organisatorin kommen immer hinein. null = in
 *  Ordnung, sonst die Meldung. */
async function albumSperre(admin: Admin, slug: string, role: string | null, name: string): Promise<string | null> {
  if (!hatBingo(slug)) return null
  const r = bingoRolle(role, name)
  if (r.verwaltet || r.admin) return null
  const e = await ladeEinstellungen(admin, slug)
  return e.albumGesperrt ? 'Das Fotoalbum ist zurzeit gesperrt.' : null
}

const SLUG_RE = /^[a-z0-9-]{2,60}$/
const ID_RE = /^[a-z0-9]{8,20}$/
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/
// Kein revalidatePath: die Seiten sind force-dynamic, die Komponenten rufen
// nach Änderungen router.refresh() auf. So wird beim Hochladen vieler Fotos
// nicht nach jedem Bild die ganze Galerie serverseitig neu gerendert.
const neueId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const sauberBeschreibung = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 300) : '')

type Row = { user_full_name: string; schedule_date: string; comment: string }
type Admin = Awaited<ReturnType<typeof createAdminClient>>

async function ladeOrdner(admin: Admin, slug: string): Promise<TeOrdner | null> {
  const { data, error } = await admin.from('zeiterfassung_comments').select('user_full_name, schedule_date, comment')
    .eq('user_full_name', `${TE_ORDNER_PREFIX}${slug}`).eq('schedule_date', TE_ANCHOR).maybeSingle()
  if (error) throw new Error(`Ordner konnte nicht geladen werden: ${error.message}`)
  if (!data) return null
  return parseOrdner([data as Row])[0] ?? null
}

/** Ordner laden und prüfen, dass die Person ihn sehen darf. */
async function ordnerFuer(admin: Admin, slug: string, userId: string, verwaltet: boolean): Promise<TeOrdner | null> {
  if (!SLUG_RE.test(slug)) return null
  const o = await ladeOrdner(admin, slug)
  if (!o || !darfOrdnerSehen(o, userId, verwaltet)) return null
  return o
}

async function ladeFoto(admin: Admin, slug: string, id: string): Promise<TeFoto | null> {
  const { data } = await admin.from('zeiterfassung_comments').select('user_full_name, schedule_date, comment')
    .eq('user_full_name', fotoKey(slug, id)).limit(1)
  const list = parseFotos((data ?? []) as Row[])
  return list[0] ?? null
}

/** Sichtbarkeit aus dem Browser prüfen: 'alle' oder eine Liste aktiver Profil-IDs. */
async function sichtbarPruefen(admin: Admin, v: unknown): Promise<TeSichtbar | { error: string }> {
  if (v === 'alle') return 'alle'
  const ids = sichtbarBereinigen(v)
  if (ids === 'alle' || ids.length === 0) return { error: 'Bitte mindestens eine Person auswählen oder «Alle im Team» wählen.' }
  const { data } = await admin.from('profiles').select('id').in('id', ids)
  const bekannt = new Set(((data ?? []) as Array<{ id: string }>).map(p => p.id))
  const gueltig = ids.filter(id => bekannt.has(id))
  if (gueltig.length === 0) return { error: 'Keine gültige Person ausgewählt.' }
  return gueltig
}

/** Neuer Teamevent-Ordner (nur Organisatorin). */
export async function teameventAnlegen(name: string, datum: string | null, sichtbar: TeSichtbar = 'alle') {
  const { admin, verwaltet, name: von } = await requireZugang()
  if (!verwaltet) return { error: 'Nur die Organisatorin kann Ordner anlegen.' }
  const n = name.trim().slice(0, 80)
  if (n.length < 2) return { error: 'Bitte einen Namen eingeben (z. B. «Europapark 2026»).' }
  if (datum && !DATUM_RE.test(datum)) return { error: 'Bitte ein gültiges Datum wählen.' }
  const slug = slugify(n)
  if (!SLUG_RE.test(slug)) return { error: 'Der Name ergibt keinen gültigen Ordnernamen, bitte Buchstaben oder Zahlen verwenden.' }
  const s = await sichtbarPruefen(admin, sichtbar)
  if (typeof s === 'object' && !Array.isArray(s)) return s
  let bestehend: TeOrdner | null
  try { bestehend = await ladeOrdner(admin, slug) } catch (e) { return { error: e instanceof Error ? e.message : 'Fehler beim Prüfen.' } }
  if (bestehend) return { error: `Einen Ordner «${bestehend.name}» gibt es schon, er ist in der Übersicht zu finden.` }
  const am = new Date().toISOString()
  const { error } = await admin.from('zeiterfassung_comments').insert({
    user_full_name: `${TE_ORDNER_PREFIX}${slug}`, schedule_date: TE_ANCHOR,
    comment: JSON.stringify({ name: n, datum: datum || null, erstelltVon: von, erstelltAm: am, sichtbar: s }),
    updated_at: am,
  })
  if (error) return { error: error.message }
  return { success: true, slug }
}

/** Sichtbarkeit eines Ordners ändern (nur Organisatorin). */
export async function sichtbarkeitSetzen(slug: string, sichtbar: TeSichtbar) {
  const { admin, verwaltet } = await requireZugang()
  if (!verwaltet) return { error: 'Nur die Organisatorin kann die Sichtbarkeit ändern.' }
  if (!SLUG_RE.test(slug)) return { error: 'Ungültiger Ordner.' }
  const s = await sichtbarPruefen(admin, sichtbar)
  if (typeof s === 'object' && !Array.isArray(s)) return s
  let o: TeOrdner | null
  try { o = await ladeOrdner(admin, slug) } catch (e) { return { error: e instanceof Error ? e.message : 'Fehler beim Laden.' } }
  if (!o) return { error: 'Ordner nicht gefunden.' }
  const am = new Date().toISOString()
  const { error } = await admin.from('zeiterfassung_comments').update({
    comment: JSON.stringify({ name: o.name, datum: o.datum, erstelltVon: o.erstelltVon, erstelltAm: o.erstelltAm, sichtbar: s }),
    updated_at: am,
  }).eq('user_full_name', `${TE_ORDNER_PREFIX}${slug}`).eq('schedule_date', TE_ANCHOR)
  if (error) return { error: error.message }
  return { success: true, sichtbar: s }
}

/** Titelbild für die Ordnerkachel oder den Unterordner Anweisungen setzen
 *  (nur Organisatorin). Datei als FormData Feld «datei», wird mit festem
 *  Pfad abgelegt und ersetzt das bisherige Bild. */
export async function titelbildHochladen(slug: string, ziel: TeTitelbildZiel, form: FormData) {
  const { admin, verwaltet } = await requireZugang()
  if (!verwaltet) return { error: 'Nur die Organisatorin kann Titelbilder setzen.' }
  if (!SLUG_RE.test(slug) || (ziel !== 'ordner' && ziel !== 'anweisungen')) return { error: 'Ungültige Angaben.' }
  let o: TeOrdner | null
  try { o = await ladeOrdner(admin, slug) } catch (e) { return { error: e instanceof Error ? e.message : 'Fehler beim Laden.' } }
  if (!o) return { error: 'Ordner nicht gefunden.' }
  const datei = form.get('datei')
  if (!(datei instanceof File)) return { error: 'Keine Datei erhalten.' }
  if (!istBild(datei.name || 'bild.jpg', datei.type || '')) return { error: 'Bitte nur Bilder hochladen (JPG, PNG, WebP).' }
  if (!(datei.size > 0) || datei.size > TE_MAX_BYTES) return { error: 'Das Bild ist zu gross, höchstens 30 MB.' }
  const { error } = await admin.storage.from(TE_BUCKET).upload(titelbildPfad(slug, ziel), Buffer.from(await datei.arrayBuffer()), { contentType: datei.type || 'image/jpeg', upsert: true })
  if (error) return { error: `Upload fehlgeschlagen: ${error.message}` }
  return { success: true as const }
}

/** Titelbild entfernen, danach erscheint wieder die Illustration (nur Organisatorin). */
export async function titelbildEntfernen(slug: string, ziel: TeTitelbildZiel) {
  const { admin, verwaltet } = await requireZugang()
  if (!verwaltet) return { error: 'Nur die Organisatorin kann Titelbilder entfernen.' }
  if (!SLUG_RE.test(slug) || (ziel !== 'ordner' && ziel !== 'anweisungen')) return { error: 'Ungültige Angaben.' }
  const { error } = await admin.storage.from(TE_BUCKET).remove([titelbildPfad(slug, ziel)])
  if (error) return { error: error.message }
  return { success: true as const }
}

/** Leeren Ordner entfernen (nur Organisatorin). */
export async function teameventLoeschen(slug: string) {
  const { admin, verwaltet } = await requireZugang()
  if (!verwaltet) return { error: 'Nur die Organisatorin kann Ordner entfernen.' }
  if (!SLUG_RE.test(slug)) return { error: 'Ungültiger Ordner.' }
  const { data, error: e0 } = await admin.from('zeiterfassung_comments').select('user_full_name')
    .like('user_full_name', `${escLike(fotoKey(slug, ''))}%`).limit(1)
  if (e0) return { error: e0.message }
  if ((data ?? []).length > 0) return { error: 'Der Ordner enthält noch Fotos, bitte zuerst die Fotos löschen.' }
  const { error } = await admin.from('zeiterfassung_comments').delete()
    .eq('user_full_name', `${TE_ORDNER_PREFIX}${slug}`).eq('schedule_date', TE_ANCHOR)
  if (error) return { error: error.message }
  return { success: true }
}

/** Schritt 1 des Uploads: Prüfung und signierte Upload-URLs (Original und
 *  optional Vorschaubild). Der Browser lädt direkt in den Storage. */
export async function fotoUploadVorbereiten(slug: string, dateiname: string, mime: string, bytes: number, mitThumb: boolean) {
  const { admin, userId, verwaltet, role, name: wer } = await requireZugang()
  if (!(await ordnerFuer(admin, slug, userId, verwaltet))) return { error: 'Ordner nicht gefunden.' }
  const sperre = await albumSperre(admin, slug, role, wer)
  if (sperre) return { error: sperre }
  const name = (dateiname || 'foto').slice(0, 120)
  if (!istBild(name, mime || '')) return { error: `«${name}» ist kein Bild. Bitte nur Fotos hochladen (JPG, PNG, HEIC, WebP).` }
  if (!(bytes > 0) || bytes > TE_MAX_BYTES) return { error: `«${name}» ist zu gross, höchstens 30 MB pro Foto.` }
  const id = neueId()
  const datum = zurichToday()
  const pfad = fotoPfad(slug, datum, id, name)
  const { data: orig, error } = await admin.storage.from(TE_BUCKET).createSignedUploadUrl(pfad)
  if (error || !orig) return { error: `Upload konnte nicht vorbereitet werden: ${error?.message ?? 'unbekannt'}` }
  let thumb: { path: string; token: string } | null = null
  if (mitThumb) {
    const { data: t } = await admin.storage.from(TE_BUCKET).createSignedUploadUrl(thumbPfad(slug, datum, id))
    if (t) thumb = { path: t.path, token: t.token }
  }
  return { id, datum, orig: { path: orig.path, token: orig.token }, thumb }
}

/** Schritt 2: nach erfolgreichem Upload das Foto registrieren (Metazeile).
 *  Der Server prüft, dass die Datei wirklich im erwarteten Pfad liegt. */
export async function fotoRegistrieren(e: { slug: string; id: string; datum: string; name: string; mime: string; bytes: number; thumb: boolean; beschreibung?: string }) {
  const { admin, userId, verwaltet, name: von, role } = await requireZugang()
  if (!SLUG_RE.test(e.slug) || !ID_RE.test(e.id) || !DATUM_RE.test(e.datum)) return { error: 'Ungültige Angaben.' }
  if (!(await ordnerFuer(admin, e.slug, userId, verwaltet))) return { error: 'Ordner nicht gefunden.' }
  const sperre = await albumSperre(admin, e.slug, role, von)
  if (sperre) return { error: sperre }
  const pfad = fotoPfad(e.slug, e.datum, e.id, e.name)
  const dir = pfad.slice(0, pfad.lastIndexOf('/'))
  const { data: list } = await admin.storage.from(TE_BUCKET).list(dir, { search: `${e.id}_`, limit: 5 })
  if (!(list ?? []).some(f => `${dir}/${f.name}` === pfad)) return { error: `«${e.name}» ist im Speicher nicht angekommen, bitte nochmals hochladen.` }
  let thumb = false
  if (e.thumb) {
    const tp = thumbPfad(e.slug, e.datum, e.id)
    const { data: tl } = await admin.storage.from(TE_BUCKET).list(tp.slice(0, tp.lastIndexOf('/')), { search: `${e.id}.jpg`, limit: 2 })
    thumb = (tl ?? []).some(f => f.name === `${e.id}.jpg`)
  }
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    {
      user_full_name: fotoKey(e.slug, e.id), schedule_date: e.datum,
      comment: JSON.stringify({
        name: e.name.slice(0, 120), mime: (e.mime || 'application/octet-stream').slice(0, 80), bytes: Math.round(e.bytes), von, am: new Date().toISOString(), thumb,
        beschreibung: sauberBeschreibung(e.beschreibung),
      }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  return { success: true }
}

/** Signierter Link zum Öffnen (10 Minuten) oder Herunterladen eines Fotos. */
export async function fotoLink(slug: string, id: string, modus: 'ansicht' | 'download') {
  const { admin, userId, verwaltet, role, name } = await requireZugang()
  if (!SLUG_RE.test(slug) || !ID_RE.test(id)) return { error: 'Ungültige Angaben.' }
  if (!(await ordnerFuer(admin, slug, userId, verwaltet))) return { error: 'Ordner nicht gefunden.' }
  const sperre = await albumSperre(admin, slug, role, name)
  if (sperre) return { error: sperre }
  const foto = await ladeFoto(admin, slug, id)
  if (!foto) return { error: 'Foto nicht gefunden.' }
  const { data, error } = await admin.storage.from(TE_BUCKET)
    .createSignedUrl(fotoPfad(slug, foto.datum, id, foto.name), 600, modus === 'download' ? { download: foto.name } : undefined)
  if (error || !data) return { error: error?.message ?? 'Link konnte nicht erstellt werden.' }
  return { url: data.signedUrl, name: foto.name, mime: foto.mime }
}

/** Foto löschen — Organisatorin jedes, alle anderen nur ihre eigenen. */
export async function fotoLoeschen(slug: string, id: string) {
  const { admin, userId, verwaltet, name } = await requireZugang()
  if (!SLUG_RE.test(slug) || !ID_RE.test(id)) return { error: 'Ungültige Angaben.' }
  if (!(await ordnerFuer(admin, slug, userId, verwaltet))) return { error: 'Ordner nicht gefunden.' }
  const foto = await ladeFoto(admin, slug, id)
  if (!foto) return { error: 'Foto nicht gefunden.' }
  if (!verwaltet && foto.von !== name) return { error: 'Es können nur eigene Fotos gelöscht werden.' }
  await admin.storage.from(TE_BUCKET).remove([fotoPfad(slug, foto.datum, id, foto.name), thumbPfad(slug, foto.datum, id)])
  const { error } = await admin.from('zeiterfassung_comments').delete().eq('user_full_name', fotoKey(slug, id))
  if (error) return { error: error.message }
  return { success: true }
}

/** Beschreibung eines Fotos setzen oder ändern — wer es hochgeladen hat,
 *  oder die Organisatorin. */
export async function fotoBeschreibungSetzen(slug: string, id: string, text: string) {
  const { admin, userId, verwaltet, name, role } = await requireZugang()
  if (!SLUG_RE.test(slug) || !ID_RE.test(id)) return { error: 'Ungültige Angaben.' }
  if (!(await ordnerFuer(admin, slug, userId, verwaltet))) return { error: 'Ordner nicht gefunden.' }
  const sperre = await albumSperre(admin, slug, role, name)
  if (sperre) return { error: sperre }
  const { data } = await admin.from('zeiterfassung_comments').select('schedule_date, comment')
    .eq('user_full_name', fotoKey(slug, id)).limit(1).maybeSingle()
  const row = data as { schedule_date: string; comment: string } | null
  if (!row) return { error: 'Foto nicht gefunden.' }
  let alt: Record<string, unknown>
  try { alt = JSON.parse(row.comment) as Record<string, unknown> } catch { return { error: 'Foto nicht lesbar.' } }
  if (!verwaltet && alt.von !== name) return { error: 'Die Beschreibung kann nur ändern, wer das Foto hochgeladen hat.' }
  const beschreibung = sauberBeschreibung(text)
  const { error } = await admin.from('zeiterfassung_comments').update({ comment: JSON.stringify({ ...alt, beschreibung }), updated_at: new Date().toISOString() })
    .eq('user_full_name', fotoKey(slug, id)).eq('schedule_date', row.schedule_date)
  if (error) return { error: error.message }
  return { success: true as const, beschreibung }
}

/** Alle Fotos des Ordners als Liste signierter Links (1 Stunde) für den
 *  ZIP Download im Browser — für alle mit Zugang zum Ordner. */
export async function albumZipListe(slug: string) {
  const { admin, userId, verwaltet, role, name } = await requireZugang()
  if (!SLUG_RE.test(slug)) return { error: 'Ungültige Angaben.' }
  if (!(await ordnerFuer(admin, slug, userId, verwaltet))) return { error: 'Ordner nicht gefunden.' }
  const sperre = await albumSperre(admin, slug, role, name)
  if (sperre) return { error: sperre }
  const fotos = parseFotos(await ladeTeameventRows(admin, slug)).filter(f => f.slug === slug)
  const eintraege = fotos.map(f => ({ pfad: `${f.datum}/${f.id}_${sicherName(f.name)}`, speicher: fotoPfad(slug, f.datum, f.id, f.name) }))
  const urls: Record<string, string> = {}
  for (let i = 0; i < eintraege.length; i += 100) {
    const { data } = await admin.storage.from(TE_BUCKET).createSignedUrls(eintraege.slice(i, i + 100).map(x => x.speicher), 3600)
    for (const d of data ?? []) if (d.path && d.signedUrl) urls[d.path] = d.signedUrl
  }
  return { dateien: eintraege.filter(x => urls[x.speicher]).map(x => ({ pfad: x.pfad, url: urls[x.speicher] })) }
}
