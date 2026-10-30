import { ohneGaesteErgebnis } from '@/lib/gaeste'
import Link from 'next/link'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import DashboardReminders, { UpcomingBirthdays, type Reminder, type UpcomingBirthday } from '@/components/admin/DashboardReminders'
import KorrekturMeldungen from '@/components/admin/KorrekturMeldungen'
import LohnReminderPopup from '@/components/admin/LohnReminderPopup'
import { LOHN_ABR_PREFIX, loadLohnData, pfaendungHinweis, fmtLohnChf } from '@/lib/lohn'
import { ladeErinnerungAus } from '@/lib/erinnerungen'
import { isMonthReleasedToLeitende } from '@/lib/leitende'
import { getZeitKorrekturen } from '@/lib/korrekturen'
import { loadAnwesenheit, fmtZurichTime } from '@/lib/anwesenheit'
import { modulAktiv } from '@/config/module'
import { loadPersonalEintraege, type PersonalEintrag } from '@/lib/personal-data'
import { loadKontoEmployees } from '@/lib/konto-data'
import { istExtern, ladeExterne } from '@/lib/externe'
import { round2 } from '@/lib/ferien'

export const dynamic = 'force-dynamic'

const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']

const fmtCH = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

function fmtSaldo(min: number | null): string {
  if (min == null) return '–'
  const s = min < 0 ? '−' : ''
  const a = Math.abs(min)
  return `${s}${Math.floor(a / 60)}:${String(Math.round(a % 60)).padStart(2, '0')}`
}

const TYP_BADGE: Record<string, string> = {
  Ferien:    'bg-mint-bg text-mint-ink',
  Lohn:      'bg-steel-bg text-steel-ink',
  Pensum:    'bg-lilac-bg text-lilac-ink',
  Austritt:  'bg-blush-bg text-blush-ink',
  Eintritt:  'bg-apricot-bg text-apricot-ink',
  Sonstiges: 'bg-edge-row text-ink-3',
}

function CardHeader({ title, href, linkLabel, badge }: { title: string; href: string; linkLabel: string; badge?: React.ReactNode }) {
  return (
    <div className="px-6 py-4 border-b border-edge-soft flex items-center justify-between gap-3 flex-wrap">
      <h2 className="text-sm font-semibold text-ink-2">{title}</h2>
      <div className="flex items-center gap-3">
        {badge}
        <Link href={href} className="text-xs font-semibold text-ink-4 hover:text-ink-2 hover:underline underline-offset-2">
          {linkLabel} →
        </Link>
      </div>
    </div>
  )
}

/** Admin Start page: compact overviews of Anwesenheit, Korrektur-Meldungen,
 *  Personal-Änderungen, Geburtstage und Ferienkonto — details live on the
 *  respective menu pages. */
