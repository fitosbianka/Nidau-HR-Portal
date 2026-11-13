// Praxis Konfiguration für diese Installation (Prototyp Dentalpraxis Nidau).
// Alles, was praxisspezifisch ist, steht hier an einer Stelle; der übrige
// Code liest diese Werte. Namen müssen profiles.full_name entsprechen.

export const PRAXIS = {
  name: 'Dentalpraxis Nidau',
  firma: 'Dentalpraxis Nidau AG',
  ort: 'Nidau',
  adresse: 'Knettnauweg 17, 2560 Nidau',
  telefon: '032 323 84 84',
  domain: 'dentalpraxisnidau.ch',
  /** Ferien Editorin neben den Admins (im Prototyp niemand) */
  ferienEditoren: [] as string[],
  /** Bestellverantwortliche: bekommt die Erinnerungen beim Anmelden */
  bestellerName: 'Caroline Soldati',
  /** Personen ohne Ferienplanung (Inhaber, Externe) */
  ferienAusgeschlossen: ['Bianka Fitos'],
  /** Personen mit Verfügbarkeitsliste statt fester Standardwoche */
  verfuegbarkeitPersonen: [] as string[],
  /** Externe, selbständige Mitarbeitende */
  externeNamen: [] as string[],
  /** Namen pro Person, die beim Zeiterfassungs Terminal anders geschrieben sind: nicht nötig */
}
