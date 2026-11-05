# HR Portal Dentalpraxis Nidau, Regeln für die Arbeit am Code

Prototyp für die Dentalpraxis Nidau AG, eine eigenständige Kopie des
HR Portals der Dentalpraxis Kehrsatz (Stand 30.10.2026). Auftraggeberin:
Bianka Fitos. Eigene Datenbank, eigenes Hosting, keine gemeinsamen Daten
mit Kehrsatz.

## Arbeitsweise

- Jede Änderung geht nach der Prüfung direkt auf `main`. Vercel baut von
  `main`.
- Prüfschleife vor jedem Commit: `tsc --noEmit`, `next lint`, `vitest run`,
  `next build` (mit Platzhalter-Umgebungsvariablen für Supabase).
- Keine Modellkennungen in Commits, Code oder Kommentaren.
- Zeitzone: Zürcher Wandzeit nie mit einem geschätzten Offset umrechnen,
  immer über `src/lib/zeitzone.ts`; der Test `zeitzone-waechter.test.ts`
  sperrt solche Stellen.
- Praxisspezifisches nur in `src/config/praxis.ts` (Name, Adresse,
  Rollen) und `src/config/module.ts` (ein- und ausgeschaltete Module),
  nie verstreut im Code.
- Kein Datenbankzugriff aus der Arbeitsumgebung; das vollständige Schema
  liegt in `supabase/schema-nidau.sql`.

## Sprache und Formate

- Oberfläche und Antworten auf Deutsch, Schweizer Schreibweise: nie «ß»,
  immer «ss». Beträge mit Apostroph (CHF 12'351.50), Datum dd.mm.yyyy,
  Zeiten wie «8.00 Uhr».

## Fachliche Vereinbarungen

- **Ferienplanung, rote Wochen:** für ZAZ und DH / PA immer gesperrt. Für
  die Assistenz öffnet sich ein Tag nur, wenn an diesem Tag eine ZAZ fest
  fehlt (F im Arbeitsplan oder akzeptierte Anmeldung, ohne Vertretung und
  ohne ganztägigen Einsatz); offene ZAZ Wünsche öffnen nichts. Pro fehlende
  ZAZ darf an genau diesem Tag eine Person der Assistenz frei nehmen,
  zusätzlich gilt die Wochenregel (Frei muss für die eigenen Tage reichen).
  Umsetzung: `oeffnung` in `kapazitaetFuer`, `src/lib/ferien-kapazitaet.ts`.
- **Ferienanteil pro Wochentag (Teilzeit mit halben Tagen):** pro Person
  kann ein Anteil je Wochentag hinterlegt sein (Personalakte, Abschnitt
  «Ferienanteil pro Wochentag», Standard nach Namen in
  `src/lib/ferien-anteil.ts`). Ein glattes «F» zählt dann den Anteil des
  Tags (Ferientage und Gutschrift 8.30 h mal Anteil), F:x behält sein
  Gewicht. Gilt gleich im Konto, in der Zeiterfassung, in der Ferienplanung
  (Kosten einer Anmeldung) und in der Kapazität (Praxistage nur an Tagen in
  der Praxis). Im Prototyp ist kein Namensstandard hinterlegt. Das Monatssoll bleibt Werktage mal 8.30 h mal
  Pensum.

## Stand des Prototyps

- Abgeschaltet: Parkplätze, Geschäftsanalyse (Finanzen), Teamevents,
  Lohnabrechnungen, «Jetzt anwesend», HR Dokumente.
- Admin und Stempeluhr: Bianka Fitos. Bestellverantwortliche: Caroline
  Soldati. Keine Ferien Editorin, keine Externen, keine Personen mit
  Verfügbarkeitsliste.
- TimeMoto ist noch nicht verbunden; der Webhook unter
  `/api/timemoto/webhook` ist bereit.
- Einrichtung Schritt für Schritt: `ANLEITUNG-NIDAU.md`.
