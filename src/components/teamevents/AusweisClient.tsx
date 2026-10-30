'use client'

// Ausweisdaten einer Person (ID / Reisepass): Art, Nummer, Ablaufdatum und
// Bilder, hochladen oder direkt mit der Handykamera aufnehmen. Alle Daten
// laufen über Server Actions bzw. die geprüfte Bildroute (eigene Person
// oder Organisatorin). Die Komponente bekommt NUR die Daten der Person,
// die sie anzeigt.

import { useEffect, useRef, useState } from 'react'
import { ausweisSpeichern, ausweisBildHochladen, ausweisBildLoeschen, ausweisDetails, ausweisLoeschen } from '@/actions/ausweise'
import { istBild, datumKurz, fmtBytes } from '@/lib/teamevents'
import {
  AUSWEIS_ART_LABEL, AUSWEIS_SEITE_LABEL, AUSWEIS_MAX_BYTES, AUSWEIS_STATUS_LABEL, ausweisStatus,
  type AusweisArt, type AusweisSeite, type AusweisStatus,
} from '@/lib/ausweise'
import type { AusweisMitBildern } from '@/lib/ausweise-data'

const STATUS_KLASSE: Record<AusweisStatus, string> = {
  fehlt: 'badge-gray', abgelaufen: 'badge-red', bald: 'badge bg-apricot-bg text-apricot-ink', ok: 'badge-green', ohne_ablauf: 'badge-gray',
}
export function AusweisStatusBadge({ status }: { status: AusweisStatus }) {
  return <span className={STATUS_KLASSE[status]}>{AUSWEIS_STATUS_LABEL[status]}</span>
}

const zeigbar = (mime: string) => /^image\//.test(mime) && !/hei[cf]/i.test(mime)

/** Bild vor dem Upload im Browser verkleinern (max. 1600 px, JPEG), damit
 *  der Upload klein bleibt; null, wenn der Browser das Format nicht lesen
 *  kann (z. B. HEIC), dann geht die Originaldatei. */
async function verkleinern(file: File): Promise<File | null> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d'); if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, w, h); bmp.close()
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.85))
    if (!blob) return null
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch { return null }
}

