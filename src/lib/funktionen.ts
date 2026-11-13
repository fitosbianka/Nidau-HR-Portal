// Funktionen (Rollen) der Mitarbeitenden in dieser Installation. Die
// Funktion steht in profiles.job_title; Admin und HR & Finanzen sind
// Verwaltungsfunktionen mit der Rolle admin (alle Bereiche). HR & Finanzen
// ist zusätzlich für die Module Lohnabrechnungen und Finanzen vorgesehen,
// sobald diese eingeschaltet werden.

export const FUNKTIONEN = ['Admin', 'HR & Finanzen', 'Leitende DA', 'DA', 'ZAZ', 'DH', 'PA', 'Lernende'] as const
export type Funktion = (typeof FUNKTIONEN)[number]

export const VERWALTUNG_FUNKTIONEN: readonly string[] = ['Admin', 'HR & Finanzen']
export const istVerwaltungsFunktion = (jobTitle: string | null | undefined) => VERWALTUNG_FUNKTIONEN.includes((jobTitle ?? '').trim())
export const istFunktion = (v: unknown): v is Funktion => typeof v === 'string' && (FUNKTIONEN as readonly string[]).includes(v)

/** Funktionen, die eine externe (selbständige) Person haben kann */
export const EXTERN_FUNKTIONEN = ['ZAZ', 'DH', 'PA', 'DA', 'Leitende DA', 'Lernende'] as const

/** Behandler Gruppen im Arbeitsplan und in der Ferienplanung */
export const istDhPa = (jobTitle: string | null | undefined) => { const t = (jobTitle ?? '').trim(); return t === 'DH / PA' || t === 'DH' || t === 'PA' }
