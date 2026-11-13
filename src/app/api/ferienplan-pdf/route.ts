import { ohneGaesteErgebnis } from '@/lib/gaeste'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateFerienplanPdf } from '@/lib/pdf/hr-pdfs.mjs'
import { FERIEN_EDITORS } from '@/lib/leitende'
import { FERIEN_EXCLUDED } from '@/lib/ferienplanung-data'
import { ladeExterne } from '@/lib/externe'
import { maskUfEntries } from '@/lib/plan-privacy'
import { weekdaysBetween } from '@/lib/ferien-wuensche'
import { ferienWeight, round2 } from '@/lib/ferien'
import { pensumFaktor } from '@/lib/ferien-anspruch'
import { istFerienAlsMinusstunden } from '@/lib/ferien-minusstunden'

// Der Ferienplan als PDF (eine A4-Querseite) — gleicher Stil wie das
// Arbeitsplan-PDF. GET ?from=YYYY-MM-DD&to=YYYY-MM-DD (&dl=1 → Download).
// Nur akzeptierte Einträge (F/UF/WB/ND); UF anderer Personen erscheint wie
// im Portal maskiert als F (nur Admins sehen «UF»). Zugriff: Admins und die
// Ferien-Editorin — dieselben Personen, die im Portal die volle
// Planungsseite mit der Tage-Spalte sehen.
//
// Damit IMMER alles auf eine Seite passt, wählt die Route die Spaltenform:
//   · kurzes Intervall (≤ 55 Werktage) → eine Spalte pro Werktag
//   · länger (bis ganzes Jahr)         → eine Spalte pro Kalenderwoche mit
//     fünf Tagessegmenten (wie die Jahresansicht im Portal)

const MON_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const DOW_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr']

// gleiche Gruppen und Farben wie der Ferienkalender im Portal
const GROUPS: Array<{ label: string; match: (t: string | null) => boolean; bg: string; fg: string }> = [
  { label: 'ZAZ',      match: t => t === 'ZAZ',                                bg: '#DFEDE8', fg: '#3F6B62' },
  { label: 'DH / PA',  match: t => t === 'DH / PA' || t === 'DH' || t === 'PA', bg: '#DFE7F2', fg: '#4F6B8F' },
  { label: 'DA',       match: t => t === 'DA' || t === 'Leitende DA',           bg: '#F7EAD9', fg: '#96703F' },
  { label: 'Lernende', match: t => t === 'Lernende',                            bg: '#EAE7F1', fg: '#5A5170' },
  { label: 'Weitere',  match: t => !['ZAZ', 'DH / PA', 'DH', 'PA', 'DA', 'Leitende DA', 'Lernende'].includes(t ?? ''), bg: '#F1EFEA', fg: '#55525E' },
]

// Zellfarben wie ACCEPT_FILL im Portal-Kalender, Textfarben je Art dunkler
type Code = 'F' | 'UF' | 'WB' | 'ND'
const FILLS: Record<Code, { bg: string; fg: string }> = {
  F:  { bg: '#BBD8D0', fg: '#33574F' },
  UF: { bg: '#CFCABA', fg: '#6E6749' },
  WB: { bg: '#CDC5E2', fg: '#5A5170' },
  ND: { bg: '#F0B4A2', fg: '#A6492F' },
}
const CODE_LABEL: Record<Code, string> = {
  F: 'Ferien', UF: 'Unbezahlte Ferien', WB: 'Weiterbildung', ND: 'Notfalldienst',
}

