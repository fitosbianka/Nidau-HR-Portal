# HR Portal Dentalpraxis Nidau, Einrichtung Schritt für Schritt

Prototyp des HR Portals für die Dentalpraxis Nidau AG, Knettnauweg 17,
2560 Nidau. Eine eigene Kopie des Kehrsatz Portals mit eigener Datenbank,
eigenem Hosting und eigener Adresse. Die beiden Praxen teilen keine Daten.

Du brauchst: dein GitHub Konto, dein Vercel Konto, dein Supabase Konto und
etwa 45 Minuten. Die Reihenfolge ist wichtig: zuerst GitHub, dann Supabase,
dann Vercel, dann die Adressen verbinden.

## Teil A, GitHub (5 Minuten)

1. Auf github.com anmelden, oben rechts auf «+» und «New repository».
2. Owner: fitosbianka. Repository name: `hr-portal-nidau`. Sichtbarkeit:
   «Private». Nichts ankreuzen (kein README, keine .gitignore, keine
   Licence). «Create repository».
3. Mir Bescheid geben: «Repo ist da». Ich lade den fertig vorbereiteten Code
   hoch (Logo, Name, Module, Schema liegen bereit). Danach steht in
   GitHub ein Branch `main` mit allen Dateien.

## Teil B, Supabase (15 Minuten)

1. Auf supabase.com anmelden, «New project». Organisation: deine. Name:
   `hr-portal-nidau`. Database Password: generieren lassen und im
   Passwortmanager ablegen (du brauchst es selten, darfst es aber nie
   verlieren). Region: «Central EU (Frankfurt)». «Create new project» und
   zwei Minuten warten, bis das Projekt bereit ist.
2. Links «SQL Editor», «New query». Den ganzen Inhalt der Datei
   `supabase/schema-nidau.sql` aus dem Repo einfügen und «Run». Unten muss
   «Success. No rows returned» stehen. Diese Datei legt alle Tabellen, den
   Dateispeicher und die Zugriffsregeln an.
3. Links «Authentication», «Users», «Add user», «Create new user»: deine
   E-Mail, ein Passwort, Haken bei «Auto Confirm User». «Create user».
4. Wieder «SQL Editor», «New query», Inhalt von
   `supabase/admin-befoerdern.sql` einfügen, oben deine E-Mail eintragen,
   «Run». Damit bist du Admin.
5. «Authentication», «Sign In / Providers» (je nach Version «Providers»):
   «Email» bleibt eingeschaltet. Den Schalter «Allow new users to sign up»
   ausschalten. Mitarbeitende werden immer vom Admin eingeladen.
6. «Project Settings» (Zahnrad unten links), «API» beziehungsweise
   «API Keys». Drei Werte kopieren und bereithalten:
   - Project URL, sieht aus wie `https://abcdefgh.supabase.co`
   - `anon` `public` Schlüssel (langer Text, beginnt mit `eyJ`)
   - `service_role` `secret` Schlüssel (ebenfalls lang, streng geheim, nie
     an Dritte, nie in eine Mail)
7. Kontrolle: «Storage», «Buckets». Dort muss `employee-documents` stehen,
   privat. Fehlt er, «New bucket», Name `employee-documents`, «Public
   bucket» aus.

## Teil C, Vercel (10 Minuten)

1. Auf vercel.com anmelden, «Add New…», «Project». Unter «Import Git
   Repository» `fitosbianka/hr-portal-nidau` wählen und «Import». Fehlt das
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
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public Schlüssel aus Teil B |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role Schlüssel aus Teil B |
   | `NEXT_PUBLIC_APP_URL` | `https://hr-portal-nidau.vercel.app` |

4. «Deploy». Nach zwei bis drei Minuten erscheint «Congratulations» mit der
   Adresse des Portals, zum Beispiel `hr-portal-nidau.vercel.app`.
5. Weicht die echte Adresse von `https://hr-portal-nidau.vercel.app` ab:
   «Settings», «Environment Variables», `NEXT_PUBLIC_APP_URL` auf die echte
   Adresse ändern, dann «Deployments», beim neuesten Eintrag «Redeploy».
   Die Adresse steht in den Einladungsmails an die Mitarbeitenden.
6. Später, nicht für den Prototyp: eigene Adresse wie
   `portal.dentalpraxisnidau.ch` unter «Settings», «Domains» hinzufügen und
   beim Domain Anbieter den angezeigten CNAME Eintrag setzen.

## Teil D, Supabase mit der Portaladresse verbinden (3 Minuten)

1. Supabase, «Authentication», «URL Configuration». Site URL:
   `https://hr-portal-nidau.vercel.app` (deine echte Adresse). Unter
   Redirect URLs hinzufügen: `https://hr-portal-nidau.vercel.app/**`.
   «Save». Ohne das laufen Einladungs- und Passwortlinks ins Leere.
2. Hinweis zu den Mails: Supabase verschickt im Gratisplan nur wenige Mails
   pro Stunde. Für den Prototyp reicht das. Dauert eine Einladung zu lange,
   kannst du eine Person auch direkt unter «Authentication», «Users», «Add
   user» mit Passwort anlegen und ihr das Passwort geben.

