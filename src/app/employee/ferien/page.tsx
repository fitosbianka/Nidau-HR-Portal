import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import FerienMitarbeiterClient, { type MeinKonto } from '@/components/ferien/FerienMitarbeiterClient'
import { loadFerienplanungData } from '@/lib/ferienplanung-data'
import { getPhasenDeadlines } from '@/lib/ferien-reminder'
import { ladeFerienHinweis } from '@/lib/ferien-hinweis'
import { FERIEN_EDITORS } from '@/lib/leitende'
import { PLAN_YEAR, PHASE_DEFS, PHASE_START_KEY, PHASE_OPEN_TIME, PHASE_CLOSE_TIME, phaseKeyForTitle, phaseStateFor, zurichNow, type PhasenDeadlines } from '@/lib/ferien-wuensche'
import { anspruchTageFor } from '@/lib/ferien-anspruch'
import { istFerienAlsMinusstunden } from '@/lib/ferien-minusstunden'
import { maskUfEntries } from '@/lib/plan-privacy'
import { ladeFerienKontext, wochenFuerMitarbeiter, meineTage } from '@/lib/ferien-wochen-data'
import { kategorieFuer, gruenRegel, type Person } from '@/lib/ferien-wochen'
import { zweiWochenAmStueck, meineArbeitstage, arbeitetLautStandardwoche } from '@/lib/ferien-kapazitaet'
import { anteilAus } from '@/lib/ferien-anteil'
import { ladeSamstage } from '@/lib/samstage-data'
import { samstagRolle, samstagZahlen } from '@/lib/samstage'
import { ladeNotfalldienste } from '@/lib/notfalldienste-data'
import { ndRolle, ndZahlen } from '@/lib/notfalldienste'
import { zurichToday } from '@/lib/salary-sync'
import { istExternNutzer } from '@/lib/externe'

export const dynamic = 'force-dynamic'

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const lang = (d: string) => { const x = new Date(`${d}T12:00:00`); return `${x.getDate()}. ${MONATE[x.getMonth()]}` }
const nextDay = (d: string) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10) }

/** Eine Statuszeile zur eigenen Eingabephase. */
function statusZeile(phasen: PhasenDeadlines, jobTitle: string | null, editor: boolean): { text: string; aktiv: boolean } {
  if (editor) return { text: 'Du kannst jederzeit Wochen anmelden und Wünsche eingeben.', aktiv: true }
  const key = phaseKeyForTitle(jobTitle)
  const state = phaseStateFor(phasen, key, zurichNow())
  const frist = phasen[key]
  if (state === 'aktiv' && frist) return { text: `Deine Anmeldung ist offen bis ${lang(frist)}, ${PHASE_CLOSE_TIME.replace(':', '.')} Uhr.`, aktiv: true }
  if (state === 'abgeschlossen') return { text: 'Die Eingabefrist für deine Gruppe ist abgelaufen. Für Änderungen melde dich bei der Praxisleitung.', aktiv: false }
  if (state === 'ausstehend') {
    let start = phasen[PHASE_START_KEY[key]] ?? null
    if (!start) {
      const idx = PHASE_DEFS.findIndex(p => p.key === key)
      for (let i = idx - 1; i >= 0; i--) { const f = phasen[PHASE_DEFS[i].key]; if (f) { start = nextDay(f); break } }
    }
    return { text: start ? `Deine Anmeldung startet am ${lang(start)} um ${PHASE_OPEN_TIME.replace(':', '.')} Uhr.` : 'Deine Anmeldung ist noch nicht offen.', aktiv: false }
  }
  return { text: 'Die Ferienplanung ist für deine Gruppe noch nicht eröffnet. Den Kalender mit den akzeptierten Ferien siehst du trotzdem.', aktiv: false }
}

