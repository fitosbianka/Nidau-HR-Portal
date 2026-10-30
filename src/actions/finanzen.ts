'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { hatFinanzZugang } from '@/lib/finanzen/zugang'
import { verschluesseln } from '@/lib/finanzen/krypto'
import { decodeCsvBytes, parseUbsCsv, fuehreJahrZusammen, FinanzCsvError, type MonatsStatus } from '@/lib/finanzen/ubs-csv'
import {
  FINANZ_BUCKET, originalPfad, ladeJahresdatei, speichereJahresdatei,
  ladeKontos, speichereKonto, schreibeImportEintrag,
  speichereFinanzConfig, FINANZ_KATEGORIEN_KEY, FINANZ_REGELN_KEY, FINANZ_ZIEL_KEY, FINANZ_GEPRUEFT_KEY,
} from '@/lib/finanzen/speicher'
import {
  START_KATEGORIEN, START_REGELN, GRUPPEN_REIHENFOLGE, INTERN_ID, UNKLASSIERT_ID,
  kategorieVon, istGrosseBuchung, passtRegel, suchtextVorschlag,
  type Kategorie, type Regel, type Gruppe,
} from '@/lib/finanzen/kategorien'
import { ladeFinanzBestand, ladeRegeln, ladeGeprueft, ladeKategorien } from '@/lib/finanzen/daten'
import type { FinanzZiel } from '@/lib/finanzen/analyse'
import type { Buchung } from '@/lib/finanzen/types'

// Jede Finanz-Action prüft Admin-Rolle UND Namen (FINANZ_ZUGANG) —
// die Admin-Rolle allein reicht bewusst nicht.
async function requireFinanzZugang() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Keine Berechtigung')
  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (!hatFinanzZugang(p?.role, p?.full_name)) throw new Error('Keine Berechtigung')
  return { admin: await createAdminClient(), name: p?.full_name ?? '' }
}

/** Schritt 1: signierte Upload-URL für die Original-CSV (die Datei geht
 *  direkt vom Browser in den Storage — Server Actions sind auf ~1 MB
 *  begrenzt, die CSV darf nie als Ganzes durch eine Action reisen). */
export async function createFinanzUploadUrl(dateiname: string) {
  const { admin } = await requireFinanzZugang()
  const pfad = originalPfad(dateiname || 'kontoauszug.csv')
  const { data, error } = await admin.storage.from(FINANZ_BUCKET).createSignedUploadUrl(pfad)
  if (error || !data) return { error: `Upload konnte nicht vorbereitet werden: ${error?.message ?? 'unbekannt'}` }
  return { path: data.path, token: data.token }
}

/** Schritt 2: Datei aus dem Storage laden, auf dem Server parsen (das
 *  Server-Ergebnis ist massgebend), mit dem Bestand zusammenführen,
 *  Jahresdateien speichern und das Importprotokoll schreiben. */
