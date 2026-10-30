'use server'

// Ausweisdaten (ID / Reisepass): STRENG PERSÖNLICH. Jede Aktion prüft
// serverseitig: die angemeldete Person darf nur IHRE EIGENEN Daten lesen
// und ändern — die Organisatorin (Bianka) die aller Mitarbeitenden. Andere
// Admins haben KEINEN Zugriff. Die Profil ID aus dem Browser wird immer
// gegen die Session geprüft. Nummer, Ablaufdatum und Bilder werden
// verschlüsselt abgelegt (teamevent-geheim.ts); Bilder gehen durch den
// Server (kein direkter Upload in den Bucket) und werden über die geprüfte
// Route /api/ausweis-bild ausgeliefert.

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { TE_BUCKET, hatTeameventZugang, istOrganisatorin, istBild } from '@/lib/teamevents'
import { AUSWEIS_ANCHOR, AUSWEIS_MAX_BYTES, ausweisKey, type Ausweis, type AusweisArt, type AusweisBild, type AusweisSeite } from '@/lib/ausweise'
import { ladeAusweis } from '@/lib/ausweise-data'
import { EP_FRIST_EINGABE } from '@/lib/teamevent-europapark'
import { fristAbgelaufen } from '@/lib/teamevent-programm'
import { parseAusweisGeheim, ausweisZuObjekt, bildPfad, verschluesselBytes } from '@/lib/teamevent-geheim'

const UUID_RE = /^[0-9a-f-]{8,64}$/i
const ID_RE = /^[a-z0-9]{8,20}$/
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/

type Admin = Awaited<ReturnType<typeof createAdminClient>>
type Ctx = { admin: Admin; userId: string; organisatorin: boolean; name: string }

async function requireNutzer(): Promise<Ctx> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (!hatTeameventZugang(p?.role, p?.full_name)) throw new Error('Keine Berechtigung')
  return { admin: await createAdminClient(), userId: user.id, organisatorin: istOrganisatorin(p?.full_name), name: p?.full_name ?? 'Unbekannt' }
}

/** Kernregel: nur die eigene Person oder die Organisatorin. */
function darf(ctx: Ctx, profileId: string): boolean {
  return UUID_RE.test(profileId) && (ctx.organisatorin || ctx.userId === profileId)
}
const KEIN_ZUGRIFF = { error: 'Keine Berechtigung für diese Ausweisdaten.' }
/** Nach dem Eingabeschluss (Teamevent Europapark) darf nur noch die
 *  Organisatorin Ausweisdaten ändern; lesen bleibt für die Person möglich. */
const GESCHLOSSEN = { error: 'Die Eingabe der Ausweisdaten ist seit 16. Oktober, 20.00 Uhr geschlossen. Die Vorregistrierung beim Hotel muss nun selbst gemacht werden.' }
const geschlossenFuer = (ctx: Ctx) => !ctx.organisatorin && fristAbgelaufen(EP_FRIST_EINGABE, new Date().toISOString())

async function ladeRoh(admin: Admin, profileId: string): Promise<Ausweis> {
  const { data, error } = await admin.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', ausweisKey(profileId)).eq('schedule_date', AUSWEIS_ANCHOR).maybeSingle()
  if (error) throw new Error(`Ausweisdaten konnten nicht geladen werden: ${error.message}`)
  return parseAusweisGeheim(profileId, (data as { comment: string } | null)?.comment)
}

