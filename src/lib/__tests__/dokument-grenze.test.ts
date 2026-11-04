import { describe, expect, it } from 'vitest'
import { DOCUMENT_MAX_BYTES, DOCUMENT_MAX_MB, DOCUMENT_SIZE_ERROR, storageUploadFehler } from '@/lib/utils'

describe('Grösse von Mitarbeiter- und HR-Dokumenten', () => {
  it('erlaubt gescannte Verträge bis 50 MB', () => {
    expect(DOCUMENT_MAX_MB).toBe(50)
    expect(DOCUMENT_MAX_BYTES).toBe(50 * 1024 * 1024)
    expect(DOCUMENT_SIZE_ERROR).toBe('Die Datei darf maximal 50 MB gross sein.')
  })
  it('übersetzt die Ablehnung des Storage wegen Grösse, andere Fehler bleiben sichtbar', () => {
    expect(storageUploadFehler('The object exceeded the maximum allowed size')).toMatch(/Supabase Storage.*mindestens 50 MB/)
    expect(storageUploadFehler('Payload too large')).toMatch(/Upload file size limit/)
    expect(storageUploadFehler('new row violates row-level security policy')).toBe('Fehler beim Hochladen: new row violates row-level security policy')
    expect(storageUploadFehler(undefined)).toBe('Fehler beim Hochladen: unbekannt')
  })
})
