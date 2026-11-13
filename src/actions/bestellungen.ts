'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { LEITENDE_TITLE } from '@/lib/leitende'
import {
  PRODUKT_PREFIX, LISTE_PREFIX, BESTELL_LOG_PREFIX, FIRMEN_KEY, BEOBACHTEN_PREFIX, BESTELL_ANCHOR,
  FIRMEN_EMPFOHLEN, hatBestellZugang, bestellHeute, parseListeRow, parseProduktRow, parseBeobachtenRow,
  gueltigesDatum, istErinnerungRhythmus, ersterTerminAb, naechsteErinnerung, rhythmusKurz, datumCH,
  type BestellItem, type BestellListe, type Produkt, type BeobachtenProdukt, type Erinnerung, type ErinnerungRhythmus,
} from '@/lib/bestellungen'

// Alle mit Seitenzugang haben VOLLEN Zugriff;
// jede Änderung landet im Protokoll mit Name und Zeitpunkt.
async function requireBestellZugang() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase.from('profiles').select('role, full_name, job_title').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string; job_title: string | null } | null
  if (!hatBestellZugang(p?.role, p?.job_title, p?.full_name, LEITENDE_TITLE)) throw new Error('Keine Berechtigung')
  return { admin: await createAdminClient(), name: p?.full_name ?? 'Admin' }
}

function revalidateBestellungen() {
  revalidatePath('/admin/bestellungen')
  revalidatePath('/employee/bestellungen')
}

const neueId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** Protokoll-Eintrag — best effort, bricht das eigentliche Speichern nie ab. */
async function protokoll(admin: SupabaseClient, von: string, text: string) {
  try {
    await admin.from('zeiterfassung_comments').insert({
      user_full_name: `${BESTELL_LOG_PREFIX}${neueId()}`,
      schedule_date: bestellHeute(),
      comment: JSON.stringify({
        am: new Date().toISOString(),
        von,
        text: text.length > 200 ? text.slice(0, 199) + '…' : text,
      }),
    })
  } catch { /* Protokoll darf das Speichern nicht verhindern */ }
}

async function ladeProdukt(admin: SupabaseClient, id: string): Promise<Produkt | null> {
  const { data } = await admin.from('zeiterfassung_comments')
    .select('user_full_name, comment')
    .eq('user_full_name', `${PRODUKT_PREFIX}${id}`)
    .eq('schedule_date', BESTELL_ANCHOR)
    .maybeSingle()
  if (!data) return null
  const r = data as { user_full_name: string; comment: string }
  return parseProduktRow(r.user_full_name, r.comment)
}

