import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { modulAktiv } from '@/config/module'
import { AutoRefresh } from './AutoRefresh'
import { loadAnwesenheit, fmtZurichTime, fmtMinutesH, type AnwStatus, type AnwEmployee } from '@/lib/anwesenheit'

// Must be after imports. Tells Next.js: never cache this page — always render
// fresh from Supabase on every request (and every router.refresh() call).
export const dynamic = 'force-dynamic'

const STATUS_CONFIG: Record<AnwStatus, {
  label:     string
  dot:       string
  badge:     string
  border:    string
  animate?:  boolean
}> = {
  eingestempelt: { label: 'Eingestempelt', dot: 'bg-mint-mid', badge: 'bg-mint-bg text-mint-ink', border: 'border-l-mint-mid', animate: true  },
  zurueck:       { label: 'Zurück',        dot: 'bg-blue-500',    badge: 'bg-blue-100 text-blue-700',       border: 'border-l-blue-500',   animate: true  },
  pause:         { label: 'Pause',         dot: 'bg-apricot-mid', badge: 'bg-apricot-bg text-apricot-ink',     border: 'border-l-apricot-mid',  animate: false },
  ausgestempelt: { label: 'Ausgestempelt', dot: 'bg-ink-4',       badge: 'bg-edge-row text-ink-2',       border: 'border-l-edge-strong',   animate: false },
  abwesend:      { label: 'Abwesend',      dot: 'bg-ink-5',       badge: 'bg-edge-row text-ink-4',     border: 'border-l-edge-ctl',  animate: false },
}

export default async function AdminAnwesenheitPage() {
  if (!modulAktiv('anwesend')) redirect('/admin/zeiterfassung/berichte')
  const supabase = await createClient()
  const { list, counts } = await loadAnwesenheit(supabase)

  const nowZ = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Zurich' }))
  const todayDisplay = nowZ.toLocaleDateString('de-CH', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
  const nowTime = nowZ.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })

  function initials(name: string): string {
    return name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
  }

  function getTimeDetail(emp: AnwEmployee): string {
    if (emp.status === 'eingestempelt' && emp.inSince)  return `seit ${fmtZurichTime(emp.inSince)} Uhr`
    if (emp.status === 'zurueck'       && emp.inSince)  return `zurück seit ${fmtZurichTime(emp.inSince)} Uhr`
    if (emp.status === 'pause'         && emp.lastOutAt) return `Pause seit ${fmtZurichTime(emp.lastOutAt)} Uhr`
    if (emp.status === 'ausgestempelt' && emp.lastOutAt) return `gegangen um ${fmtZurichTime(emp.lastOutAt)} Uhr`
    return ''
  }

  const activeList  = list.filter(e => e.status !== 'abwesend')
  const absentList  = list.filter(e => e.status === 'abwesend')

  return (
    <div className="space-y-6">
      {/* Realtime refresh: Supabase WebSocket + 30 s polling fallback */}
      <AutoRefresh />

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Jetzt anwesend</h1>
          <p className="page-subtitle">{todayDisplay}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-mint-bg text-mint-ink text-xs font-semibold mt-1">
          <span className="w-1.5 h-1.5 rounded-full bg-mint-mid animate-pulse" />
          {nowTime} Uhr
        </span>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Anwesend',      value: counts.anwesend, color: 'text-mint-ink' },
          { label: 'Pause',         value: counts.pause,    color: 'text-apricot-mid'   },
          { label: 'Ausgestempelt', value: counts.ausgest,  color: 'text-ink-3'    },
          { label: 'Abwesend',      value: counts.abwesend, color: 'text-ink-4'   },
        ].map(s => (
          <div key={s.label} className="card p-4 text-center">
            <p className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Active employees — cards */}
      {activeList.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-ink-4 uppercase tracking-wider mb-3">Heute aktiv</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeList.map(emp => {
              const cfg = STATUS_CONFIG[emp.status]
              const timeDetail = getTimeDetail(emp)
              return (
                <div
                  key={emp.name}
                  className={`card border-l-4 ${cfg.border} p-4 flex flex-col gap-3`}
                >
                  {/* Top: avatar + name + badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-edge-row flex items-center justify-center text-xs font-semibold text-ink-3 flex-shrink-0">
                        {initials(emp.name)}
                      </div>
                      <p className="text-sm font-semibold text-ink truncate">{emp.name}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${cfg.badge}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}${cfg.animate ? ' animate-pulse' : ''}`} />
                      {cfg.label}
                    </span>
                  </div>

                  {/* Bottom: time detail + hours */}
                  <div className="flex items-end justify-between pl-12">
                    <p className="text-xs text-ink-4">{timeDetail}</p>
                    {emp.workedMinutes > 0 && (
                      <p className="text-sm font-bold text-ink-2 tabular-nums">
                        {fmtMinutesH(emp.workedMinutes)}
                        <span className="text-[10px] font-normal text-ink-4 ml-1">heute</span>
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Absent employees — compact cards */}
      {absentList.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-ink-4 uppercase tracking-wider mb-3">Abwesend</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {absentList.map(emp => {
              const cfg = STATUS_CONFIG[emp.status]
              const label = !emp.hadMonthEvent
                ? `Noch nicht eingestempelt im ${nowZ.toLocaleDateString('de-CH', { month: 'long' })}`
                : 'Heute nicht anwesend'
              return (
                <div
                  key={emp.name}
                  className={`card border-l-4 ${cfg.border} px-4 py-3 flex items-center gap-3`}
                >
                  <div className="w-8 h-8 rounded-full bg-edge-row flex items-center justify-center text-xs font-semibold text-ink-4 flex-shrink-0">
                    {initials(emp.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-3 truncate">{emp.name}</p>
                    <p className="text-[11px] text-ink-4">{label}</p>
                  </div>
                  <span className={`ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold flex-shrink-0 ${cfg.badge}`}>
                    <span className={`w-1 h-1 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <p className="text-[10px] text-ink-4 text-right">Wird automatisch alle 30 Sekunden aktualisiert</p>
    </div>
  )
}
