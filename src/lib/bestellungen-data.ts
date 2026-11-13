import type { SupabaseClient } from '@supabase/supabase-js'
import {
  PRODUKT_PREFIX, LISTE_PREFIX, BESTELL_LOG_PREFIX, FIRMEN_KEY, BEOBACHTEN_PREFIX, BESTELL_ANCHOR,
  FIRMEN_EMPFOHLEN, parseProduktRow, parseListeRow, parseBeobachtenRow, bestellHeute, erinnerungFaellig,
  type Produkt, type BestellListe, type BestellLog, type BeobachtenProdukt,
} from '@/lib/bestellungen'

export type BestellungenData = {
  produkte: Produkt[]
  /** «Im Auge behalten» — zuletzt hinzugefügte zuerst */
  beobachten: BeobachtenProdukt[]
  firmen: string[]
  /** Offene Firmen-Bestellliste (höchstens eine) */
  offen: BestellListe | null
  /** Offene WhatsApp Liste (höchstens eine) */
  whatsappOffen: BestellListe | null
  /** Abgeschlossene Listen, neuste zuerst */
  geschlossene: BestellListe[]
  /** Änderungsprotokoll, neuste zuerst (letzte 250) */
  logs: BestellLog[]
}

const esc = (s: string) => s.replace(/_/g, '\\_')

export async function loadBestellungenData(client: SupabaseClient): Promise<BestellungenData> {
  const [{ data: prodRows }, { data: beobRows }, { data: listeRows }, { data: firmenRow }, { data: logRows }] = await Promise.all([
    client.from('zeiterfassung_comments')
      .select('user_full_name, comment')
      .like('user_full_name', `${esc(PRODUKT_PREFIX)}%`),
    client.from('zeiterfassung_comments')
      .select('user_full_name, comment')
      .like('user_full_name', `${esc(BEOBACHTEN_PREFIX)}%`),
    // die neusten 400 Listen genügen (offene sind naturgemäss jung) — so
    // bleibt die Seite auch nach Jahren Bestellhistorie schnell
    client.from('zeiterfassung_comments')
      .select('user_full_name, comment')
      .like('user_full_name', `${esc(LISTE_PREFIX)}%`)
      .order('schedule_date', { ascending: false })
      .limit(400),
    client.from('zeiterfassung_comments')
      .select('comment')
      .eq('user_full_name', FIRMEN_KEY)
      .eq('schedule_date', BESTELL_ANCHOR)
      .maybeSingle(),
    client.from('zeiterfassung_comments')
      .select('comment')
      .like('user_full_name', `${esc(BESTELL_LOG_PREFIX)}%`)
      .order('schedule_date', { ascending: false })
      .limit(250),
  ])

  const produkte: Produkt[] = []
  for (const r of (prodRows ?? []) as Array<{ user_full_name: string; comment: string }>) {
    const p = parseProduktRow(r.user_full_name, r.comment)
    if (p) produkte.push(p)
  }
  produkte.sort((a, b) => a.name.localeCompare(b.name, 'de-CH'))

  const beobachten: BeobachtenProdukt[] = []
  for (const r of (beobRows ?? []) as Array<{ user_full_name: string; comment: string }>) {
    const b = parseBeobachtenRow(r.user_full_name, r.comment)
    if (b) beobachten.push(b)
  }
  // zuletzt hinzugefügte zuerst (die Karte zeigt die neusten 10)
  beobachten.sort((a, b) => b.erstellt.localeCompare(a.erstellt) || a.name.localeCompare(b.name, 'de-CH'))

  const listen: BestellListe[] = []
  for (const r of (listeRows ?? []) as Array<{ user_full_name: string; comment: string }>) {
    const l = parseListeRow(r.user_full_name, r.comment)
    if (l) listen.push(l)
  }
  // dieselbe deterministische Wahl wie in den Server-Actions: die ÄLTESTE
  // offene Liste gewinnt, falls je zwei gleichzeitig entstanden sind
  const offene = listen
    .filter(l => l.status === 'offen')
    .sort((a, b) => a.erstellt.localeCompare(b.erstellt) || a.id.localeCompare(b.id))
  const geschlossene = listen
    .filter(l => l.status === 'geschlossen')
    .sort((a, b) => (b.geschlossenAm ?? '').localeCompare(a.geschlossenAm ?? '') || b.erstellt.localeCompare(a.erstellt))

  let firmen = [...FIRMEN_EMPFOHLEN]
  if (firmenRow) {
    try {
      const parsed = JSON.parse((firmenRow as { comment: string }).comment) as string[]
      if (Array.isArray(parsed) && parsed.length > 0) firmen = parsed
    } catch { /* Vorbelegung behalten */ }
  }

  const logs: BestellLog[] = []
  for (const r of (logRows ?? []) as Array<{ comment: string }>) {
    try {
      const p = JSON.parse(r.comment) as Partial<BestellLog>
      if (p.am && p.text) logs.push({ am: p.am, von: p.von ?? '?', text: p.text })
    } catch { /* ignore */ }
  }
  logs.sort((a, b) => b.am.localeCompare(a.am))

  return {
    produkte,
    beobachten,
    firmen,
    offen: offene.find(l => l.typ === 'normal') ?? null,
    whatsappOffen: offene.find(l => l.typ === 'whatsapp') ?? null,
    geschlossene,
    logs,
  }
}

/** Fällige Erinnerung aus «Im Auge behalten» — für das Login-Fenster der
 *  Bestell-Verantwortlichen (nur die Felder, die das Fenster zeigt). */
export type FaelligeErinnerung = Pick<BeobachtenProdukt, 'id' | 'name' | 'firma' | 'artikelNr' | 'menge'> & {
  /** Fällig seit (YYYY-MM-DD) */
  naechste: string
}

/** Alle heute fälligen Erinnerungen, älteste zuerst. */
export async function ladeFaelligeErinnerungen(client: SupabaseClient): Promise<FaelligeErinnerung[]> {
  const heute = bestellHeute()
  const { data } = await client.from('zeiterfassung_comments')
    .select('user_full_name, comment')
    .like('user_full_name', `${esc(BEOBACHTEN_PREFIX)}%`)
  const out: FaelligeErinnerung[] = []
  for (const r of (data ?? []) as Array<{ user_full_name: string; comment: string }>) {
    const b = parseBeobachtenRow(r.user_full_name, r.comment)
    if (b?.erinnerung && erinnerungFaellig(b, heute)) {
      out.push({ id: b.id, name: b.name, firma: b.firma, artikelNr: b.artikelNr, menge: b.menge, naechste: b.erinnerung.naechste })
    }
  }
  out.sort((a, b) => a.naechste.localeCompare(b.naechste) || a.name.localeCompare(b.name, 'de-CH'))
  return out
}
