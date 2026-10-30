'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { submitZeitKorrektur } from '@/actions/korrekturen'
import type { ZeitKorrektur } from '@/lib/korrekturen'
import { fmtKDate as fmtDate, StatusChip, KorrekturModal } from '@/components/korrekturen/KorrekturShared'

/** Report a Zeiterfassung correction (visible on the admin dashboard),
 *  plus the caller's full correction history (5 latest, rest in a modal). */
export default function ZeitKorrekturCard({ mine }: { mine: ZeitKorrektur[] }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [datum, setDatum] = useState('')
  const [zeit,  setZeit]  = useState('')
  const [text,  setText]  = useState('')
  const [busy,  setBusy]  = useState(false)
  const [msg,   setMsg]   = useState<{ ok: boolean; text: string } | null>(null)
  const [showAll, setShowAll] = useState(false)

  function submit() {
    if (!datum) { setMsg({ ok: false, text: 'Bitte das Datum wählen, das korrigiert werden muss.' }); return }
    if (!zeit.trim()) { setMsg({ ok: false, text: 'Bitte die korrekte Zeit angeben.' }); return }
    setBusy(true)
    setMsg(null)
    startTransition(async () => {
      let res: { error?: string } | undefined
      try {
        res = await submitZeitKorrektur(datum, zeit, text)
      } catch {
        res = { error: 'Netzwerkfehler — bitte erneut versuchen.' }
      }
      if (res?.error) {
        setMsg({ ok: false, text: res.error })
      } else {
        setMsg({ ok: true, text: 'Danke! Die Meldung liegt jetzt auf dem Dashboard der Praxisleitung.' })
        setDatum(''); setZeit(''); setText('')
        router.refresh()
      }
      setBusy(false)
    })
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-6 py-4 border-b border-edge-soft">
        <h2 className="text-sm font-semibold text-ink-2">Zeiterfassung — Korrektur melden</h2>
        <p className="text-xs text-ink-4 mt-0.5">
          Stimmt etwas an Ihrer Zeiterfassung nicht (z.&nbsp;B. Stempeln vergessen)?
          Melden Sie hier den Tag und die korrekte Zeit — die Meldung erscheint direkt bei der Praxisleitung auf dem Dashboard.
        </p>
      </div>

      <div className="p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-[.14em] block mb-1.5">
              Zu korrigierender Tag
            </label>
            <input
              type="date"
              value={datum}
              onChange={e => setDatum(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-edge-ctl rounded-ctl outline-none focus:border-dusk bg-white"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-[.14em] block mb-1.5">
              Korrekte Zeit
            </label>
            <input
              type="text"
              value={zeit}
              onChange={e => setZeit(e.target.value)}
              placeholder="z. B. 07:45–12:00 / 13:00–17:15"
              maxLength={120}
              className="w-full px-3 py-2 text-sm border border-edge-ctl rounded-ctl outline-none focus:border-dusk bg-white"
            />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-[.14em] block mb-1.5">
            Bemerkung (optional)
          </label>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="z. B. Ausstempeln am Abend vergessen"
            className="w-full px-3 py-2 text-sm border border-edge-ctl rounded-ctl outline-none focus:border-dusk bg-white resize-y"
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={submit} disabled={busy} className="btn-primary">
            {busy ? 'Wird gesendet…' : 'Korrektur melden'}
          </button>
          {msg && (
            <p className={`text-xs px-3 py-1.5 rounded-ctl ${msg.ok ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>
              {msg.ok ? '✓ ' : '⚠ '}{msg.text}
            </p>
          )}
        </div>

        {mine.length > 0 && (
          <div className="pt-4 border-t border-edge-soft">
            <div className="flex items-center justify-between mb-2">
              <p className="eyebrow mb-0">Meine Korrektur-Meldungen</p>
              {mine.length > 5 && (
                <button
                  onClick={() => setShowAll(true)}
                  className="text-xs font-semibold text-mint-ink hover:underline underline-offset-2"
                >
                  Weitere ({mine.length - 5}) …
                </button>
              )}
            </div>
            <ul className="space-y-1.5">
              {mine.slice(0, 5).map(k => (
                <li key={k.key} className="text-xs text-ink-3 flex flex-wrap gap-x-2 gap-y-1 items-center">
                  <span className="font-semibold text-ink-2 tnum">{fmtDate(k.datum)}</span>
                  <span className="tnum">{k.zeit}</span>
                  {k.text && <span className="text-ink-4">— {k.text}</span>}
                  <span className="text-ink-5">(gemeldet am {fmtDate(k.am)})</span>
                  <StatusChip done={k.done} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {showAll && (
        <KorrekturModal
          title="Alle meine Korrektur-Meldungen"
          items={mine}
          onClose={() => setShowAll(false)}
        />
      )}
    </div>
  )
}