export default function AusweisClient({ profileId, initial, heute, personName, eigene, onGeaendert }: {
  profileId: string
  initial: AusweisMitBildern
  heute: string
  personName: string
  eigene: boolean
  onGeaendert?: (a: AusweisMitBildern) => void
}) {
  const [a, setA] = useState<AusweisMitBildern>(initial)
  const [art, setArt] = useState<AusweisArt | ''>(initial.art ?? '')
  const [nummer, setNummer] = useState(initial.nummer ?? '')
  const [ablauf, setAblauf] = useState(initial.ablauf ?? '')
  const [seite, setSeite] = useState<AusweisSeite | ''>('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [ansicht, setAnsicht] = useState<{ url: string; name: string; mime: string } | null>(null)
  const kameraRef = useRef<HTMLInputElement>(null)
  const dateiRef = useRef<HTMLInputElement>(null)

  const status = ausweisStatus(a, heute)
  const geaendert = (art || '') !== (a.art ?? '') || nummer.trim() !== (a.nummer ?? '') || ablauf !== (a.ablauf ?? '')

  async function neuLaden() {
    const r = await ausweisDetails(profileId)
    if ('ausweis' in r && r.ausweis) {
      setA(r.ausweis)
      setArt(r.ausweis.art ?? ''); setNummer(r.ausweis.nummer ?? ''); setAblauf(r.ausweis.ablauf ?? '')
      onGeaendert?.(r.ausweis)
    }
  }

  async function speichern() {
    setMsg(null); setBusy('speichern')
    try {
      const r = await ausweisSpeichern(profileId, { art: art || null, nummer, ablauf })
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      setMsg({ type: 'ok', text: 'Angaben gespeichert.' })
      await neuLaden()
    } finally { setBusy(null) }
  }

  /** Vorschlag für die Seite: ID → Vorder-, dann Rückseite; Pass → Datenseite. */
  function seiteVorschlag(): AusweisSeite | null {
    if (seite) return seite
    if (art === 'pass') return 'daten'
    if (art === 'id') {
      if (!a.bilder.some(b => b.seite === 'vorne')) return 'vorne'
      if (!a.bilder.some(b => b.seite === 'hinten')) return 'hinten'
    }
    return null
  }

  async function hochladen(file: File) {
    setMsg(null); setBusy('upload')
    try {
      if (!istBild(file.name, file.type)) throw new Error('Bitte nur Bilder hochladen (JPG, PNG, HEIC, WebP).')
      if (file.size > AUSWEIS_MAX_BYTES) throw new Error('Das Bild ist zu gross, höchstens 20 MB.')
      const klein = await verkleinern(file)
      const form = new FormData()
      form.set('datei', klein ?? file)
      const seiteWert = seiteVorschlag(); if (seiteWert) form.set('seite', seiteWert)
      const r = await ausweisBildHochladen(profileId, form)
      if ('error' in r && r.error) throw new Error(r.error)
      setSeite('')
      setMsg({ type: 'ok', text: 'Bild gespeichert.' })
      await neuLaden()
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Fehler beim Hochladen.' })
    } finally { setBusy(null) }
  }

  function oeffnen(id: string) {
    const b = a.bilderMitUrl.find(x => x.id === id)
    if (b?.url) setAnsicht({ url: b.url, name: b.name, mime: b.mime })
  }

  async function bildLoeschen(id: string) {
    if (!confirm('Dieses Bild löschen?')) return
    setBusy(id)
    try {
      const r = await ausweisBildLoeschen(profileId, id)
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      await neuLaden()
    } finally { setBusy(null) }
  }

  async function allesLoeschen() {
    if (!confirm(`Alle Ausweisdaten${eigene ? '' : ` von ${personName}`} löschen (Nummer, Ablaufdatum und Bilder)?`)) return
    setBusy('alles')
    try {
      const r = await ausweisLoeschen(profileId)
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      setMsg({ type: 'ok', text: 'Ausweisdaten gelöscht.' })
      await neuLaden()
    } finally { setBusy(null) }
  }

  useEffect(() => {
    if (!ansicht) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAnsicht(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ansicht])

  const hatDaten = !!(a.nummer || a.ablauf || a.bilder.length)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <AusweisStatusBadge status={status} />
          {a.ablauf && <span className="text-[11px] text-ink-4 tnum">gültig bis {datumKurz(a.ablauf)}</span>}
          {a.aktualisiertAm && <span className="text-[11px] text-ink-4 tnum">· aktualisiert {datumKurz(a.aktualisiertAm.slice(0, 10))}{a.aktualisiertVon ? ` von ${a.aktualisiertVon}` : ''}</span>}
        </div>
        <p className="text-[11px] text-ink-4 flex items-center gap-1">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          {eigene ? 'Diese Angaben sehen nur die Person selbst und Bianka, nie das übrige Team.' : `Vertraulich, nur ${personName} selbst und Bianka sehen diese Angaben.`}
        </p>
      </div>

      {msg && (
        <p className={`text-xs px-3 py-2 rounded-ctl inline-block ${msg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>
          {msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}
        </p>
      )}

      {/* Angaben */}
      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-3 items-end">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Dokument</span>
          <div className="flex gap-1.5">
            {(['id', 'pass'] as AusweisArt[]).map(k => (
              <button key={k} type="button" onClick={() => setArt(k)}
                className={`px-3 py-2 rounded-ctl border text-sm ${art === k ? 'border-mint-mid bg-mint-bg text-mint-ink font-semibold' : 'border-edge-ctl text-ink-2 hover:bg-surface'}`}>
                {k === 'id' ? 'ID' : 'Reisepass'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Nummer</label>
          <input value={nummer} onChange={e => setNummer(e.target.value)} maxLength={40} placeholder={art === 'pass' ? 'z. B. X1234567' : 'z. B. C1234567'}
            className="input-field text-sm tnum" autoComplete="off" spellCheck={false} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Ablaufdatum</label>
          <input type="date" value={ablauf} onChange={e => setAblauf(e.target.value)} className="input-field text-sm w-44" />
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={speichern} disabled={!geaendert || busy !== null} className="btn-primary">{busy === 'speichern' ? 'Speichert…' : 'Angaben speichern'}</button>
        {geaendert && <span className="text-[11px] text-apricot-ink">Noch nicht gespeichert</span>}
        {status === 'abgelaufen' && <span className="text-[11px] text-blush-ink">Der Ausweis ist abgelaufen, bitte rechtzeitig erneuern.</span>}
        {status === 'bald' && <span className="text-[11px] text-apricot-ink">Läuft in weniger als 6 Monaten ab, für Reisen oft zu knapp.</span>}
      </div>

      {/* Bilder */}
      <div className="border-t border-edge-soft pt-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <p className="text-xs font-semibold text-ink-2">Bilder des Ausweises <span className="text-ink-4 font-normal tnum">({a.bilder.length}/6)</span></p>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={seite} onChange={e => setSeite(e.target.value as AusweisSeite | '')} className="input-field text-xs py-1.5 w-40" title="Welche Seite zeigt das nächste Bild?">
              <option value="">Seite automatisch</option>
              {(Object.keys(AUSWEIS_SEITE_LABEL) as AusweisSeite[]).map(s => <option key={s} value={s}>{AUSWEIS_SEITE_LABEL[s]}</option>)}
            </select>
            <button onClick={() => kameraRef.current?.click()} disabled={busy !== null} className="btn-secondary text-xs">
              {busy === 'upload' ? 'Lädt…' : '📷 Foto aufnehmen'}
            </button>
            <button onClick={() => dateiRef.current?.click()} disabled={busy !== null} className="btn-secondary text-xs">↑ Datei hochladen</button>
            <input ref={kameraRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) hochladen(f); e.target.value = '' }} />
            <input ref={dateiRef} type="file" accept="image/*,.heic,.heif" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) hochladen(f); e.target.value = '' }} />
          </div>
        </div>
        {a.bilderMitUrl.length === 0 ? (
          <p className="text-[11px] text-ink-4">Noch kein Bild. Mit «Foto aufnehmen» direkt mit dem Handy fotografieren oder eine Bilddatei hochladen. Bei der ID Vorderseite und Rückseite, beim Pass die Datenseite.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {a.bilderMitUrl.map(b => (
              <div key={b.id} className="group relative rounded-xl overflow-hidden border border-edge-row bg-surface">
                <button onClick={() => oeffnen(b.id)} disabled={busy === b.id} className="block w-full aspect-[3/2] overflow-hidden" title="Bild öffnen">
                  {b.url && zeigbar(b.mime) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.url} alt={b.seite ? AUSWEIS_SEITE_LABEL[b.seite] : b.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-ink-4 px-2 text-center">
                      <span className="text-[10px] break-all leading-tight">{b.name}</span>
                      <span className="text-[9px]">keine Vorschau</span>
                    </div>
                  )}
                </button>
                <div className="px-2 py-1.5">
                  <p className="text-[10.5px] text-ink-2 truncate">{b.seite ? AUSWEIS_SEITE_LABEL[b.seite] : 'Bild'}</p>
                  <p className="text-[9.5px] text-ink-4 tnum truncate">{b.am ? datumKurz(b.am.slice(0, 10)) : ''}{b.bytes ? ` · ${fmtBytes(b.bytes)}` : ''}</p>
                </div>
                <button onClick={() => bildLoeschen(b.id)} disabled={busy === b.id}
                  className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-white/90 border border-edge text-ink-4 hover:text-red-500 text-[12px] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity" title="Bild löschen">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {hatDaten && (
        <div className="flex justify-end">
          <button onClick={allesLoeschen} disabled={busy !== null} className="text-[11px] text-ink-4 hover:text-red-500">Alle Ausweisdaten löschen</button>
        </div>
      )}

      {ansicht && (
        <div className="fixed inset-0 z-[70] bg-black/85 flex flex-col" role="dialog" aria-modal="true" onClick={() => setAnsicht(null)}>
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-white/90" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold truncate">{ansicht.name}</p>
            <div className="flex items-center gap-2">
              <a href={`${ansicht.url}&dl=1`} rel="noopener" className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-semibold">↓ Herunterladen</a>
              <button onClick={() => setAnsicht(null)} className="w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 text-sm" title="Schliessen (Esc)">✕</button>
            </div>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center p-3" onClick={e => e.stopPropagation()}>
            {zeigbar(ansicht.mime) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ansicht.url} alt={ansicht.name} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
            ) : (
              <p className="text-center text-white/80 text-sm">Dieses Format kann der Browser nicht direkt anzeigen, zum Beispiel HEIC vom iPhone. Bitte herunterladen.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
