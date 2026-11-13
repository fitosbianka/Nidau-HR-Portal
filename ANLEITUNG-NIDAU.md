# HR Portal Dentalpraxis Nidau, Einrichtung Schritt für Schritt

Prototyp des HR Portals für die Dentalpraxis Nidau AG, Knettnauweg 17,
2560 Nidau. Eigene Datenbank, eigenes Hosting, eigene Adresse; die
beiden Praxen teilen keine Daten.

Du brauchst: dein GitHub Konto, dein Vercel Konto, dein Supabase Konto und
etwa 45 Minuten. Die Reihenfolge ist wichtig: zuerst GitHub, dann Supabase,
dann Vercel, dann die Adressen verbinden.

## Teil A, GitHub (5 Minuten)

1. Auf github.com anmelden, oben rechts auf «+» und «New repository».
2. Owner: fitosbianka. Repository name: `nidau-hr-portal`. Sichtbarkeit:
   «Private». Nichts ankreuzen (kein README, keine .gitignore, keine
   Licence). «Create repository».
3. Erledigt: der Code liegt auf `main` in `fitosbianka/nidau-hr-portal`.

## Teil B, Supabase (15 Minuten)

1. Auf supabase.com anmelden, «New project». Organisation: deine. Name:
   `nidau-hr-portal`. Database Password: generieren lassen und im
   Passwortmanager ablegen (du brauchst es selten, darfst es aber nie
   verlieren). Region: «Central Europe (Zurich)», damit Datenbank, Logins
   und Dokumente in der Schweiz liegen. «Create new project» und zwei
   Minuten warten, bis das Projekt bereit ist.
2. Links «SQL Editor», «New query». Den ganzen Inhalt der Datei
   `supabase/schema-nidau.sql` aus dem Repo einfügen und «Run». Unten muss
   «Success. No rows returned» stehen. Diese Datei legt alle Tabellen, den
   Dateispeicher und die Zugriffsregeln an.
3. Links «Authentication», «Users», «Add user», «Create new user»:
   `fitosbianka@gmail.com`, ein Passwort deiner Wahl, Haken bei «Auto
   Confirm User». «Create user». Das ist dein Admin Login.
4. Wieder «SQL Editor», «New query», Inhalt von
   `supabase/admin-befoerdern.sql` einfügen (deine E-Mail steht schon
   drin), «Run». Damit bist du Admin mit der Funktion Admin.
5. «Authentication», «Sign In / Providers» (je nach Version «Providers»):
   «Email» bleibt eingeschaltet. Den Schalter «Allow new users to sign up»
   ausschalten. Konten erstellt immer der Admin im Portal; die Mail
   braucht es nur für «Passwort vergessen» beim Login.
6. «Project Settings» (Zahnrad unten links), «API Keys». Drei Werte
   kopieren und bereithalten:
   - Project URL, sieht aus wie `https://abcdefgh.supabase.co` (unter
     «Data API» oder oben auf der Seite «API Keys»)
   - Publishable key, beginnt mit `sb_publishable_`
   - Secret key, beginnt mit `sb_secret_` (mit dem Augensymbol einblenden,
     dann kopieren; streng geheim, nie an Dritte, nie in eine Mail)
   Die älteren Schlüssel `anon` und `service_role` unter «View legacy API
   keys» (beginnen mit `eyJ`) gehen ebenfalls, aber nur bis Anfang 2027.
   Das Portal nimmt beide Arten.
7. Kontrolle: «Storage», «Buckets». Dort muss `employee-documents` stehen,
   privat. Fehlt er, «New bucket», Name `employee-documents`, «Public
   bucket» aus.

## Teil C, Vercel (10 Minuten)

1. Auf vercel.com anmelden, «Add New…», «Project». Unter «Import Git
   Repository» `fitosbianka/nidau-hr-portal` wählen und «Import». Fehlt das
   Repo in der Liste: «Adjust GitHub App Permissions» und dem neuen Repo
   Zugriff geben.
2. Framework Preset: Next.js (wird erkannt). Root Directory: `./`. Build
   Einstellungen nicht ändern.
