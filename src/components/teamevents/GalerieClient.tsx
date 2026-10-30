'use client'

// Fotoalbum / Galerie eines Teamevents. Alle mit Zugang zum Ordner laden
// Fotos hoch oder nehmen sie direkt mit der Kamera auf, geben pro Foto eine
// Beschreibung mit, sehen von wem und wann ein Foto kam und laden einzeln
// oder alles als ZIP herunter. Grosse Fotos und HEIC werden im Browser zu
// JPEG verkleinert (schnell, zuverlässig, auf jedem Gerät anzeigbar); jeder
// Schritt meldet einen klaren Fehler mit «Nochmals versuchen». Fotos sind
// nach Tag gruppiert und nach Person filterbar. Löschen und Beschreibung
// ändern dürfen die hochladende Person und die Organisatorin.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { fotoUploadVorbereiten, fotoRegistrieren, fotoLink, fotoLoeschen, fotoBeschreibungSetzen, albumZipListe } from '@/actions/teamevents'
import { TE_BUCKET, TE_MAX_BYTES, datumLang, datumKurz, fmtBytes, istBild, fotoalbumIntro, type TeOrdner } from '@/lib/teamevents'
import type { GalerieFoto, TeamPerson } from '@/lib/teamevents-data'
import { SichtbarkeitDialog, sichtbarText } from './SichtbarkeitWahl'
import FotoVollbild from './FotoVollbild'
import { verkleinern } from './bingo/upload'
import { zipAusDateien } from './bingo/zip'

type Auswahl = {
  key: string
  file: File
  vorschau: string | null
  beschreibung: string
  status: 'wartet' | 'laedt' | 'fertig' | 'fehler'
  schritt?: string
  fehler?: string
}

const fmtZeit = (iso: string) => iso
  ? `${new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }).replace(':', '.')} Uhr`
  : ''
const vorname = (n: string) => n.split(' ')[0] || n
const GROSS_AB = 6 * 1024 * 1024
const istHeic = (f: File) => /hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name)
const zeigbar = (f: File) => /^image\/(jpeg|jpg|png|webp|gif|avif|bmp)$/i.test(f.type)

function freundlich(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err ?? '')
  if (/fetch|network|load failed|Failed to fetch/i.test(m)) return 'Keine Verbindung, bitte nochmals versuchen.'
  return m || 'Upload fehlgeschlagen, bitte nochmals versuchen.'
}

