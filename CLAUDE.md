# HR Portal Dentalpraxis Nidau, Regeln für die Arbeit am Code

Prototyp für die Dentalpraxis Nidau AG, eine eigenständige Kopie des
HR Portals einer anderen Praxis (Stand 30.10.2026), seither eigenständig
weiterentwickelt. Auftraggeberin: Bianka Fitos. Eigene Datenbank,
eigenes Hosting, keine gemeinsamen Daten mit einer anderen Praxis.

## Arbeitsweise

- Jede Änderung geht nach der Prüfung direkt auf `main`. Vercel baut von
  `main`.
- Prüfschleife vor jedem Commit: `tsc --noEmit`, `next lint`, `vitest run`,
  `next build` (mit Platzhalter-Umgebungsvariablen für Supabase).
- Keine Modellkennungen in Commits, Code oder Kommentaren.
- Zeitzone: Zürcher Wandzeit nie mit einem geschätzten Offset umrechnen,
  immer über `src/lib/zeitzone.ts`; der Test `zeitzone-waechter.test.ts`
  sperrt solche Stellen.
- Praxisspezifisches nur in `src/config/praxis.ts` (Name, Adresse, wer
  stempelt, Rollen) und `src/config/module.ts` (ein- und ausgeschaltete
  Module), nie verstreut im Code. Keine Namen, Löhne, Regeln oder Daten
  aus einer anderen Praxis im Code, auch nicht in Tests und Kommentaren.
- Kein Datenbankzugriff aus der Arbeitsumgebung; das vollständige Schema
  liegt in `supabase/schema-nidau.sql`.

## Sprache und Formate

