'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { resolveZeitKorrektur, deleteZeitKorrektur, getKorrekturTagesZeiten, saveKorrekturTagesNotiz } from '@/actions/korrekturen'
import type { ZeitKorrektur } from '@/lib/korrekturen'
import { fmtKDate as fmtDate, KorrekturModal } from '@/components/korrekturen/KorrekturShared'
import { zurichZuIso } from '@/lib/zeitzone'

type ZeitenSpan = {
  zeit: string
  komplett: boolean
  inId: string | null
  outId: string | null
  inHHMM: string
  outHHMM: string
  newIn: string
  newOut: string
}

type ZeitenState = {
  korrektur: ZeitKorrektur
  loading: boolean
  spans: ZeitenSpan[]
  totalMin: number
  note: string
  origNote: string
  loadError: string | null
  saving: boolean
  saved: boolean
  addIn: string    // optional new entry, clock-in (HH:MM)
  addOut: string   // optional new entry, clock-out (HH:MM)
}

function fmtH(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`
}

/** Zürcher Wandzeit als UTC ISO, mit dem echten Offset des Tages (Sommer- oder Winterzeit) */
const buildISO = (zurichDate: string, hhMM: string): string => zurichZuIso(zurichDate, hhMM)

function initials(name: string): string {
  return name.split(' ').filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?'
}

/** Zeiterfassung correction requests, newest first — 5 open ones on the
 *  card, the rest in a modal, plus the last 5 corrected ones below. The
 *  card is always shown; without open requests it says so. */
export default function KorrekturMeldungen({ items }: { items: ZeitKorrektur[] }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [zeiten, setZeiten] = useState<ZeitenState | null>(null)

  const open = items.filter(k => !k.done)
  const erledigt = items
    .filter(k => k.done)
    .sort((a, b) => (b.done ?? '').localeCompare(a.done ?? '') || (b.am ?? '').localeCompare(a.am ?? ''))
    .slice(0, 5)

  function done(key: string) {
    setBusyKey(key)
    setError(null)
    startTransition(async () => {
      let res: { error?: string } | undefined
      try {
        res = await resolveZeitKorrektur(key)
      } catch {
        res = { error: 'Netzwerkfehler — bitte erneut versuchen.' }
      }
      if (res?.error) setError(res.error)
      else router.refresh()
      setBusyKey(null)
    })
  }

  function openZeiten(k: ZeitKorrektur) {
    setZeiten({ korrektur: k, loading: true, spans: [], totalMin: 0, note: '', origNote: '', loadError: null, saving: false, saved: false, addIn: '', addOut: '' })
    startTransition(async () => {
      try {
        const res = await getKorrekturTagesZeiten(k.name, k.datum)
        setZeiten(prev => prev && prev.korrektur.key === k.key
          ? ('error' in res && res.error
              ? { ...prev, loading: false, loadError: res.error }
              : {
                  ...prev,
                  loading: false,
                  spans: (res.spans ?? []).map(s => ({ ...s, newIn: s.inHHMM, newOut: s.outHHMM })),
                  totalMin: res.totalMin ?? 0,
                  note: res.note ?? '',
                  origNote: res.note ?? '',
                })
          : prev)
      } catch {
        setZeiten(prev => prev && prev.korrektur.key === k.key
          ? { ...prev, loading: false, loadError: 'Netzwerkfehler — bitte erneut versuchen.' }
          : prev)
      }
    })
  }

  /** One call against the attendance API; surfaces the server's German
   *  error message when it rejects (e.g. Ausstempeln vor Einstempeln). */
  async function zeitRequest(method: 'PATCH' | 'PUT' | 'POST' | 'DELETE', payload: unknown) {
    const res = await fetch('/api/admin/attendance', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(j.error ?? 'Speichern fehlgeschlagen. Bitte erneut versuchen.')
    }
  }

  /** Delete one stamped entry of the day (soft-delete via the attendance
   *  API — recoverable in the database, logged, gone from all reports). */
  function deleteSpan(i: number) {
    if (!zeiten || zeiten.saving) return
    const s = zeiten.spans[i]
    const ids = [s.inId, s.outId].filter((x): x is string => !!x)
    if (ids.length === 0) return
    if (!confirm(`Eintrag ${s.zeit} von ${zeiten.korrektur.name} wirklich löschen?\nEr verschwindet aus allen Berichten und Zeiten-Ansichten.`)) return
    setZeiten(prev => prev && ({ ...prev, saving: true, saved: false, loadError: null }))
    startTransition(async () => {
      try {
        await zeitRequest('DELETE', { timemoto_event_ids: ids })
        const reload = await getKorrekturTagesZeiten(zeiten.korrektur.name, zeiten.korrektur.datum)
        setZeiten(prev => {
          if (!prev || prev.korrektur.key !== zeiten.korrektur.key) return prev
          const base = { ...prev, saving: false, saved: true }
          if ('error' in reload && reload.error) return base
          return {
            ...base,
            spans: (reload.spans ?? []).map(sp => ({ ...sp, newIn: sp.inHHMM, newOut: sp.outHHMM })),
            totalMin: reload.totalMin ?? 0,
          }
        })
        router.refresh()
      } catch (err) {
        setZeiten(prev => prev && ({
          ...prev, saving: false,
          loadError: err instanceof Error && err.message ? err.message : 'Löschen fehlgeschlagen. Bitte erneut versuchen.',
        }))
      }
    })
  }

  /** Save changed times (via the attendance API, which logs the changes),
   *  complete unvollständige Stempel, add a new entry and save the day
   *  note. The Meldung stays OPEN — it disappears only when
   *  «✓ Korrigiert» is clicked. */
  function saveZeiten() {
    if (!zeiten) return
    const fail = (msg: string) => setZeiten(prev => prev && ({ ...prev, loadError: msg }))
    for (const sp of zeiten.spans) {
      // A stamped side must keep a valid time; the missing side of an
      // incomplete span may stay empty (bleibt offen) or be filled in.
      if ((sp.inId && !sp.newIn) || (sp.outId && !sp.newOut)) {
        return fail('Bitte gültige Zeiten (HH:MM) eingeben.')
      }
      if ((sp.newIn && !/^\d{2}:\d{2}$/.test(sp.newIn)) || (sp.newOut && !/^\d{2}:\d{2}$/.test(sp.newOut))) {
        return fail('Bitte gültige Zeiten (HH:MM) eingeben.')
      }
      if (sp.newIn && sp.newOut && sp.newOut <= sp.newIn) {
        return fail('Ausstempeln muss nach dem Einstempeln liegen.')
      }
    }
    if (!!zeiten.addIn !== !!zeiten.addOut) {
      return fail('Für den neuen Eintrag bitte beide Zeiten angeben.')
    }
    if (zeiten.addIn && zeiten.addOut && zeiten.addOut <= zeiten.addIn) {
      return fail('Ausstempeln muss nach dem Einstempeln liegen.')
    }
    setZeiten(prev => prev && ({ ...prev, saving: true, saved: false, loadError: null }))
    startTransition(async () => {
      try {
        const datum = zeiten.korrektur.datum
        // Sequential on purpose: adjust existing stamps first, THEN insert
        // the completing counterpart, so the server checks the In/Out order
        // against the already-corrected time.
        for (const sp of zeiten.spans) {
          if (sp.inId && sp.newIn && sp.newIn !== sp.inHHMM) {
            await zeitRequest('PATCH', { timemoto_event_id: sp.inId, time_logged: buildISO(datum, sp.newIn) })
          }
          if (sp.outId && sp.newOut && sp.newOut !== sp.outHHMM) {
            await zeitRequest('PATCH', { timemoto_event_id: sp.outId, time_logged: buildISO(datum, sp.newOut) })
          }
          if (!sp.outId && sp.inId && sp.newOut) {
            await zeitRequest('PUT', { timemoto_event_id: sp.inId, time_logged: buildISO(datum, sp.newOut) })
          }
          if (!sp.inId && sp.outId && sp.newIn) {
            await zeitRequest('PUT', { timemoto_event_id: sp.outId, time_logged: buildISO(datum, sp.newIn) })
          }
        }
        if (zeiten.addIn && zeiten.addOut) {
          await zeitRequest('POST', {
            userFullName: zeiten.korrektur.name,
            clockIn: buildISO(datum, zeiten.addIn),
            clockOut: buildISO(datum, zeiten.addOut),
          })
        }
        if (zeiten.note.trim() !== zeiten.origNote.trim()) {
          const res = await saveKorrekturTagesNotiz(zeiten.korrektur.name, datum, zeiten.note)
          if (res && 'error' in res && res.error) throw new Error(res.error)
        }
        // Reload the day so completed pairs and new entries show up with
        // their fresh event ids (needed for further edits) and totals.
        const reload = await getKorrekturTagesZeiten(zeiten.korrektur.name, datum)
        setZeiten(prev => {
          if (!prev || prev.korrektur.key !== zeiten.korrektur.key) return prev
          const base = { ...prev, saving: false, saved: true, origNote: prev.note, addIn: '', addOut: '' }
          if ('error' in reload && reload.error) return base
          return {
            ...base,
            spans: (reload.spans ?? []).map(s => ({ ...s, newIn: s.inHHMM, newOut: s.outHHMM })),
            totalMin: reload.totalMin ?? 0,
          }
        })
        router.refresh()
      } catch (err) {
        setZeiten(prev => prev && ({
          ...prev, saving: false,
          loadError: err instanceof Error && err.message ? err.message : 'Speichern fehlgeschlagen. Bitte erneut versuchen.',
        }))
      }
    })
  }

  function remove(k: ZeitKorrektur) {
    if (!confirm(`Meldung von ${k.name} (${fmtDate(k.datum)}) endgültig löschen?\nSie verschwindet auch in der Liste der Mitarbeiterin.`)) return
    setBusyKey(k.key)
    setError(null)
    startTransition(async () => {
      let res: { error?: string } | undefined
      try {
        res = await deleteZeitKorrektur(k.key)
      } catch {
        res = { error: 'Netzwerkfehler — bitte erneut versuchen.' }
      }
      if (res?.error) setError(res.error)
      else router.refresh()
      setBusyKey(null)
    })
  }

  return (
    <div className={`card overflow-hidden ${open.length > 0 ? 'border-steel-ink/20' : ''}`}>
      <div className="px-6 py-4 border-b border-edge-soft flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-ink-2">Korrektur-Meldungen — Zeiterfassung</h2>
        <div className="flex items-center gap-3">
          <Link href="/admin/zeiterfassung/korrekturen" className="text-xs font-semibold text-ink-4 hover:text-ink-2 hover:underline underline-offset-2">
            Alle Korrekturen ansehen →
          </Link>
          {open.length > 0 ? (
            <span className="badge badge-teal">
              <span className="w-1.5 h-1.5 rounded-full bg-mint-mid" />
              {open.length} offen
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-edge-row text-ink-4 text-xs font-semibold">
              0 offen
            </span>
          )}
        </div>
      </div>
      {error && (
        <p className="mx-6 mt-3 text-xs px-3 py-1.5 rounded-ctl bg-blush-bg text-blush-ink">⚠ {error}</p>
      )}
      {open.length === 0 && (
        <p className="px-6 py-4 text-sm text-ink-4">Im Moment gibt es keine offenen Korrektur-Meldungen.</p>
      )}
      <ul className="divide-y divide-edge-row">
        {open.slice(0, 5).map(k => (
          <li key={k.key} className="px-6 py-3.5 flex items-center gap-4 flex-wrap">
            <div className="avatar w-9 h-9 text-xs flex-shrink-0">{initials(k.name)}</div>
            <div className="flex-1 min-w-[220px]">
              <p className="text-sm font-semibold text-ink">{k.name}</p>
              <p className="text-xs text-ink-3 mt-0.5">
                <span className="font-semibold text-ink-2">Tag: <span className="tnum">{fmtDate(k.datum)}</span></span>
                {' · '}Korrekte Zeit: <span className="font-semibold text-ink-2 tnum">{k.zeit}</span>
                {k.text && <> {' · '}{k.text}</>}
              </p>
              <p className="text-[11px] text-ink-4 mt-0.5">gemeldet am {fmtDate(k.am)}</p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => openZeiten(k)}
                disabled={busyKey === k.key}
                className="btn-secondary text-xs px-3 py-1.5"
                title="Stempelzeiten dieses Tages ansehen und anpassen, fehlende Zeiten ergänzen, Einträge hinzufügen und Tagesnotiz setzen"
              >
                Zeiten
              </button>
              <button
                onClick={() => done(k.key)}
                disabled={busyKey === k.key}
                className="btn-secondary text-xs px-3 py-1.5"
                title="Als korrigiert markieren — die Meldung verschwindet hier und erscheint bei der Mitarbeiterin als korrigiert"
              >
                {busyKey === k.key ? '…' : '✓ Korrigiert'}
              </button>
              <button
                onClick={() => remove(k)}
                disabled={busyKey === k.key}
                className="p-1.5 rounded-lg border border-edge-ctl bg-white text-ink-4 hover:text-red-500 hover:bg-edge-row transition-colors"
                title="Meldung endgültig löschen (z. B. Test-Eintrag)"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </li>
        ))}
      </ul>
      {open.length > 5 && (
        <div className="px-6 py-3 border-t border-edge-soft">
          <button
            onClick={() => setShowAll(true)}
            className="text-xs font-semibold text-mint-ink hover:underline underline-offset-2"
          >
            Weitere ({open.length - 5}) …
          </button>
        </div>
      )}

      {/* ── Last 5 corrected requests ── */}
      {erledigt.length > 0 && (
        <div className="border-t border-edge-soft">
          <p className="px-6 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
            Zuletzt korrigiert
          </p>
          <ul className="divide-y divide-edge-row">
            {erledigt.map(k => (
              <li key={k.key} className="px-6 py-2.5 flex items-center gap-3">
                <span className="w-5 h-5 rounded-full bg-mint-bg text-mint-ink flex items-center justify-center text-[11px] flex-shrink-0">✓</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-ink-2 truncate">
                    {k.name} · Tag: <span className="tnum">{fmtDate(k.datum)}</span>
                    {k.zeit && <> · <span className="tnum">{k.zeit}</span></>}
                  </p>
                  {k.text && <p className="text-[11px] text-ink-4 truncate">{k.text}</p>}
                </div>
                {k.done && (
                  <p className="text-[11px] text-ink-4 flex-shrink-0 tnum">korrigiert am {fmtDate(k.done)}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {showAll && (
        <KorrekturModal
          title="Alle offenen Korrektur-Meldungen"
          items={open}
          showName
          onClose={() => setShowAll(false)}
        />
      )}

      {/* ── Current day times + day note ── */}
      {zeiten && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setZeiten(null)} />
          <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-edge-soft bg-surface flex items-start justify-between">
              <div>
                <h3 className="text-sm font-bold text-ink">Zeiten am {fmtDate(zeiten.korrektur.datum)}</h3>
                <p className="text-xs text-ink-4 mt-0.5">{zeiten.korrektur.name} · gemeldet: {zeiten.korrektur.zeit}</p>
              </div>
              <button
                onClick={() => setZeiten(null)}
                className="w-7 h-7 rounded-lg hover:bg-edge-row text-ink-4 hover:text-ink-2 flex items-center justify-center text-lg leading-none"
                aria-label="Schliessen"
              >×</button>
            </div>
            <div className="px-6 py-4 space-y-3">
              {zeiten.loading ? (
                <p className="text-xs text-ink-4 py-2">Wird geladen…</p>
              ) : (
                <>
                  {zeiten.loadError && (
                    <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink">⚠ {zeiten.loadError}</p>
                  )}
                  <div>
                    <p className="field-label">Gestempelte Zeiten (direkt anpassbar)</p>
                    {zeiten.spans.length === 0 ? (
                      <p className="text-sm text-ink-4">
                        Keine Stempelzeiten an diesem Tag — unten lässt sich ein neuer Eintrag erfassen.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {zeiten.spans.map((s, i) => (
                          <div key={i}>
                            <div className="flex items-center gap-2">
                              {zeiten.spans.length > 1 && <span className="text-[11px] text-ink-4 w-4">{i + 1}.</span>}
                              <input
                                type="time"
                                value={s.newIn}
                                onChange={e => setZeiten(prev => prev && ({ ...prev, saved: false, spans: prev.spans.map((x, idx) => idx === i ? { ...x, newIn: e.target.value } : x) }))}
                                className={`flex-1 px-2.5 py-2 text-sm tnum border rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk ${!s.inId && !s.newIn ? 'border-apricot-ink/50' : 'border-edge-ctl'}`}
                              />
                              <span className="text-xs text-ink-4">bis</span>
                              <input
                                type="time"
                                value={s.newOut}
                                onChange={e => setZeiten(prev => prev && ({ ...prev, saved: false, spans: prev.spans.map((x, idx) => idx === i ? { ...x, newOut: e.target.value } : x) }))}
                                className={`flex-1 px-2.5 py-2 text-sm tnum border rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk ${!s.outId && !s.newOut ? 'border-apricot-ink/50' : 'border-edge-ctl'}`}
                              />
                              <button
                                onClick={() => deleteSpan(i)}
                                disabled={zeiten.saving}
                                className="p-2 rounded-lg border border-edge-ctl bg-white text-ink-4 hover:text-red-500 hover:bg-edge-row transition-colors flex-shrink-0"
                                title="Diesen Eintrag löschen (z.B. doppelt gestempelt)"
                                aria-label="Eintrag löschen"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                            {!s.komplett && (
                              <p className={`text-[11px] font-semibold text-apricot-ink mt-1 ${zeiten.spans.length > 1 ? 'ml-6' : ''}`}>
                                unvollständig — fehlende Zeit eintragen und speichern
                              </p>
                            )}
                          </div>
                        ))}
                        <p className="text-xs font-bold text-ink-2 tnum pt-0.5">Total {fmtH(zeiten.totalMin)}</p>
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="field-label">Neuer Eintrag (optional, von – bis)</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={zeiten.addIn}
                        onChange={e => setZeiten(prev => prev && ({ ...prev, addIn: e.target.value, saved: false }))}
                        className="flex-1 px-2.5 py-2 text-sm tnum border border-edge-ctl rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk"
                      />
                      <span className="text-xs text-ink-4">bis</span>
                      <input
                        type="time"
                        value={zeiten.addOut}
                        onChange={e => setZeiten(prev => prev && ({ ...prev, addOut: e.target.value, saved: false }))}
                        className="flex-1 px-2.5 py-2 text-sm tnum border border-edge-ctl rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk"
                      />
                    </div>
                  </div>
                  <div>
                    <p className="field-label">Tagesnotiz (erscheint in der Zeiterfassung)</p>
                    <input
                      type="text"
                      value={zeiten.note}
                      onChange={e => setZeiten(prev => prev && ({ ...prev, note: e.target.value, saved: false }))}
                      placeholder="z.B. Grund der Korrektur…"
                      maxLength={500}
                      className="w-full px-2.5 py-2 text-sm border border-edge-ctl rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk placeholder:text-ink-5"
                    />
                  </div>
                  {zeiten.saved && (
                    <p className="text-xs font-semibold text-mint-ink">
                      ✓ Gespeichert — die Meldung bleibt offen, bis sie mit «✓ Korrigiert» abgeschlossen wird.
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={() => setZeiten(null)} className="btn-secondary flex-1">Schliessen</button>
              <button onClick={saveZeiten} disabled={zeiten.loading || zeiten.saving} className="btn-primary flex-1">
                {zeiten.saving ? 'Speichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
