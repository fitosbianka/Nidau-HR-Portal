// Geschäftsanalyse — Datenmodell. Beträge IMMER in Rappen (ganze Zahlen),
// nie mit Kommazahlen summieren. Negativ = Ausgabe, positiv = Einnahme.
//
// Ablage:
//  · Buchungen als JSON im privaten Bucket employee-documents unter
//    _finanzen/ubs/<kontoKey>/<jahr>.json (kontoKey = IBAN ohne Leerzeichen);
//    Originaldateien unter _finanzen/ubs/originale/. KEIN Eintrag in der
//    Tabelle documents — die Dateien erscheinen in keinem Dokumentenordner.
//  · Kleine Konfiguration als reservierte Zeilen in zeiterfassung_comments,
//    Präfix __finanz_, schedule_date immer 1970-01-01 (wie PP_ANCHOR).

export type Buchung = {
  id: string                 // stabiler Schlüssel (Hash + Zähler, siehe ubs-csv)
  kontoKey: string
  buchungsdatum: string      // YYYY-MM-DD, bestimmt den Monat
  valutadatum: string | null
  betragRp: number           // in Rappen, negativ = Ausgabe, positiv = Einnahme
  waehrung: string
  saldoRp: number | null     // Saldo laut Bank nach dieser Buchung, falls geliefert
  transaktionsNr: string
  text1: string
  text2: string
  text3: string
  /** Einzelbeträge einer Sammelbuchung — zählen NIE zusätzlich zur Summe */
  details: Array<{ betragRp: number; text1: string; text3: string }>
  kategorieManuell: string | null   // von Hand gesetzt, sonst null
  importId: string
}

export type MonatsInfo = {
  saldoMonatsendeRp: number | null
  /** der Import deckt den ganzen Monat ab */
  vollstaendig: boolean
  abgleichOk: boolean | null
}

export type Jahresdatei = {
  kontoKey: string
  jahr: number
  monate: Record<string, MonatsInfo>   // Schlüssel YYYY-MM
  buchungen: Buchung[]
}

export type FinanzKonto = {
  kontoKey: string
  name: string
  iban: string
}

export type ImportEintrag = {
  importId: string
  am: string                 // ISO-Zeitpunkt
  dateiname: string
  kontoKey: string
  von: string | null
  bis: string | null
  anzahl: number
  einnahmenRp: number
  ausgabenRp: number         // positiv dargestellt
  abgleichOk: boolean | null
  importiertVon: string
  monate: string[]
}

// Reservierte Schlüssel in zeiterfassung_comments
export const FINANZ_ANCHOR = '1970-01-01'
export const FINANZ_KONTO_PREFIX = '__finanz_konto__'
export const FINANZ_IMPORT_PREFIX = '__finanz_import__'
