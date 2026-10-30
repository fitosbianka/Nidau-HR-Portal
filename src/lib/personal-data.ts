import { ohneGaesteErgebnis } from '@/lib/gaeste'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PersonalTyp } from '@/actions/personal'

// Shared loader for the Personal-Änderungen — used by the Personal page AND
// the admin Start page, so both always show the same entries: manual rows
// plus automatic ones from the Lohn-Historie (future effective dates) and
// future Eintrittsdaten.

export const PERSONAL_PREFIX = '__personal__'

export type PersonalEintrag = {
  key: string
  datum: string           // YYYY-MM-DD (Wirkungsdatum)
  typ: PersonalTyp
  emp: string
  text: string
  erledigt: boolean
  by: string | null
  quelle: 'manuell' | 'lohnhistorie' | 'profil'
}

export async function loadPersonalEintraege(admin: SupabaseClient): Promise<{
  eintraege: PersonalEintrag[]
  namen: string[]
  today: string
}> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })

  const [{ data: rows }, { data: salary }, { data: profs }] = await Promise.all([
    admin.from('zeiterfassung_comments')
      .select('user_full_name, schedule_date, comment')
      .like('user_full_name', '\\_\\_personal\\_\\_%'),
    admin.from('salary_history')
      .select('employee_id, effective_date, pensum, bruttolohn_100, monatslohn, notes')
      .gt('effective_date', today)
      .order('effective_date'),
    admin.from('profiles')
      .select('id, full_name, eintrittsdatum, job_title')
      .in('role', ['employee', 'admin'])
      .eq('is_active', true)
      .order('full_name')
      .then(ohneGaesteErgebnis),
  ])

  const profileList = (profs ?? []) as Array<{ id: string; full_name: string; eintrittsdatum: string | null }>
  const nameById = new Map(profileList.map(p => [p.id, p.full_name]))

  const eintraege: PersonalEintrag[] = []

  for (const r of (rows ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>) {
    try {
      const j = JSON.parse(r.comment) as { typ?: string; emp?: string; text?: string; erledigt?: boolean; by?: string }
      eintraege.push({
        key: r.user_full_name.slice(PERSONAL_PREFIX.length),
        datum: r.schedule_date,
        typ: (j.typ as PersonalEintrag['typ']) ?? 'Sonstiges',
        emp: j.emp ?? '—',
        text: j.text ?? '',
        erledigt: !!j.erledigt,
        by: j.by ?? null,
        quelle: 'manuell',
      })
    } catch { /* ignore bad rows */ }
  }

  // Automatic: future salary/Pensum changes from the Lohn-Historie
  for (const s of (salary ?? []) as Array<{ employee_id: string; effective_date: string; pensum: number | null; bruttolohn_100: number | null; monatslohn: number | null; notes: string | null }>) {
    const name = nameById.get(s.employee_id)
    if (!name) continue
    const parts: string[] = []
    if (s.pensum != null) parts.push(`Pensum ${s.pensum}%`)
    if (s.monatslohn != null) parts.push(`Monatslohn CHF ${s.monatslohn}`)
    else if (s.bruttolohn_100 != null) parts.push(`Bruttolohn (100%) CHF ${s.bruttolohn_100}`)
    if (s.notes) parts.push(s.notes)
    eintraege.push({
      key: `lohn-${s.employee_id}-${s.effective_date}`,
      datum: s.effective_date,
      typ: s.pensum != null && s.monatslohn == null && s.bruttolohn_100 == null ? 'Pensum' : 'Lohn',
      emp: name,
      text: parts.join(' · ') || 'Änderung gemäss Lohn-Historie',
      erledigt: false,
      by: null,
      quelle: 'lohnhistorie',
    })
  }

  // Automatic: future Eintritte
  for (const p of profileList) {
    if (p.eintrittsdatum && p.eintrittsdatum > today) {
      eintraege.push({
        key: `eintritt-${p.id}`,
        datum: p.eintrittsdatum,
        typ: 'Eintritt',
        emp: p.full_name,
        text: 'Eintritt gemäss Profil',
        erledigt: false,
        by: null,
        quelle: 'profil',
      })
    }
  }

  eintraege.sort((a, b) => a.datum.localeCompare(b.datum))

  return { eintraege, namen: profileList.map(p => p.full_name), today }
}
