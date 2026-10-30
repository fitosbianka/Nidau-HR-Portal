import type { DocumentCategory } from './supabase/types'

// "ferienkonto" and "unfallmeldung" are VIRTUAL categories: the database has a
// CHECK constraint on documents.category, so these documents are stored under
// an allowed category with a label starting with the matching prefix and are
// displayed as their own folder.
export type DisplayCategory = DocumentCategory | 'ferienkonto' | 'unfallmeldung'

export const FERIENKONTO_LABEL_PREFIX = 'Arbeitszeit- und Ferienkonto'
export const UNFALLMELDUNG_LABEL_PREFIX = 'Unfall-/Krankheitsmeldung'

/** Category a document is displayed under (resolves the virtual folders). */
export function documentDisplayCategory(doc: { category?: string | null; label?: string | null }): DisplayCategory {
  const cat = (doc.category ?? 'allgemein') as DocumentCategory
  const label = doc.label ?? ''
  if (cat === 'zeiterfassung' && (label.startsWith(FERIENKONTO_LABEL_PREFIX) || label.startsWith('Ferienkonto'))) return 'ferienkonto'
  if (cat === 'arztzeugnis' && label.startsWith(UNFALLMELDUNG_LABEL_PREFIX)) return 'unfallmeldung'
  return cat
}

export const DOCUMENT_CATEGORIES: Record<
  DisplayCategory,
  {
    label: string
    badgeClass: string
    filterLabel: string
    /** Folder card colours (bg, border, icon text, active bg) */
    folderBg: string
    folderBorder: string
    folderText: string
    folderActiveBg: string
  }
> = {
  vertrag: {
    label: 'Vertrag', badgeClass: 'badge-vertrag', filterLabel: 'Verträge',
    folderBg: 'bg-steel-bg', folderBorder: 'border-steel-ink/25', folderText: 'text-steel-ink',
    folderActiveBg: 'bg-steel-ink',
  },
  lohn: {
    label: 'Lohnabrechnung', badgeClass: 'badge-lohn', filterLabel: 'Lohnabrechnung',
    folderBg: 'bg-mint-bg', folderBorder: 'border-mint-ink/25', folderText: 'text-mint-ink',
    folderActiveBg: 'bg-mint-ink',
  },
  zeiterfassung: {
    label: 'Zeiterfassung', badgeClass: 'badge-zeiterfassung', filterLabel: 'Zeiterfassung',
    folderBg: 'bg-apricot-bg', folderBorder: 'border-apricot-ink/25', folderText: 'text-apricot-ink',
    folderActiveBg: 'bg-apricot-ink',
  },
  ferienkonto: {
    label: 'Arbeitszeit- und Ferienkonto', badgeClass: 'badge-ferienkonto', filterLabel: 'Arbeitszeit- und Ferienkonto',
    folderBg: 'bg-lilac-bg', folderBorder: 'border-lilac-ink/25', folderText: 'text-lilac-ink',
    folderActiveBg: 'bg-lilac-ink',
  },
  arztzeugnis: {
    label: 'Arztzeugnis', badgeClass: 'badge-arztzeugnis', filterLabel: 'Arztzeugnisse',
    folderBg: 'bg-blush-bg', folderBorder: 'border-blush-ink/25', folderText: 'text-blush-ink',
    folderActiveBg: 'bg-blush-ink',
  },
  unfallmeldung: {
    label: 'Unfall-/Krankheitsmeldung', badgeClass: 'badge-unfallmeldung', filterLabel: 'Unfall-/Krankheitsmeldungen',
    folderBg: 'bg-apricot-bg', folderBorder: 'border-apricot-ink/25', folderText: 'text-apricot-ink',
    folderActiveBg: 'bg-apricot-ink',
  },
  allgemein: {
    label: 'Allgemeines', badgeClass: 'badge-allgemein', filterLabel: 'Allgemeines',
    folderBg: 'bg-edge-row', folderBorder: 'border-edge-ctl', folderText: 'text-ink-3',
    folderActiveBg: 'bg-dusk',
  },
}

export const CATEGORY_ORDER: DisplayCategory[] = [
  'vertrag', 'lohn', 'zeiterfassung', 'ferienkonto', 'arztzeugnis', 'unfallmeldung', 'allgemein',
]

// ── Document uploads ─────────────────────────────────────────────────────────
// Allowed file types for the Mitarbeiter/HR folders: PDF, Word, Excel and
// pictures (incl. iPhone photos as HEIC). ONE list for the upload form and
// both server actions, so they can never drift apart.
export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
]
export const DOCUMENT_ACCEPT =
  '.pdf,.xls,.xlsx,.doc,.docx,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,' + DOCUMENT_MIME_TYPES.join(',')
export const DOCUMENT_TYPES_ERROR = 'Nur PDF-, Word-, Excel- und Bilddateien (JPG, PNG, HEIC) sind erlaubt.'

/** documents.file_type value for an uploaded MIME type. */
export function documentFileType(mime: string): 'pdf' | 'word' | 'excel' | 'image' {
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/msword' ||
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'word'
  return 'excel'
}

// Format a date string to Swiss date (e.g. "13.05.2026")
export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Zurich',
  })
}

// Same but returns "—" for null/undefined
export function formatDateOptional(dateString: string | null | undefined): string {
  if (!dateString) return '—'
  return formatDate(dateString)
}

// Format a number as Swiss francs (e.g. "CHF 8'500")
export function formatCHF(value: number | null | undefined): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency: 'CHF',
    maximumFractionDigits: 0,
  }).format(value)
}

// Format a date-time string to Swiss date+time (e.g. "13.05.2026, 14:32")
// timeZone is explicit so server (UTC) and client (CET/CEST) produce identical output
export function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleDateString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich',
  })
}

/** Betrag als «CHF 12'345.60» (Apostroph-Gruppierung, ganze Beträge ohne
 *  Rappen) — gemeinsame Funktion für Parkplätze und Finanzen. */
export function fmtChf(n: number): string {
  const rounded = Math.round(n * 100) / 100
  const [int, dec] = rounded.toFixed(2).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "'")
  return dec === '00' ? `CHF ${grouped}` : `CHF ${grouped}.${dec}`
}
