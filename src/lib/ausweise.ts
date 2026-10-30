// Ausweisdaten (ID oder Reisepass) der Mitarbeitenden — für Teamevents mit
// Reise. STRENG PERSÖNLICH: Nummer, Ablaufdatum und Bilder sieht nur die
// Person selbst und die Organisatorin; nie das übrige Team. Ablage:
//   __ausweis__<profileId> @ 1970-01-01 → {art, nummer, ablauf, bilder[], aktualisiertAm, aktualisiertVon}
//   Bilder im privaten Bucket unter _ausweise/<profileId>/<id>_<name>
// Jeder Zugriff läuft über Server Actions bzw. die Bildroute, die
// Eigentümerschaft oder Organisatorin prüfen. Nummer, Ablaufdatum und
// Bilder liegen verschlüsselt (siehe teamevent-geheim.ts).

import { sicherName } from './teamevents'

export const AUSWEIS_PREFIX = '__ausweis__'
export const AUSWEIS_BASIS = '_ausweise'
export const AUSWEIS_ANCHOR = '1970-01-01'
export const AUSWEIS_MAX_BYTES = 20 * 1024 * 1024

export type AusweisArt = 'id' | 'pass'
export type AusweisSeite = 'vorne' | 'hinten' | 'daten'
/** enc = verschlüsselt abgelegt (alle neuen Bilder); Pfad siehe teamevent-geheim.ts. */
export type AusweisBild = { id: string; name: string; mime: string; bytes: number; am: string; seite: AusweisSeite | null; enc?: boolean }
export type Ausweis = {
  profileId: string
  art: AusweisArt | null
  nummer: string | null
  ablauf: string | null        // YYYY-MM-DD
  bilder: AusweisBild[]
  aktualisiertAm: string | null
  aktualisiertVon: string | null
}

export const ausweisKey = (profileId: string) => `${AUSWEIS_PREFIX}${profileId}`
export const ausweisPfad = (profileId: string, id: string, name: string) => `${AUSWEIS_BASIS}/${profileId}/${id}_${sicherName(name)}`
export const AUSWEIS_ART_LABEL: Record<AusweisArt, string> = { id: 'Identitätskarte', pass: 'Reisepass' }
export const AUSWEIS_SEITE_LABEL: Record<AusweisSeite, string> = { vorne: 'Vorderseite', hinten: 'Rückseite', daten: 'Datenseite' }

export function leererAusweis(profileId: string): Ausweis {
  return { profileId, art: null, nummer: null, ablauf: null, bilder: [], aktualisiertAm: null, aktualisiertVon: null }
}

export function parseAusweis(profileId: string, comment: string | null | undefined): Ausweis {
  const leer = leererAusweis(profileId)
  if (!comment) return leer
  try {
    const j = JSON.parse(comment) as Partial<Ausweis>
    return {
      profileId,
      art: j.art === 'id' || j.art === 'pass' ? j.art : null,
      nummer: typeof j.nummer === 'string' && j.nummer.trim() ? j.nummer.trim() : null,
      ablauf: typeof j.ablauf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.ablauf) ? j.ablauf : null,
      bilder: Array.isArray(j.bilder) ? j.bilder.filter((b): b is AusweisBild => !!b && typeof b === 'object' && typeof (b as AusweisBild).id === 'string' && typeof (b as AusweisBild).name === 'string') : [],
      aktualisiertAm: typeof j.aktualisiertAm === 'string' ? j.aktualisiertAm : null,
      aktualisiertVon: typeof j.aktualisiertVon === 'string' ? j.aktualisiertVon : null,
    }
  } catch { return leer }
}

export type AusweisStatus = 'fehlt' | 'abgelaufen' | 'bald' | 'ok' | 'ohne_ablauf'

/** fehlt = weder Nummer noch Bild; abgelaufen; bald = läuft in < 6 Monaten ab. */
export function ausweisStatus(a: Ausweis | null, heute: string): AusweisStatus {
  if (!a || (!a.nummer && a.bilder.length === 0)) return 'fehlt'
  if (!a.ablauf) return 'ohne_ablauf'
  if (a.ablauf < heute) return 'abgelaufen'
  const d = new Date(`${heute}T00:00:00`); d.setMonth(d.getMonth() + 6)
  const grenze = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return a.ablauf <= grenze ? 'bald' : 'ok'
}

export const AUSWEIS_STATUS_LABEL: Record<AusweisStatus, string> = {
  fehlt: 'noch nicht erfasst', abgelaufen: 'abgelaufen', bald: 'läuft bald ab', ok: 'gültig', ohne_ablauf: 'ohne Ablaufdatum',
}