export async function importUbsCsv(storagePath: string, kontoName?: string) {
  const { admin, name } = await requireFinanzZugang()
  if (!storagePath.startsWith('_finanzen/ubs/originale/')) return { error: 'Ungültiger Dateipfad.' }

  const { data: blob, error: dlErr } = await admin.storage.from(FINANZ_BUCKET).download(storagePath)
  if (dlErr || !blob) return { error: `Die Datei konnte nicht geladen werden: ${dlErr?.message ?? 'unbekannt'}` }
  const rohBytes = new Uint8Array(await blob.arrayBuffer())

  let parse
  try {
    parse = parseUbsCsv(decodeCsvBytes(rohBytes))
  } catch (e) {
    if (e instanceof FinanzCsvError) return { error: e.message }
    return { error: 'Die Datei konnte nicht gelesen werden.' }
  }

  // Die vom Browser hochgeladene KLARTEXT-CSV sofort verschlüsselt
  // überschreiben — im Storage bleibt kein Klartext-Original liegen
  const extraWarnungen: string[] = []
  {
    const { error: encErr } = await admin.storage.from(FINANZ_BUCKET).upload(
      storagePath,
      new Blob([new Uint8Array(verschluesseln(rohBytes))]),
      { upsert: true, contentType: 'application/octet-stream' },
    )
    if (encErr) extraWarnungen.push('Die Originaldatei konnte nicht verschlüsselt abgelegt werden — bitte den Import wiederholen.')
  }

  // Konto anlegen/aktualisieren (Name nur setzen, wenn neu oder mitgegeben)
  const kontos = await ladeKontos(admin)
  const bestehendes = kontos.find(k => k.kontoKey === parse.kontoKey)
  const kontoErr = await speichereKonto(admin, {
    kontoKey: parse.kontoKey,
    name: (kontoName?.trim() || bestehendes?.name || 'Geschäftskonto UBS'),
    iban: parse.iban || bestehendes?.iban || '',
  })
  if (kontoErr) return { error: kontoErr }

  const importId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const jahre = Array.from(new Set(Object.keys(parse.monate).map(m => parseInt(m.slice(0, 4), 10)))).sort()
  const statusGesamt: Record<string, MonatsStatus> = {}
  for (const jahr of jahre) {
    // gleiche Schreibsperre wie beim Umbuchen — Import und Zuordnung
    // können sich nicht gegenseitig überschreiben
    const saveErr = await mitSperre(`jahr|${parse.kontoKey}|${jahr}`, async () => {
      const bestehend = await ladeJahresdatei(admin, parse.kontoKey, jahr)
      const { datei, status } = fuehreJahrZusammen(bestehend, parse.kontoKey, jahr, parse, importId)
      Object.assign(statusGesamt, status)
      return speichereJahresdatei(admin, datei)
    })
    if (saveErr) return { error: `Jahr ${jahr} konnte nicht gespeichert werden: ${saveErr}` }
  }

  const einnahmenRp = parse.buchungen.reduce((s, b) => s + (b.betragRp > 0 ? b.betragRp : 0), 0)
  const ausgabenRp = parse.buchungen.reduce((s, b) => s + (b.betragRp < 0 ? -b.betragRp : 0), 0)
  await schreibeImportEintrag(admin, {
    importId,
    am: new Date().toISOString(),
    dateiname: storagePath.split('/').pop() ?? storagePath,
    kontoKey: parse.kontoKey,
    von: parse.von,
    bis: parse.bis,
    anzahl: parse.buchungen.length,
    einnahmenRp,
    ausgabenRp,
    abgleichOk: parse.saldoAbgleichOk,
    importiertVon: name,
    monate: Object.keys(statusGesamt).sort(),
  })

  revalidatePath('/admin/finanzen')
  return {
    success: true,
    kontoKey: parse.kontoKey,
    anzahl: parse.buchungen.length,
    vorgemerkt: parse.vorgemerkt,
    abgleichOk: parse.saldoAbgleichOk,
    warnungen: [...parse.warnungen, ...extraWarnungen],
    monate: statusGesamt,
  }
}

// ═══ Kategorien & Regeln ══════════════════════════════════════════════════

// Schreibsperre pro Ablage-Schlüssel: Lesen-Ändern-Schreiben derselben
// Jahresdatei (oder Konfigzeile) darf nie parallel laufen, sonst
// überschreibt der letzte Aufruf die Änderungen der anderen — genau so
// gingen beim schnellen Zuordnen in der Prüfliste Kategorien verloren.
// (Zweite Schutzschicht: der Client reiht seine Aufrufe zusätzlich auf.)
const finanzSperren: Map<string, Promise<unknown>> =
  (globalThis as { __finanzSperren?: Map<string, Promise<unknown>> }).__finanzSperren ??
  ((globalThis as { __finanzSperren?: Map<string, Promise<unknown>> }).__finanzSperren = new Map())

