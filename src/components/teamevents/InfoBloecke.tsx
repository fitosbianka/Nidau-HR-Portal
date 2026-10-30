'use client'

// Infoteil eines Teamevents: auf und zuklappbare Blöcke mit kurzen
// Aufzählungspunkten. Die Organisatorin kann jeden Block direkt auf der
// Seite anpassen; Platzhalter in eckigen Klammern sieht nur sie (markiert),
// für das Team bleiben solche Zeilen ausgeblendet.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { texteSpeichern, texteZuruecksetzen } from '@/actions/teamevent-programm'
import { hatPlatzhalter, platzhalterTeile, type InfoBlock } from '@/lib/teamevent-programm'

type Block = InfoBlock & { angepasst: boolean }

/** Zeilen im Format «Name: Text» zeigen den Namen fett (Apps). */
function MitName({ text }: { text: string }) {
  const m = /^([^:]{2,40}):\s+([\s\S]+)$/.exec(text)
  if (!m) return <>{text}</>
  return <><span className="font-semibold text-ink">{m[1]}</span>{' '}{m[2]}</>
}

export function Zeile({ text, verwaltet }: { text: string; verwaltet: boolean }) {
  if (!verwaltet || !hatPlatzhalter(text)) return <MitName text={text} />
  return (
    <>
      {platzhalterTeile(text).map((t, i) => t.platzhalter
        ? <mark key={i} className="bg-apricot-bg text-apricot-ink rounded px-1 font-semibold" title="Platzhalter, für das Team ausgeblendet, bis er ausgefüllt ist">{t.text}</mark>
        : <span key={i}>{t.text}</span>)}
    </>
  )
}

function BlockDialog({ slug, block, onClose }: { slug: string; block: Block; onClose: () => void }) {
  const router = useRouter()
  const [text, setText] = useState(block.zeilen.join('\n'))
  const [err, setErr] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function speichern() {
    setErr(null)
    startTransition(async () => {
      const r = await texteSpeichern(slug, block.id, text.split('\n'))
      if ('error' in r && r.error) { setErr(r.error); return }
      router.refresh(); onClose()
    })
  }
  function standard() {
    if (!confirm('Standardtext für diesen Block wiederherstellen?')) return
    setErr(null)
    startTransition(async () => {
      const r = await texteZuruecksetzen(slug, block.id)
      if ('error' in r && r.error) { setErr(r.error); return }
      router.refresh(); onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-lg p-5 my-8">
        <p className="text-sm font-bold text-ink mb-0.5">{block.titel}</p>
        <p className="text-[11px] text-ink-4 mb-3">Eine Zeile pro Punkt. Platzhalter in eckigen Klammern bleiben für das Team ausgeblendet, bis sie ausgefüllt sind.</p>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={Math.min(16, Math.max(5, text.split('\n').length + 1))}
          className="input-field text-sm w-full leading-relaxed" />
        {err && <p className="text-xs text-blush-ink mt-2">⚠ {err}</p>}
        <div className="flex flex-wrap justify-between gap-2 mt-4">
          <button onClick={standard} disabled={isPending || !block.angepasst} className="text-[11px] text-ink-4 hover:text-ink-2 disabled:opacity-40">Standardtext wiederherstellen</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Abbrechen</button>
            <button onClick={speichern} disabled={isPending} className="btn-primary">{isPending ? 'Speichert…' : 'Speichern'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function InfoBloecke({ slug, bloecke, verwaltet, platzhalter }: { slug: string; bloecke: Block[]; verwaltet: boolean; platzhalter: number }) {
  const info = bloecke.filter(b => b.ort === 'info')
  const weitere = bloecke.filter(b => b.ort === 'checkliste')
  const [offen, setOffen] = useState<Set<string>>(() => new Set()) // alle Blöcke zu, jede Person öffnet, was sie lesen will
  const [edit, setEdit] = useState<Block | null>(null)
  const alleOffen = info.every(b => offen.has(b.id))
  const toggle = (id: string) => setOffen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-ink">Infos zum Anlass</h2>
        <div className="flex items-center gap-3 text-[11px]">
          {verwaltet && platzhalter > 0 && (
            <span className="text-apricot-ink">{platzhalter} Platzhalter offen, für das Team ausgeblendet</span>
          )}
          <button onClick={() => setOffen(alleOffen ? new Set() : new Set(info.map(b => b.id)))} className="text-mint-ink hover:underline font-semibold">
            {alleOffen ? 'Alle schliessen' : 'Alle öffnen'}
          </button>
        </div>
      </div>

      <div className="card divide-y divide-edge-soft overflow-hidden">
        {info.map(b => {
          const auf = offen.has(b.id)
          return (
            <div key={b.id}>
              <div className="flex items-center">
                <button onClick={() => toggle(b.id)} aria-expanded={auf}
                  className="flex-1 flex items-center justify-between gap-3 px-4 sm:px-5 py-3 text-left hover:bg-surface/60">
                  <span className="text-sm font-semibold text-ink">{b.titel}</span>
                  <span className="flex items-center gap-2 text-ink-4">
                    {!auf && <span className="text-[11px] tnum hidden sm:inline">{b.zeilen.length} Punkte</span>}
                    <svg className={`w-4 h-4 transition-transform ${auf ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" /></svg>
                  </span>
                </button>
                {verwaltet && (
                  <button onClick={() => setEdit(b)} className="px-3 py-3 text-[11px] font-semibold text-mint-ink hover:underline flex-shrink-0" title="Text anpassen">
                    {b.angepasst ? 'Angepasst ✎' : 'Anpassen'}
                  </button>
                )}
              </div>
              {auf && (
                <ul className="px-4 sm:px-5 pb-4 pt-0.5 space-y-1.5">
                  {b.zeilen.length === 0 && <li className="text-xs text-ink-4">Noch keine Angaben</li>}
                  {b.zeilen.map((z, i) => (
                    <li key={i} className="flex gap-2.5 text-[13.5px] text-ink-2 leading-snug">
                      <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-mint-mid flex-shrink-0" />
                      <span><Zeile text={z} verwaltet={verwaltet} /></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {verwaltet && weitere.length > 0 && (
        <div className="text-[11px] text-ink-4 flex flex-wrap gap-x-4 gap-y-1 px-1">
          {weitere.map(b => (
            <span key={b.id}>
              {b.titel} <Zeile text={b.zeilen.join(' · ') || 'leer'} verwaltet />
              <button onClick={() => setEdit(b)} className="ml-1.5 text-mint-ink hover:underline font-semibold">Anpassen</button>
            </span>
          ))}
        </div>
      )}

      {edit && <BlockDialog slug={slug} block={edit} onClose={() => setEdit(null)} />}
    </section>
  )
}