export default function GalerieClient({ ordner, fotos, verwaltet, meinName, team, basis = '/admin/teamevents', album = false, gesperrt = false }: {
  ordner: TeOrdner; fotos: GalerieFoto[]; verwaltet: boolean; meinName: string; team: TeamPerson[]; basis?: string
  /** Anlass mit Fotobingo: die Galerie ist das Fotoalbum */
  album?: boolean
  /** Von der Organisatorin für Mitarbeitende gesperrt (Admins sehen es trotzdem) */
  gesperrt?: boolean
}) {
  const titel = album ? 'Fotoalbum' : 'Fotos'
  const router = useRouter()
  const dateiRef = useRef<HTMLInputElement>(null)
  const kameraRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [ansicht, setAnsicht] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [sichtbarEdit, setSichtbarEdit] = useState(false)
  const [filterVon, setFilterVon] = useState<string | null>(null)
  const [zipStatus, setZipStatus] = useState<string | null>(null)
  const [beschreibungEdit, setBeschreibungEdit] = useState<{ f: GalerieFoto; text: string; fehler: string | null } | null>(null)

  // Upload-Dialog: ausgewählte Dateien mit Beschreibung und Status
  const [auswahl, setAuswahl] = useState<Auswahl[]>([])
  const auswahlRef = useRef<Auswahl[]>([])
  useEffect(() => { auswahlRef.current = auswahl }, [auswahl])
  const [dialogOffen, setDialogOffen] = useState(false)
  const [laeuft, setLaeuft] = useState(false)
  const [fuerAlle, setFuerAlle] = useState('')

  // Personen für den Filter (nach Anzahl)
  const personen = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of fotos) m.set(f.von || 'Unbekannt', (m.get(f.von || 'Unbekannt') ?? 0) + 1)
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de-CH'))
  }, [fotos])
  const gefiltert = useMemo(() => filterVon ? fotos.filter(f => (f.von || 'Unbekannt') === filterVon) : fotos, [fotos, filterVon])

  // Nach Upload-Tag gruppiert (neuster Tag zuerst, darin neuste zuerst)
  const gruppen = useMemo(() => {
    const m = new Map<string, GalerieFoto[]>()
    for (const f of gefiltert) m.set(f.datum, [...(m.get(f.datum) ?? []), f])
    return Array.from(m.entries()).sort(([a], [b]) => b.localeCompare(a))
  }, [gefiltert])
  const alleSortiert = useMemo(() => gruppen.flatMap(([, l]) => l), [gruppen])

  // ── Auswahl und Upload ──
  function waehlen(files: FileList | File[]) {
    const neu: Auswahl[] = Array.from(files).filter(f => f.size > 0).map((file, i) => ({
      key: `${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 7)}`, file,
      vorschau: zeigbar(file) ? URL.createObjectURL(file) : null,
      beschreibung: '', status: 'wartet',
    }))
    if (neu.length === 0) return
    setMsg(null)
    setAuswahl(prev => [...prev, ...neu])
    setDialogOffen(true)
  }
  function setze(key: string, patch: Partial<Auswahl>) {
    setAuswahl(prev => prev.map(a => (a.key === key ? { ...a, ...patch } : a)))
  }
  function dialogSchliessen() {
    for (const a of auswahlRef.current) if (a.vorschau) URL.revokeObjectURL(a.vorschau)
    setAuswahl([]); setFuerAlle(''); setDialogOffen(false)
  }
  function entfernenAusAuswahl(key: string) {
    const a = auswahlRef.current.find(x => x.key === key)
    if (a?.vorschau) URL.revokeObjectURL(a.vorschau)
    setAuswahl(prev => prev.filter(x => x.key !== key))
  }

  const ladeEins = useCallback(async (key: string) => {
    const a = auswahlRef.current.find(x => x.key === key)
    if (!a) return
    const supabase = createClient()
    const schritt = (s: string) => setze(key, { status: 'laedt', schritt: s, fehler: undefined })
    try {
      const file = a.file
      if (!istBild(file.name, file.type)) throw new Error('Das ist kein Bild. Bitte nur Fotos hochladen (JPG, PNG, HEIC, WebP).')
      schritt('wird vorbereitet')
      // HEIC und grosse Dateien werden zu JPEG verkleinert (längste Seite
      // 3000 px); kleine JPG, PNG und WebP bleiben im Original
      const klein = istHeic(file) || file.size > GROSS_AB ? await verkleinern(file, 3000, 0.88) : null
      const daten: Blob = klein ?? file
      const mime = klein ? 'image/jpeg' : (file.type || 'image/jpeg')
      const name = klein ? `${file.name.replace(/\.[^.]+$/, '')}.jpg` : file.name
      if (daten.size > TE_MAX_BYTES) throw new Error('Das Foto ist zu gross, höchstens 30 MB.')
      const thumb = await verkleinern(daten, 480, 0.8)
      const v = await fotoUploadVorbereiten(ordner.slug, name, mime, daten.size, !!thumb)
      if ('error' in v && v.error) throw new Error(v.error)
      const prep = v as { id: string; datum: string; orig: { path: string; token: string }; thumb: { path: string; token: string } | null }
      schritt('wird hochgeladen')
      let letzter: string | null = null
      for (let versuch = 0; versuch < 2; versuch++) {
        const { error } = await supabase.storage.from(TE_BUCKET)
          .uploadToSignedUrl(prep.orig.path, prep.orig.token, daten, { contentType: mime, upsert: true })
        letzter = error ? error.message : null
        if (!error) break
      }
      if (letzter) throw new Error(`Upload fehlgeschlagen, bitte nochmals versuchen (${letzter}).`)
      let thumbOk = false
      if (thumb && prep.thumb) {
        const { error: e2 } = await supabase.storage.from(TE_BUCKET)
          .uploadToSignedUrl(prep.thumb.path, prep.thumb.token, thumb, { contentType: 'image/jpeg', upsert: true })
        thumbOk = !e2
      }
      schritt('wird gespeichert')
      const aktuell = auswahlRef.current.find(x => x.key === key)
      const r = await fotoRegistrieren({ slug: ordner.slug, id: prep.id, datum: prep.datum, name, mime, bytes: daten.size, thumb: thumbOk, beschreibung: aktuell?.beschreibung ?? a.beschreibung })
      if ('error' in r && r.error) throw new Error(r.error)
      setze(key, { status: 'fertig', schritt: undefined })
    } catch (err) {
      setze(key, { status: 'fehler', fehler: freundlich(err), schritt: undefined })
    }
  }, [ordner.slug])

  async function starten() {
    if (laeuft) return
    setLaeuft(true)
    try {
      const keys = auswahlRef.current.filter(a => a.status !== 'fertig').map(a => a.key)
      for (const k of keys) await ladeEins(k)
    } finally {
      setLaeuft(false)
    }
    const jetzt = auswahlRef.current
    const ok = jetzt.filter(a => a.status === 'fertig').length
    if (ok > 0) {
      setMsg({ type: 'ok', text: `${ok} von ${jetzt.length} Foto${jetzt.length !== 1 ? 's' : ''} hochgeladen.` })
      router.refresh()
    }
    if (jetzt.length > 0 && jetzt.every(a => a.status === 'fertig')) dialogSchliessen()
  }

  // ── Ansicht, Download, Löschen, Beschreibung ──
  const oeffnen = (f: GalerieFoto) => setAnsicht(Math.max(0, alleSortiert.findIndex(x => x.id === f.id)))
  const linkFuer = async (f: GalerieFoto) => {
    const r = await fotoLink(ordner.slug, f.id, 'ansicht')
    return 'error' in r && r.error ? null : (r as { url: string }).url
  }

  async function herunterladen(f: GalerieFoto) {
    setBusyId(f.id)
    try {
      const r = await fotoLink(ordner.slug, f.id, 'download')
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      const a = document.createElement('a')
      a.href = (r as { url: string }).url
      a.download = f.name
      a.rel = 'noopener'
      document.body.appendChild(a); a.click(); a.remove()
    } catch { setMsg({ type: 'err', text: 'Download fehlgeschlagen, bitte nochmals versuchen.' }) }
    finally { setBusyId(null) }
  }

  async function allesHerunterladen() {
    setMsg(null); setZipStatus('Liste wird geholt')
    try {
      const r = await albumZipListe(ordner.slug)
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      const z = await zipAusDateien((r as { dateien: Array<{ pfad: string; url: string }> }).dateien, `${ordner.name.replace(/[^A-Za-z0-9äöüÄÖÜ._-]+/g, '_')}_Fotoalbum.zip`, setZipStatus)
      setMsg(z.ok ? { type: 'ok', text: `${z.anzahl} Fotos als ZIP heruntergeladen.` } : { type: 'err', text: z.fehler })
    } catch { setMsg({ type: 'err', text: 'Download fehlgeschlagen, bitte nochmals versuchen.' }) }
    finally { setZipStatus(null) }
  }

  async function loeschen(f: GalerieFoto) {
    if (!confirm(`Foto${f.beschreibung ? ` «${f.beschreibung}»` : ''} von ${vorname(f.von)} löschen?`)) return
    setBusyId(f.id)
    try {
      const r = await fotoLoeschen(ordner.slug, f.id)
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      setAnsicht(null)
      router.refresh()
    } finally { setBusyId(null) }
  }

  async function beschreibungSpeichern() {
    const b = beschreibungEdit
    if (!b) return
    setBusyId(b.f.id)
    try {
      const r = await fotoBeschreibungSetzen(ordner.slug, b.f.id, b.text)
      if ('error' in r && r.error) { setBeschreibungEdit({ ...b, fehler: r.error }); return }
      setBeschreibungEdit(null)
      router.refresh()
    } catch { setBeschreibungEdit({ ...b, fehler: 'Netzwerkfehler, bitte nochmals versuchen.' }) }
    finally { setBusyId(null) }
  }

  const darfBearbeiten = (f: GalerieFoto) => verwaltet || (meinName !== '' && f.von === meinName)
  const wartend = auswahl.filter(a => a.status !== 'fertig').length
  const fehlerhaft = auswahl.filter(a => a.status === 'fehler').length

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <p className="text-xs text-ink-4">
            <Link href={basis} className="hover:text-ink-2">Teamevents</Link>
            <span className="mx-1.5">/</span>
            <Link href={`${basis}/${ordner.slug}`} className="hover:text-ink-2">{ordner.name}</Link>
            <span className="mx-1.5">/</span>
            <span className="text-ink-2">{titel}</span>
          </p>
          <h1 className="page-title mt-1">{titel}</h1>
          <p className="page-subtitle tnum">{ordner.name} · {fotos.length} Foto{fotos.length !== 1 ? 's' : ''}{personen.length > 1 ? ` von ${personen.length} Personen` : ''}</p>
          {gesperrt && (
            <p className="text-[11px] text-blush-ink mt-1">Für Mitarbeitende zurzeit gesperrt. Der Schalter ist in der Verwaltung im Ordner Spiele.</p>
          )}
          {verwaltet && (
            <p className="text-[11px] text-ink-4 mt-1 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></svg>
              <span>Sichtbar für: {sichtbarText(ordner.sichtbar, team)}</span>
              <button onClick={() => setSichtbarEdit(true)} className="text-mint-ink hover:underline font-semibold">Ändern</button>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {fotos.length > 0 && (
            <button onClick={allesHerunterladen} disabled={!!zipStatus} className="btn-secondary disabled:opacity-60" title="Alle Fotos als ZIP herunterladen">
              {zipStatus ? zipStatus : '↓ Alle herunterladen'}
            </button>
          )}
          <button onClick={() => kameraRef.current?.click()} disabled={laeuft} className="btn-secondary disabled:opacity-60">📷 Foto aufnehmen</button>
          <button onClick={() => dateiRef.current?.click()} disabled={laeuft} className="btn-primary disabled:opacity-60">＋ Fotos hochladen</button>
          <input ref={dateiRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden"
            onChange={e => { if (e.target.files) waehlen(e.target.files); e.target.value = '' }} />
          <input ref={kameraRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={e => { if (e.target.files) waehlen(e.target.files); e.target.value = '' }} />
        </div>
      </div>

      {/* Einleitung */}
      <div className="card px-5 py-4">
        <p className="text-[13px] text-ink-2 leading-relaxed">{fotoalbumIntro(ordner)}</p>
        <p className="text-[11px] text-ink-4 mt-2">
          JPG, PNG, HEIC oder WebP. Grosse Fotos werden beim Hochladen automatisch verkleinert, du kannst zu jedem Foto eine Beschreibung schreiben. Zum Hochladen auch Fotos auf diese Seite ziehen.
        </p>
      </div>

      {/* Ablagefläche */}
      <div
        onDragOver={e => { e.preventDefault() }}
        onDrop={e => { e.preventDefault(); if (e.dataTransfer.files?.length) waehlen(e.dataTransfer.files) }}
        className="space-y-5"
      >
        {msg && (
          <p className={`text-xs px-3 py-2 rounded-ctl inline-block ${msg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>
            {msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}
          </p>
        )}

        {personen.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => setFilterVon(null)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${filterVon === null ? 'bg-dusk text-white border-dusk' : 'bg-white text-ink-2 border-edge-ctl hover:bg-edge-row'}`}>
              Alle ({fotos.length})
            </button>
            {personen.map(([n, anzahl]) => (
              <button key={n} onClick={() => setFilterVon(filterVon === n ? null : n)}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${filterVon === n ? 'bg-dusk text-white border-dusk' : 'bg-white text-ink-2 border-edge-ctl hover:bg-edge-row'}`}>
                {vorname(n)} ({anzahl})
              </button>
            ))}
          </div>
        )}

        {gruppen.length === 0 ? (
          <div className="card px-6 py-14 text-center">
            <p className="text-sm font-semibold text-ink-2">Noch keine Fotos</p>
            <p className="text-xs text-ink-4 mt-1">Mit «Fotos hochladen» oder «Foto aufnehmen» die ersten Bilder ablegen.</p>
          </div>
        ) : gruppen.map(([datum, liste]) => (
          <div key={datum} className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-edge-soft flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">{datumLang(datum)}</p>
              <p className="text-[11px] text-ink-4 tnum">{liste.length} Foto{liste.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="p-3 sm:p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {liste.map(f => (
                <div key={f.id} className="group relative rounded-xl overflow-hidden border border-edge-row bg-surface flex flex-col">
                  <button onClick={() => oeffnen(f)} disabled={busyId === f.id} className="relative block w-full aspect-square overflow-hidden" title={f.beschreibung || f.name}>
                    {f.vorschauUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.vorschauUrl} alt={f.beschreibung || f.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-ink-4 px-2">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.4}>
                          <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="m21 16-5-5-9 8" />
                        </svg>
                        <span className="text-[10px] text-center break-all leading-tight">{f.name}</span>
                        <span className="text-[9px]">keine Vorschau</span>
                      </div>
                    )}
                    {f.beschreibung && (
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent text-white text-[11px] leading-tight px-2 pt-6 pb-1.5 text-left"
                        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {f.beschreibung}
                      </span>
                    )}
                  </button>
                  <div className="px-2 py-1.5">
                    <p className="text-[10.5px] text-ink-2 truncate" title={`${f.von} · ${datumKurz(f.datum)} ${fmtZeit(f.am)}`}>
                      <span className="font-semibold">{vorname(f.von) || 'Unbekannt'}</span>{f.am ? ` · ${fmtZeit(f.am)}` : ''}
                    </p>
                  </div>
                  <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button onClick={() => herunterladen(f)} disabled={busyId === f.id}
                      className="w-7 h-7 rounded-full bg-white/90 border border-edge text-ink-2 hover:text-ink text-[12px]" title="Herunterladen">↓</button>
                    {darfBearbeiten(f) && (
                      <>
                        <button onClick={() => setBeschreibungEdit({ f, text: f.beschreibung, fehler: null })} disabled={busyId === f.id}
                          className="w-7 h-7 rounded-full bg-white/90 border border-edge text-ink-2 hover:text-ink text-[12px]" title="Beschreibung">✎</button>
                        <button onClick={() => loeschen(f)} disabled={busyId === f.id}
                          className="w-7 h-7 rounded-full bg-white/90 border border-edge text-ink-4 hover:text-red-500 text-[12px]" title="Löschen">✕</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {sichtbarEdit && (
        <SichtbarkeitDialog slug={ordner.slug} name={ordner.name} wert={ordner.sichtbar} team={team} onClose={() => setSichtbarEdit(false)} />
      )}

      {/* Upload-Dialog: Beschreibung je Foto, Fortschritt, Nochmals versuchen */}
      {dialogOffen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true">
          <div className="bg-white w-full sm:rounded-card sm:max-w-2xl shadow-xl overflow-hidden rounded-t-card border border-edge max-h-[92vh] flex flex-col">
            <div className="flex items-start justify-between px-5 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">Fotos hochladen</h3>
                <p className="text-xs text-ink-4 mt-0.5 tnum">
                  {auswahl.length} Foto{auswahl.length !== 1 ? 's' : ''}{laeuft ? ` · ${auswahl.filter(a => a.status === 'fertig').length} fertig` : ' · Beschreibung ist freiwillig'}
                </p>
              </div>
              <button onClick={dialogSchliessen} disabled={laeuft} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4 disabled:opacity-40" aria-label="Schliessen">✕</button>
            </div>
            <div className="overflow-auto px-5 py-4 space-y-3">
              {auswahl.length > 1 && !laeuft && (
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <p className="field-label">Beschreibung für alle <span className="normal-case font-normal">(optional)</span></p>
                    <input value={fuerAlle} onChange={e => setFuerAlle(e.target.value)} maxLength={300} placeholder="z. B. Silver Star am Freitagmorgen" className="input-field !py-1.5 text-sm w-full" />
                  </div>
                  <button onClick={() => { const t = fuerAlle.trim(); if (t) setAuswahl(prev => prev.map(a => (a.beschreibung.trim() ? a : { ...a, beschreibung: t }))) }}
                    disabled={!fuerAlle.trim()} className="btn-secondary !py-1.5 text-xs">Übernehmen</button>
                </div>
              )}
              <ul className="space-y-2">
                {auswahl.map(a => (
                  <li key={a.key} className="flex gap-3 items-start border border-edge-soft rounded-ctl p-2">
                    <div className="w-16 h-16 rounded-lg overflow-hidden bg-edge-row flex-shrink-0 flex items-center justify-center text-ink-4">
                      {a.vorschau ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.vorschau} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.4}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="m21 16-5-5-9 8" /></svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[11px] text-ink-4 truncate flex-1">{a.file.name} · {fmtBytes(a.file.size)}</p>
                        {a.status === 'fertig' && <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-full bg-mint-bg text-mint-ink">hochgeladen</span>}
                        {a.status === 'laedt' && <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-full bg-apricot-bg text-apricot-ink animate-pulse">{a.schritt ?? 'lädt'}</span>}
                        {a.status === 'fehler' && <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-full bg-blush-bg text-blush-ink">Fehler</span>}
                        {a.status === 'wartet' && !laeuft && (
                          <button onClick={() => entfernenAusAuswahl(a.key)} className="text-ink-4 hover:text-ink text-[12px] px-1" title="Aus der Auswahl entfernen">✕</button>
                        )}
                      </div>
                      <input value={a.beschreibung} onChange={e => setze(a.key, { beschreibung: e.target.value })} maxLength={300}
                        disabled={laeuft || a.status === 'fertig'} placeholder="Beschreibung (optional)" className="input-field !py-1.5 text-sm w-full mt-1 disabled:opacity-60" />
                      {a.status === 'fehler' && (
                        <p className="text-[11px] text-blush-ink mt-1 flex items-center gap-2 flex-wrap">
                          <span>⚠ {a.fehler}</span>
                          <button onClick={() => { void ladeEins(a.key) }} disabled={laeuft} className="font-semibold underline">Nochmals versuchen</button>
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {!laeuft && (
                <button onClick={() => dateiRef.current?.click()} className="text-[12px] text-mint-ink font-semibold hover:underline">＋ Weitere Fotos auswählen</button>
              )}
            </div>
            <div className="px-5 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={dialogSchliessen} disabled={laeuft} className="btn-secondary flex-1">{wartend === 0 ? 'Fertig' : 'Abbrechen'}</button>
              {wartend > 0 && (
                <button onClick={starten} disabled={laeuft} className="btn-primary flex-1">
                  {laeuft ? 'Lädt hoch…' : fehlerhaft > 0 && fehlerhaft === wartend ? 'Nochmals versuchen' : `${wartend} Foto${wartend !== 1 ? 's' : ''} hochladen`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Beschreibung ändern */}
      {beschreibungEdit && (
        <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">Beschreibung</h3>
                <p className="text-xs text-ink-4 mt-0.5">{beschreibungEdit.f.name} · {vorname(beschreibungEdit.f.von)}</p>
              </div>
              <button onClick={() => setBeschreibungEdit(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4">✕</button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <textarea value={beschreibungEdit.text} onChange={e => setBeschreibungEdit({ ...beschreibungEdit, text: e.target.value })} rows={3} maxLength={300}
                placeholder="z. B. Silver Star am Freitagmorgen" className="input-field text-sm w-full" autoFocus />
              {beschreibungEdit.fehler && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {beschreibungEdit.fehler}</p>}
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={() => setBeschreibungEdit(null)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={beschreibungSpeichern} disabled={busyId === beschreibungEdit.f.id} className="btn-primary flex-1">
                {busyId === beschreibungEdit.f.id ? 'Wird gespeichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ansicht in Originalgrösse, mit Wischen zum nächsten Foto */}
      {ansicht !== null && alleSortiert[ansicht] && (
        <FotoVollbild liste={alleSortiert} index={ansicht} onIndex={setAnsicht} laden={linkFuer} onClose={() => setAnsicht(null)}
          titel={f => f.beschreibung || f.name}
          untertitel={f => `von ${f.von || 'Unbekannt'} · ${datumKurz(f.datum)}${f.am ? `, ${fmtZeit(f.am)}` : ''}${f.bytes ? ` · ${fmtBytes(f.bytes)}` : ''}`}
          fuss={f => f.beschreibung ? <p className="text-center text-white/85 text-sm px-6 pb-3 leading-snug">{f.beschreibung}</p> : null}
          aktionen={f => (<>
            <button onClick={() => herunterladen(f)} className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-semibold">↓ Herunterladen</button>
            {darfBearbeiten(f) && <button onClick={() => setBeschreibungEdit({ f, text: f.beschreibung, fehler: null })} className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-semibold">✎ Beschreibung</button>}
            {darfBearbeiten(f) && <button onClick={() => loeschen(f)} className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-red-500/70 text-xs font-semibold">Löschen</button>}
          </>)} />
      )}
    </div>
  )
}