export default async function AdminStartPage() {
  const supabase = await createClient()
  const admin = await createAdminClient()
  const nowZ = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Zurich' }))

  const [{ data: profs }, korrekturen, anw, personal, konto] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, birthday, is_active, role, eintrittsdatum, job_title')
      .in('role', ['employee', 'admin'])
      .then(ohneGaesteErgebnis),
    getZeitKorrekturen(supabase),
    loadAnwesenheit(supabase),
    loadPersonalEintraege(admin),
    loadKontoEmployees(supabase),
  ])

  // Externe (selbständige Vertretungen) zählen nicht als Angestellte:
  // keine Geburtstags-/Team-Listen, keine Lohn-Erinnerungen
  const externeIds = await ladeExterne(admin)
  const profileList = ((profs ?? []) as Array<{ id: string; full_name: string; birthday: string | null; is_active: boolean; role: string; eintrittsdatum: string | null }>)
    .filter(p => !istExtern(p.full_name) && !externeIds.has(p.id))

  // ── Erinnerungen: birthdays today / in 2 days + plan deadlines ──────────
  const reminders: Reminder[] = []
  const mmdd = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const todayMD = mmdd(nowZ)
  const in2 = new Date(nowZ); in2.setDate(in2.getDate() + 2)
  const in2MD = mmdd(in2)
  for (const emp of profileList) {
    if (!emp.is_active || !emp.birthday) continue
    const bd = emp.birthday.slice(5, 10)   // MM-DD
    if (bd === todayMD) {
      reminders.push({
        kind: 'birthday-today', id: `geburtstag:${emp.id}:${nowZ.getFullYear()}`,
        dauerhaft: { key: `geburtstag:${emp.id}`, label: `Geburtstag von ${emp.full_name}` },
        text: `Heute hat ${emp.full_name} Geburtstag!`,
      })
    } else if (bd === in2MD) {
      reminders.push({
        kind: 'birthday-soon', id: `geburtstag-bald:${emp.id}:${in2.getFullYear()}`,
        dauerhaft: { key: `geburtstag-bald:${emp.id}`, label: `Hinweis 2 Tage vor dem Geburtstag von ${emp.full_name}` },
        text: `${emp.full_name} hat in 2 Tagen Geburtstag (${in2.getDate()}.${in2.getMonth() + 1}.)`,
      })
    }
  }

  // Next month's plan: released to Leitende by the 5th, published by the 15th
  const dayOfMonth = nowZ.getDate()
  if (dayOfMonth >= 5) {
    let ny = nowZ.getFullYear()
    let nm = nowZ.getMonth() + 2
    if (nm > 12) { nm = 1; ny++ }
    const planHref = `/admin/arbeitsplan?m=${ny}-${String(nm).padStart(2, '0')}`
    const [released, { data: pubRow }] = await Promise.all([
      isMonthReleasedToLeitende(supabase, ny, nm),
      supabase.from('schedule_publications').select('year').eq('year', ny).eq('month', nm).maybeSingle(),
    ])
    const planMonat = `${ny}-${String(nm).padStart(2, '0')}`
    if (!released) {
      reminders.push({
        kind: 'plan-release', id: `plan-freigabe:${planMonat}`,
        dauerhaft: { key: 'plan-freigabe', label: 'Arbeitsplan noch nicht für die Leitenden freigegeben (ab dem 5.)' },
        text: `Arbeitsplan ${MONTH_NAMES[nm - 1]} ${ny} ist noch nicht für die Leitenden freigegeben (Ziel: 5. des Vormonats).`,
        href: planHref,
      })
    }
    if (dayOfMonth >= 15 && !pubRow) {
      reminders.push({
        kind: 'plan-publish', id: `plan-veroeffentlichung:${planMonat}`,
        dauerhaft: { key: 'plan-veroeffentlichung', label: 'Arbeitsplan noch nicht veröffentlicht (ab dem 15.)' },
        text: `Arbeitsplan ${MONTH_NAMES[nm - 1]} ${ny} ist noch nicht veröffentlicht (Ziel: 15. des Vormonats).`,
        href: planHref,
      })
    }
  }

  // ── Lohn-Erinnerung ab dem 23.: fehlende Abrechnungen des Monats ────────
  // Löhne werden am 25. ausbezahlt — ab dem 23. warnen Popup und
  // Erinnerung, solange nicht für alle Aktiven eine Abrechnung des
  // laufenden Monats gespeichert ist.
  const lohnMonat = `${nowZ.getFullYear()}-${String(nowZ.getMonth() + 1).padStart(2, '0')}`
  const lohnMonatLabel = `${MONTH_NAMES[nowZ.getMonth()]} ${nowZ.getFullYear()}`
  let lohnFehlende: string[] = []
  if (modulAktiv('lohn') && dayOfMonth >= 23) {
    const { data: abrRows } = await admin
      .from('zeiterfassung_comments')
      .select('user_full_name')
      .like('user_full_name', `${LOHN_ABR_PREFIX.replace(/_/g, '\\_')}%`)
      .eq('schedule_date', `${lohnMonat}-01`)
    const gespeichert = new Set<string>()
    for (const r of (abrRows ?? []) as Array<{ user_full_name: string }>) {
      const rest = r.user_full_name.slice(LOHN_ABR_PREFIX.length)
      const sep = rest.lastIndexOf('_')
      if (sep > 0) gespeichert.add(rest.slice(0, sep))
    }
    // Wer erst NACH dem Abrechnungsmonat eintritt, braucht dafür noch keine
    // Lohnabrechnung (z.B. Eintritt Oktober → kein Hinweis im September).
    const lohnMonatEnde = `${lohnMonat}-${String(new Date(nowZ.getFullYear(), nowZ.getMonth() + 1, 0).getDate()).padStart(2, '0')}`
    lohnFehlende = profileList
      .filter(p => p.is_active && !gespeichert.has(p.id))
      .filter(p => !(p.eintrittsdatum && p.eintrittsdatum > lohnMonatEnde))
      .map(p => p.full_name)
      .sort()
    if (lohnFehlende.length > 0) {
      reminders.push({
        kind: 'lohn-faellig', id: `lohn-faellig:${lohnMonat}`,
        dauerhaft: { key: 'lohn-faellig', label: 'Fehlende Lohnabrechnungen vor der Auszahlung am 25.' },
        text: `Lohnauszahlung am 25.: für ${lohnMonatLabel} ${lohnFehlende.length === 1 ? 'fehlt noch 1 Lohnabrechnung' : `fehlen noch ${lohnFehlende.length} Lohnabrechnungen`}.`,
        href: '/admin/lohn',
      })
    }
  }

  // ── R5.4: Lohnpfändung — Meldung ans Betreibungsamt ─────────────────────
  // Für Personen mit hinterlegter Pfändung: sobald die Abrechnung des
  // laufenden Monats gespeichert ist, wird ihr PFÄNDUNGSBETRAG mit dem
  // zuletzt tatsächlich überwiesenen Betrag verglichen (nicht die
  // Auszahlung, die schwankt auch ohne Einkommensänderung). Ein Monat
  // unter dem Existenzminimum (Unfall, Krankheit) ist kein Massstab: ist
  // der Betrag danach wieder derselbe, gibt es nichts zu melden. Regel
  // und Beispiele: pfaendungHinweis in src/lib/lohn.ts.
  if (modulAktiv('lohn')) try {
    const lohnDaten = await loadLohnData(admin)
    const hatPfaendung = Object.entries(lohnDaten.stamm)
      .filter(([, st]) => st.pfaendungArt === 'betrag' || st.pfaendungArt === 'quote')
    const monatLabel = (m: string) => `${MONTH_NAMES[parseInt(m.slice(5, 7), 10) - 1]} ${m.slice(0, 4)}`
    for (const [profileId] of hatPfaendung) {
      const prof = profileList.find(p => p.id === profileId)
      if (!prof?.is_active) continue
      const list = lohnDaten.abrechnungen[profileId] ?? []
      const cur = list.find(a => a.monat === lohnMonat)
      if (!cur) continue
      const h = pfaendungHinweis(cur, list)
      if (!h) continue
      const was = h.art === 'erstmals'
        ? `${lohnMonatLabel} erstmals mit Überweisung Fr. ${fmtLohnChf(h.betrag)}`
        : h.art === 'keine-ueberweisung'
          ? `im ${lohnMonatLabel} keine Überweisung (Netto unter dem Existenzminimum)${h.bisher ? `, bisher Fr. ${fmtLohnChf(h.bisher.betrag)}` : ''}`
          : `Pfändungsbetrag ${lohnMonatLabel} Fr. ${fmtLohnChf(h.betrag)} statt bisher Fr. ${fmtLohnChf(h.bisher.betrag)} (${monatLabel(h.bisher.monat)})`
      reminders.push({
        kind: 'pfaendung-meldung', id: `pfaendung:${profileId}:${lohnMonat}`,
        dauerhaft: { key: `pfaendung:${profileId}`, label: `Lohnpfändung ${prof.full_name}: Meldung ans Betreibungsamt` },
        text: `Lohnpfändung ${prof.full_name}: ${was} — schriftliche Meldung ans Betreibungsamt mit Kopie der Lohnabrechnung (R5.4).`,
        href: '/admin/lohn',
      })
    }
  } catch { /* Erinnerung ist Komfort — Dashboard lädt auch ohne */ }

  // ── Dauerhaft ausgeblendete Erinnerungen («Nie mehr anzeigen») ──────────
  const ausgeblendet = await ladeErinnerungAus(admin).catch(() => [])
  const ausKeys = new Set(ausgeblendet.map(a => a.key))
  const sichtbareReminders = reminders.filter(r => !ausKeys.has(r.dauerhaft.key))

  // ── Nächste 5 Geburtstage ────────────────────────────────────────────────
  const todayMid = new Date(nowZ.getFullYear(), nowZ.getMonth(), nowZ.getDate())
  const upcoming: UpcomingBirthday[] = []
  for (const emp of profileList) {
    if (!emp.is_active || !emp.birthday) continue
    const bm = parseInt(emp.birthday.slice(5, 7), 10)
    const bd = parseInt(emp.birthday.slice(8, 10), 10)
    if (!bm || !bd) continue
    let next = new Date(nowZ.getFullYear(), bm - 1, bd)
    if (next < todayMid) next = new Date(nowZ.getFullYear() + 1, bm - 1, bd)
    const days = Math.round((next.getTime() - todayMid.getTime()) / 86400000)
    upcoming.push({ name: emp.full_name, day: bd, month: bm, days })
  }
  upcoming.sort((a, b) => a.days - b.days)
  const nextBirthdays = upcoming.slice(0, 5)

  // ── Anstehende Personal-Änderungen (nächste 5, nicht erledigt) ──────────
  const anstehend: PersonalEintrag[] = personal.eintraege
    .filter(e => !e.erledigt && e.datum >= personal.today)
    .slice(0, 5)

  // ── Anwesenheit: aktuell eingestempelte ──────────────────────────────────
  const present = anw.list.filter(e => e.status === 'eingestempelt' || e.status === 'zurueck')

  // ── Ferienkonto-Übersicht: letzter bekannter Stand pro Person ───────────
  const kontoRows = konto.employees.map(e => {
    let saldoMin: number | null = null
    let restFerien: number | null = null
    for (const m of e.months) {
      if (m.kontoMin != null) saldoMin = m.kontoMin
      if (m.restFerien != null) restFerien = m.restFerien
    }
    return { id: e.id, name: e.name, pensumLabel: e.pensumLabel, saldoMin, restFerien: restFerien != null ? round2(restFerien) : null }
  })

  const todayDisplay = nowZ.toLocaleDateString('de-CH', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <div className="space-y-8">
      {/* ── Popup: fehlende Lohnabrechnungen (ab dem 23.) ── */}
      {modulAktiv('lohn') && lohnFehlende.length > 0 && (
        <LohnReminderPopup monat={lohnMonat} monatLabel={lohnMonatLabel} fehlende={lohnFehlende} />
      )}

      {/* ── Page header ─────────────────────────────────── */}
      <div>
        <h1 className="page-title">Startseite</h1>
        <p className="page-subtitle">{todayDisplay}</p>
      </div>

      {/* ── Erinnerungen ────────────────────────────────── */}
      <DashboardReminders reminders={sichtbareReminders} ausgeblendet={ausgeblendet} />

      {/* ── Korrektur-Meldungen (Übersicht, max. 5) ─────── */}
      <KorrekturMeldungen items={korrekturen} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* ── Jetzt anwesend ─────────────────────────────── */}
{modulAktiv('anwesend') && (
        <div className="card overflow-hidden">
          <CardHeader
            title="Jetzt anwesend"
            href="/admin/zeiterfassung"
            linkLabel="Zur Übersicht"
            badge={
              <span className="badge badge-teal">
                <span className="w-1.5 h-1.5 rounded-full bg-mint-mid animate-pulse" />
                {anw.counts.anwesend} anwesend
              </span>
            }
          />
          <div className="px-6 py-3 grid grid-cols-4 gap-2 border-b border-edge-soft">
            {[
              { label: 'Anwesend',      value: anw.counts.anwesend, color: 'text-mint-ink' },
              { label: 'Pause',         value: anw.counts.pause,    color: 'text-apricot-mid' },
              { label: 'Ausgestempelt', value: anw.counts.ausgest,  color: 'text-ink-3' },
              { label: 'Abwesend',      value: anw.counts.abwesend, color: 'text-ink-4' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className={`text-lg font-bold tnum ${s.color}`}>{s.value}</p>
                <p className="text-[9px] font-semibold text-ink-4 uppercase tracking-wider">{s.label}</p>
              </div>
            ))}
          </div>
          {present.length === 0 ? (
            <p className="px-6 py-5 text-sm text-ink-4">Im Moment ist niemand eingestempelt.</p>
          ) : (
            <ul className="divide-y divide-edge-row">
              {present.map(e => (
                <li key={e.name} className="px-6 py-2.5 flex items-center gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-mint-mid animate-pulse flex-shrink-0" />
                  <p className="text-sm font-medium text-ink flex-1 truncate">{e.name}</p>
                  {e.inSince && (
                    <p className="text-xs text-ink-4 tnum flex-shrink-0">seit {fmtZurichTime(e.inSince)} Uhr</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
)}

        {/* ── Personal-Änderungen ────────────────────────── */}
        <div className="card overflow-hidden">
          <CardHeader title="Personal-Änderungen" href="/admin/personal" linkLabel="Alle ansehen" />
          {anstehend.length === 0 ? (
            <p className="px-6 py-5 text-sm text-ink-4">Keine anstehenden Änderungen.</p>
          ) : (
            <ul className="divide-y divide-edge-row">
              {anstehend.map(e => (
                <li key={`${e.quelle}-${e.key}`} className="px-6 py-3 flex items-center gap-3">
                  <span className="text-xs font-semibold text-ink-2 tnum w-[72px] flex-shrink-0">{fmtCH(e.datum)}</span>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold flex-shrink-0 ${TYP_BADGE[e.typ] ?? TYP_BADGE.Sonstiges}`}>
                    {e.typ === 'Ferien' ? 'Ferien extra' : e.typ}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink truncate">{e.emp}</p>
                    {e.text && <p className="text-xs text-ink-4 truncate">{e.text}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Ferienkonto-Übersicht ──────────────────────── */}
        <div className="card overflow-hidden">
          <CardHeader title={`Arbeitszeit- und Ferienkonto ${konto.year}`} href="/admin/zeiterfassung/konto" linkLabel="Zum Konto" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider border-b border-edge-soft">
                  <th className="text-left px-6 py-2.5 font-semibold">Name</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Zeitkonto</th>
                  <th className="text-right px-6 py-2.5 font-semibold">Restferien</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge-row">
                {kontoRows.map(r => (
                  <tr key={r.id}>
                    <td className="px-6 py-2.5">
                      <p className="font-medium text-ink truncate">{r.name}</p>
                      <p className="text-[11px] text-ink-4">{r.pensumLabel}</p>
                    </td>
                    <td className={`px-3 py-2.5 text-right tnum font-semibold ${r.saldoMin != null && r.saldoMin < 0 ? 'text-blush-ink' : 'text-ink-2'}`}>
                      {fmtSaldo(r.saldoMin)}
                    </td>
                    <td className="px-6 py-2.5 text-right tnum font-semibold text-ink-2">
                      {r.restFerien != null ? `${r.restFerien} Tage` : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-6 py-3 border-t border-edge-soft text-[11px] text-ink-4">
            Letzter bekannter Stand pro Person — Details und Korrekturen auf der Konto-Seite.
          </p>
        </div>

        {/* ── Nächste Geburtstage ────────────────────────── */}
        <UpcomingBirthdays items={nextBirthdays} />
      </div>
    </div>
  )
}