async function mitSperre<T>(schluessel: string, fn: () => Promise<T>): Promise<T> {
  const vorher = finanzSperren.get(schluessel) ?? Promise.resolve()
  const lauf = vorher.then(fn, fn)
  finanzSperren.set(schluessel, lauf.then(() => undefined, () => undefined))
  return lauf
}

const anzeigeText = (b: Buchung) =>
  [b.text1, b.text2, b.text3].map(t => t.trim()).filter(Boolean).join(' — ').slice(0, 200)

function pruefeKategorien(kategorien: Kategorie[]): string | null {
  if (kategorien.length === 0) return 'Mindestens eine Kategorie ist nötig.'
  const ids = new Set<string>()
  for (const k of kategorien) {
    if (!k.id || !k.name?.trim()) return 'Jede Kategorie braucht einen Namen.'
    if (ids.has(k.id)) return `Kategorie-ID doppelt: ${k.id}`
    ids.add(k.id)
    if (!GRUPPEN_REIHENFOLGE.includes(k.gruppe as Gruppe)) return `Ungültige Gruppe bei «${k.name}».`
  }
  if (!kategorien.some(k => k.id === INTERN_ID)) return 'Die Kategorie «Interne Umbuchung» darf nicht gelöscht werden.'
  return null
}

function pruefeRegeln(regeln: Regel[], kategorien: Kategorie[]): string | null {
  const katIds = new Set(kategorien.map(k => k.id))
  const ids = new Set<string>()
  for (const r of regeln) {
    if (!r.id) return 'Regel ohne ID.'
    if (ids.has(r.id)) return 'Regel-ID doppelt.'
    ids.add(r.id)
    if (!katIds.has(r.kategorieId)) return 'Eine Regel zeigt auf eine Kategorie, die es nicht (mehr) gibt.'
    if (!['einnahme', 'ausgabe', 'beide'].includes(r.richtung)) return 'Ungültige Richtung bei einer Regel.'
    if (typeof r.prioritaet !== 'number' || !isFinite(r.prioritaet)) return 'Ungültige Priorität bei einer Regel.'
    if (r.betragMin != null && r.betragMax != null && r.betragMin > r.betragMax) return 'Bei einer Regel ist «Betrag von» grösser als «Betrag bis».'
  }
  return null
}

/** Kategorien und Regeln zusammen speichern. Gelöschte Kategorien werden
 *  abgelehnt, solange noch eine Buchung von Hand darauf zeigt. */
export async function speichereKategorienUndRegeln(kategorien: Kategorie[], regeln: Regel[]) {
  const { admin } = await requireFinanzZugang()
  const katFehler = pruefeKategorien(kategorien)
  if (katFehler) return { error: katFehler }
  const regelFehler = pruefeRegeln(regeln, kategorien)
  if (regelFehler) return { error: regelFehler }

  const bestand = await ladeFinanzBestand(admin)
  const neueIds = new Set(kategorien.map(k => k.id))
  const geloescht = bestand.kategorien.filter(k => !neueIds.has(k.id))
  for (const k of geloescht) {
    let verwendet = false
    bestand.buchungenProKonto.forEach(bs => { if (bs.some(b => b.kategorieManuell === k.id)) verwendet = true })
    if (verwendet) return { error: `«${k.name}» kann nicht gelöscht werden — Buchungen sind von Hand dieser Kategorie zugeordnet.` }
  }

  const err = await mitSperre('regeln', async () => {
    const e1 = await speichereFinanzConfig(admin, FINANZ_KATEGORIEN_KEY, kategorien)
    if (e1) return e1
    return speichereFinanzConfig(admin, FINANZ_REGELN_KEY, regeln)
  })
  if (err) return { error: err }
  revalidatePath('/admin/finanzen')
  revalidatePath('/admin/finanzen/regeln')
  return { success: true }
}

/** Setzt die Regeln auf die Startregeln zurück und ergänzt fehlende
 *  Startkategorien (bestehende Kategorien und Handzuordnungen bleiben). */
