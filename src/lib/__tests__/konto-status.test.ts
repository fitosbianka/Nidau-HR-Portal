import { describe, expect, it } from 'vitest'
import { hatPortalKonto, platzhalterEmail, OHNE_KONTO_DOMAIN } from '@/lib/konto-status'

describe('Portal Konto: Profile ohne Login tragen eine Platzhalter Adresse', () => {
  it('erkennt echte Konten und Platzhalter', () => {
    expect(hatPortalKonto('anna.muster@beispiel.ch')).toBe(true)
    expect(hatPortalKonto(' Anna.Muster@Beispiel.ch ')).toBe(true)
    expect(hatPortalKonto(platzhalterEmail('Anna Muster'))).toBe(false)
    expect(hatPortalKonto(`extern-anna-muster-abc@${OHNE_KONTO_DOMAIN}`)).toBe(false)   // ältere externe Profile
    expect(hatPortalKonto('')).toBe(false)
    expect(hatPortalKonto(null)).toBe(false)
  })
  it('bildet eindeutige, gültige Platzhalter ohne Umlaute und Sonderzeichen', () => {
    const a = platzhalterEmail('Léonie Röthlisberger-Müller')
    expect(a).toMatch(new RegExp(`^ohne-login-leonie-rothlisberger-muller-[a-z0-9]+@${OHNE_KONTO_DOMAIN.replace('.', '\\.')}$`))
    expect(platzhalterEmail('Anna Muster', 'extern')).toMatch(/^extern-anna-muster-/)
    expect(platzhalterEmail('   ')).toMatch(/^ohne-login-person-/)
  })
})
