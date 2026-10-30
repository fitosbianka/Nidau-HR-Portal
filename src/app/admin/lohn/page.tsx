import { ohneGaesteErgebnis } from '@/lib/gaeste'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { loadLohnData, lohnSeedFor } from '@/lib/lohn'
import { bvgAbgleich, massgebendeAbrechnung } from '@/lib/lohn-bvg'
import { absenzEpisoden } from '@/lib/absenz-tage'
import type { AbsenzFall } from '@/lib/absenz-phasen'
import LohnClient from './LohnClient'
import { ladeExterne, istExternProfil } from '@/lib/externe'

export const dynamic = 'force-dynamic'

/** Lohnabrechnungen — admin only. The admin layout already redirects
 *  non-admins; this page double-checks on top (sensitive data). */
export default async function LohnPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') redirect('/employee')

  const admin = await createAdminClient()
  const jahr = parseInt(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' }).slice(0, 4), 10)
  // BVG: Personen ohne bestätigten Stand erhalten den Betrag ihrer letzten
  // Abrechnung — danach sind Stammdaten, HR-Seite und Vorbelegung identisch
  await bvgAbgleich(admin)
  const externeIds = await ladeExterne(await createAdminClient())
  const [{ saetze, stamm, abrechnungen }, { data: profiles }] = await Promise.all([
    loadLohnData(admin),
    admin.from('profiles')
      .select('id, full_name, job_title, pensum, monatslohn, bruttolohn_100, is_active, eintrittsdatum')
      .in('role', ['employee', 'admin'])
      .order('full_name')
      .then(ohneGaesteErgebnis),
  ])

  // ALLE Arbeitsplan-Einträge des Jahres (paginiert — Supabase liefert max.
  // 1000 Zeilen pro Request): daraus kommen die K-/U-/UF-Tage UND die
  // persönlichen Plantage pro Monat (effektive Methode für unbezahlte
  // Ferien: Abzug = Lohn × UF-Tage ÷ Plantage des konkreten Monats).
  type PlanRow = { employee_id: string; schedule_date: string; entry: string }
  const absRows: PlanRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from('work_schedule')
      .select('employee_id, schedule_date, entry')
      .gte('schedule_date', `${jahr}-01-01`).lte('schedule_date', `${jahr}-12-31`)
      .order('schedule_date', { ascending: true })
      .range(from, from + 999)
    if (!data || data.length === 0) break
    absRows.push(...(data as PlanRow[]))
    if (data.length < 1000) break
  }

  // Pro Mitarbeiterin: K/U-Tage aus dem Arbeitsplan zu FÄLLEN gebündelt
  // (Regelwerk Krankheit/Unfall: Fallbeginn = erster markierter Tag,
  // Kalendertage, Fälle laufen über Monatsgrenzen — R1.1/R1.3/R1.6).
  // UF separat als markierte Arbeitstage pro Monat (voller Abzug je Tag).
  const tageByEmp: Record<string, { K: string[]; U: string[]; UF: string[] }> = {}
  // Persönliche Plantage pro Mitarbeiterin und Monat: jeder Tag mit einem
  // Arbeitsplan-Eintrag zählt voll (Arbeit UND Absenzen — der Monatslohn
  // deckt beide); nur «%»/Frei und leere Einträge zählen nicht.
  const planTage: Record<string, Record<string, number>> = {}
  for (const r of absRows) {
    const e = r.entry.trim().toUpperCase()
    if (e === '' || e === '%' || e === 'FREI') continue
    const monat = r.schedule_date.slice(0, 7)
    const pt = (planTage[r.employee_id] ??= {})
    pt[monat] = (pt[monat] ?? 0) + 1
    const t = (tageByEmp[r.employee_id] ??= { K: [], U: [], UF: [] })
    if (r.entry === 'K') t.K.push(r.schedule_date)
    else if (r.entry === 'U') t.U.push(r.schedule_date)
    else if (r.entry === 'UF') t.UF.push(r.schedule_date)
  }
  // Eintritt während eines Monats (Fall C, Pro-rata): Solltage innerhalb
  // der Anstellung = Plantage ab dem Eintrittsdatum. Austrittsdaten kennt
  // das System nicht — dort wird die Pro-rata im Dialog manuell aktiviert.
  const eintritte: Record<string, { datum: string; monat: string; innerhalbTage: number }> = {}
  for (const p of (profiles ?? []) as Array<{ id: string; eintrittsdatum?: string | null }>) {
    const ed = p.eintrittsdatum
    if (!ed || !ed.startsWith(String(jahr))) continue
    const monat = ed.slice(0, 7)
    let innerhalb = 0
    for (const r of absRows) {
      if (r.employee_id !== p.id || !r.schedule_date.startsWith(monat) || r.schedule_date < ed) continue
      const e = r.entry.trim().toUpperCase()
      if (e === '' || e === '%' || e === 'FREI') continue
      innerhalb++
    }
    eintritte[p.id] = { datum: ed, monat, innerhalbTage: innerhalb }
  }

  const absenzFaelle: Record<string, AbsenzFall[]> = {}
  const abzugsTage: Record<string, Record<string, { unbezahlt: number }>> = {}
  for (const [empId, t] of Object.entries(tageByEmp)) {
    const faelle: AbsenzFall[] = [
      ...absenzEpisoden(t.U).map(e => ({ typ: 'unfall' as const, beginn: e.von, ende: e.bis })),
      ...absenzEpisoden(t.K).map(e => ({ typ: 'krankheit' as const, beginn: e.von, ende: e.bis })),
    ].sort((a, b) => a.beginn.localeCompare(b.beginn))
    if (faelle.length > 0) absenzFaelle[empId] = faelle
    for (let m = 1; m <= 12; m++) {
      const monat = `${jahr}-${String(m).padStart(2, '0')}`
      const unbezahlt = t.UF.filter(d => d.startsWith(monat)).length
      if (unbezahlt > 0) (abzugsTage[empId] ??= {})[monat] = { unbezahlt }
    }
  }

  // BVG-Kontrolle: gespeicherter Abzug (Stammdaten/HR) gegen die massgebende
  // letzte Abrechnung jeder aktiven Person
  const bvgKontrolle: Array<{ id: string; name: string; stamm: number; abrechnung: number; periode: string }> = []
  for (const p of (profiles ?? []) as Array<{ id: string; full_name: string; is_active: boolean }>) {
    if (!p.is_active) continue
    const m = massgebendeAbrechnung(abrechnungen[p.id] ?? [])
    if (!m) continue
    const gespeichert = stamm[p.id]?.pkAbzug ?? lohnSeedFor(p.full_name)?.pkAbzug ?? 0
    if (Math.abs(gespeichert - m.pkAbzug) > 0.004) {
      bvgKontrolle.push({ id: p.id, name: p.full_name, stamm: gespeichert, abrechnung: m.pkAbzug, periode: m.periode })
    }
  }

  return (
    <LohnClient
      profiles={((profiles ?? []) as Array<{ id: string; full_name: string; job_title: string | null; pensum: number | null; monatslohn: number | null; bruttolohn_100: number | null; is_active: boolean }>).map(p => ({ ...p, extern: istExternProfil(p, externeIds) }))}
      bvgKontrolle={bvgKontrolle}
      saetzeByJahr={saetze}
      stammById={stamm}
      abrechnungenById={abrechnungen}
      abzugsTage={abzugsTage}
      absenzFaelle={absenzFaelle}
      planTage={planTage}
      eintritte={eintritte}
    />
  )
}