export async function startregelnWiederherstellen() {
  const { admin } = await requireFinanzZugang()
  const err = await mitSperre('regeln', async () => {
    const kategorien = await ladeKategorien(admin)
    const vorhandene = new Set(kategorien.map(k => k.id))
    const ergaenzt = [...kategorien, ...START_KATEGORIEN.filter(k => !vorhandene.has(k.id))]
    const e1 = await speichereFinanzConfig(admin, FINANZ_KATEGORIEN_KEY, ergaenzt)
    if (e1) return e1
    return speichereFinanzConfig(admin, FINANZ_REGELN_KEY, START_REGELN)
  })
  if (err) return { error: err }
  revalidatePath('/admin/finanzen')
  revalidatePath('/admin/finanzen/regeln')
  return { success: true }
}

/** «Regel testen»: welche Buchungen der letzten 12 Monate würde diese Regel
 *  treffen? (Nur hier fliessen Buchungstexte — bewusst und auf Klick.) */
export async function regelTesten(entwurf: {
  suchtext: string; richtung: Regel['richtung']; betragMin: number | null; betragMax: number | null
}) {
  const { admin } = await requireFinanzZugang()
  const bestand = await ladeFinanzBestand(admin)
  const regel: Regel = { id: '_test', kategorieId: UNKLASSIERT_ID, prioritaet: 0, aktiv: true, ...entwurf }
  const grenze = new Date()
  grenze.setMonth(grenze.getMonth() - 12)
  const ab = grenze.toISOString().slice(0, 10)
  const treffer: Array<{ datum: string; betragRp: number; text: string }> = []
  let gesamt = 0
  bestand.buchungenProKonto.forEach(bs => {
    for (const b of bs) {
      if (b.buchungsdatum < ab) continue
      if (!passtRegel(b, regel)) continue
      gesamt += 1
      if (treffer.length < 50) treffer.push({ datum: b.buchungsdatum, betragRp: b.betragRp, text: anzeigeText(b) })
    }
  })
  treffer.sort((a, b) => b.datum.localeCompare(a.datum))
  return { treffer, gesamt }
}

// ═══ Prüfliste ════════════════════════════════════════════════════════════

export type PrueflisteBuchung = {
  id: string; kontoKey: string; datum: string; betragRp: number; text: string
}

/** Unklassierte Buchungen (gruppiert nach ähnlichem Text) und grosse,
 *  noch nicht geprüfte Einzelbuchungen — wird erst auf Klick geladen. */
export async function ladePruefliste() {
  const { admin } = await requireFinanzZugang()
  const bestand = await ladeFinanzBestand(admin)
  const geprueftSet = new Set(bestand.geprueft)

  const gruppenMap = new Map<string, { vorschlag: string; richtung: 'einnahme' | 'ausgabe'; buchungen: PrueflisteBuchung[] }>()
  const grosse: Array<PrueflisteBuchung & { kategorieName: string }> = []

  bestand.buchungenProKonto.forEach(bs => {
    for (const b of bs) {
      const z = kategorieVon(b, bestand.ctx)
      if (z.quelle === 'unklassiert') {
        const vorschlag = suchtextVorschlag(b.text1) || suchtextVorschlag(b.text2) || 'Ohne Text'
        const richtung = b.betragRp >= 0 ? 'einnahme' as const : 'ausgabe' as const
        const key = `${vorschlag.toLowerCase()}|${richtung}`
        const g = gruppenMap.get(key) ?? { vorschlag, richtung, buchungen: [] }
        g.buchungen.push({ id: b.id, kontoKey: b.kontoKey, datum: b.buchungsdatum, betragRp: b.betragRp, text: anzeigeText(b) })
        gruppenMap.set(key, g)
      }
      if (istGrosseBuchung(b, z) && !geprueftSet.has(b.id)) {
        grosse.push({
          id: b.id, kontoKey: b.kontoKey, datum: b.buchungsdatum, betragRp: b.betragRp, text: anzeigeText(b),
          kategorieName: bestand.kategorien.find(k => k.id === z.kategorieId)?.name ?? 'Unklassiert',
        })
      }
    }
  })

  const gruppen = Array.from(gruppenMap.values())
    .map(g => ({ ...g, buchungen: g.buchungen.sort((a, b) => b.datum.localeCompare(a.datum)).slice(0, 20) }))
    .sort((a, b) => b.buchungen[0].datum.localeCompare(a.buchungen[0].datum))
    .slice(0, 40)
  grosse.sort((a, b) => b.datum.localeCompare(a.datum))
  return { gruppen, grosse: grosse.slice(0, 40) }
}

