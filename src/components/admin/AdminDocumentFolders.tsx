'use client'

import { useState, useTransition } from 'react'
import { deleteDocument, getDocumentUrl, moveDocument, renameDocument } from '@/actions/documents'
import { openFileWindow } from '@/lib/client-files'
import { formatDateTime, DOCUMENT_CATEGORIES, CATEGORY_ORDER, documentDisplayCategory, type DisplayCategory } from '@/lib/utils'
import type { Document } from '@/lib/supabase/types'

interface Props {
  documents: Document[]
}

// ── Icons ────────────────────────────────────────────────────────────────────

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M19.5 21a3 3 0 003-3v-4.5a3 3 0 00-3-3h-15a3 3 0 00-3 3V18a3 3 0 003 3h15zM1.5 10.146V6a3 3 0 013-3h5.379a2.25 2.25 0 011.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 013 3v1.146A4.483 4.483 0 0019.5 9h-15a4.483 4.483 0 00-3 1.146z" />
    </svg>
  )
}

function PdfIcon() {
  return (
    <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
      <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    </div>
  )
}

function ImageIcon() {
  return (
    <div className="w-9 h-9 rounded-xl bg-steel-bg flex items-center justify-center flex-shrink-0">
      <svg className="w-4 h-4 text-steel-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A1.5 1.5 0 0021.75 19.5V4.5A1.5 1.5 0 0020.25 3H3.75A1.5 1.5 0 002.25 4.5v15A1.5 1.5 0 003.75 21zM10.5 8.25h.008v.008H10.5V8.25z" />
      </svg>
    </div>
  )
}

