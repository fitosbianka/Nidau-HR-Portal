import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ladeAlleSeiten, SEITENGROESSE } from '@/lib/seiten'
import { loadBerichteData, ladeTagesNotizen } from '@/lib/berichte-data'
import { makeNameCanonicalizer } from '@/lib/names'

// ── Nachbau des Supabase-Verhaltens: höchstens 1000 Zeilen pro Abfrage ─────
type Row = Record<string, string | null>
type Filter = (r: Row) => boolean
const likeRe = (muster: string, ci: boolean) => new RegExp('^' + muster
  .replace(/[.*+?^${}()|[\]\\]/g, m => (m === '\\' ? '\\' : `\\${m}`))
  .replace(/\\\\_/g, '\u0000').replace(/%/g, '.*').replace(/_/g, '.').replace(/\u0000/g, '_') + '$', ci ? 'i' : '')

function fakeSupabase(tabellen: Record<string, Row[]>, protokoll: string[] = []) {
  const builder = (name: string) => {
    const filter: Filter[] = []
    let bereich: [number, number] | null = null
    const b: Record<string, unknown> = {}
    const chain = (f?: Filter) => { if (f) filter.push(f); return b }
    const s = (v: unknown) => String(v ?? '')
    Object.assign(b, {
      select: () => chain(),
      is: (k: string, v: null) => chain(r => (r[k] ?? null) === v),
      eq: (k: string, v: string) => chain(r => r[k] === v),
      gte: (k: string, v: string) => chain(r => s(r[k]) >= v),
      lte: (k: string, v: string) => chain(r => s(r[k]) <= v),
      lt: (k: string, v: string) => chain(r => s(r[k]) < v),
      like: (k: string, m: string) => chain(r => likeRe(m, false).test(s(r[k]))),
      ilike: (k: string, m: string) => chain(r => likeRe(m, true).test(s(r[k]))),
      not: (k: string, op: string, m: string) => { if (op !== 'like') throw new Error(op); return chain(r => !likeRe(m, false).test(s(r[k]))) },
      or: () => chain(),
      order: () => chain(),
      range: (von: number, bis: number) => { bereich = [von, bis]; return b },
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
        const alle = (tabellen[name] ?? []).filter(r => filter.every(f => f(r)))
        // ohne range: PostgREST-Standard, höchstens 1000 Zeilen
        const data = bereich ? alle.slice(bereich[0], bereich[1] + 1) : alle.slice(0, SEITENGROESSE)
        protokoll.push(`${name}:${bereich ? `${bereich[0]}-${bereich[1]}` : 'ohne range'}:${data.length}`)
        return Promise.resolve({ data, error: null }).then(onF, onR)
      },
    })
    return b
  }
  return { from: builder } as unknown as SupabaseClient
}

