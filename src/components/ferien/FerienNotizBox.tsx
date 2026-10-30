'use client'

// Notizbox auf der Ferienplanung, nur für Bianka: freier Text, wird beim
// Tippen automatisch gespeichert (kurz nach der letzten Eingabe), ein- und
// ausklappbar, Stand im Browser gemerkt.

import { useEffect, useRef, useState } from 'react'
import { ferienNotizSpeichern } from '@/actions/ferien-notiz'
import { FERIEN_NOTIZ_MAX } from '@/lib/ferien-notiz'

const KEY = 'ferienplanung-notiz-offen'
const fmtZeit = (iso: string) => `${new Date(iso).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })}, ${new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }).replace(':', '.')} Uhr`

export default function FerienNotizBox({ text, am }: { text: string; am: string | null }) {
  const [offen, setOffen] = useState(true)
  const [wert, setWert] = useState(text)
  const [gespeichert, setGespeichert] = useState(text)
  const [stand, setStand] = useState<string | null>(am)
  const [status, setStatus] = useState<'ok' | 'laeuft' | 'fehler'>('ok')
  const [fehler, setFehler] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const letzter = useRef(text)

  useEffect(() => { try { setOffen(localStorage.getItem(KEY) !== '0') } catch { /* egal */ } }, [])
  const umschalten = () => setOffen(o => { try { localStorage.setItem(KEY, o ? '0' : '1') } catch { /* egal */ } return !o })

  async function speichern(t: string) {
    if (t === letzter.current) return
    setStatus('laeuft'); setFehler(null)
    try {
      const r = await ferienNotizSpeichern(t)
      if ('error' in r && r.error) { setStatus('fehler'); setFehler(r.error); return }
      letzter.current = t
      setGespeichert(t)
      setStand((r as { am: string }).am)
      setStatus('ok')
    } catch {
      setStatus('fehler'); setFehler('Netzwerkfehler, die Notiz ist noch nicht gespeichert.')
    }
  }
  function tippen(t: string) {
    setWert(t)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void speichern(t) }, 900)
  }
  // Beim Verlassen der Seite nicht verlieren: sofort speichern
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const ungespeichert = wert !== gespeichert
  return (
    <div className="card overflow-hidden">
      <button onClick={umschalten} className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-ink">Meine Notizen</p>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-lilac-bg text-lilac-ink">nur für dich</span>
          <span className="text-[11px] text-ink-4 tnum">
            {status === 'laeuft' ? 'wird gespeichert…' : status === 'fehler' ? '⚠ nicht gespeichert' : ungespeichert ? 'ungespeicherte Änderung' : stand ? `gespeichert ${fmtZeit(stand)}` : 'noch leer'}
          </span>
        </div>
        <svg className={`w-4 h-4 text-ink-4 transition-transform flex-shrink-0 ${offen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {offen && (
        <div className="px-5 pb-4 border-t border-edge-soft">
          <textarea value={wert} onChange={e => tippen(e.target.value)} onBlur={() => { if (timer.current) clearTimeout(timer.current); void speichern(wert) }}
            rows={Math.min(14, Math.max(4, wert.split('\n').length + 1))} maxLength={FERIEN_NOTIZ_MAX}
            placeholder="Offene Punkte, Absprachen, Gedanken zur Planung. Speichert automatisch."
            className="input-field text-sm w-full mt-3 leading-relaxed" />
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-[10.5px] text-ink-4">Sieht nur Bianka. Speichert automatisch kurz nach dem Tippen.</p>
            {fehler ? (
              <button onClick={() => speichern(wert)} className="text-[10.5px] font-semibold text-blush-ink underline">{fehler} Nochmals speichern</button>
            ) : (
              <p className="text-[10.5px] text-ink-5 tnum">{wert.length} Zeichen</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