function ExcelIcon() {
  return (
    <div className="w-9 h-9 rounded-xl bg-mint-bg flex items-center justify-center flex-shrink-0">
      <svg className="w-4 h-4 text-mint-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 19.5m9.75-9.75c0 .621-.504 1.125-1.125 1.125H12m8.625-9h-7.5A1.125 1.125 0 0112 1.875v-1.5" />
      </svg>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function AdminDocumentFolders({ documents }: Props) {
  const [openFolder, setOpenFolder]   = useState<DisplayCategory | null>(null)
  const [loadingId, setLoadingId]     = useState<string | null>(null)
  const [deletingId, setDeletingId]   = useState<string | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [isPending, startTransition]  = useTransition()

  // "Verschieben" dialog state
  const [moveDoc, setMoveDoc]         = useState<Document | null>(null)
  const [moveTarget, setMoveTarget]   = useState<DisplayCategory | null>(null)
  const [moveBusy, setMoveBusy]       = useState(false)

  // "Umbenennen" dialog state
  const [renameDoc, setRenameDoc]     = useState<Document | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameBusy, setRenameBusy]   = useState(false)

  // Label without the virtual-folder prefix — that part stays fixed on rename
  function baseLabel(label: string): string {
    for (const p of ['Arbeitszeit- und Ferienkonto', 'Unfall-/Krankheitsmeldung']) {
      if (label.startsWith(p)) {
        const rest = label.slice(p.length).replace(/^[\s—–-]+/, '').trim()
        return rest || label
      }
    }
    return label
  }

  // Count per display category (resolves the virtual Ferienkonto folder)
  const counts = CATEGORY_ORDER.reduce<Record<DisplayCategory, number>>((acc, cat) => {
    acc[cat] = documents.filter((d) => documentDisplayCategory(d) === cat).length
    return acc
  }, {} as Record<DisplayCategory, number>)

  const folderDocs = openFolder
    ? documents.filter((d) => documentDisplayCategory(d) === openFolder)
    : []

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleOpen(doc: Document, mode: 'preview' | 'download') {
    // Placeholder tab BEFORE the await — a window.open after an await is
    // silently blocked on phones. Downloads use a Content-Disposition URL.
    const fw = mode === 'preview' ? openFileWindow() : null
    setLoadingId(`${doc.id}-${mode}`)
    setError(null)
    try {
      const result = await getDocumentUrl(doc.id, mode === 'download' ? { download: true } : undefined)
      if (result.error || !result.url) {
        fw?.cancel()
        setError('Datei konnte nicht geöffnet werden.')
        return
      }
      if (fw) fw.show(result.url)
      else window.location.assign(result.url)
    } finally {
      setLoadingId(null)
    }
  }

  function handleMove() {
    if (!moveDoc || !moveTarget) return
    setMoveBusy(true)
    setError(null)
    startTransition(async () => {
      const result = await moveDocument(moveDoc.id, moveTarget)
      if (result.error) setError(result.error)
      setMoveBusy(false)
      setMoveDoc(null)
      setMoveTarget(null)
    })
  }

  function handleRename() {
    if (!renameDoc || !renameValue.trim()) return
    setRenameBusy(true)
    setError(null)
    startTransition(async () => {
      const result = await renameDocument(renameDoc.id, renameValue.trim())
      if (result.error) setError(result.error)
      setRenameBusy(false)
      setRenameDoc(null)
      setRenameValue('')
    })
  }

  function handleDelete(doc: Document) {
    if (!confirm(`"${doc.label}" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return
    setDeletingId(doc.id)
    setError(null)
    startTransition(async () => {
      const result = await deleteDocument(doc.id)
      if (result.error) setError(result.error)
      setDeletingId(null)
    })
  }

  // ── Folder grid ─────────────────────────────────────────────────────────

  if (!openFolder) {
    return (
      <div className="p-6">
        {documents.length === 0 && (
          <p className="text-sm text-ink-4 text-center py-6">Noch keine Dokumente vorhanden.</p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {CATEGORY_ORDER.map((cat) => {
            const info  = DOCUMENT_CATEGORIES[cat]
            const count = counts[cat]
            const empty = count === 0
            return (
              <button
                key={cat}
                onClick={() => { setError(null); setOpenFolder(cat) }}
                className={`group flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all duration-150
                  ${empty
                    ? 'border-edge-soft bg-surface opacity-60 hover:opacity-80'
                    : `${info.folderBorder} ${info.folderBg} hover:shadow-md hover:-translate-y-0.5`
                  }`}
              >
                <FolderIcon className={`w-10 h-10 ${empty ? 'text-ink-5' : info.folderText}`} />
                <div className="text-center">
                  <p className={`text-xs font-semibold leading-tight ${empty ? 'text-ink-4' : 'text-ink-2'}`}>
                    {info.label}
                  </p>
                  <p className={`text-lg font-bold mt-0.5 ${empty ? 'text-ink-5' : info.folderText}`}>
                    {count}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Open folder — document list ─────────────────────────────────────────

  const catInfo = DOCUMENT_CATEGORIES[openFolder]

  return (
    <div>
      {/* Folder header / breadcrumb */}
      <div className={`px-6 py-3 border-b border-edge-soft flex items-center gap-3 ${catInfo.folderBg}`}>
        <button
          onClick={() => { setOpenFolder(null); setError(null) }}
          className="flex items-center gap-1.5 text-sm font-medium text-ink-3 hover:text-ink transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Alle Ordner
        </button>
        <span className="text-ink-5">/</span>
        <FolderIcon className={`w-4 h-4 ${catInfo.folderText}`} />
        <span className={`text-sm font-semibold ${catInfo.folderText}`}>{catInfo.label}</span>
        <span className="ml-auto text-xs text-ink-4">{folderDocs.length} Dokument{folderDocs.length !== 1 ? 'e' : ''}</span>
      </div>

      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      {folderDocs.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <FolderIcon className="w-12 h-12 text-ink-5 mx-auto mb-3" />
          <p className="text-sm text-ink-4">Dieser Ordner ist leer.</p>
        </div>
      ) : (
        <ul className="divide-y divide-edge-row">
          {folderDocs.map((doc) => {
            const isDeleting = isPending && deletingId === doc.id
            const isLoadingPreview  = loadingId === `${doc.id}-preview`
            const isLoadingDownload = loadingId === `${doc.id}-download`
            const isBusy = isDeleting || isLoadingPreview || isLoadingDownload

            return (
              <li key={doc.id} className={`flex items-center gap-4 px-6 py-4 transition-colors ${isDeleting ? 'opacity-40' : 'hover:bg-hovrow'}`}>
                {doc.file_type === 'pdf' ? <PdfIcon /> : doc.file_type === 'image' ? <ImageIcon /> : <ExcelIcon />}

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{doc.label}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-ink-4 truncate" suppressHydrationWarning>
                      {doc.file_name} · {formatDateTime(doc.created_at)}
                    </span>
                    {doc.viewed_at && (
                      <span className="text-xs text-mint-ink flex items-center gap-0.5">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        Gesehen
                      </span>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Preview */}
                  <button
                    onClick={() => handleOpen(doc, 'preview')}
                    disabled={isBusy}
                    title="Vorschau"
                    className="p-2 rounded-xl text-ink-4 hover:text-mint-ink hover:bg-brand-50 transition-all disabled:opacity-40"
                  >
                    {isLoadingPreview ? <Spinner /> : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </button>

                  {/* Download */}
                  <button
                    onClick={() => handleOpen(doc, 'download')}
                    disabled={isBusy}
                    title="Herunterladen"
                    className="p-2 rounded-xl text-ink-4 hover:text-blue-600 hover:bg-blue-50 transition-all disabled:opacity-40"
                  >
                    {isLoadingDownload ? <Spinner /> : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                    )}
                  </button>

                  {/* Rename */}
                  <button
                    onClick={() => { setRenameDoc(doc); setRenameValue(baseLabel(doc.label ?? '')); setError(null) }}
                    disabled={isBusy}
                    title="Umbenennen"
                    className="p-2 rounded-xl text-ink-4 hover:text-apricot-ink hover:bg-apricot-bg transition-all disabled:opacity-40"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                    </svg>
                  </button>

                  {/* Move to another folder */}
                  <button
                    onClick={() => { setMoveDoc(doc); setMoveTarget(null); setError(null) }}
                    disabled={isBusy}
                    title="Verschieben"
                    className="p-2 rounded-xl text-ink-4 hover:text-lilac-ink hover:bg-lilac-bg transition-all disabled:opacity-40"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M3 7.5V6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7.5z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 13.5h6m0 0l-2.25-2.25M15 13.5l-2.25 2.25" />
                    </svg>
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(doc)}
                    disabled={isBusy}
                    title="Löschen"
                    className="p-2 rounded-xl text-ink-4 hover:text-[#B0654F] hover:bg-blush-bg transition-all disabled:opacity-40"
                  >
                    {isDeleting ? <Spinner /> : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    )}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* ── Umbenennen dialog ── */}
      {renameDoc && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-ink">Dokument umbenennen</h3>
                <p className="text-xs text-ink-4 mt-0.5 truncate">{renameDoc.file_name}</p>
              </div>
              <button onClick={() => setRenameDoc(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4 flex-shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4">
              <p className="field-label">Neue Bezeichnung</p>
              <input
                type="text"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRename() }}
                autoFocus
                maxLength={200}
                className="input-field w-full"
                placeholder="z.B. Arbeitsvertrag 2026"
              />
              {baseLabel(renameDoc.label ?? '') !== (renameDoc.label ?? '') && (
                <p className="text-xs text-ink-4 mt-2">
                  Der Ordner-Zusatz («{(renameDoc.label ?? '').split('—')[0].trim()}») bleibt automatisch erhalten.
                </p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={() => setRenameDoc(null)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={handleRename} disabled={!renameValue.trim() || renameBusy} className="btn-primary flex-1">
                {renameBusy ? 'Wird gespeichert…' : 'Umbenennen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Verschieben dialog ── */}
      {moveDoc && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-md shadow-xl overflow-hidden rounded-t-card border border-edge">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-ink">Dokument verschieben</h3>
                <p className="text-xs text-ink-4 mt-0.5 truncate">{moveDoc.label}</p>
              </div>
              <button onClick={() => setMoveDoc(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4 flex-shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4">
              <p className="field-label">Zielordner</p>
              <div className="flex flex-col gap-1.5">
                {CATEGORY_ORDER.filter((c) => c !== documentDisplayCategory(moveDoc)).map((cat) => {
                  const info = DOCUMENT_CATEGORIES[cat]
                  const selected = moveTarget === cat
                  return (
                    <button
                      key={cat}
                      onClick={() => setMoveTarget(cat)}
                      className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-ctl border text-left text-[13px] font-semibold transition-colors ${
                        selected
                          ? 'bg-active border-edge-strong text-ink'
                          : 'bg-white border-edge-ctl text-ink-2 hover:bg-edge-row'
                      }`}
                    >
                      <FolderIcon className={`w-4 h-4 flex-shrink-0 ${info.folderText}`} />
                      {info.label}
                      {selected && (
                        <svg className="w-4 h-4 ml-auto text-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-edge-soft bg-surface flex gap-2">
              <button onClick={() => setMoveDoc(null)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={handleMove} disabled={!moveTarget || moveBusy} className="btn-primary flex-1">
                {moveBusy ? 'Wird verschoben…' : 'Verschieben'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin text-ink-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  )
}
