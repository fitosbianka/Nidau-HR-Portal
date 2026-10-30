'use client'

import { useState, useTransition } from 'react'
import { deleteDocument } from '@/actions/documents'
import { formatDateTime, DOCUMENT_CATEGORIES, documentDisplayCategory } from '@/lib/utils'
import type { Document } from '@/lib/supabase/types'

interface Props {
  documents: Document[]
  employeeId: string
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

export default function DocumentList({ documents, employeeId }: Props) {
  const [isPending, startTransition] = useTransition()
  const [deletingId, setDeletingId]  = useState<string | null>(null)
  const [error, setError]            = useState<string | null>(null)

  function handleDelete(docId: string) {
    if (!confirm('Dieses Dokument wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.')) return
    setDeletingId(docId)
    setError(null)
    startTransition(async () => {
      const result = await deleteDocument(docId)
      if (result.error) setError(result.error)
      setDeletingId(null)
    })
  }

  if (documents.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <div className="w-12 h-12 rounded-2xl bg-edge-row flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-ink-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        </div>
        <p className="text-ink-2 font-semibold text-sm">Noch keine Dokumente</p>
        <p className="text-ink-4 text-xs mt-1">Laden Sie das erste Dokument hoch.</p>
      </div>
    )
  }

  return (
    <div>
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}
      <ul className="divide-y divide-edge-row">
        {documents.map((doc) => {
          const category = documentDisplayCategory(doc)
          const catInfo  = DOCUMENT_CATEGORIES[category]

          return (
            <li
              key={doc.id}
              className="flex items-center gap-4 px-6 py-4 hover:bg-hovrow transition-colors group"
            >
              {doc.file_type === 'pdf' ? <PdfIcon /> : doc.file_type === 'image' ? <ImageIcon /> : <ExcelIcon />}

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink truncate">{doc.label}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className={catInfo.badgeClass}>{catInfo.label}</span>
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

              <button
                onClick={() => handleDelete(doc.id)}
                disabled={isPending && deletingId === doc.id}
                className="flex-shrink-0 p-2 text-ink-5 hover:text-[#B0654F] hover:bg-blush-bg
                           rounded-xl transition-all duration-150 disabled:opacity-50
                           opacity-0 group-hover:opacity-100"
                title="Dokument löschen"
              >
                {isPending && deletingId === doc.id ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
