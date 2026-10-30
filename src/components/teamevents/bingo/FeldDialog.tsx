'use client'

// Detailansicht eines Feldes: Aufgabe, bisherige Fotos des Teams mit Name
// und Zeit, Foto aufnehmen oder aus der Galerie wählen (mit Fortschritt
// und «Nochmals versuchen»), eigene Fotos löschen. Die Organisatorin kann
// hier den Text der Aufgabe anpassen.

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { bingoFotoLoeschen, bingoFotoLink, bingoAufgabeTextSpeichern } from '@/actions/teamevent-bingo'
import { BINGO_FREI_ID, uploadLimit, type BingoAufgabe } from '@/lib/teamevent-bingo'
import type { FotoAnsicht } from '@/lib/teamevent-bingo-data'
import { bingoHochladen } from './upload'
import FotoVollbild from '../FotoVollbild'
import KameraDialog from './KameraDialog'

type Eintrag = { key: string; file: File; status: 'wartet' | 'laedt' | 'fertig' | 'fehler'; schritt?: string; fehler?: string }

const fmtZeit = (iso: string) => iso ? new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }) : ''
const fmtTag = (iso: string) => iso ? new Date(iso).toLocaleDateString('de-CH', { weekday: 'short', timeZone: 'Europe/Zurich' }) : ''

