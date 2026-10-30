'use client'

// Sichtbarkeit eines Teamevent-Ordners: «Alle im Team» oder eine Auswahl
// von Personen. Wird beim Anlegen und nachträglich (Dialog) verwendet.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { sichtbarkeitSetzen } from '@/actions/teamevents'
import type { TeSichtbar } from '@/lib/teamevents'
import type { TeamPerson } from '@/lib/teamevents-data'

/** «Alle im Team» oder «3 Personen: Anna, Beat, Clara». */
export function sichtbarText(s: TeSichtbar, team: TeamPerson[], kurz = false): string {
  if (s === 'alle') return 'Alle im Team'
  const namen = s.map(id => team.find(p => p.id === id)?.full_name ?? '?').sort((a, b) => a.localeCompare(b, 'de-CH'))
  if (kurz) return `${namen.length} Person${namen.length !== 1 ? 'en' : ''}`
  return `${namen.length} Person${namen.length !== 1 ? 'en' : ''}: ${namen.join(', ')}`
}

export function SichtbarkeitWahl({ wert, onChange, team }: { wert: TeSichtbar; onChange: (v: TeSichtbar) => void; team: TeamPerson[] }) {
  const alle = wert === 'alle'
  const ids = alle ? [] : wert
  const toggle = (id: string) => onChange(ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <label className={`flex items-center gap-2 px-3 py-1.5 rounded-ctl border cursor-pointer text-sm ${alle ? 'border-mint-mid bg-mint-bg text-mint-ink font-semibold' : 'border-edge-ctl text-ink-2'}`}>
          <input type="radio" className="accent-mint-mid" checked={alle} onChange={() => onChange('alle')} />
          Alle im Team
        </label>
        <label className={`flex items-center gap-2 px-3 py-1.5 rounded-ctl border cursor-pointer text-sm ${!alle ? 'border-mint-mid bg-mint-bg text-mint-ink font-semibold' : 'border-edge-ctl text-ink-2'}`}>
          <input type="radio" className="accent-mint-mid" checked={!alle} onChange={() => onChange(ids.length ? ids : [])} />
          Nur bestimmte Personen
        </label>
      </div>
      {!alle && (
        <div className="rounded-ctl border border-edge-ctl bg-white p-2 max-h-56 overflow-y-auto">
          {team.length === 0 ? (
            <p className="text-xs text-ink-4 px-1 py-1">Keine aktiven Mitarbeitenden gefunden.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
              {team.map(p => (
                <label key={p.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-surface cursor-pointer text-[13px] text-ink-2">
                  <input type="checkbox" className="accent-mint-mid" checked={ids.includes(p.id)} onChange={() => toggle(p.id)} />
                  <span className="truncate">{p.full_name}</span>
                </label>
              ))}
            </div>
          )}
          <div className="flex gap-3 px-1.5 pt-1.5 mt-1 border-t border-edge-soft text-[11px]">
            <button type="button" onClick={() => onChange(team.map(p => p.id))} className="text-mint-ink hover:underline">Alle anwählen</button>
            <button type="button" onClick={() => onChange([])} className="text-ink-4 hover:underline">Auswahl leeren</button>
            <span className="ml-auto text-ink-4 tnum">{ids.length} gewählt</span>
          </div>
        </div>
      )}
      <p className="text-[11px] text-ink-4">Die Organisatorin sieht jeden Ordner. Wer einen Ordner nicht sehen darf, kann auch keine Fotos daraus öffnen oder herunterladen.</p>
    </div>
  )
}

/** Dialog: Sichtbarkeit eines bestehenden Ordners ändern (Admins). */
export function SichtbarkeitDialog({ slug, name, wert, team, onClose }: {
  slug: string; name: string; wert: TeSichtbar; team: TeamPerson[]; onClose: () => void
}) {
  const router = useRouter()
  const [v, setV] = useState<TeSichtbar>(wert)
  const [err, setErr] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function speichern() {
    setErr(null)
    startTransition(async () => {
      const r = await sichtbarkeitSetzen(slug, v)
      if ('error' in r && r.error) { setErr(r.error); return }
      router.refresh()
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-lg p-5">
        <p className="text-sm font-bold text-ink mb-0.5">Sichtbarkeit {name}</p>
        <p className="text-[11px] text-ink-4 mb-4">Wer soll diesen Ordner und seine Fotos sehen?</p>
        <SichtbarkeitWahl wert={v} onChange={setV} team={team} />
        {err && <p className="text-xs text-blush-ink mt-3">⚠ {err}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="btn-secondary">Abbrechen</button>
          <button onClick={speichern} disabled={isPending || (v !== 'alle' && v.length === 0)} className="btn-primary">{isPending ? 'Speichert…' : 'Speichern'}</button>
        </div>
      </div>
    </div>
  )
}
