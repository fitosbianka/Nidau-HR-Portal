// Praxis Konfiguration für diese Installation (Dentalpraxis Nidau).
// Alles, was praxisspezifisch ist, steht hier an einer Stelle; der übrige
// Code liest diese Werte. Namen müssen profiles.full_name entsprechen.

export const PRAXIS = {
  name: 'Dentalpraxis Nidau',
  firma: 'Dentalpraxis Nidau AG',
  ort: 'Nidau',
  adresse: 'Knettnauweg 17, 2560 Nidau',
  telefon: '032 323 84 84',
  domain: 'dentalpraxisnidau.ch',
  /** Funktionen, die stempeln: Zeiterfassung, Arbeitszeit- und Ferienkonto, Monatsberichte */
  zeiterfassungFunktionen: ['DA', 'Leitende DA', 'Lernende'] as string[],
  /** Einzelne Personen mit anderer Funktion, die trotzdem stempeln (voller Name) */
  zeiterfassungZusaetzlich: [] as string[],
  /** Ferien Editorin neben den Admins (niemand) */
  ferienEditoren: [] as string[],
  /** Bestellverantwortliche: bekommt die Erinnerungen beim Anmelden */
  bestellerName: 'Caroline Soldati',
  /** Personen ohne Ferienplanung (Inhaber, Verwaltung ohne Pensum) */
  ferienAusgeschlossen: ['Bianka Fitos'],
  /** Personen mit Verfügbarkeitsliste statt fester Standardwoche */
  verfuegbarkeitPersonen: [] as string[],
  /** Externe, selbständige Mitarbeitende (zusätzlich zur Markierung in der Personalakte) */
  externeNamen: [] as string[],
}
