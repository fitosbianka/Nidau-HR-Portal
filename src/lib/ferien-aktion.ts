// Laufende Aktionen der Ferienplanung (Admin): Schlüssel pro Wunsch oder
// Woche, damit der gedrückte Knopf sofort «Wird eingetragen …» zeigt.

export type Aktion = 'akzeptieren' | 'ablehnen' | 'zuruecknehmen' | 'loeschen'
/** Eine Woche eines Wunsches über mehrere Wochen (Von, Bis, Arbeitstage ohne Feiertage) */
export type Teil = { from: string; to: string; tage: string[] }
/** Schlüssel einer laufenden Aktion: «<employeeId>_<from>:<aktion>» */
export const aktionKey = (employeeId: string, from: string, aktion: Aktion) => `${employeeId}_${from}:${aktion}`
export const LAUFEND: Record<Aktion, string> = { akzeptieren: 'Wird eingetragen …', ablehnen: 'Wird abgelehnt …', zuruecknehmen: 'Wird zurückgenommen …', loeschen: 'Wird gelöscht …' }
