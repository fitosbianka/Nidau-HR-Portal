'use client'

// Editor for the Kontroll-Regeln (shift patterns used by "Kontrolle Vormonat").
// One global save button; empty fields mean "no limit" for that check.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveKontrollRegeln } from '@/actions/kontrolle'
import type { KontrollRegel } from '@/lib/kontrolle'

export default function RegelnClient({ initial }: { initial: KontrollRegel[] }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [regeln, setRegeln] = useState<KontrollRegel[]>(initial)
  const [dirty,  setDirty]  = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const update = (i: number, patch: Partial<KontrollRegel>) => {
    setRegeln(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
    setDirty(true)
    setSaved(false)
  }
  const remove = (i: number) => {
    setRegeln(prev => prev.filter((_, idx) => idx !== i))
    setDirty(true)
    setSaved(false)
  }
  const add = () => {
    setRegeln(prev => [...prev, { id: `regel-${Date.now()}`, name: '', aktiv: true, ohnePause: false }])
    setDirty(true)
    setSaved(false)
  }

  const save = () => {
    setSaving(true)
    setError(null)
    startTransition(async () => {
      try {
        const res = await saveKontrollRegeln(regeln)
        if (res?.error) setError(res.error)
        else {
          setDirty(false)
          setSaved(true)
          router.refresh()
        }
      } catch {
        setError('Netzwerkfehler — Änderung wurde nicht gespeichert. Bitte erneut versuchen.')
      }
      setSaving(false)
    })
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-edge-soft bg-surface flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs">
          {dirty && !saving && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-apricot-bg text-apricot-ink font-bold text-[11px]">
              Nicht gespeicherte Änderungen
            </span>
          )}
          {saved && !dirty && <span className="font-semibold text-mint-ink">✓ Gespeichert</span>}
        </div>
        <button onClick={save} disabled={saving || !dirty} className="btn-primary !px-5 whitespace-nowrap disabled:opacity-40">
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
      </div>

      {error && (
        <div className="mx-5 mt-4 p-3 bg-blush-bg border border-blush-ink/30 rounded-ctl text-sm text-blush-ink">⚠ {error}</div>
      )}

      <div className="divide-y divide-edge-row">
        {regeln.map((r, i) => (
          <div key={r.id} className="px-5 py-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <input
                type="text"
                value={r.name}
                onChange={e => update(i, { name: e.target.value })}
                placeholder="Name der Schicht (steht in der Notiz)"
                maxLength={60}
                className="flex-1 min-w-[220px] px-3 py-2 text-sm font-semibold text-ink border border-edge-ctl rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk placeholder:text-ink-5"
              />
              <label className="inline-flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer select-none">
                <input type="checkbox" checked={r.aktiv} onChange={e => update(i, { aktiv: e.target.checked })} className="rounded border-edge-ctl" />
                Aktiv
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer select-none">
                <input type="checkbox" checked={r.ohnePause} onChange={e => update(i, { ohnePause: e.target.checked })} className="rounded border-edge-ctl" />
                Nur ohne Pause
              </label>
              <button
                onClick={() => remove(i)}
                className="w-7 h-7 rounded-lg hover:bg-blush-bg text-ink-4 hover:text-blush-ink flex items-center justify-center text-base leading-none"
                title="Regel löschen"
              >✕</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2">
              <div>
                <p className="field-label">Start zwischen</p>
                <div className="flex items-center gap-1.5">
                  <input type="time" value={r.startVon ?? ''} onChange={e => update(i, { startVon: e.target.value || undefined })} className="px-2 py-1.5 text-[12.5px] tnum border border-edge-ctl rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk" />
                  <span className="text-xs text-ink-4">und</span>
                  <input type="time" value={r.startBis ?? ''} onChange={e => update(i, { startBis: e.target.value || undefined })} className="px-2 py-1.5 text-[12.5px] tnum border border-edge-ctl rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk" />
                </div>
              </div>
              <div>
                <p className="field-label">Ende zwischen</p>
                <div className="flex items-center gap-1.5">
                  <input type="time" value={r.endeVon ?? ''} onChange={e => update(i, { endeVon: e.target.value || undefined })} className="px-2 py-1.5 text-[12.5px] tnum border border-edge-ctl rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk" />
                  <span className="text-xs text-ink-4">und</span>
                  <input type="time" value={r.endeBis ?? ''} onChange={e => update(i, { endeBis: e.target.value || undefined })} className="px-2 py-1.5 text-[12.5px] tnum border border-edge-ctl rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk" />
                </div>
              </div>
              <div>
                <p className="field-label">Gestempelte Dauer (Std.)</p>
                <div className="flex items-center gap-1.5">
                  <input type="number" min={0} max={24} step={0.5} value={r.dauerVonH ?? ''} onChange={e => update(i, { dauerVonH: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="von" className="w-[70px] px-2 py-1.5 text-[12.5px] tnum border border-edge-ctl rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk placeholder:text-ink-5" />
                  <span className="text-xs text-ink-4">bis</span>
                  <input type="number" min={0} max={24} step={0.5} value={r.dauerBisH ?? ''} onChange={e => update(i, { dauerBisH: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="bis" className="w-[70px] px-2 py-1.5 text-[12.5px] tnum border border-edge-ctl rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk placeholder:text-ink-5" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="px-5 py-3 border-t border-edge-soft flex items-center justify-between gap-3 flex-wrap">
        <button onClick={add} className="btn-secondary !px-4 !py-1.5 !text-xs">+ Regel hinzufügen</button>
        <p className="text-[11px] text-ink-4 max-w-[64ch]">
          Ein Tag passt zu einer Regel, sobald EINE der ausgefüllten Bedingungen zutrifft: Start im
          Fenster ODER Ende im Fenster ODER Dauer im Bereich. «Nur ohne Pause» schränkt die Regel
          zusätzlich auf Tage ein, die in einem Stück gestempelt wurden. Tage mit genau 8:30 werden
          nie markiert.
        </p>
      </div>
    </div>
  )
}