## Teil E, erster Login und Team (15 Minuten)

1. Portaladresse öffnen, mit deiner E-Mail und deinem Passwort anmelden.
   Du landest auf der Startseite als Admin.
2. «Mitarbeiter», Mitarbeiterin anlegen: Name, E-Mail, Funktion, Pensum,
   Eintrittsdatum, Reihenfolge im Arbeitsplan. Für den Prototyp kannst du
   als E-Mail deine eigene Adresse mit Zusatz nehmen, zum Beispiel
   `bianka+zorana@gmail.com`, dann landen die Einladungen bei dir. Die
   Funktionen sind feste Codes im Portal, weil Plan, Ferienplanung und
   Zeiterfassung danach rechnen:

   | Person | Funktion im Portal |
   |---|---|
   | Dr. med. dent. Constantin Berli, Dr. med. dent. Pavel Berli, med. dent. Anderson Sá | ZAZ |
   | Jacqueline Althaus, Laura Leupi (Dentalhygiene) | DH / PA |
   | Angela Arn, Niloofar Parziale (Prophylaxe) | DH / PA |
   | Zorana Kojic, Angela Balkhi, Léonie Gfeller, Ariela Röthlisberger | DA |
   | Caroline Soldati (Koordination) | Leitende DA |
   | Melinda Duraku | Lernende |

   Persönliche Angaben (AHV, Adresse, Geburtstag) trägst du direkt im
   Profil ein. Bitte schick sie mir nicht im Chat.
3. «Mitarbeiter-Standards»: Standardwoche pro Person setzen. Dann
   «Arbeitsplan», Monat wählen, Standards anwenden, Plan prüfen und
   veröffentlichen.
4. «Zeiterfassung»: ohne TimeMoto trägst du Beispielzeiten mit «Eintrag
   hinzufügen» ein, oder du stempelst mit deiner eigenen Stempeluhr.
   Das TimeMoto Terminal kommt später dazu: im TimeMoto Portal die Webhook
   Adresse `https://DEINE-ADRESSE/api/timemoto/webhook` eintragen. Das
   Nidau Terminal muss nur ans Nidau Portal senden.
5. «Ferienplanung»: «Regeln bearbeiten» (Plätze pro Farbe, Assistenz
   Bedarf) und «Fristen bearbeiten» setzen. Danach können Mitarbeitende
   Wochen anmelden.
6. «Bestellungen»: Caroline Soldati ist als Bestellverantwortliche
   eingetragen und bekommt die Erinnerungen beim Anmelden. Ändern lässt
   sich das in `src/config/praxis.ts`.

## Teil F, was im Prototyp anders ist als in Kehrsatz

- Abgeschaltet: Parkplätze, Geschäftsanalyse, Teamevents, Lohnabrechnungen,
  «Jetzt anwesend», HR Dokumente. Die Schalter stehen in
  `src/config/module.ts`; ein Modul einschalten heisst, es dort aus der
  Liste nehmen.
- Alles Praxisspezifische steht in `src/config/praxis.ts`: Name, Adresse,
  wer die Stempeluhr hat, wer Bestellungen verantwortet, wer Ferien
  bearbeiten darf.
- Logo und App Symbole stammen von der Nidau Website.
- Das Arbeitszeitkonto startet ohne Altdaten und rechnet alles live.
- Die Ferienregel «zwei bestimmte Behandler nie gleichzeitig weg» ist aus.
- Texte sprechen von «der Praxisleitung» statt von Laura und Bianka.
- Das einmalige Setup Skript mit festem Geheimnis aus dem Kehrsatz Code
  ist entfernt, das Schema liegt vollständig in `supabase/`.

## Kosten und Konten

- Supabase: Gratisplan reicht für den Prototyp. Projekte im Gratisplan
  werden nach einer Woche ohne Zugriffe pausiert; vor der Präsentation
  einmal einloggen, dann läuft es wieder.
- Vercel: Hobby Plan ist nur für private Nutzung erlaubt. Für den
  Prototyp ist das vertretbar, für den Betrieb braucht Nidau denselben
  Plan wie Kehrsatz.
- Zugänge bleiben bei dir. Für die Präsentation reicht dein Admin Login,
  Mitarbeitende lädst du erst ein, wenn das Portal wirklich kommt.

## Wenn etwas nicht klappt

- Login geht nicht: in Supabase unter «Authentication», «Users» prüfen,
  ob der Benutzer «Confirmed» ist, und in Vercel, ob alle vier
  Umgebungsvariablen gesetzt sind (danach «Redeploy»).
- Seite zeigt «Keine Berechtigung»: `supabase/admin-befoerdern.sql`
  nochmals mit der richtigen E-Mail ausführen.
- Einladungslink führt auf eine Fehlerseite: Teil D prüfen (Site URL und
  Redirect URLs).
- Bei allem anderen: mir die Meldung schicken, ich schaue in den Code.
