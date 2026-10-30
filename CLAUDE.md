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

## Stand des Prototyps

- Abgeschaltet: Parkplätze, Geschäftsanalyse (Finanzen), Teamevents,
  Lohnabrechnungen, «Jetzt anwesend», HR Dokumente.
- Admin und Stempeluhr: Bianka Fitos. Bestellverantwortliche: Caroline
  Soldati. Keine Ferien Editorin, keine Externen, keine Personen mit
  Verfügbarkeitsliste.
- TimeMoto ist noch nicht verbunden; der Webhook unter
  `/api/timemoto/webhook` ist bereit.
- Einrichtung Schritt für Schritt: `ANLEITUNG-NIDAU.md`.
