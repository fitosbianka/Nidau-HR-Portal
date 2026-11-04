'use client'

import { useState, useTransition, useRef } from 'react'
import { createDocumentUploadUrl, finalizeDocumentUpload } from '@/actions/documents'
import { createClient } from '@/lib/supabase/client'
import { DOCUMENT_CATEGORIES, CATEGORY_ORDER, DOCUMENT_MIME_TYPES, DOCUMENT_ACCEPT, DOCUMENT_TYPES_ERROR, DOCUMENT_MAX_BYTES, DOCUMENT_MAX_MB, DOCUMENT_SIZE_ERROR, storageUploadFehler } from '@/lib/utils'

export default function UploadDocumentForm({ employeeId }: { employeeId?: string }) {
  const [error, setError]         = useState<string | null>(null)
  const [success, setSuccess]     = useState(false)
  const [isPending, startTransition] = useTransition()
  const [fileName, setFileName]   = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFileName(e.target.files?.[0]?.name ?? null)
    setError(null)
    setSuccess(false)
  }

  function handleSubmit(formData: FormData) {
    setError(null)
    setSuccess(false)
    startTransition(async () => {
      const file     = formData.get('file') as File | null
      const label    = (formData.get('label') as string) ?? ''
      const category = (formData.get('category') as string) ?? 'allgemein'

      if (!file || !label) { setError('Alle Felder sind erforderlich.'); return }
      if (!DOCUMENT_MIME_TYPES.includes(file.type)) { setError(DOCUMENT_TYPES_ERROR); return }
      if (file.size > DOCUMENT_MAX_BYTES) { setError(DOCUMENT_SIZE_ERROR); return }

      try {
        // 1. Ask the server for a signed upload target
        const auth = await createDocumentUploadUrl(file.name, employeeId ?? null)
        if ('error' in auth && auth.error) { setError(auth.error); return }
        const { path, token } = auth as { path: string; token: string }

        // 2. Upload straight from the browser to storage (no size limits
        //    from the server or hosting platform)
        const supabase = createClient()
        const { error: upErr } = await supabase.storage
          .from('employee-documents')
          .uploadToSignedUrl(path, token, file, { contentType: file.type })
        if (upErr) { setError(storageUploadFehler(upErr.message)); return }

        // 3. Register the document
        const fin = await finalizeDocumentUpload({
          path,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          label,
          category,
          employeeId: employeeId ?? null,
        })
        if (fin.error) { setError(fin.error); return }

        setSuccess(true)
        setFileName(null)
        formRef.current?.reset()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unbekannter Fehler beim Hochladen.')
      }
    })
  }

  return (
    <form ref={formRef} action={handleSubmit} className="space-y-5">
      {employeeId && <input type="hidden" name="employee_id" value={employeeId} />}

      {/* Kategorie */}
      <div>
        <label className="block text-sm font-medium text-ink-2 mb-1.5">
          Kategorie <span className="text-red-500">*</span>
        </label>
        <select name="category" required className="select-field">
          {CATEGORY_ORDER.map((cat) => (
            <option key={cat} value={cat}>
              {DOCUMENT_CATEGORIES[cat].label}
            </option>
          ))}
        </select>
      </div>

      {/* Bezeichnung */}
      <div>
        <label className="block text-sm font-medium text-ink-2 mb-1.5">
          Bezeichnung <span className="text-red-500">*</span>
        </label>
        <input
          name="label"
          type="text"
          className="input-field"
          placeholder="z.B. Lohnabrechnung März 2026, Arbeitsvertrag 2025"
          required
        />
      </div>

      {/* Datei */}
      <div>
        <label className="block text-sm font-medium text-ink-2 mb-1.5">
          Datei (PDF, Word, Excel oder Bild, bis {DOCUMENT_MAX_MB} MB) <span className="text-red-500">*</span>
        </label>
        <input
          name="file"
          type="file"
          accept={DOCUMENT_ACCEPT}
          onChange={handleFileChange}
          required
          className="block w-full text-sm text-ink-3
                     file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0
                     file:text-sm file:font-semibold file:bg-brand-50 file:text-ink
                     hover:file:bg-brand-100 file:transition-colors
                     cursor-pointer border border-edge-ctl rounded-lg bg-white"
        />
        {fileName && (
          <p className="text-xs text-ink-3 mt-1.5 flex items-center gap-1">
            <svg className="w-3.5 h-3.5 text-brand-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            {fileName}
          </p>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-mint-bg border border-mint-ink/20 rounded-xl text-sm text-mint-ink flex items-center gap-2">
          <svg className="w-4 h-4 text-mint-ink flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          Dokument erfolgreich hochgeladen.
        </div>
      )}

      <button type="submit" disabled={isPending} className="btn-primary">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        {isPending ? 'Wird hochgeladen…' : 'Hochladen'}
      </button>
    </form>
  )
}