async function speichereProdukt(admin: SupabaseClient, p: Produkt): Promise<string | null> {
  const { id, ...meta } = p
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    {
      user_full_name: `${PRODUKT_PREFIX}${id}`,
      schedule_date: BESTELL_ANCHOR,
      comment: JSON.stringify(meta),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error?.message ?? null
}

async function ladeListe(admin: SupabaseClient, id: string): Promise<BestellListe | null> {
  const { data } = await admin.from('zeiterfassung_comments')
    .select('user_full_name, schedule_date, comment')
    .eq('user_full_name', `${LISTE_PREFIX}${id}`)
    .maybeSingle()
  if (!data) return null
  const r = data as { user_full_name: string; comment: string }
  return parseListeRow(r.user_full_name, r.comment)
}

async function speichereListe(admin: SupabaseClient, l: BestellListe): Promise<string | null> {
  const { id, ...meta } = l
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    {
      user_full_name: `${LISTE_PREFIX}${id}`,
      schedule_date: l.erstellt,
      comment: JSON.stringify(meta),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error?.message ?? null
}

/** Offene Liste des Typs holen oder neu anlegen. Gibt es (durch zwei
 *  gleichzeitige erste Einträge) mehrere offene, gewinnt deterministisch
 *  die ÄLTESTE — überall dieselbe Wahl wie im Seiten-Loader. */
async function offeneListe(admin: SupabaseClient, typ: 'normal' | 'whatsapp'): Promise<BestellListe> {
  const { data } = await admin.from('zeiterfassung_comments')
    .select('user_full_name, comment')
    .like('user_full_name', `${LISTE_PREFIX.replace(/_/g, '\\_')}%`)
  const offene: BestellListe[] = []
  for (const r of (data ?? []) as Array<{ user_full_name: string; comment: string }>) {
    const l = parseListeRow(r.user_full_name, r.comment)
    if (l && l.status === 'offen' && l.typ === typ) offene.push(l)
  }
  offene.sort((a, b) => a.erstellt.localeCompare(b.erstellt) || a.id.localeCompare(b.id))
  if (offene.length > 0) return offene[0]
  return { id: neueId(), typ, status: 'offen', items: [], erstellt: bestellHeute(), geschlossenAm: null, geschlossenVon: null }
}

// ── Firmen ────────────────────────────────────────────────────────────────

export async function addFirma(nameRoh: string) {
  const { admin, name } = await requireBestellZugang()
  const firma = nameRoh.trim()
  if (!firma) return { error: 'Bitte einen Firmennamen eingeben.' }
  if (firma.length > 60) return { error: 'Der Firmenname ist zu lang.' }
  const { data } = await admin.from('zeiterfassung_comments')
    .select('comment').eq('user_full_name', FIRMEN_KEY).eq('schedule_date', BESTELL_ANCHOR).maybeSingle()
  let firmen = [...FIRMEN_EMPFOHLEN]
  if (data) { try { firmen = JSON.parse((data as { comment: string }).comment) as string[] } catch { /* Vorbelegung */ } }
  // Existiert die Firma schon (egal in welcher Schreibweise), wird sie
  // einfach verwendet — kein Fehler, der z.B. das Produkt-Speichern stoppt.
  const vorhanden = firmen.find(f => f.toLowerCase() === firma.toLowerCase())
  if (vorhanden) return { success: true, firma: vorhanden }
  firmen.push(firma)
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: FIRMEN_KEY, schedule_date: BESTELL_ANCHOR, comment: JSON.stringify(firmen), updated_at: new Date().toISOString() },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  await protokoll(admin, name, `Firma «${firma}» hinzugefügt`)
  revalidateBestellungen()
  return { success: true, firma }
}

// ── Produkte ──────────────────────────────────────────────────────────────

export type ProduktEingabe = {
  name: string
  artikelNr: string
  firma: string
  menge: string | null
  intervallWochen: number | null
}

function pruefeProdukt(e: ProduktEingabe): string | null {
  if (!e.name.trim()) return 'Bitte einen Produktnamen eingeben.'
  if (!e.firma.trim()) return 'Bitte eine Firma wählen.'
  if (e.intervallWochen != null && (!Number.isFinite(e.intervallWochen) || e.intervallWochen <= 0 || e.intervallWochen > 260)) {
    return 'Bitte einen gültigen Turnus in Wochen angeben (1–260).'
  }
  return null
}

export async function addProdukt(e: ProduktEingabe) {
  const { admin, name } = await requireBestellZugang()
  const bad = pruefeProdukt(e)
  if (bad) return { error: bad }
  const p: Produkt = {
    id: neueId(),
    name: e.name.trim(),
    artikelNr: e.artikelNr.trim(),
    firma: e.firma.trim(),
    menge: e.menge?.trim() || null,
    intervallWochen: e.intervallWochen ?? null,
    bestellCount: 0,
    zuletztBestellt: null,
    abgelehntAm: null,
    erstellt: bestellHeute(),
  }
  const err = await speichereProdukt(admin, p)
  if (err) return { error: err }
  await protokoll(admin, name, `Produkt «${p.name}» angelegt (${p.firma}${p.artikelNr ? `, Art.-Nr. ${p.artikelNr}` : ''})`)
  revalidateBestellungen()
  return { success: true }
}

export async function updateProdukt(id: string, e: ProduktEingabe) {
  const { admin, name } = await requireBestellZugang()
  const bad = pruefeProdukt(e)
  if (bad) return { error: bad }
  const alt = await ladeProdukt(admin, id)
  if (!alt) return { error: 'Produkt nicht gefunden.' }
  const neu: Produkt = {
    ...alt,
    name: e.name.trim(),
    artikelNr: e.artikelNr.trim(),
    firma: e.firma.trim(),
    menge: e.menge?.trim() || null,
    intervallWochen: e.intervallWochen ?? null,
  }
  const err = await speichereProdukt(admin, neu)
  if (err) return { error: err }
  await protokoll(admin, name, `Produkt «${neu.name}» geändert (${neu.firma}${neu.artikelNr ? `, Art.-Nr. ${neu.artikelNr}` : ''}${neu.intervallWochen ? `, alle ${neu.intervallWochen} Wo.` : ''})`)
  revalidateBestellungen()
  return { success: true }
}

export async function deleteProdukt(id: string) {
  const { admin, name } = await requireBestellZugang()
  const alt = await ladeProdukt(admin, id)
  if (!alt) return { error: 'Produkt nicht gefunden.' }
  const { error } = await admin.from('zeiterfassung_comments').delete()
    .eq('user_full_name', `${PRODUKT_PREFIX}${id}`).eq('schedule_date', BESTELL_ANCHOR)
  if (error) return { error: error.message }
  await protokoll(admin, name, `Produkt «${alt.name}» gelöscht`)
  revalidateBestellungen()
  return { success: true }
}

// ── «Im Auge behalten» ───────────────────────────────────────────────────
// Produkte ohne festen Turnus, bei denen vor jeder Bestellung kurz geprüft
// wird, ob noch Vorrat da ist.

export type BeobachtenEingabe = {
  name: string
  artikelNr: string
  firma: string
  menge: string | null
}

async function ladeBeobachten(admin: SupabaseClient, id: string): Promise<BeobachtenProdukt | null> {
  const { data } = await admin.from('zeiterfassung_comments')
    .select('user_full_name, comment')
    .eq('user_full_name', `${BEOBACHTEN_PREFIX}${id}`)
    .eq('schedule_date', BESTELL_ANCHOR)
    .maybeSingle()
  if (!data) return null
  const r = data as { user_full_name: string; comment: string }
  return parseBeobachtenRow(r.user_full_name, r.comment)
}

async function speichereBeobachten(admin: SupabaseClient, b: BeobachtenProdukt): Promise<string | null> {
  const { id, ...meta } = b
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    {
      user_full_name: `${BEOBACHTEN_PREFIX}${id}`,
      schedule_date: BESTELL_ANCHOR,
      comment: JSON.stringify(meta),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error?.message ?? null
}

/** Anlegen (id = null) oder bearbeiten. */
export async function beobachtenSpeichern(id: string | null, e: BeobachtenEingabe) {
  const { admin, name } = await requireBestellZugang()
  if (!e.name.trim()) return { error: 'Bitte einen Produktnamen eingeben.' }
  if (!e.firma.trim()) return { error: 'Bitte eine Firma wählen.' }

  let b: BeobachtenProdukt
  if (id) {
    const alt = await ladeBeobachten(admin, id)
    if (!alt) return { error: 'Eintrag nicht gefunden.' }
    b = { ...alt, name: e.name.trim(), artikelNr: e.artikelNr.trim(), firma: e.firma.trim(), menge: e.menge?.trim() || null }
  } else {
    b = {
      id: neueId(), name: e.name.trim(), artikelNr: e.artikelNr.trim(), firma: e.firma.trim(),
      menge: e.menge?.trim() || null, erstellt: new Date().toISOString(), erstelltVon: name, erinnerung: null,
    }
  }
  const err = await speichereBeobachten(admin, b)
  if (err) return { error: err }
  await protokoll(admin, name, `Im Auge behalten: «${b.name}» ${id ? 'geändert' : 'hinzugefügt'} (${b.firma}${b.artikelNr ? `, Art.-Nr. ${b.artikelNr}` : ''})`)
  revalidateBestellungen()
  return { success: true }
}

export async function beobachtenEntfernen(id: string) {
  const { admin, name } = await requireBestellZugang()
  const alt = await ladeBeobachten(admin, id)
  if (!alt) return { error: 'Eintrag nicht gefunden.' }
  const { error } = await admin.from('zeiterfassung_comments').delete()
    .eq('user_full_name', `${BEOBACHTEN_PREFIX}${id}`).eq('schedule_date', BESTELL_ANCHOR)
  if (error) return { error: error.message }
  await protokoll(admin, name, `Im Auge behalten: «${alt.name}» entfernt`)
  revalidateBestellungen()
  return { success: true }
}

/** Beobachtetes Produkt auf die offene Bestellliste setzen. */
export async function beobachtenAufListe(id: string) {
  const { admin, name } = await requireBestellZugang()
  const b = await ladeBeobachten(admin, id)
  if (!b) return { error: 'Eintrag nicht gefunden.' }
  const liste = await offeneListe(admin, 'normal')
  const schonDrauf = liste.items.some(it =>
    it.name.trim().toLowerCase() === b.name.trim().toLowerCase() && it.firma === b.firma)
  if (schonDrauf) return { error: `«${b.name}» steht bereits auf der Bestellliste.` }
  liste.items.push({
    produktId: null, name: b.name, artikelNr: b.artikelNr, firma: b.firma,
    menge: b.menge ?? '', quelle: 'manuell',
  })
  const err = await speichereListe(admin, liste)
  if (err) return { error: err }
  await protokoll(admin, name, `«${b.name}»${b.menge ? ` (${b.menge})` : ''} von «Im Auge behalten» zur Bestellliste hinzugefügt`)
  revalidateBestellungen()
  return { success: true }
}

// ── Erinnerungen «Im Auge behalten» ──────────────────────────────────────
// Setzen dürfen alle Berechtigten; das Login-Fenster bekommt nur die Bestellverantwortliche
// (siehe Mitarbeiter-Layout). Am Stichtag erscheint das Produkt rot.

export type ErinnerungEingabe = { ab: string; rhythmus: ErinnerungRhythmus }

/** Erinnerung setzen oder ändern — eingabe = null entfernt sie. Bei einem
 *  Rhythmus ist der erste Termin der erste Reihentermin ab heute (ein
 *  Anker in der Vergangenheit macht sie also nicht rückwirkend fällig);
 *  einmalig gilt genau das gewählte Datum. */
export async function beobachtenErinnerungSetzen(id: string, eingabe: ErinnerungEingabe | null) {
  const { admin, name } = await requireBestellZugang()
  const alt = await ladeBeobachten(admin, id)
  if (!alt) return { error: 'Eintrag nicht gefunden.' }
  let neu: Erinnerung | null = null
  if (eingabe) {
    if (!gueltigesDatum(eingabe.ab)) return { error: 'Bitte ein gültiges Datum wählen.' }
    if (!istErinnerungRhythmus(eingabe.rhythmus)) return { error: 'Bitte wählen, wie oft erinnert werden soll.' }
    const basis = { ab: eingabe.ab, rhythmus: eingabe.rhythmus }
    neu = { ...basis, naechste: ersterTerminAb(basis, bestellHeute()) }
  }
  const err = await speichereBeobachten(admin, { ...alt, erinnerung: neu })
  if (err) return { error: err }
  await protokoll(admin, name, neu
    ? `Erinnerung «${alt.name}»: ${neu.rhythmus === 'einmalig' ? `einmalig am ${datumCH(neu.naechste)}` : `${rhythmusKurz(neu.rhythmus)} ab ${datumCH(neu.ab)}, nächste am ${datumCH(neu.naechste)}`}`
    : `Erinnerung «${alt.name}» entfernt`)
  revalidateBestellungen()
  return { success: true }
}

/** Fällige Erinnerung abhaken: «liste» setzt das Produkt zusätzlich auf
 *  die offene Bestellliste, «ueberspringen» nicht. In beiden Fällen rückt
 *  die Erinnerung auf den nächsten Termin nach heute (einmalig: erledigt,
 *  die Erinnerung verschwindet). */
export async function beobachtenErinnerungErledigen(id: string, aktion: 'liste' | 'ueberspringen') {
  const { admin, name } = await requireBestellZugang()
  const b = await ladeBeobachten(admin, id)
  if (!b) return { error: 'Eintrag nicht gefunden.' }
  if (!b.erinnerung) return { error: 'Für dieses Produkt ist keine Erinnerung gesetzt.' }
  let aufListe = false
  if (aktion === 'liste') {
    const liste = await offeneListe(admin, 'normal')
    const schonDrauf = liste.items.some(it =>
      it.name.trim().toLowerCase() === b.name.trim().toLowerCase() && it.firma === b.firma)
    if (!schonDrauf) {
      liste.items.push({
        produktId: null, name: b.name, artikelNr: b.artikelNr, firma: b.firma,
        menge: b.menge ?? '', quelle: 'manuell',
      })
      const err = await speichereListe(admin, liste)
      if (err) return { error: err }
      aufListe = true
    }
  }
  const naechste = naechsteErinnerung(b.erinnerung, bestellHeute())
  const err = await speichereBeobachten(admin, { ...b, erinnerung: naechste ? { ...b.erinnerung, naechste } : null })
  if (err) return { error: err }
  const weiter = naechste ? `nächste Erinnerung am ${datumCH(naechste)}` : 'einmalige Erinnerung erledigt'
  await protokoll(admin, name, aktion === 'liste'
    ? `Erinnerung «${b.name}»: ${aufListe ? 'zur Bestellliste hinzugefügt' : 'stand bereits auf der Bestellliste'}, ${weiter}`
    : `Erinnerung «${b.name}» übersprungen, ${weiter}`)
  revalidateBestellungen()
  return { success: true }
}

// ── Bestellliste (Firmen-Bestellung) ─────────────────────────────────────

/** Produkt (oder freien Artikel) auf die offene Liste setzen.
 *  quelle 'empfehlung' = eine angenommene Empfehlung. */
export async function itemHinzufuegen(eintrag: {
  produktId?: string | null
  name?: string
  menge?: string
  quelle?: 'manuell' | 'empfehlung'
}) {
  const { admin, name } = await requireBestellZugang()
  let item: BestellItem
  if (eintrag.produktId) {
    const p = await ladeProdukt(admin, eintrag.produktId)
    if (!p) return { error: 'Produkt nicht gefunden.' }
    item = {
      produktId: p.id, name: p.name, artikelNr: p.artikelNr, firma: p.firma,
      menge: (eintrag.menge ?? p.menge ?? '').trim(),
      quelle: eintrag.quelle === 'empfehlung' ? 'empfehlung' : 'manuell',
    }
  } else {
    if (!eintrag.name?.trim()) return { error: 'Bitte ein Produkt wählen.' }
    item = { produktId: null, name: eintrag.name.trim(), artikelNr: '', firma: '', menge: (eintrag.menge ?? '').trim(), quelle: 'manuell' }
  }
  const liste = await offeneListe(admin, 'normal')
  if (item.produktId && liste.items.some(it => it.produktId === item.produktId)) {
    return { error: `«${item.name}» steht bereits auf der Bestellliste.` }
  }
  liste.items.push(item)
  const err = await speichereListe(admin, liste)
  if (err) return { error: err }
  await protokoll(admin, name, `«${item.name}»${item.menge ? ` (${item.menge})` : ''} zur Bestellliste hinzugefügt${item.quelle === 'empfehlung' ? ' (Empfehlung angenommen)' : ''}`)
  revalidateBestellungen()
  return { success: true }
}

export async function itemEntfernen(listeId: string, index: number, erwarteterName?: string) {
  const { admin, name } = await requireBestellZugang()
  const liste = await ladeListe(admin, listeId)
  if (!liste || liste.status !== 'offen') return { error: 'Liste nicht gefunden oder bereits abgeschlossen.' }
  const item = liste.items[index]
  if (!item) return { error: 'Position nicht gefunden.' }
  // Schutz vor veralteten Indizes (zwei Geräte gleichzeitig): stimmt der
  // Name nicht mehr, hat jemand die Liste zwischenzeitlich geändert.
  if (erwarteterName != null && item.name !== erwarteterName) {
    return { error: 'Die Liste wurde zwischenzeitlich geändert — bitte kurz neu laden und nochmals versuchen.' }
  }
  liste.items.splice(index, 1)
  const err = await speichereListe(admin, liste)
  if (err) return { error: err }
  await protokoll(admin, name, `«${item.name}» von der ${liste.typ === 'whatsapp' ? 'WhatsApp-Liste' : 'Bestellliste'} entfernt`)
  revalidateBestellungen()
  return { success: true }
}

export async function itemMengeAendern(listeId: string, index: number, menge: string, erwarteterName?: string) {
  const { admin, name } = await requireBestellZugang()
  const liste = await ladeListe(admin, listeId)
  if (!liste || liste.status !== 'offen') return { error: 'Liste nicht gefunden oder bereits abgeschlossen.' }
  const item = liste.items[index]
  if (!item) return { error: 'Position nicht gefunden.' }
  if (erwarteterName != null && item.name !== erwarteterName) {
    return { error: 'Die Liste wurde zwischenzeitlich geändert — bitte kurz neu laden und nochmals versuchen.' }
  }
  const alt = item.menge
  item.menge = menge.trim()
  const err = await speichereListe(admin, liste)
  if (err) return { error: err }
  if (alt !== item.menge) {
    await protokoll(admin, name, `Menge «${item.name}»: ${alt || '—'} → ${item.menge || '—'}`)
  }
  revalidateBestellungen()
  return { success: true }
}

export async function empfehlungAblehnen(produktId: string) {
  const { admin, name } = await requireBestellZugang()
  const p = await ladeProdukt(admin, produktId)
  if (!p) return { error: 'Produkt nicht gefunden.' }
  p.abgelehntAm = bestellHeute()
  const err = await speichereProdukt(admin, p)
  if (err) return { error: err }
  await protokoll(admin, name, `Empfehlung «${p.name}» abgelehnt — nächste Erinnerung in ${p.intervallWochen ?? '?'} Wochen`)
  revalidateBestellungen()
  return { success: true }
}

/** Bestellliste abschliessen: Status «geschlossen», bei allen Produkt-
 *  Positionen «zuletzt bestellt» setzen und den Bestellzähler erhöhen. */
export async function listeAbschliessen(listeId: string) {
  const { admin, name } = await requireBestellZugang()
  const liste = await ladeListe(admin, listeId)
  if (!liste || liste.status !== 'offen') return { error: 'Liste nicht gefunden oder bereits abgeschlossen.' }
  if (liste.items.length === 0) return { error: 'Die Liste ist leer — bitte zuerst Produkte hinzufügen.' }
  const heute = bestellHeute()
  liste.status = 'geschlossen'
  liste.geschlossenAm = heute
  liste.geschlossenVon = name
  const err = await speichereListe(admin, liste)
  if (err) return { error: err }
  for (const it of liste.items) {
    if (!it.produktId) continue
    const p = await ladeProdukt(admin, it.produktId)
    if (!p) continue
    p.zuletztBestellt = heute
    p.bestellCount += 1
    p.abgelehntAm = null
    await speichereProdukt(admin, p)
  }
  await protokoll(admin, name, liste.typ === 'whatsapp'
    ? `WhatsApp-Bestellung als erledigt markiert (${liste.items.length} Position${liste.items.length === 1 ? '' : 'en'})`
    : `Bestellliste abgeschlossen (${liste.items.length} Position${liste.items.length === 1 ? '' : 'en'})`)
  revalidateBestellungen()
  return { success: true }
}

// ── WhatsApp Liste (Bestellung per WhatsApp beim Lieferanten) ────────────

export async function whatsappItemHinzufuegen(text: string, menge?: string) {
  const { admin, name } = await requireBestellZugang()
  if (!text.trim()) return { error: 'Bitte eingeben, was bestellt werden soll.' }
  const liste = await offeneListe(admin, 'whatsapp')
  liste.items.push({ produktId: null, name: text.trim(), artikelNr: '', firma: '', menge: (menge ?? '').trim(), quelle: 'manuell' })
  const err = await speichereListe(admin, liste)
  if (err) return { error: err }
  await protokoll(admin, name, `WhatsApp Bestellung: «${text.trim()}» hinzugefügt`)
  revalidateBestellungen()
  return { success: true }
}