- Oberfläche und Antworten auf Deutsch, Schweizer Schreibweise: nie «ß»,
  immer «ss». Beträge mit Apostroph (CHF 12'351.50), Datum dd.mm.yyyy,
  Zeiten wie «8.00 Uhr».

## Fachliche Vereinbarungen

- **Funktionen (Rollen):** Admin, HR & Finanzen, Leitende DA, DA, ZAZ,
  DH, PA, Lernende (`src/lib/funktionen.ts`). Admin und HR & Finanzen
  haben die Rolle admin; die Rolle folgt der Funktion beim Anlegen und
  beim Ändern in der Personalakte (`updatePersonalDetails`), der letzte
  Admin und das eigene Konto verlieren die Rechte nie.
- **Konten ohne E-Mail:** Mitarbeitende werden auch ohne E-Mail angelegt
  (Platzhalter Adresse auf `kein-login.invalid`, unbekanntes Passwort,
  `src/lib/konto-status.ts`). Alle Daten hängen an der Profil ID. Das
  Konto entsteht später in der Personalakte unter «Zugriff» mit der
  E-Mail und einem Startpasswort (`kontoErstellen`), das die Person
  behalten darf; der Admin kann jederzeit ein neues setzen
  (`passwortNeuSetzen`). Keine Einladungsmails; «Passwort vergessen»
  beim Login bleibt (Supabase Mail, Redirect URL in der Anleitung).
- **Zeiterfassung:** solange kein Webhook läuft, kommen die Zeiten über
  «TimeMoto Import» (`src/lib/timemoto-import.ts`, Aktionen in
  `src/actions/timemoto-import.ts`). Eine Datei mit allen Mitarbeitenden:
  der Timesheet Bericht als PDF (`src/lib/timemoto-timesheet.ts`, pdfjs
  in `src/lib/pdf-text.ts`, Abschnitte «Name:», IN und OUT nach der x
  Position der Kopfzeile) oder als CSV und XLSX (Abschnittszeilen,
  Fortsetzungszeilen ohne Datum). Spalten über die Kopfzeile, nie nach
  Position; Zeiten sind Zürcher Wandzeit; Ereignis IDs
  `import_<hash(person|typ|zeit)>`, bestehende Zeilen werden nie
  überschrieben (Zeit-Sperre wie beim Webhook). Wer stempelt, steht in
  `PRAXIS.zeiterfassungFunktionen` (DA, Leitende DA, Lernende).
- **Ferienplanung, rote Wochen:** für ZAZ und DH / PA immer gesperrt. Für
  die Assistenz öffnet sich ein Tag nur, wenn an diesem Tag eine ZAZ fest
  fehlt (F im Arbeitsplan oder akzeptierte Anmeldung, ohne Vertretung und
  ohne ganztägigen Einsatz); offene ZAZ Wünsche öffnen nichts. Pro fehlende
  ZAZ darf an genau diesem Tag eine Person der Assistenz frei nehmen,
  zusätzlich gilt die Wochenregel (Frei muss für die eigenen Tage reichen).
  Umsetzung: `oeffnung` in `kapazitaetFuer`, `src/lib/ferien-kapazitaet.ts`.
- **Ferienanteil pro Wochentag (Teilzeit mit halben Tagen):** pro Person
  kann ein Anteil je Wochentag hinterlegt sein (Personalakte, Abschnitt
  «Ferienanteil pro Wochentag»). Ein glattes «F» zählt dann den Anteil des
  Tags (Ferientage und Gutschrift 8.30 h mal Anteil), F:x behält sein
  Gewicht. Gilt gleich im Konto, in der Zeiterfassung, in der Ferienplanung
  und in der Kapazität. Kein Namensstandard hinterlegt. Das Monatssoll
  bleibt Werktage mal 8.30 h mal Pensum.
- **Pensumwoche (Teilzeit mit ganzen Tagen):** eine Kalenderwoche, die an
  allen Arbeitstagen (Mo bis Fr ohne Feiertage) F trägt, zählt Pensum mal
  Arbeitstage (50 % = 2,5 Tage und 21.15 h), einzelne F-Tage je einen Tag.
  Umsetzung `pensumWocheGewichte` in `src/lib/ferien-pensumwoche.ts`,
  angewendet im Konto und in den Berichten; die Ferienplanung zählt gleich
  (`ferientageZaehlen`). Die Konto-Seite zeigt dazu die «Prüfung
  Ferientage Teilzeit» (Admins).
- **Ferienanspruch:** Anspruch = Wochen × 5 Tage × Pensum plus Korrektur
  in Tagen. Praxisregel 5 Wochen für alle (`src/lib/ferien-anspruch.ts`,
  keine Namensliste), Admins passen Wochen und Korrektur pro Person im
  Planungsstand an (`anspruchAnpassen`, Zeile `__ferien_anspruch__<id>`).
- **Samstage:** pro Rolle nur so viele Selbstanmeldungen, wie der Bedarf
  des Samstags vorgibt (Standard je 1). Ist die Rolle besetzt, sieht die
  Person «Besetzt» statt «Ich kann», bereits Angemeldete bleiben, Admins
  und Ferien Editorinnen tragen weiterhin direkt ein. Umsetzung
  `samstagVoll` in `src/lib/samstage.ts`.

## Stand des Prototyps

- Abgeschaltet (Code bleibt, Schalter in `src/config/module.ts`):
  Kontrolle Vormonat samt Kontroll-Regeln, «Jetzt anwesend»,
  Lohnabrechnungen, HR Dokumente (Admin Vorlagen).
- Entfernt: Parkplätze, Geschäftsanalyse, Teamevents, Anekdoten, Meine
  Stempeluhr mit Aufgaben Zeiterfassung, Externe Einsätze, Gastkonten,
  Einladungsmail.
- Erster Admin: Bianka Fitos (`supabase/admin-befoerdern.sql`).
  Bestellverantwortliche: Caroline Soldati. Keine Ferien Editorin, keine
  Externen, keine Personen mit Verfügbarkeitsliste.
- TimeMoto ist noch nicht verbunden; der Webhook unter
  `/api/timemoto/webhook` ist bereit, bis dahin der Import.
- Einrichtung Schritt für Schritt: `ANLEITUNG-NIDAU.md`.