describe('Seitenabruf (Supabase gibt höchstens 1000 Zeilen)', () => {
  it('ladeAlleSeiten holt alle Seiten bis zur ersten unvollständigen', async () => {
    const aufrufe: Array<[number, number]> = []
    const rows = await ladeAlleSeiten<number>(async (von, bis) => {
      aufrufe.push([von, bis])
      const n = von === 0 || von === 1000 ? 1000 : 250
      return { data: Array.from({ length: n }, (_, i) => von + i), error: null }
    })
    expect(rows).toHaveLength(2250)
    expect(rows[2249]).toBe(2249)
    expect(aufrufe).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
    expect(await ladeAlleSeiten(async () => ({ data: [], error: null }))).toEqual([])
    await expect(ladeAlleSeiten(async () => ({ data: null, error: { message: 'kaputt' } }))).rejects.toThrow('kaputt')
  })

  it('Tagesnotizen der Kontrolle fehlen auch dann nicht, wenn der Monat über 1000 Protokollzeilen hat', async () => {
    // Oktober 2026: 1200 Planprotokoll-Zeilen, dazwischen und am Ende echte Tagesnotizen
    const comments: Row[] = []
    for (let i = 0; i < 1200; i++) comments.push({ user_full_name: `__planlog__${String(i).padStart(5, '0')}`, schedule_date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, comment: '{"kind":"zelle"}' })
    comments.splice(500, 0, { user_full_name: 'Lena Muster', schedule_date: '2026-10-07', comment: 'Spätschicht' })   // TimeMoto-Schreibweise
    comments.push({ user_full_name: 'Lena Muster-Beispiel', schedule_date: '2026-10-21', comment: 'Frühschicht' })
    comments.push({ user_full_name: '__zeitlog__abc', schedule_date: '2026-10-21', comment: '{"at":"x","text":"y"}' })
    // 1500 Stempel in einem Monat
    const events: Row[] = []
    for (let i = 0; i < 1500; i++) {
      const tag = String((i % 22) + 1).padStart(2, '0')
      events.push({ timemoto_event_id: `ev${String(i).padStart(5, '0')}`, user_full_name: i % 2 ? 'Lena Muster' : 'Nina Muster', clocking_type: i % 4 < 2 ? 'In' : 'Out', time_logged: `2026-10-${tag}T0${6 + (i % 4)}:00:00.000Z`, clocking_pair_id: `p${Math.floor(i / 2)}`, location_name: null, deleted_at: null })
    }
    const protokoll: string[] = []
    const db = fakeSupabase({
      zeiterfassung_comments: comments,
      attendance_events: events,
      work_schedule: [],
      profiles: [{ id: 'u1', full_name: 'Lena Muster-Beispiel', job_title: 'DA', role: 'employee' }, { id: 'u2', full_name: 'Nina Muster', job_title: 'DA', role: 'employee' }],
    }, protokoll)

    const data = await loadBerichteData(db, { dateFrom: '2026-10-01', dateTo: '2026-10-31' })
    expect(data.initialComments['Lena Muster-Beispiel||2026-10-07']).toBe('Spätschicht')
    expect(data.initialComments['Lena Muster-Beispiel||2026-10-21']).toBe('Frühschicht')
    expect(Object.keys(data.initialComments)).toHaveLength(2)          // Protokollzeilen bleiben draussen
    expect(data.events).toHaveLength(1500)                              // zweite Seite geladen
    expect(protokoll.filter(p => p.startsWith('attendance_events:'))).toEqual(['attendance_events:0-999:1000', 'attendance_events:1000-1999:500'])
    expect(protokoll.some(p => p.includes('ohne range') && !p.startsWith('profiles:'))).toBe(false)

    // Sicherung für den Export: Notizen der Person direkt nach Namen, kanonisch zugeordnet
    const canonical = makeNameCanonicalizer(['Lena Muster-Beispiel', 'Nina Muster'])
    const notizen = await ladeTagesNotizen(db, 'Lena Muster-Beispiel', canonical, '2026-10-01', '2026-10-31')
    expect(notizen).toEqual({ 'Lena Muster-Beispiel||2026-10-07': 'Spätschicht', 'Lena Muster-Beispiel||2026-10-21': 'Frühschicht' })
  })

  it('Meine Zeiten: nur die eigenen Zeilen werden geladen', async () => {
    const protokoll: string[] = []
    const db = fakeSupabase({
      zeiterfassung_comments: [
        { user_full_name: 'Nina Muster', schedule_date: '2026-10-02', comment: 'Frühschicht' },
        { user_full_name: 'Lena Muster-Beispiel', schedule_date: '2026-10-02', comment: 'fremd' },
      ],
      attendance_events: [
        { timemoto_event_id: 'a', user_full_name: 'Nina Muster', clocking_type: 'In', time_logged: '2026-10-02T06:00:00.000Z', clocking_pair_id: 'p1', location_name: null, deleted_at: null },
        { timemoto_event_id: 'b', user_full_name: 'Lena Muster', clocking_type: 'In', time_logged: '2026-10-02T06:00:00.000Z', clocking_pair_id: 'p2', location_name: null, deleted_at: null },
      ],
      work_schedule: [],
      profiles: [{ id: 'u1', full_name: 'Lena Muster-Beispiel', job_title: 'DA', role: 'employee' }, { id: 'u2', full_name: 'Nina Muster', job_title: 'DA', role: 'employee' }],
    }, protokoll)
    const { loadOwnBerichteData } = await import('@/lib/berichte-data')
    const eigene = await loadOwnBerichteData(db, 'u2', 'Nina Muster')
    expect(eigene.events.map(e => e.timemoto_event_id)).toEqual(['a'])
    expect(eigene.initialComments).toEqual({ 'Nina Muster||2026-10-02': 'Frühschicht' })
    expect(eigene.profiles.map(p => p.id)).toEqual(['u2'])
  })
})