function isoKw(ds: string): number {
  const d = new Date(`${ds}T00:00:00`)
  const t = new Date(d)
  t.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const jan4 = new Date(t.getFullYear(), 0, 4)
  return 1 + Math.round(((t.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7)
}
const fmtCH = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const { data: profRow } = await supabase
    .from('profiles').select('role, full_name').eq('id', user.id).single()
  const prof = profRow as { role: string; full_name: string } | null
  const isAdmin = prof?.role === 'admin'
  if (!isAdmin && !FERIEN_EDITORS.includes(prof?.full_name ?? '')) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
  }

  const from = req.nextUrl.searchParams.get('from') ?? ''
  const to = req.nextUrl.searchParams.get('to') ?? ''
  const dl = req.nextUrl.searchParams.get('dl') === '1'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
    return NextResponse.json({ error: 'Ungültiger Zeitraum' }, { status: 400 })
  }
  const spanDays = (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000
  if (spanDays > 750) {
    return NextResponse.json({ error: 'Der Zeitraum ist zu lang (maximal zwei Jahre).' }, { status: 400 })
  }
  const weekdays = weekdaysBetween(from, to)
  if (weekdays.length === 0) {
    return NextResponse.json({ error: 'Keine Werktage (Mo–Fr) im gewählten Zeitraum.' }, { status: 400 })
  }

  const admin = await createAdminClient()
  const { data: empRows } = await admin.from('profiles')
    .select('id, full_name, job_title, schedule_order, pensum')
    .eq('role', 'employee').eq('is_active', true)
    .order('schedule_order', { ascending: true, nullsFirst: false })
    .order('full_name')
    .then(ohneGaesteErgebnis)
  const externeIds = await ladeExterne(admin)
  const emps = ((empRows ?? []) as Array<{ id: string; full_name: string; job_title: string | null; schedule_order: number | null; pensum: number | null }>)
    .filter(e => !FERIEN_EXCLUDED.has(e.full_name) && !externeIds.has(e.id))

  // Einträge paginiert laden (1000-Zeilen-Limit pro Request)
  type Row = { employee_id: string; schedule_date: string; entry: string }
  const rows: Row[] = []
  for (let idx = 0; ; idx += 1000) {
    const { data } = await admin.from('work_schedule')
      .select('employee_id, schedule_date, entry')
      .or('entry.eq.F,entry.like.F:*,entry.eq.UF,entry.eq.WB,entry.eq.ND')
      .gte('schedule_date', from).lte('schedule_date', to)
      .order('schedule_date', { ascending: true })
      .range(idx, idx + 999)
    if (!data || data.length === 0) break
    rows.push(...(data as Row[]))
    if (data.length < 1000) break
  }

  // UF anderer Personen wie im Portal maskieren (nur Admins sehen «UF»)
  const masked = maskUfEntries(rows, user.id, isAdmin)
  const entryMap = new Map<string, Code>()
  const weight = new Map<string, number>()   // Ferien-Gewicht (F:x) pro Zelle
  for (const r of masked) {
    const code: Code | null =
      r.entry === 'F' || r.entry.startsWith('F:') ? 'F'
      : r.entry === 'UF' ? 'UF' : r.entry === 'WB' ? 'WB' : r.entry === 'ND' ? 'ND' : null
    if (!code) continue
    const k = `${r.employee_id}|${r.schedule_date}`
    entryMap.set(k, code)
    if (code === 'F') weight.set(k, r.entry.startsWith('F:') ? (ferienWeight(r.entry) ?? 1) : NaN)
  }

  // Spaltenform: Werktage einzeln oder Kalenderwochen mit 5 Segmenten
  const mode: 'days' | 'weeks' = weekdays.length <= 55 ? 'days' : 'weeks'
  const crossYear = from.slice(0, 4) !== to.slice(0, 4)

  let columns: Array<{ num?: number; wd?: string; kw?: number }>
  let headSpans: Array<{ label: string; count: number }>
  let cellDays: string[][]   // pro Spalte die ISO-Tage (1 im days-Modus, 5 im weeks-Modus)

  if (mode === 'days') {
    columns = weekdays.map(d => ({
      num: parseInt(d.slice(8), 10),
      wd: DOW_SHORT[(new Date(`${d}T00:00:00`).getDay() + 6) % 7],
    }))
    cellDays = weekdays.map(d => [d])
    headSpans = []
    for (const d of weekdays) {
      const label = `KW ${isoKw(d)}`
      const last = headSpans[headSpans.length - 1]
      if (last && last.label === label) last.count++
      else headSpans.push({ label, count: 1 })
    }
  } else {
    // Wochen ab dem Montag der Startwoche bis zur Woche des Endtags
    const start = new Date(`${from}T00:00:00`)
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    columns = []
    cellDays = []
    headSpans = []
    const cur = new Date(start)
    while (isoOf(cur) <= to) {
      const days: string[] = []
      for (let i = 0; i < 5; i++) {
        const dd = new Date(cur)
        dd.setDate(cur.getDate() + i)
        const iso = isoOf(dd)
        days.push(iso >= from && iso <= to ? iso : '')   // ausserhalb → leer
      }
      columns.push({ kw: isoKw(isoOf(new Date(cur.getTime() + 3 * 86400000))) })
      cellDays.push(days)
      // Monats-Beschriftung nach dem ERSTEN Tag im Zeitraum (nicht dem
      // Donnerstag): die Randwoche um Neujahr gehört sonst zum Vorjahres-Dez
      const anchor = days.find(x => x !== '') ?? isoOf(cur)
      const am = parseInt(anchor.slice(5, 7), 10) - 1
      const label = crossYear ? `${MON_SHORT[am]} ${anchor.slice(2, 4)}` : MON_SHORT[am]
      const last = headSpans[headSpans.length - 1]
      if (last && last.label === label) last.count++
      else headSpans.push({ label, count: 1 })
      cur.setDate(cur.getDate() + 7)
    }
  }

  // Gruppenzeilen wie im Portal-Kalender, Tage-Spalte pensumgewichtet
  const groups = GROUPS
    .map(g => ({
      label: g.label, bg: g.bg, fg: g.fg,
      rows: emps.filter(e => g.match(e.job_title)).map(e => {
        const faktor = pensumFaktor(e.pensum)
        let tage = 0
        const cells = cellDays.map(days => {
          const codes = days.map(d => (d ? entryMap.get(`${e.id}|${d}`) ?? null : null))
          for (let i = 0; i < days.length; i++) {
            if (codes[i] !== 'F') continue
            // Vereinbarte Ausnahme: kein Ferienbezug (Minusstunden) — Zelle bleibt «F»
            if (istFerienAlsMinusstunden(e.full_name, days[i]!)) continue
            const w = weight.get(`${e.id}|${days[i]}`)
            tage += w != null && !Number.isNaN(w) ? w : faktor
          }
          return mode === 'days' ? codes[0] : codes
        })
        return { name: e.full_name, cells, total: round2(tage) > 0 ? String(round2(tage)) : '' }
      }),
    }))
    .filter(g => g.rows.length > 0)

  // Legende: nur vorkommende Arten (Ferien immer)
  const present = new Set<Code>(['F'])
  entryMap.forEach(code => present.add(code))
  const legend = (['F', 'UF', 'WB', 'ND'] as Code[])
    .filter(c => present.has(c))
    .map(c => ({ code: c, label: CODE_LABEL[c], bg: FILLS[c].bg, fg: FILLS[c].fg }))

  const rangeLabel = `${fmtCH(from)} – ${fmtCH(to)}`
  let bytes: Uint8Array
  try {
    bytes = await generateFerienplanPdf({
      rangeLabel,
      createdLabel: `Erstellt am ${new Date().toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })} · nur akzeptierte Einträge`,
      mode,
      columns,
      headSpans,
      groups,
      fills: FILLS,
      legend,
      showTotals: true,
      hint: mode === 'days'
        ? '«Tage» = akzeptierte Ferientage im Zeitraum, pensumgewichtet (unbezahlte Ferien, Weiterbildung und Notfalldienst zählen nicht als Ferientage).'
        : 'Jede Wochenzelle zeigt fünf Tagessegmente (Mo–Fr). «Tage» = akzeptierte Ferientage im Zeitraum, pensumgewichtet (UF/WB/ND zählen nicht als Ferientage).',
    })
  } catch (err) {
    console.error('[ferienplan-pdf]', err)
    return NextResponse.json({ error: 'PDF-Erstellung fehlgeschlagen' }, { status: 500 })
  }

  const fname = `Ferienplan_${from}_bis_${to}.pdf`
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${dl ? 'attachment' : 'inline'}; filename="${fname}"`,
    },
  })
}