export default function FeldDialog({ slug, aufgabe, fotos, teamId, meinId, hochladenOk, sperrText, darfLoeschen, verwaltet, testmodus, nurAnsicht = false, onClose }: {
  slug: string
  aufgabe: BingoAufgabe & { angepasst?: boolean }
  fotos: FotoAnsicht[]
  teamId: string | null
  meinId: string
  hochladenOk: boolean
  sperrText: string | null
  darfLoeschen: (f: FotoAnsicht) => boolean
  verwaltet: boolean
  testmodus: boolean
  /** Fremde Karte nach dem Spiel: nur ansehen und herunterladen */
  nurAnsicht?: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const kameraRef = useRef<HTMLInputElement>(null)
  const galerieRef = useRef<HTMLInputElement>(null)
  const [queue, setQueue] = useState<Eintrag[]>([])
  const [laeuft, setLaeuft] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [ansicht, setAnsicht] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  // Text bearbeiten (Organisatorin)
  const [textEdit, setTextEdit] = useState(false)
  // Handy (grober Zeiger): «Foto aufnehmen» öffnet die Kamera über den
  // Dateidialog. Computer: eigene Kameraansicht über die Webcam, weil der
  // Dateidialog dort keinen Kameramodus kennt.
  const [handy, setHandy] = useState(true)
  const [kamera, setKamera] = useState(false)
  useEffect(() => { try { setHandy(window.matchMedia('(pointer: coarse)').matches) } catch { setHandy(true) } }, [])
  const kameraMoeglich = handy || (typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia)
  const [titel, setTitel] = useState(aufgabe.titel)
  const [text, setText] = useState(aufgabe.text)

  const limit = uploadLimit(aufgabe, fotos.map(f => ({ ...f })), meinId)
  const meineFotos = fotos.filter(f => f.eigenes)
  const kannHochladen = hochladenOk && !nurAnsicht && limit.frei > 0 && !!teamId

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && ansicht === null) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ansicht, onClose])

  async function verarbeite(eintraege: Eintrag[]) {
    if (!teamId) return
    setLaeuft(true)
    for (const e of eintraege) {
      const setze = (p: Partial<Eintrag>) => setQueue(q => q.map(x => (x.key === e.key ? { ...x, ...p } : x)))
      setze({ status: 'laedt', fehler: undefined })
      const r = await bingoHochladen(slug, aufgabe.id, e.file, teamId, schritt => setze({ schritt }))
      setze(r.ok ? { status: 'fertig', schritt: undefined } : { status: 'fehler', fehler: r.fehler, schritt: undefined })
      if (r.ok) router.refresh()
    }
    setLaeuft(false)
  }

  function dateienGewaehlt(liste: FileList | File[] | null) {
    if (!liste || liste.length === 0 || laeuft) return
    const frei = Math.max(0, limit.frei - queue.filter(q => q.status === 'fertig' || q.status === 'laedt' || q.status === 'wartet').length)
    const dateien = Array.from(liste).slice(0, Math.max(1, frei))
    if (dateien.length < liste.length) setMsg(`Es werden nur die ersten ${dateien.length} Fotos hochgeladen, mehr Platz hat dieses Feld nicht.`)
    const neu: Eintrag[] = dateien.map(f => ({ key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file: f, status: 'wartet' }))
    setQueue(q => [...q.filter(x => x.status !== 'fertig'), ...neu])
    void verarbeite(neu)
  }

  function nochmals(e: Eintrag) {
    if (laeuft) return
    void verarbeite([e])
  }

  const oeffnen = (f: FotoAnsicht) => setAnsicht(Math.max(0, fotos.findIndex(x => x.id === f.id)))
  const linkFuer = async (f: FotoAnsicht) => {
    const r = await bingoFotoLink(slug, f.id, 'ansicht')
    return 'error' in r && r.error ? null : (r as { url: string }).url
  }

  async function herunterladen(f: FotoAnsicht) {
    setBusyId(f.id)
    try {
      const r = await bingoFotoLink(slug, f.id, 'download')
      if ('error' in r && r.error) { setMsg(r.error); return }
      const a = document.createElement('a')
      a.href = (r as { url: string }).url; a.download = `${aufgabe.id}_${f.id}.jpg`; a.rel = 'noopener'
      document.body.appendChild(a); a.click(); a.remove()
    } finally { setBusyId(null) }
  }

  function loeschen(f: FotoAnsicht) {
    if (!confirm('Dieses Foto löschen?')) return
    setBusyId(f.id)
    startTransition(async () => {
      const r = await bingoFotoLoeschen(slug, f.id)
      setBusyId(null)
      if ('error' in r && r.error) { setMsg(r.error); return }
      setAnsicht(null)
      router.refresh()
    })
  }

  function textSpeichern(zuruecksetzen = false) {
    startTransition(async () => {
      const r = await bingoAufgabeTextSpeichern(slug, aufgabe.id, zuruecksetzen ? '' : titel, zuruecksetzen ? '' : text)
      if ('error' in r && r.error) { setMsg(r.error); return }
      setTextEdit(false)
      router.refresh()
    })
  }

  const frei = aufgabe.id === BINGO_FREI_ID
  const zaehler = limit.proPerson ? `Deine Fotos ${meineFotos.length} von ${limit.max}` : `${fotos.length} von ${limit.max} Fotos`

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-edge-soft">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4">{frei ? 'Freies Feld' : aufgabe.bonus ? 'Bonuswettbewerb' : aufgabe.zusammen ? 'Zusammen mit einem anderen Team' : 'Aufgabe'}</p>
            <h2 className="text-[17px] font-bold text-ink leading-tight mt-0.5">{aufgabe.titel}</h2>
          </div>
          <button onClick={onClose} className="w-9 h-9 -mr-2 rounded-lg hover:bg-edge-row text-ink-3 flex items-center justify-center" aria-label="Schliessen">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          {textEdit ? (
            <div className="space-y-2 rounded-xl border border-edge-ctl bg-surface p-3">
              <input value={titel} onChange={e => setTitel(e.target.value)} maxLength={60} className="input-field text-sm" placeholder="Titel" />
              <textarea value={text} onChange={e => setText(e.target.value)} maxLength={400} rows={3} className="input-field text-sm" placeholder="Aufgabe" />
              <div className="flex flex-wrap gap-2">
                <button onClick={() => textSpeichern()} disabled={isPending} className="btn-primary !px-3 !py-1.5 !text-xs">Speichern</button>
                <button onClick={() => setTextEdit(false)} className="btn-secondary !px-3 !py-1.5 !text-xs">Abbrechen</button>
                {aufgabe.angepasst && <button onClick={() => textSpeichern(true)} disabled={isPending} className="text-xs text-ink-4 hover:text-ink-2 ml-auto">Standardtext zurücksetzen</button>}
              </div>
            </div>
          ) : (aufgabe.text || verwaltet) ? (
            // Aufgaben ohne Beschreibung zeigen nur den Titel
            <p className="text-[14px] text-ink-2 leading-relaxed">
              {aufgabe.text}
              {verwaltet && <button onClick={() => setTextEdit(true)} className={`${aufgabe.text ? 'ml-2' : ''} text-[11px] font-semibold text-mint-ink hover:underline align-baseline`}>Text anpassen</button>}
            </p>
          ) : null}

          {aufgabe.zusammen && !nurAnsicht && (
            <p className="text-[12px] text-ink-3 bg-lilac-soft rounded-lg px-3 py-2">Beide Teams laden dasselbe Foto hoch, dann zählt das Feld für beide.</p>
          )}

          {/* Fotos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4">{nurAnsicht ? 'Fotos' : 'Eure Fotos'}</p>
              {!nurAnsicht && <p className="text-[11px] text-ink-4 tnum">{zaehler}</p>}
            </div>
            {fotos.length === 0 ? (
              <p className="text-[13px] text-ink-4">{nurAnsicht ? 'Keine Fotos für dieses Feld.' : 'Noch kein Foto. Los gehts.'}</p>
            ) : (
              <div className={`grid gap-2 ${aufgabe.proPerson ? 'grid-cols-4' : 'grid-cols-3'}`}>
                {fotos.map(f => (
                  <div key={f.id} className="relative group">
                    <button onClick={() => oeffnen(f)} disabled={busyId === f.id} className="block w-full aspect-square rounded-xl overflow-hidden border border-edge-row bg-surface" aria-label="Foto öffnen">
                      {f.vorschauUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f.vorschauUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                      ) : (
                        <span className="w-full h-full flex items-center justify-center text-[10px] text-ink-4 px-1 text-center">Keine Vorschau</span>
                      )}
                    </button>
                    {f.test && <span className="absolute top-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-apricot-bg text-apricot-ink">Test</span>}
                    {darfLoeschen(f) && (
                      <button onClick={() => loeschen(f)} disabled={busyId === f.id || isPending}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 border border-edge text-ink-3 hover:text-red-500 text-[11px] flex items-center justify-center" aria-label="Foto löschen">✕</button>
                    )}
                    <p className="mt-1 text-[10px] text-ink-4 tnum truncate">{f.rufname}{f.am ? ` · ${fmtTag(f.am)} ${fmtZeit(f.am)}` : ''}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upload */}
          {!nurAnsicht && (
            <div>
              {kannHochladen ? (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => (handy ? kameraRef.current?.click() : setKamera(true))} disabled={laeuft || !kameraMoeglich} className="btn-primary !py-3 flex items-center justify-center gap-2 disabled:opacity-50" title={kameraMoeglich ? undefined : 'Dieser Browser hat keinen Kamerazugriff'}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><circle cx="12" cy="12.5" r="3.2" /></svg>
                    Foto aufnehmen
                  </button>
                  <button onClick={() => galerieRef.current?.click()} disabled={laeuft} className="btn-secondary !py-3 flex items-center justify-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="m21 16-5-5-9 8" /></svg>
                    {handy ? 'Aus Galerie wählen' : 'Foto auswählen'}
                  </button>
                  <input ref={kameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { dateienGewaehlt(e.target.files); e.target.value = '' }} />
                  <input ref={galerieRef} type="file" accept="image/*,.heic,.heif" multiple={limit.frei > 1} className="hidden" onChange={e => { dateienGewaehlt(e.target.files); e.target.value = '' }} />
                </div>
              ) : (
                <p className="text-[12.5px] text-ink-3 bg-surface border border-edge-soft rounded-xl px-3 py-2.5">
                  {!teamId ? 'Du bist noch keinem Team zugeteilt. Bitte melde dich bei Bianka.'
                    : sperrText ?? (limit.frei <= 0 ? (limit.proPerson ? 'Du hast für dieses Feld alle Fotos hochgeladen.' : 'Dieses Feld ist voll, zuerst ein Foto löschen.') : 'Hochladen ist gerade nicht möglich.')}
                </p>
              )}
              {testmodus && kannHochladen && <p className="mt-2 text-[11px] text-apricot-ink">Testmodus, dieses Foto wird als Test markiert.</p>}
              {queue.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {queue.map(q => (
                    <li key={q.key} className="flex items-center gap-2 text-[12px]">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${q.status === 'fertig' ? 'bg-mint-mid' : q.status === 'fehler' ? 'bg-red-500' : q.status === 'laedt' ? 'bg-apricot-mid animate-pulse' : 'bg-edge-ctl'}`} />
                      <span className="truncate text-ink-2 flex-1">
                        {q.status === 'fertig' ? 'Hochgeladen' : q.status === 'laedt' ? (q.schritt ?? 'Lädt') : q.status === 'fehler' ? q.fehler : 'Wartet'}
                      </span>
                      {q.status === 'fehler' && <button onClick={() => nochmals(q)} disabled={laeuft} className="text-[11px] font-semibold text-mint-ink hover:underline">Nochmals versuchen</button>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {msg && <p className="text-xs px-3 py-2 rounded-ctl inline-block bg-blush-bg text-blush-ink">⚠ {msg}</p>}
        </div>
      </div>

      {kamera && (
        <KameraDialog onClose={() => setKamera(false)} onFoto={f => { setKamera(false); dateienGewaehlt([f]) }} />
      )}
      {ansicht !== null && fotos[ansicht] && (
        <FotoVollbild liste={fotos} index={ansicht} onIndex={setAnsicht} laden={linkFuer} onClose={() => setAnsicht(null)}
          titel={() => aufgabe.titel} untertitel={f => `${f.rufname}${f.am ? ` · ${fmtTag(f.am)} ${fmtZeit(f.am)}` : ''}`}
          aktionen={f => (<>
            <button onClick={() => herunterladen(f)} className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-semibold">Herunterladen</button>
            {darfLoeschen(f) && <button onClick={() => loeschen(f)} className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-red-500/70 text-xs font-semibold">Löschen</button>}
          </>)} />
      )}
    </div>
  )
}
