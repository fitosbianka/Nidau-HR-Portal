// Geschäftsanalyse — serverseitiges Laden des gesamten Bestands
// (Kontos, Kategorien, Regeln, alle Jahresdateien) und Aufbau der
// Monats-Aggregate. NUR über den Admin-Client aufrufen; Buchungen mit
// Texten bleiben auf dem Server — an den Client gehen ausschliesslich
// die Aggregate aus aggregiereMonate.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Buchung, FinanzKonto, MonatsInfo } from './types'
import {
  START_KATEGORIEN, START_REGELN, baueKontext, kategorieVon, istGrosseBuchung,
  type Kategorie, type Regel, type KategorisierKontext,
} from './kategorien'
import { aggregiereMonate, STANDARD_ZIEL, type FinanzZiel, type MonatsAggregat } from './analyse'
import {
  ladeKontos, ladeJahre, ladeJahresdatei, ladeFinanzConfig,
  FINANZ_KATEGORIEN_KEY, FINANZ_REGELN_KEY, FINANZ_ZIEL_KEY, FINANZ_GEPRUEFT_KEY, ladeImportprotokoll,
} from './speicher'
import { vollstaendigAusProtokoll } from './ubs-csv'

export async function ladeKategorien(admin: SupabaseClient): Promise<Kategorie[]> {
  const gespeichert = await ladeFinanzConfig<Kategorie[]>(admin, FINANZ_KATEGORIEN_KEY)
  return Array.isArray(gespeichert) && gespeichert.length > 0 ? gespeichert : START_KATEGORIEN
}

export async function ladeRegeln(admin: SupabaseClient): Promise<Regel[]> {
  const gespeichert = await ladeFinanzConfig<Regel[]>(admin, FINANZ_REGELN_KEY)
  return Array.isArray(gespeichert) ? gespeichert : START_REGELN
}

export async function ladeZiel(admin: SupabaseClient): Promise<FinanzZiel> {
  const z = await ladeFinanzConfig<FinanzZiel>(admin, FINANZ_ZIEL_KEY)
  if (!z || typeof z !== 'object') return STANDARD_ZIEL
  return {
    zielRp: typeof z.zielRp === 'number' ? z.zielRp : null,
    zieldatum: typeof z.zieldatum === 'string' ? z.zieldatum : null,
    mindestMonate: typeof z.mindestMonate === 'number' && z.mindestMonate >= 1 ? z.mindestMonate : 3,
  }
}

export async function ladeGeprueft(admin: SupabaseClient): Promise<string[]> {
  const g = await ladeFinanzConfig<string[]>(admin, FINANZ_GEPRUEFT_KEY)
  return Array.isArray(g) ? g.filter(x => typeof x === 'string') : []
}

export type FinanzBestand = {
  kontos: FinanzKonto[]
  kategorien: Kategorie[]
  regeln: Regel[]
  ziel: FinanzZiel
  geprueft: string[]
  ctx: KategorisierKontext
  /** ALLE Buchungen je Konto — bleiben auf dem Server */
  buchungenProKonto: Map<string, Buchung[]>
  monatsInfosProKonto: Map<string, Record<string, MonatsInfo>>
  /** Monats-Aggregate ohne Texte — das ist die Client-Ansicht */
  aggregate: MonatsAggregat[]
}

export async function ladeFinanzBestand(admin: SupabaseClient): Promise<FinanzBestand> {
  const [kontos, kategorien, regeln, ziel, geprueft] = await Promise.all([
    ladeKontos(admin), ladeKategorien(admin), ladeRegeln(admin), ladeZiel(admin), ladeGeprueft(admin),
  ])

  // Importprotokoll: ein früher importierter Monat gilt als vollständig,
  // wenn ein Import ihn laut Von/Bis bis zum letzten Bankarbeitstag abdeckt
  const protokoll = await ladeImportprotokoll(admin)
  const buchungenProKonto = new Map<string, Buchung[]>()
  const monatsInfosProKonto = new Map<string, Record<string, MonatsInfo>>()
  for (const konto of kontos) {
    const jahre = await ladeJahre(admin, konto.kontoKey)
    const buchungen: Buchung[] = []
    const infos: Record<string, MonatsInfo> = {}
    const dateien = await Promise.all(jahre.map(j => ladeJahresdatei(admin, konto.kontoKey, j)))
    for (const datei of dateien) {
      if (!datei) continue
      buchungen.push(...datei.buchungen)
      Object.assign(infos, datei.monate)
    }
    buchungen.sort((a, b) => a.buchungsdatum.localeCompare(b.buchungsdatum))
    buchungenProKonto.set(konto.kontoKey, buchungen)
    monatsInfosProKonto.set(konto.kontoKey, vollstaendigAusProtokoll(infos, protokoll.filter(e => e.kontoKey === konto.kontoKey)))
  }

  const alle: Array<{ kontoKey: string; buchungsdatum: string; betragRp: number }> = []
  buchungenProKonto.forEach(bs => { for (const b of bs) alle.push({ kontoKey: b.kontoKey, buchungsdatum: b.buchungsdatum, betragRp: b.betragRp }) })
  const eigeneIbans = kontos.flatMap(k => [k.iban, k.kontoKey]).filter(Boolean)
  const ctx = baueKontext(kategorien, regeln, eigeneIbans, alle)

  const aggregate: MonatsAggregat[] = []
  for (const konto of kontos) {
    aggregate.push(...aggregiereMonate(
      konto.kontoKey,
      buchungenProKonto.get(konto.kontoKey) ?? [],
      monatsInfosProKonto.get(konto.kontoKey) ?? {},
      ctx,
    ))
  }

  return { kontos, kategorien, regeln, ziel, geprueft, ctx, buchungenProKonto, monatsInfosProKonto, aggregate }
}

/** Offene Punkte für die Prüfliste — nur ZAHLEN, keine Texte. */
export function zaehleOffene(bestand: FinanzBestand): { unklassiertOffen: number; grosseOffen: number } {
  let unklassiertOffen = 0
  let grosseOffen = 0
  const geprueft = new Set(bestand.geprueft)
  bestand.buchungenProKonto.forEach(bs => {
    for (const b of bs) {
      const z = kategorieVon(b, bestand.ctx)
      if (z.quelle === 'unklassiert') unklassiertOffen += 1
      if (istGrosseBuchung(b, z) && !geprueft.has(b.id)) grosseOffen += 1
    }
  })
  return { unklassiertOffen, grosseOffen }
}