3. «Environment Variables» aufklappen und vier Einträge erfassen. Name
   genau so schreiben, Wert ohne Anführungszeichen, alle drei Umgebungen
   angehakt (Production, Preview, Development):

   | Name | Wert |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL aus Teil B |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key aus Teil B (`sb_publishable_…`) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Secret key aus Teil B (`sb_secret_…`) |
   | `NEXT_PUBLIC_APP_URL` | `https://hr-portal-nidau.vercel.app` |

4. «Deploy». Nach zwei bis drei Minuten erscheint «Congratulations» mit der
   Adresse des Portals, zum Beispiel `hr-portal-nidau.vercel.app`.
5. Weicht die echte Adresse von `https://hr-portal-nidau.vercel.app` ab:
   «Settings», «Environment Variables», `NEXT_PUBLIC_APP_URL` auf die echte
   Adresse ändern, dann «Deployments», beim neuesten Eintrag «Redeploy».
6. Später, nicht für den Prototyp: eigene Adresse wie
   `portal.dentalpraxisnidau.ch` unter «Settings», «Domains» hinzufügen und
   beim Domain Anbieter den angezeigten CNAME Eintrag setzen.

## Teil D, Supabase mit der Portaladresse verbinden (3 Minuten)

1. Supabase, «Authentication», «URL Configuration». Site URL:
   `https://hr-portal-nidau.vercel.app` (deine echte Adresse). Unter
   Redirect URLs hinzufügen: `https://hr-portal-nidau.vercel.app/**`.
   «Save». Ohne das läuft der Link von «Passwort vergessen» ins Leere.
2. Konten und Passwörter kommen vom Admin (Teil E), dafür verschickt das
   Portal keine Mails. Nur «Passwort vergessen» beim Login schickt eine
   Mail über Supabase. Im Gratisplan sind das wenige Mails pro Stunde,
   und der Link funktioniert nur mit den Adressen aus Punkt 1. Kommt die
   Mail nicht an, setzt du das Passwort in der Personalakte unter
   «Zugriff» neu und gibst es der Person.

## Teil E, erster Login und Team (15 Minuten)

1. Portaladresse öffnen, mit `fitosbianka@gmail.com` und deinem Passwort
   anmelden. Du landest auf der Startseite als Admin.
2. «Mitarbeiter», «Mitarbeiter hinzufügen»: Name, Funktion, E-Mail
   wahlweise. Für die Präsentation die E-Mail leer lassen: die Person wird
   ohne Portal Konto geführt, alle Angaben (Personalakte, Standardwoche,
   Arbeitsplan, Zeiten, Dokumente) lassen sich trotzdem erfassen. In der
   Liste steht dann «Ohne Portal Konto».
3. Konto später erstellen: Personalakte der Person, Abschnitt «Zugriff»,
   E-Mail eintragen, «Konto erstellen». Das Portal zeigt einmalig ein
   Startpasswort, das du kopierst und der Person weitergibst (zum
   Beispiel per WhatsApp). Sie meldet sich damit an; sie darf das
   Passwort behalten oder unter «Passwort ändern» ein eigenes setzen.
   Alles vorher Erfasste bleibt an derselben Person. Hat jemand das
   Passwort vergessen: «Passwort vergessen» beim Login, oder du setzt am
   gleichen Ort mit «Neues Passwort setzen» ein neues.
4. Die Funktionen sind feste Werte, weil Plan, Ferienplanung und
   Zeiterfassung danach rechnen:

   | Funktion | Wer |
   |---|---|
   | Admin | Praxisleitung mit allen Rechten (du) |
   | HR & Finanzen | Person für Personal und Finanzen, ebenfalls alle Rechte |
   | ZAZ | Zahnärztinnen und Zahnärzte |
   | DH | Dentalhygiene |
   | PA | Prophylaxe |
   | Leitende DA | Leitende Dentalassistentin |
   | DA | Dentalassistentinnen |
   | Lernende | Lernende |

   Admin und HR & Finanzen erhalten die Admin Rechte automatisch. Zur
   Zeiterfassung (Stempeln, Arbeitszeit- und Ferienkonto) gehören DA,
   Leitende DA und Lernende; die Liste steht in `src/config/praxis.ts`.
   Persönliche Angaben (AHV, Adresse, Geburtstag) trägst du direkt in der
   Personalakte ein. Bitte schick sie mir nicht im Chat.
5. «Mitarbeiter-Standards»: Standardwoche pro Person setzen. Dann
   «Arbeitsplan», Monat wählen, Standards anwenden, Plan prüfen und
   veröffentlichen.
