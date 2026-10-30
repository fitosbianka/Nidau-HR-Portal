import { createClient } from '@/lib/supabase/server'
import UploadDocumentForm from '@/components/admin/UploadDocumentForm'
import AdminDocumentFolders from '@/components/admin/AdminDocumentFolders'

export default async function HrDokumentePage() {
  const supabase = await createClient()

  // Fetch HR documents — those with no employee_id
  const { data: documents } = await supabase
    .from('documents')
    .select('*')
    .is('employee_id', null)
    .order('created_at', { ascending: false })

  const docList = documents ?? []

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <div>
        <h1 className="page-title">HR Dokumente</h1>
        <p className="page-subtitle">
          Allgemeine Vorlagen und interne Dokumente — nicht mit einzelnen Mitarbeitenden verknüpft.
        </p>
      </div>

      {/* ── Folder view ─────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-edge-soft flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-2">
            Ordner
            <span className="ml-2 text-ink-4 font-normal">({docList.length})</span>
          </h2>
        </div>
        <AdminDocumentFolders documents={docList} />
      </div>

      {/* ── Upload form ─────────────────────────────────────── */}
      <div className="card p-6">
        <h2 className="text-sm font-semibold text-ink-2 mb-5">Dokument hochladen</h2>
        <UploadDocumentForm />
      </div>
    </div>
  )
}
