# HR Portal Dentalpraxis Nidau

Internes Mitarbeiterportal der Dentalpraxis Nidau AG: Arbeitsplan,
Zeiterfassung, Arbeitszeit- und Ferienkonto, Ferienplanung, Bestellungen,
Mitarbeiterverwaltung. Prototyp, abgeleitet vom HR Portal der Dentalpraxis
Kehrsatz.

- Einrichtung (Supabase, GitHub, Vercel, Umgebungsvariablen):
  `ANLEITUNG-NIDAU.md`
- Datenbankschema für ein neues Supabase Projekt: `supabase/schema-nidau.sql`,
  danach `supabase/admin-befoerdern.sql`
- Praxisdaten und Rollen: `src/config/praxis.ts`
- Module ein- und ausschalten: `src/config/module.ts`

## Lokal entwickeln

```bash
npm install
cp .env.local.example .env.local   # Werte aus Supabase eintragen
npm run dev
```

Prüfschleife: `npx tsc --noEmit`, `npx next lint`, `npx vitest run`,
`npm run build`.

## Umgebungsvariablen

| Name | Herkunft |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase, Project Settings, API, Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase, Project Settings, API, anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase, Project Settings, API, service_role (geheim) |
| `NEXT_PUBLIC_APP_URL` | Adresse des Portals, zum Beispiel `https://hr-portal-nidau.vercel.app` |
