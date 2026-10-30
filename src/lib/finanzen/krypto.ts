// Verschlüsselung der Finanz-Ablage — NUR serverseitig (node:crypto).
// AES-256-GCM; der Schlüssel wird per HKDF aus dem SUPABASE_SERVICE_ROLE_KEY
// abgeleitet und verlässt den Server nie (keine zusätzliche Konfiguration
// nötig, der Browser bekommt ihn nie zu sehen). Damit sind die Jahres-JSONs
// und Original-CSVs im Bucket selbst dann unlesbar, wenn jemand an die
// rohen Storage-Objekte käme.
//
// WICHTIG: Wird der Supabase Service-Role-Key rotiert, sind die
// verschlüsselten Dateien nicht mehr lesbar — die Daten lassen sich dann
// jederzeit durch erneuten CSV-Import aus dem UBS Online Banking
// wiederherstellen (die Bank bleibt die Quelle der Wahrheit).

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto'

const MAGIC = Buffer.from('FINZ1')

function schluessel(): Buffer {
  const basis = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!basis) throw new Error('Verschlüsselung nicht möglich: SUPABASE_SERVICE_ROLE_KEY fehlt.')
  return Buffer.from(hkdfSync('sha256', basis, 'hr-portal-finanzen', 'finanz-ablage-v1', 32))
}

export function verschluesseln(klar: Uint8Array): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', schluessel(), iv)
  const chiffrat = Buffer.concat([cipher.update(klar), cipher.final()])
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), chiffrat])
}

export function istVerschluesselt(bytes: Uint8Array): boolean {
  return bytes.length > 33 && Buffer.from(bytes.subarray(0, MAGIC.length)).equals(MAGIC)
}

/** Wirft bei falschem Schlüssel oder manipulierten Daten (GCM-Tag). */
export function entschluesseln(bytes: Uint8Array): Buffer {
  const b = Buffer.from(bytes)
  const iv = b.subarray(MAGIC.length, MAGIC.length + 12)
  const tag = b.subarray(MAGIC.length + 12, MAGIC.length + 28)
  const chiffrat = b.subarray(MAGIC.length + 28)
  const decipher = createDecipheriv('aes-256-gcm', schluessel(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(chiffrat), decipher.final()])
}
