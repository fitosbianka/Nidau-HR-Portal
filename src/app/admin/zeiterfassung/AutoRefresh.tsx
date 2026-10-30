'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Keeps the Jetzt-anwesend server component fresh via two mechanisms:
 *
 * 1. Supabase Realtime (postgres_changes) — fires within ~1 s of every
 *    attendance_events INSERT / UPDATE / DELETE that the TimeMoto webhook writes.
 *    Requires the table to be in the Supabase Realtime publication (see below).
 *
 * 2. 30-second polling fallback — ensures the page stays current even if
 *    Realtime is not yet enabled on the table.
 *
 * To enable Realtime on the table, run once in the Supabase SQL Editor:
 *   ALTER PUBLICATION supabase_realtime ADD TABLE attendance_events;
 */
export function AutoRefresh() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    // ── 1. Realtime subscription ─────────────────────────────────────────────
    const channel = supabase
      .channel('attendance-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_events' },
        () => router.refresh(),
      )
      .subscribe()

    // ── 2. Polling fallback (30 s) ────────────────────────────────────────────
    const fallback = setInterval(() => router.refresh(), 30_000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(fallback)
    }
  }, [router])

  return null
}
