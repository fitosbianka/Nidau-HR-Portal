// Portal Konto einer Person. Mitarbeitende können ohne E-Mail angelegt
// werden: das Login Konto trägt dann eine Platzhalter Adresse auf einer
// ungültigen Domain und ein unbekanntes Passwort, kann sich also nie
// anmelden. Sobald der Admin eine E-Mail setzt (Personalakte, Abschnitt
// «Zugriff», «Konto erstellen»), wird dasselbe Konto mit Startpasswort
// freigeschaltet. Die Profil ID und damit alle Daten (Arbeitsplan, Zeiten,
// Dokumente, Ferien, Verlauf) bleiben dabei unverändert.

export const OHNE_KONTO_DOMAIN = 'kein-login.invalid'
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Hat die Person ein Konto, mit dem sie sich anmelden kann? */
export function hatPortalKonto(email: string | null | undefined): boolean {
  const e = (email ?? '').trim().toLowerCase()
  return !!e && !e.endsWith(`@${OHNE_KONTO_DOMAIN}`)
}

/** Platzhalter Adresse für ein Profil ohne Login, eindeutig pro Anlage. */
export function platzhalterEmail(fullName: string, vorsilbe = 'ohne-login'): string {
  const slug = fullName.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'person'
  return `${vorsilbe}-${slug}-${Date.now().toString(36)}@${OHNE_KONTO_DOMAIN}`
}

export const OHNE_KONTO_TEXT = 'Ohne Portal Konto'
