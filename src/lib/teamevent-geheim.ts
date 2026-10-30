// Verschlüsselung der persönlichen Teamevent Daten — NUR serverseitig
// (node:crypto). Ausweisnummer, Ablaufdatum, Allergieangaben und die
// Ausweisbilder liegen verschlüsselt in der Datenbank bzw. im Bucket.
// Damit sind sie auch für Personen unlesbar, die per Datenbankregel rohe
// Zeilen oder Storage Objekte lesen könnten (andere Admins): lesbar
// werden sie nur über die Server Actions und die Bildroute, die beide
// prüfen, ob die angemeldete Person die Eigentümerin oder die
// Organisatorin ist. Schlüssel wie bei den Finanzen per HKDF aus dem
// SUPABASE_SERVICE_ROLE_KEY abgeleitet (verlässt den Server nie).

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto'
import { ausweisPfad, parseAusweis, AUSWEIS_BASIS, type Ausweis, type AusweisBild } from './ausweise'
import { parseCheck, type TeCheck } from './teamevent-programm'

const TEXT_PREFIX = 'enc1:'
const MAGIC = Buffer.from('AUSW1')

function schluessel(): Buffer {
  const basis = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!basis) throw new Error('Verschlüsselung nicht möglich: SUPABASE_SERVICE_ROLE_KEY fehlt.')
  return Buffer.from(hkdfSync('sha256', basis, 'hr-portal-teamevents', 'persoenliche-daten-v1', 32))
}

export function verschluesselBytes(klar: Uint8Array): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', schluessel(), iv)
  const chiffrat = Buffer.concat([cipher.update(klar), cipher.final()])
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), chiffrat])
}
export const istVerschluesselt = (bytes: Uint8Array) => bytes.length > 33 && Buffer.from(bytes.subarray(0, MAGIC.length)).equals(MAGIC)
/** Wirft bei falschem Schlüssel oder manipulierten Daten (GCM Tag). */
export function entschluesselBytes(bytes: Uint8Array): Buffer {
  const b = Buffer.from(bytes)
  const iv = b.subarray(MAGIC.length, MAGIC.length + 12)
  const tag = b.subarray(MAGIC.length + 12, MAGIC.length + 28)
  const decipher = createDecipheriv('aes-256-gcm', schluessel(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(b.subarray(MAGIC.length + 28)), decipher.final()])
}

export function verschluesselText(klar: string | null | undefined): string | null {
  if (!klar) return null
  return `${TEXT_PREFIX}${verschluesselBytes(Buffer.from(klar, 'utf-8')).toString('base64')}`
}
/** Verschlüsselten Text lesen; unverschlüsselte Altwerte werden übernommen
 *  (und beim nächsten Speichern verschlüsselt). null bei Fehlern. */
export function entschluesselText(wert: unknown): string | null {
  if (typeof wert !== 'string' || !wert) return null
  if (!wert.startsWith(TEXT_PREFIX)) return wert
  try { return entschluesselBytes(Buffer.from(wert.slice(TEXT_PREFIX.length), 'base64')).toString('utf-8') } catch { return null }
}

// ── Ausweis ─────────────────────────────────────────────────────────────

/** Gespeicherte Ausweiszeile lesen (Nummer und Ablaufdatum entschlüsselt). */
export function parseAusweisGeheim(profileId: string, comment: string | null | undefined): Ausweis {
  const basis = parseAusweis(profileId, comment)
  if (!comment) return basis
  try {
    const j = JSON.parse(comment) as { nummerEnc?: unknown; ablaufEnc?: unknown }
    const nummer = entschluesselText(j.nummerEnc)
    const ablauf = entschluesselText(j.ablaufEnc)
    return {
      ...basis,
      nummer: nummer?.trim() ? nummer.trim() : basis.nummer,
      ablauf: ablauf && /^\d{4}-\d{2}-\d{2}$/.test(ablauf) ? ablauf : basis.ablauf,
    }
  } catch { return basis }
}

/** Ausweis für die Ablage serialisieren (Nummer und Datum verschlüsselt). */
export function ausweisZuObjekt(a: Ausweis, am: string, von: string): Record<string, unknown> {
  return { art: a.art, nummerEnc: verschluesselText(a.nummer), ablaufEnc: verschluesselText(a.ablauf), bilder: a.bilder, aktualisiertAm: am, aktualisiertVon: von }
}

/** Speicherpfad eines Ausweisbildes: neue Bilder verschlüsselt als .bin,
 *  ältere (vor der Verschlüsselung hochgeladene) unter ihrem Namen. */
export const bildPfad = (profileId: string, b: AusweisBild) => (b.enc ? `${AUSWEIS_BASIS}/${profileId}/${b.id}.bin` : ausweisPfad(profileId, b.id, b.name))

// ── Persönliche Checkliste ──────────────────────────────────────────────

export function parseCheckGeheim(comment: string | null | undefined): TeCheck {
  const basis = parseCheck(comment)
  if (!comment) return basis
  try {
    const j = JSON.parse(comment) as { allergienEnc?: unknown }
    const allergien = entschluesselText(j.allergienEnc)
    return { ...basis, allergien: allergien?.trim() ? allergien.trim().slice(0, 500) : basis.allergien }
  } catch { return basis }
}

export function checkZuObjekt(c: TeCheck): Record<string, unknown> {
  return { ticks: c.ticks, einstieg: c.einstieg, allergienEnc: verschluesselText(c.allergien), keineAllergien: c.keineAllergien, aktualisiertAm: c.aktualisiertAm }
}