6. «Berichte», «TimeMoto Import»: im TimeMoto Portal den Bericht
   «Timesheet» für alle Mitarbeitenden und den ganzen Monat als PDF,
   Excel oder CSV exportieren und als eine Datei hochladen. Das Portal
   trennt die Zeiten pro Person anhand der Abschnitte «Name:». Die
   Vorschau zeigt pro Person Tage, Stempel, Zeitraum und das zugeordnete
   Profil; einen unbekannten Namen ordnest du einmal zu, das Portal merkt
   sich das. Erst «Importieren» speichert. Danach stehen die Zeiten in
   der Zeiterfassung, im Arbeitszeit- und Ferienkonto und bei den
   Mitarbeitenden unter «Meine Zeiten». Dieselbe Datei zweimal
   hochzuladen ergibt keine Doppelten.
   Einzelne Zeiten trägst du in der Zeiterfassung mit «Eintrag
   hinzufügen» ein. Der Webhook für das Terminal kommt später dazu
   (Adresse `https://DEINE-ADRESSE/api/timemoto/webhook` im TimeMoto
   Portal eintragen).
7. «Ferienplanung»: «Regeln bearbeiten» (Plätze pro Farbe, Assistenz
   Bedarf) und «Fristen bearbeiten» setzen. Danach können Mitarbeitende
   Wochen anmelden.
8. «Bestellungen»: die Bestellverantwortliche steht in
   `src/config/praxis.ts` und bekommt die Erinnerungen beim Anmelden.

## Teil F, was im Prototyp anders ist

- Abgeschaltet, Code bleibt: Kontrolle Vormonat mit Kontroll-Regeln,
  «Jetzt anwesend» (braucht den Webhook), Lohnabrechnungen, HR Dokumente
  (allgemeine Vorlagen für Admins; die Dokumente in der Personalakte und
  «Meine Dokumente» bleiben). Die Schalter stehen in
  `src/config/module.ts`; einschalten heisst, das Modul dort aus der
  Liste nehmen.
- Entfernt: Parkplätze, Geschäftsanalyse, Teamevents, Anekdoten, Meine
  Stempeluhr, Einladungsmail. Zeitkorrekturen (Meldungen der
  Mitarbeitenden) und «Passwort vergessen» bleiben.
- Alles Praxisspezifische steht in `src/config/praxis.ts`: Name, Adresse,
  wer stempelt, wer Bestellungen verantwortet, wer Ferien bearbeiten darf.
  Keine Namen, Löhne oder Regeln aus einer anderen Praxis im Code.
- Logo und App Symbole stammen von der Nidau Website.
- Das Arbeitszeitkonto startet ohne Altdaten und rechnet alles live.
- Ferienanspruch: 5 Wochen für alle, Abweichungen pro Person passt du im
  Planungsstand an.

## Kosten und Konten

- Supabase: Gratisplan reicht für den Prototyp. Projekte im Gratisplan
  werden nach einer Woche ohne Zugriffe pausiert; vor der Präsentation
  einmal einloggen, dann läuft es wieder.
- Vercel: Hobby Plan ist nur für private Nutzung erlaubt. Für den
  Prototyp ist das vertretbar, für den Betrieb braucht Nidau einen
  bezahlten Plan.
- Zugänge bleiben bei dir. Für die Präsentation reicht dein Admin Login,
  Konten für die Mitarbeitenden erstellst du erst, wenn das Portal
  wirklich kommt.

## Wenn etwas nicht klappt

- Login geht nicht: in Supabase unter «Authentication», «Users» prüfen,
  ob der Benutzer «Confirmed» ist, und in Vercel, ob alle vier
  Umgebungsvariablen gesetzt sind (danach «Redeploy»).
- Seite zeigt «Keine Berechtigung»: `supabase/admin-befoerdern.sql`
  nochmals ausführen.
- Import erkennt die Datei nicht: beim Timesheet braucht es pro Person
  die Zeile «Name:» und die Tabelle mit Date, IN und OUT; bei Listen
  eine Kopfzeile mit Name, Datum, Zeit (oder Zeitstempel) und Ein/Aus.
  Mir die Kopfzeile schicken (ohne Namen), dann ergänze ich das Format.
- Bei allem anderen: mir die Meldung schicken, ich schaue in den Code.
