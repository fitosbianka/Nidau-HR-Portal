'use client'

import { useState } from 'react'
import { getDocumentUrl } from '@/actions/documents'
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

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin text-mint-ink" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function EmployeeDocumentList({ documents }: Props) {
  const [openFolder, setOpenFolder] = useState<DisplayCategory | null>(null)
  const [loadingId, setLoadingId]   = useState<string | null>(null)
  const [error, setError]           = useState<string | null>(null)

  // Counts and new-doc counts per category
  const counts    = CATEGORY_ORDER.reduce<Record<DisplayCategory, number>>((acc, cat) => {
    acc[cat] = documents.filter((d) => documentDisplayCategory(d) === cat).length
    return acc
  }, {} as Record<DisplayCategory, number>)

  const newCounts = CATEGORY_ORDER.reduce<Record<DisplayCategory, number>>((acc, cat) => {
    acc[cat] = documents.filter((d) => documentDisplayCategory(d) === cat && !d.viewed_at).length
    return acc
  }, {} as Record<DisplayCategory, number>)

  const folderDocs = openFolder
    ? documents.filter((d) => documentDisplayCategory(d) === openFolder)
    : []

  /** Open (PDF preview) — the placeholder tab is opened BEFORE the await so
   *  the phone's popup blocker cannot swallow it. */
  async function handleOpen(doc: Document) {
    const fw = openFileWindow()
    setLoadingId(`${doc.id}-open`)
    setError(null)
    try {
      const result = await getDocumentUrl(doc.id)
      if (result.error || !result.url) {
        fw.cancel()
        setError('Das Dokument konnte nicht geöffnet werden. Bitte versuchen Sie es erneut.')
        return
      }
      fw.show(result.url)
    } finally {
      setLoadingId(null)
    }
  }

  /** Download — the signed URL carries a Content-Disposition attachment, so
   *  navigating to it saves the file (with its clean name) instead of
   *  opening it, on desktop and mobile alike. */
  async function handleDownload(doc: Document) {
    setLoadingId(`${doc.id}-dl`)
    setError(null)
    try {
      const result = await getDocumentUrl(doc.id, { download: true })
      if (result.error || !result.url) {
        setError('Das Dokument konnte nicht heruntergeladen werden. Bitte versuchen Sie es erneut.')
        return
      }
      window.location.assign(result.url)
    } finally {
      setLoadingId(null)
    }
  }

  // ── Empty state ──────────────────────────────────────────────────────────

  if (documents.length === 0) {
    return (
      <div className="px-6 py-16 text-center">
        <div className="w-14 h-14 rounded-2xl bg-edge-row flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-ink-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        </div>
        <p className="text-ink-2 font-semibold text-sm">Noch keine Dokumente</p>
        <p className="text-ink-4 text-xs mt-1">
          Ihre Dokumente erscheinen hier, sobald sie hochgeladen wurden.
        </p>
      </div>
    )
  }

  // ── Folder grid ──────────────────────────────────────────────────────────

  if (!openFolder) {
    return (
      <div className="p-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {CATEGORY_ORDER.map((cat) => {
            const info    = DOCUMENT_CATEGORIES[cat]
            const count   = counts[cat]
            const newCount = newCounts[cat]
            const empty   = count === 0
            return (
              <button
                key={cat}
                onClick={() => { setError(null); setOpenFolder(cat) }}
                className={`group relative flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all duration-150
                  ${empty
                    ? 'border-edge-soft bg-surface opacity-60 hover:opacity-80'
                    : `${info.folderBorder} ${info.folderBg} hover:shadow-md hover:-translate-y-0.5`
                  }`}
              >
                {/* New-document badge */}
                {newCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-600 text-white text-[10px] font-bold flex items-center justify-center">
                    {newCount}
                  </span>
                )}
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

  // ── Open folder — document list ──────────────────────────────────────────

  const catInfo = DOCUMENT_CATEGORIES[openFolder]

  return (
    <div>
      {/* Breadcrumb header */}
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
        <span className="ml-auto text-xs text-ink-4">
          {folderDocs.length} Dokument{folderDocs.length !== 1 ? 'e' : ''}
        </span>
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
            const isNew    = !doc.viewed_at
            // PDFs and pictures open in the browser; other files download
            const canPreview = doc.file_type === 'pdf' || doc.file_type === 'image'
            const openBusy = loadingId === `${doc.id}-open`
            const dlBusy   = loadingId === `${doc.id}-dl`
            const anyBusy  = openBusy || dlBusy

            return (
              <li key={doc.id} className="flex items-center gap-1 pr-4 hover:bg-hovrow transition-colors group">
                {/* Row body: tap = open (PDF) / download (other file types) */}
                <button
                  onClick={() => (canPreview ? handleOpen(doc) : handleDownload(doc))}
                  disabled={anyBusy}
                  className="flex-1 min-w-0 flex items-center gap-4 px-6 py-4 text-left disabled:opacity-60"
                >
                  {doc.file_type === 'pdf' ? <PdfIcon /> : doc.file_type === 'image' ? <ImageIcon /> : <ExcelIcon />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-ink truncate group-hover:text-ink transition-colors">
                        {doc.label}
                      </p>
                      {isNew && (
                        <span className="flex-shrink-0 px-1.5 py-0.5 rounded-md text-xs font-bold bg-brand-600 text-white">
                          Neu
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-ink-4 mt-0.5" suppressHydrationWarning>
                      {formatDateTime(doc.created_at)}
                    </p>
                  </div>
                </button>

                {/* Explicit actions: Öffnen (PDF) + Herunterladen (always) */}
                {canPreview && (
                  <button
                    onClick={() => handleOpen(doc)}
                    disabled={anyBusy}
                    title="Öffnen"
                    aria-label={`${doc.label} öffnen`}
                    className="flex-shrink-0 p-2.5 rounded-xl text-ink-5 hover:text-brand-500 hover:bg-edge-row transition-colors disabled:opacity-60"
                  >
                    {openBusy ? <Spinner /> : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    )}
                  </button>
                )}
                <button
                  onClick={() => handleDownload(doc)}
                  disabled={anyBusy}
                  title="Herunterladen"
                  aria-label={`${doc.label} herunterladen`}
                  className="flex-shrink-0 p-2.5 rounded-xl text-ink-5 hover:text-brand-500 hover:bg-edge-row transition-colors disabled:opacity-60"
                >
                  {dlBusy ? <Spinner /> : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
