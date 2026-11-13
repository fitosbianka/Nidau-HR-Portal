import type { ReactNode } from 'react'
import Link from 'next/link'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { loadLohnData, lohnSeedFor } from '@/lib/lohn'
import { massgebendeAbrechnung } from '@/lib/lohn-bvg'
import InviteEmployeeModal from '@/components/admin/InviteEmployeeModal'
import EmployeeFilterTable from '@/components/admin/EmployeeFilterTable'
import { wirksamerEintrag, verlaufAbweichungen, zurichToday, type VerlaufEintrag } from '@/lib/salary-sync'
import { ladeExterne, istExternProfil } from '@/lib/externe'
import { istGast } from '@/lib/gaeste'
import { istVerwaltungsFunktion } from '@/lib/funktionen'

export const dynamic = 'force-dynamic'

function StatCard({
  label,
  value,
  iconBg,
  icon,
}: {
  label: string
  value: number
  iconBg: string
  icon: ReactNode
}) {
  return (
    <div className="card p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-tile flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        {icon}
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4">{label}</p>
        <p className="text-[26px] font-bold text-ink mt-0.5 leading-none tnum">{value}</p>
      </div>
    </div>
  )
}

export default async function MitarbeiterPage() {
  const supabase = await createClient()

  // Only count employee documents in the stats (HR docs excluded)
  const [{ data: employees }, { data: docData }, { data: verlaufData }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, job_title, is_active, last_login, created_at, birthday, eintrittsdatum, pensum, bruttolohn_100, monatslohn')
      .in('role', ['employee', 'admin'])
      .order('full_name'),
    supabase
      .from('documents')
      .select('employee_id, viewed_at')
      .not('employee_id', 'is', null),
    supabase
      .from('salary_history')
      .select('id, employee_id, effective_date, pensum, bruttolohn_100, monatslohn, created_at'),
  ])

  const countMap: Record<string, number> = {}
  docData?.forEach((d: { employee_id: string }) => {
    countMap[d.employee_id] = (countMap[d.employee_id] ?? 0) + 1
  })

  const alleProfile = (employees ?? []) as Array<{
    id: string
    full_name: string
    email: string
    job_title: string | null
    is_active: boolean
    last_login: string | null
    created_at: string
    birthday: string | null
    eintrittsdatum: string | null
    pensum: number | null
    bruttolohn_100: number | null
    monatslohn: number | null
  }>
  // Aktive auf dieser Seite, Ehemalige (inaktiv) auf der Unterseite — alle
  // Daten und Dokumente bleiben erhalten (Aufbewahrung 10 Jahre)
  // Gäste (Teamevent ohne Anstellung) stehen separat unten
  const employeeList = alleProfile.filter(e => e.is_active && !istGast(e.job_title))
  const gaeste = alleProfile.filter(e => e.is_active && istGast(e.job_title))
  const ehemaligeAnzahl = alleProfile.filter(e => !e.is_active).length

  // ── Lohn-Kontrolle: weichen aktuelle HR-Werte vom neusten wirksamen
  //    Verlaufs-Eintrag ab? (Zukunfts-Einträge zählen erst ab ihrem Datum.)
  const verlaufByEmp = new Map<string, VerlaufEintrag[]>()
  for (const v of (verlaufData ?? []) as Array<VerlaufEintrag & { employee_id: string }>) {
    const list = verlaufByEmp.get(v.employee_id) ?? []
    list.push(v)
    verlaufByEmp.set(v.employee_id, list)
  }
  const today = zurichToday()
  const lohnAbweichungen: Array<{ id: string; name: string; datum: string; felder: string[] }> = []
  for (const e of employeeList) {
    if (!e.is_active) continue
    const eff = wirksamerEintrag(verlaufByEmp.get(e.id) ?? [], today)
    if (!eff) continue
    const felder = verlaufAbweichungen(e, eff)
    if (felder.length > 0) {
      lohnAbweichungen.push({ id: e.id, name: e.full_name, datum: eff.effective_date, felder })
    }
  }

  // BVG-Kontrolle: gespeicherter Abzug (HR / Lohn-Stammdaten) gegen die
  // massgebende letzte Abrechnung — dieselbe Prüfung wie auf der Lohn-Seite
  const admin = await createAdminClient()
  const [{ stamm: lohnStamm, abrechnungen: lohnAbrechnungen }, externeIds] = await Promise.all([loadLohnData(admin), ladeExterne(admin)])
  const bvgAbweichungen: Array<{ id: string; name: string; stamm: number; abrechnung: number; periode: string }> = []
  for (const e of employeeList) {
    if (!e.is_active) continue
    const m = massgebendeAbrechnung(lohnAbrechnungen[e.id] ?? [])
    if (!m) continue
    const gespeichert = lohnStamm[e.id]?.pkAbzug ?? lohnSeedFor(e.full_name)?.pkAbzug ?? 0
    if (Math.abs(gespeichert - m.pkAbzug) > 0.004) {
      bvgAbweichungen.push({ id: e.id, name: e.full_name, stamm: gespeichert, abrechnung: m.pkAbzug, periode: m.periode })
    }
  }
  const chf = (n: number) => `CHF ${n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/’/g, "'")}`

  const zazCount      = employeeList.filter((e) => e.job_title === 'ZAZ').length
  const dhCount       = employeeList.filter((e) => e.job_title === 'DH / PA' || e.job_title === 'DH' || e.job_title === 'PA').length
  const daCount       = employeeList.filter((e) => e.job_title === 'DA' || e.job_title === 'Leitende DA').length
  const lernendeCount = employeeList.filter((e) => e.job_title === 'Lernende').length
  const adminCatCount = employeeList.filter((e) => istVerwaltungsFunktion(e.job_title)).length

  return (
    <div className="space-y-8">
      {/* ── Page header ─────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Mitarbeiter</h1>
          <p className="page-subtitle">Übersicht der aktiven Mitarbeitenden der Praxis</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Link href="/admin/mitarbeiter/ehemalige" className="btn-secondary flex items-center gap-2" title="Inaktive Konten, Daten und Dokumente bleiben erhalten">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></svg>
            Ehemalige ({ehemaligeAnzahl})
          </Link>
          <InviteEmployeeModal />
        </div>
      </div>

      {/* ── BVG-Kontrolle: gespeicherter Abzug ↔ letzte Abrechnung ── */}
      {bvgAbweichungen.length > 0 && (
        <div className="card p-5 border-apricot-ink/25">
          <p className="text-sm font-semibold text-apricot-ink">
            ⚠ BVG-Kontrolle: Bei {bvgAbweichungen.length}{' '}
            {bvgAbweichungen.length === 1 ? 'Mitarbeiterin weicht' : 'Mitarbeiterinnen weicht'} der im HR gespeicherte
            BVG-Abzug von der letzten Lohnabrechnung ab.
          </p>
          <ul className="mt-2.5 space-y-1">
            {bvgAbweichungen.map(a => (
              <li key={a.id} className="text-xs text-ink-3">
                <Link href={`/admin/employees/${a.id}`} className="font-semibold text-ink-2 hover:underline underline-offset-2">
                  {a.name}
                </Link>
                {' — '}HR {chf(a.stamm)}, letzte Abrechnung ({a.periode}) {chf(a.abrechnung)}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-ink-4 mt-2">
            Im HR-Abschnitt der Detailseite lässt sich der Betrag anpassen; er gilt dann für die nächsten Abrechnungen.
          </p>
        </div>
      )}

      {/* ── Lohn-Kontrolle: Abweichungen Verlauf ↔ aktuelle Werte ── */}
      {lohnAbweichungen.length > 0 && (
        <div className="card p-5 border-apricot-ink/25">
          <p className="text-sm font-semibold text-apricot-ink">
            ⚠ Lohn-Kontrolle: Bei {lohnAbweichungen.length}{' '}
            {lohnAbweichungen.length === 1 ? 'Mitarbeiterin weichen' : 'Mitarbeiterinnen weichen'} die aktuellen
            HR-Werte vom neusten wirksamen Eintrag im Lohn- & Pensumsverlauf ab.
          </p>
          <ul className="mt-2.5 space-y-1">
            {lohnAbweichungen.map(a => (
              <li key={a.id} className="text-xs text-ink-3">
                <Link href={`/admin/employees/${a.id}`} className="font-semibold text-ink-2 hover:underline underline-offset-2">
                  {a.name}
                </Link>
                {' — '}{a.felder.join(', ')} (Eintrag per {a.datum.split('-').reverse().join('.')})
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-ink-4 mt-2">
            Auf der Detailseite lässt sich der Verlaufswert mit einem Klick übernehmen.
          </p>
        </div>
      )}

      {/* ── Stats cards ─────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="ZAZ"
          value={zazCount}
          iconBg="bg-mint-bg"
          icon={
            <svg className="w-6 h-6 text-mint-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          }
        />
        <StatCard
          label="DH / PA"
          value={dhCount}
          iconBg="bg-steel-bg"
          icon={
            <svg className="w-6 h-6 text-steel-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          }
        />
        <StatCard
          label="DA"
          value={daCount}
          iconBg="bg-apricot-bg"
          icon={
            <svg className="w-6 h-6 text-apricot-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          }
        />
        <StatCard
          label="Lernende"
          value={lernendeCount}
          iconBg="bg-lilac-bg"
          icon={
            <svg className="w-6 h-6 text-lilac-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
            </svg>
          }
        />
        <StatCard
          label="Verwaltung"
          value={adminCatCount}
          iconBg="bg-active"
          icon={
            <svg className="w-6 h-6 text-ink-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          }
        />
      </div>

      {/* ── Employee table with category filter ─────────── */}
      {employeeList.length === 0 ? (
        <div className="card px-6 py-16 text-center">
          <div className="w-14 h-14 rounded-tile bg-edge-row flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-ink-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </div>
          <p className="text-ink font-semibold text-sm">Keine aktiven Mitarbeitenden</p>
          <p className="text-ink-4 text-xs mt-1">Mit «Mitarbeiter hinzufügen» die erste Person einladen oder anlegen.</p>
        </div>
      ) : (
        <EmployeeFilterTable employees={employeeList.map(e => ({ ...e, extern: istExternProfil(e, externeIds) }))} countMap={countMap} />
      )}

      {/* ── Gäste: Teamevent Konten ohne Anstellung ───────── */}
      {gaeste.length > 0 && (
        <div className="card p-5">
          <p className="text-sm font-semibold text-ink mb-1">Gäste</p>
          <p className="text-[11.5px] text-ink-4 mb-3">Konten für Teamevents ohne Anstellung. Gäste sehen nur den Ordner Teamevents und erscheinen in keiner anderen Liste.</p>
          <div className="flex flex-wrap gap-2">
            {gaeste.map(g => (
              <Link key={g.id} href={`/admin/employees/${g.id}`} className="inline-flex items-center gap-2 text-[13px] px-3 py-1.5 rounded-lg border border-edge-ctl bg-surface hover:bg-edge-row">
                <span className="font-semibold">{g.full_name}</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-lilac-bg text-lilac-ink">Gast</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