/** Grosse Buchung als geprüft markieren (bleibt dauerhaft gemerkt). */
export async function markiereGeprueft(buchungId: string) {
  const { admin } = await requireFinanzZugang()
  const err = await mitSperre('geprueft', async () => {
    const liste = await ladeGeprueft(admin)
    if (!liste.includes(buchungId)) liste.push(buchungId)
    return speichereFinanzConfig(admin, FINANZ_GEPRUEFT_KEY, liste.slice(-4000))
  })
  if (err) return { error: err }
  revalidatePath('/admin/finanzen')
  return { success: true }
}

/** Neue Regel aus dem Prüflisten-Vorschlag — reiht sich vor der
 *  Auffang-Regel ein. */
export async function regelAusVorschlag(suchtext: string, richtung: 'einnahme' | 'ausgabe' | 'beide', kategorieId: string) {
  const { admin } = await requireFinanzZugang()
  if (!suchtext.trim()) return { error: 'Bitte einen Suchtext angeben.' }
  const bestand = await ladeFinanzBestand(admin)
  if (!bestand.kategorien.some(k => k.id === kategorieId)) return { error: 'Kategorie nicht gefunden.' }
  const neue: Regel = {
    id: `regel_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    suchtext: suchtext.trim(), richtung, betragMin: null, betragMax: null,
    kategorieId, prioritaet: 0, aktiv: true,
  }
  const err = await mitSperre('regeln', async () => {
    const regeln = await ladeRegeln(admin)
    const maxPrio = Math.max(0, ...regeln.filter(r => r.prioritaet < 9000).map(r => r.prioritaet))
    neue.prioritaet = Math.min(8990, maxPrio + 10)
    return speichereFinanzConfig(admin, FINANZ_REGELN_KEY, [...regeln, neue])
  })
  if (err) return { error: err }

  // Wie viele bisher unklassierte Buchungen ordnet die neue Regel jetzt
  // automatisch zu? (Direkt als Rückmeldung in der Prüfliste angezeigt.)
  let treffer = 0
  bestand.buchungenProKonto.forEach(bs => {
    for (const b of bs) {
      if (kategorieVon(b, bestand.ctx).quelle !== 'unklassiert') continue
      if (passtRegel(b, neue)) treffer += 1
    }
  })

  revalidatePath('/admin/finanzen')
  revalidatePath('/admin/finanzen/regeln')
  return { success: true, treffer }
}

// ═══ Monatsdetails & Umbuchen ═════════════════════════════════════════════

export type DetailBuchung = {
  id: string
  kontoKey: string
  datum: string
  betragRp: number
  text: string
  kategorieId: string
  quelle: 'manuell' | 'intern' | 'regel' | 'unklassiert'
  gross: boolean
  details: Array<{ betragRp: number; text: string }>
}

/** Buchungsliste eines Monats — Texte werden bewusst erst auf Klick
 *  geladen und erscheinen nur hier, nie in Grafiken oder Kennzahlen. */
export async function ladeMonatsdetails(kontoKey: string, monat: string) {
  const { admin } = await requireFinanzZugang()
  if (!/^\d{4}-\d{2}$/.test(monat)) return { error: 'Ungültiger Monat.' }
  const bestand = await ladeFinanzBestand(admin)
  const buchungen: DetailBuchung[] = []
  bestand.buchungenProKonto.forEach((bs, key) => {
    if (kontoKey !== 'alle' && key !== kontoKey) return
    for (const b of bs) {
      if (b.buchungsdatum.slice(0, 7) !== monat) continue
      const z = kategorieVon(b, bestand.ctx)
      buchungen.push({
        id: b.id, kontoKey: key, datum: b.buchungsdatum, betragRp: b.betragRp, text: anzeigeText(b),
        kategorieId: z.kategorieId, quelle: z.quelle, gross: istGrosseBuchung(b, z),
        details: b.details.map(d => ({ betragRp: d.betragRp, text: [d.text1, d.text3].map(t => t.trim()).filter(Boolean).join(' — ').slice(0, 160) })),
      })
    }
  })
  buchungen.sort((a, b) => a.datum.localeCompare(b.datum) || a.id.localeCompare(b.id))
  return { buchungen: buchungen.slice(0, 600) }
}

/** Eine Buchung von Hand umbuchen (oder mit null wieder auf Automatik).
 *  Lesen-Ändern-Schreiben läuft unter der Sperre der Jahresdatei — zwei
 *  schnelle Zuordnungen nacheinander können sich nicht mehr gegenseitig
 *  überschreiben. */
export async function setzeKategorieManuell(kontoKey: string, buchungId: string, monat: string, kategorieId: string | null) {
  const { admin } = await requireFinanzZugang()
  if (!/^\d{4}-\d{2}$/.test(monat)) return { error: 'Ungültiger Monat.' }
  if (kategorieId != null) {
    const kategorien = await ladeKategorien(admin)
    if (!kategorien.some(k => k.id === kategorieId)) return { error: 'Kategorie nicht gefunden.' }
  }
  const jahr = parseInt(monat.slice(0, 4), 10)
  const fehler = await mitSperre(`jahr|${kontoKey}|${jahr}`, async () => {
    const datei = await ladeJahresdatei(admin, kontoKey, jahr)
    if (!datei) return 'Jahresdatei nicht gefunden.'
    const b = datei.buchungen.find(x => x.id === buchungId)
    if (!b) return 'Buchung nicht gefunden — die Seite neu laden und nochmals versuchen.'
    b.kategorieManuell = kategorieId
    return speichereJahresdatei(admin, datei)
  })
  if (fehler) return { error: fehler }
  revalidatePath('/admin/finanzen')
  return { success: true }
}

// ═══ Reserveziel & Konto ══════════════════════════════════════════════════

export async function speichereZiel(ziel: FinanzZiel) {
  const { admin } = await requireFinanzZugang()
  const sauber: FinanzZiel = {
    zielRp: typeof ziel.zielRp === 'number' && isFinite(ziel.zielRp) && ziel.zielRp > 0 ? Math.round(ziel.zielRp) : null,
    zieldatum: typeof ziel.zieldatum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ziel.zieldatum) ? ziel.zieldatum : null,
    mindestMonate: typeof ziel.mindestMonate === 'number' && ziel.mindestMonate >= 1 && ziel.mindestMonate <= 24
      ? Math.round(ziel.mindestMonate) : 3,
  }
  const err = await speichereFinanzConfig(admin, FINANZ_ZIEL_KEY, sauber)
  if (err) return { error: err }
  revalidatePath('/admin/finanzen')
  return { success: true }
}

export async function kontoUmbenennen(kontoKey: string, name: string) {
  const { admin } = await requireFinanzZugang()
  if (!name.trim()) return { error: 'Bitte einen Namen angeben.' }
  const kontos = await ladeKontos(admin)
  const konto = kontos.find(k => k.kontoKey === kontoKey)
  if (!konto) return { error: 'Konto nicht gefunden.' }
  const err = await speichereKonto(admin, { ...konto, name: name.trim().slice(0, 60) })
  if (err) return { error: err }
  revalidatePath('/admin/finanzen')
  revalidatePath('/admin/finanzen/regeln')
  return { success: true }
}