async function speichern(ctx: Ctx, a: Ausweis) {
  const am = new Date().toISOString()
  const { error } = await ctx.admin.from('zeiterfassung_comments').upsert(
    { user_full_name: ausweisKey(a.profileId), schedule_date: AUSWEIS_ANCHOR, comment: JSON.stringify(ausweisZuObjekt(a, am, ctx.name)), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  return { success: true as const }
}

/** Eigene Ausweisdaten (oder als Organisatorin die einer Mitarbeiterin) lesen. */
export async function ausweisDetails(profileId: string) {
  const ctx = await requireNutzer()
  if (!darf(ctx, profileId)) return KEIN_ZUGRIFF
  try { return { ausweis: await ladeAusweis(ctx.admin, profileId) } }
  catch (e) { return { error: e instanceof Error ? e.message : 'Fehler beim Laden.' } }
}

/** Art, Nummer und Ablaufdatum speichern (Bilder bleiben unverändert). */
export async function ausweisSpeichern(profileId: string, e: { art: AusweisArt | null; nummer: string; ablauf: string }) {
  const ctx = await requireNutzer()
  if (!darf(ctx, profileId)) return KEIN_ZUGRIFF
  if (geschlossenFuer(ctx)) return GESCHLOSSEN
  const nummer = (e.nummer ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
  if (nummer && !/^[A-Za-z0-9 .\-/]+$/.test(nummer)) return { error: 'Die Nummer darf nur Buchstaben, Zahlen, Punkt, Bindestrich und Schrägstrich enthalten.' }
  const ablauf = (e.ablauf ?? '').trim()
  if (ablauf && !DATUM_RE.test(ablauf)) return { error: 'Bitte ein gültiges Ablaufdatum wählen.' }
  const art: AusweisArt | null = e.art === 'id' || e.art === 'pass' ? e.art : null
  if ((nummer || ablauf) && !art) return { error: 'Bitte wählen, ob es die Identitätskarte oder der Reisepass ist.' }
  let a: Ausweis
  try { a = await ladeRoh(ctx.admin, profileId) } catch (err) { return { error: err instanceof Error ? err.message : 'Fehler beim Laden.' } }
  return speichern(ctx, { ...a, art, nummer: nummer || null, ablauf: ablauf || null })
}

/** Bild hochladen: Datei kommt als FormData (Feld «datei», optional
 *  «seite»), wird serverseitig verschlüsselt und unter dem Pfad der Person
 *  abgelegt. Höchstens 6 Bilder pro Ausweis. */
export async function ausweisBildHochladen(profileId: string, form: FormData) {
  const ctx = await requireNutzer()
  if (!darf(ctx, profileId)) return KEIN_ZUGRIFF
  if (geschlossenFuer(ctx)) return GESCHLOSSEN
  const datei = form.get('datei')
  if (!(datei instanceof File)) return { error: 'Keine Datei erhalten.' }
  const name = (datei.name || 'ausweis.jpg').slice(0, 120)
  const mime = (datei.type || 'application/octet-stream').slice(0, 80)
  if (!istBild(name, mime)) return { error: 'Bitte nur Bilder hochladen (JPG, PNG, HEIC, WebP).' }
  if (!(datei.size > 0) || datei.size > AUSWEIS_MAX_BYTES) return { error: 'Das Bild ist zu gross, höchstens 20 MB.' }
  const s = form.get('seite')
  const seite: AusweisSeite | null = s === 'vorne' || s === 'hinten' || s === 'daten' ? s : null
  let a: Ausweis
  try { a = await ladeRoh(ctx.admin, profileId) } catch (err) { return { error: err instanceof Error ? err.message : 'Fehler beim Laden.' } }
  if (a.bilder.length >= 6) return { error: 'Es sind höchstens 6 Bilder pro Ausweis möglich, bitte zuerst ein altes Bild löschen.' }
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const bild: AusweisBild = { id, name, mime, bytes: datei.size, am: new Date().toISOString(), seite, enc: true }
  let chiffrat: Buffer
  try { chiffrat = verschluesselBytes(new Uint8Array(await datei.arrayBuffer())) } catch (err) { return { error: err instanceof Error ? err.message : 'Verschlüsselung fehlgeschlagen.' } }
  const { error } = await ctx.admin.storage.from(TE_BUCKET).upload(bildPfad(profileId, bild), chiffrat, { contentType: 'application/octet-stream', upsert: true })
  if (error) return { error: `Upload fehlgeschlagen: ${error.message}` }
  return speichern(ctx, { ...a, bilder: [...a.bilder, bild] })
}

/** Ausweisbild löschen (Datei und Eintrag). */
export async function ausweisBildLoeschen(profileId: string, id: string) {
  const ctx = await requireNutzer()
  if (!darf(ctx, profileId)) return KEIN_ZUGRIFF
  if (geschlossenFuer(ctx)) return GESCHLOSSEN
  if (!ID_RE.test(id)) return { error: 'Ungültige Angaben.' }
  let a: Ausweis
  try { a = await ladeRoh(ctx.admin, profileId) } catch (err) { return { error: err instanceof Error ? err.message : 'Fehler beim Laden.' } }
  const b = a.bilder.find(x => x.id === id)
  if (!b) return { error: 'Bild nicht gefunden.' }
  await ctx.admin.storage.from(TE_BUCKET).remove([bildPfad(profileId, b)])
  return speichern(ctx, { ...a, bilder: a.bilder.filter(x => x.id !== id) })
}

/** Alle Ausweisdaten einer Person löschen (Nummer, Datum, Bilder). */
export async function ausweisLoeschen(profileId: string) {
  const ctx = await requireNutzer()
  if (!darf(ctx, profileId)) return KEIN_ZUGRIFF
  if (geschlossenFuer(ctx)) return GESCHLOSSEN
  let a: Ausweis
  try { a = await ladeRoh(ctx.admin, profileId) } catch (err) { return { error: err instanceof Error ? err.message : 'Fehler beim Laden.' } }
  if (a.bilder.length > 0) await ctx.admin.storage.from(TE_BUCKET).remove(a.bilder.map(b => bildPfad(profileId, b)))
  const { error } = await ctx.admin.from('zeiterfassung_comments').delete()
    .eq('user_full_name', ausweisKey(profileId)).eq('schedule_date', AUSWEIS_ANCHOR)
  if (error) return { error: error.message }
  return { success: true as const }
}