export default async function EmployeeFerienPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('full_name, job_title, role, pensum, eintrittsdatum').eq('id', user.id).single()
  const prof = profile as { full_name: string; job_title: string | null; role?: string; pensum: number | null; eintrittsdatum: string | null } | null
  const name = prof?.full_name ?? ''
  const editor = FERIEN_EDITORS.includes(name)

  // Plan data is read with the service client AFTER the session check.
  const adminClient = await createAdminClient()
  const heute = zurichToday()
  // Externe (selbständig) haben keine Ferientage: nur der Kalender mit den akzeptierten Ferien des Teams
  const extern = await istExternNutzer(adminClient, { id: user.id, full_name: name })
  const [data, phasen, samstage, notfalldienste, hinweis] = await Promise.all([
    loadFerienplanungData(adminClient),
    getPhasenDeadlines(adminClient),
    ladeSamstage(adminClient, `${heute.slice(0, 4)}-01-01`),
    ladeNotfalldienste(adminClient, `${heute.slice(0, 4)}-01-01`),
    ladeFerienHinweis(adminClient, user.id),
  ])
  const status = statusZeile(phasen, prof?.job_title ?? null, editor)
  // Erklärfenster für die Assistenz, solange ihre Eingabe offen ist und
  // die Person es nicht dauerhaft abgestellt hat (Editorinnen kennen es)
  const hinweisZeigen = !extern && !editor && kategorieFuer(prof?.job_title) === 'ASSISTENZ' && status.aktiv && !hinweis.seite

  // Datengrenze: Wochen nur als Zahlen plus eigener Status, Dienste nur als
  // Zahlen, Wünsche nur die eigenen. Der Kalender zeigt wie bisher die
  // akzeptierten Ferien des Teams (wer ist wann weg), ohne Pensen.
  const personen: Person[] = data.employees.map(e => ({ id: e.id, full_name: e.full_name, job_title: e.job_title, pensum: e.pensum, eintrittsdatum: e.eintrittsdatum ?? null }))
  const ctx = await ladeFerienKontext(adminClient, personen, data.wishes)
  const ich: Person = personen.find(p => p.id === user.id) ?? { id: user.id, full_name: name, job_title: prof?.job_title ?? null, pensum: prof?.pensum ?? null, eintrittsdatum: prof?.eintrittsdatum ?? null }
  const wochen = wochenFuerMitarbeiter(ctx, ich)
  const wochenFarben = Object.fromEntries(wochen.map(w => [w.montag, w.farbe]))
  const eigene = data.wishes.filter(w => w.employeeId === user.id)

  const anspruch = anspruchTageFor(name, prof?.pensum, ctx.konfig.anspruch[user.id])
  const anteilRegel = anteilAus(ctx.anteile, user.id)
  const tage = meineTage(ctx.eintraege, data.wishes, user.id, prof?.pensum, ctx.wochen, d => istFerienAlsMinusstunden(name, d), anteilRegel)
  const belegteMontage = wochen.filter(w => w.mein && w.mein.status !== 'abgelehnt').map(w => w.montag)
  const pensum = prof?.pensum ?? 100
  const konto: MeinKonto = {
    anspruch: anspruch.tage, wochen: anspruch.wochen, hinweis: anspruch.hinweis, angepasst: anspruch.angepasst,
    akzeptiert: tage.akzeptiert, angemeldet: tage.angemeldet,
    nochZuPlanen: anspruch.tage != null ? Math.max(0, Math.round((anspruch.tage - tage.akzeptiert - tage.angemeldet) * 100) / 100) : null,
    herleitung: anspruch.tage == null
      ? (anspruch.hinweis ?? 'Ohne festes Kontingent')
      : anspruch.angepasst
        ? `${String(anspruch.tage).replace('.', ',')} Tage, durch Admin angepasst`
        : pensum < 100
          ? `${(anspruch.wochen ?? 5) * 5} Tage bei 100 %, für dich mit ${pensum} % ${String(anspruch.tage).replace('.', ',')} Tage`
          : `${anspruch.wochen ?? 5} Wochen, ${String(anspruch.tage).replace('.', ',')} Tage bei 100 %${anspruch.hinweis ? `. ${anspruch.hinweis}` : ''}`,
    gruen: gruenRegel(ctx.wochen, belegteMontage),
    zweiWochen: name.startsWith('Valérie') || !kategorieFuer(prof?.job_title) ? null : zweiWochenAmStueck(user.id, ctx.wochen, ctx.eintraege, data.wishes, t => arbeitetLautStandardwoche(ctx, user.id, t)).ok,
  }

  return (
    <FerienMitarbeiterClient
      employees={data.employees.map(e => ({ id: e.id, full_name: e.full_name, job_title: e.job_title, schedule_order: e.schedule_order, pensum: null }))}
      vacations={maskUfEntries(data.vacations.filter(v => v.schedule_date >= `${PLAN_YEAR}-01-01`), user.id, prof?.role === 'admin')}
      wochen={wochen}
      wochenFarben={wochenFarben}
      myId={user.id}
      kategorie={kategorieFuer(prof?.job_title)}
      pensum={prof?.pensum ?? null}
      arbeitstage={meineArbeitstage(ctx, user.id)}
      statusText={status.text}
      eingabeAktiv={status.aktiv}
      konto={konto}
      eigene={eigene}
      samstage={samstage.map(s => samstagZahlen(s, user.id))}
      notfalldienste={notfalldienste.map(n => ndZahlen(n, user.id))}
      samstagRolle={samstagRolle(prof?.job_title)}
      ndRolle={ndRolle(prof?.job_title)}
      heute={heute}
      extern={extern}
      hinweisZeigen={hinweisZeigen}
      anteilRegel={anteilRegel}
    />
  )
}
