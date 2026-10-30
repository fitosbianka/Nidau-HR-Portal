'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { DOCUMENT_MIME_TYPES, DOCUMENT_TYPES_ERROR, documentFileType } from '@/lib/utils'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if ((profile as { role: string } | null)?.role !== 'admin') throw new Error('Keine Berechtigung')

  const adminClient = await createAdminClient()
  return { supabase, adminClient, adminId: user.id }
}

// ── Direct-to-storage upload ──────────────────────────────────────────────────
// Files are uploaded from the browser straight to Supabase Storage via a signed
// upload URL (server actions cap request bodies at ~1 MB and Vercel at ~4.5 MB,
// so large PDFs/scans cannot travel through the server).

/** Step 1: authorize an upload and hand the browser a signed target. */
export async function createDocumentUploadUrl(fileName: string, employeeId: string | null) {
  const { adminClient } = await requireAdmin()

  const safeFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const storagePath  = employeeId ? `${employeeId}/${safeFileName}` : `_hr/${safeFileName}`

  const { data, error } = await adminClient.storage
    .from('employee-documents')
    .createSignedUploadUrl(storagePath)

  if (error || !data) return { error: `Upload konnte nicht vorbereitet werden: ${error?.message ?? 'unbekannt'}` }
  return { path: data.path, token: data.token }
}

/** Step 2: after the browser upload succeeded, register the document. */
export async function finalizeDocumentUpload(input: {
  path: string
  fileName: string
  fileType: string      // MIME type
  fileSize: number
  label: string
  category: string
  employeeId: string | null
}) {
  const { adminClient, adminId } = await requireAdmin()

  let label    = (input.label ?? '').trim()
  let category = input.category || 'allgemein'
  if (category === 'ferienkonto') {
    category = 'zeiterfassung'
    if (label && !label.startsWith('Arbeitszeit- und Ferienkonto')) {
      label = 'Arbeitszeit- und Ferienkonto — ' + label
    }
  }
  if (category === 'unfallmeldung') {
    category = 'arztzeugnis'
    if (label && !label.startsWith('Unfall-/Krankheitsmeldung')) {
      label = 'Unfall-/Krankheitsmeldung — ' + label
    }
  }

  const cleanup = () => adminClient.storage.from('employee-documents').remove([input.path])

  if (!label) { await cleanup(); return { error: 'Bezeichnung ist erforderlich.' } }

  if (!DOCUMENT_MIME_TYPES.includes(input.fileType)) {
    await cleanup()
    return { error: DOCUMENT_TYPES_ERROR }
  }
  if (input.fileSize > 20 * 1024 * 1024) {
    await cleanup()
    return { error: 'Die Datei darf maximal 20 MB gross sein.' }
  }
  // The signed path is produced by createDocumentUploadUrl — make sure the
  // finalize call matches the claimed owner.
  const expectedPrefix = input.employeeId ? `${input.employeeId}/` : '_hr/'
  if (!input.path.startsWith(expectedPrefix)) {
    await cleanup()
    return { error: 'Ungültiger Speicherpfad.' }
  }

  const fileType = documentFileType(input.fileType)

  const { error: dbError } = await adminClient
    .from('documents')
    .insert({
      employee_id: input.employeeId,
      file_name: input.fileName,
      label,
      file_path: input.path,
      file_type: fileType,
      category,
      uploaded_by: adminId,
    })

  if (dbError) {
    await cleanup()
    return { error: `Datenbankfehler: ${dbError.message}` }
  }

  if (input.employeeId) revalidatePath(`/admin/employees/${input.employeeId}`)
  revalidatePath('/admin/hr-dokumente')
  revalidatePath('/admin/mitarbeiter')
  return { success: true }
}

export async function uploadDocument(formData: FormData) {
  const { adminClient, adminId } = await requireAdmin()

  const file       = formData.get('file') as File
  const employeeId = (formData.get('employee_id') as string) || null   // null = HR document
  let   label      = formData.get('label') as string
  let   category   = (formData.get('category') as string) || 'allgemein'

  // 'ferienkonto' and 'unfallmeldung' are virtual folders: stored under an
  // allowed category with a label prefix (documents.category has a DB check
  // constraint).
  if (category === 'ferienkonto') {
    category = 'zeiterfassung'
    if (label && !label.startsWith('Arbeitszeit- und Ferienkonto')) {
      label = 'Arbeitszeit- und Ferienkonto — ' + label
    }
  }
  if (category === 'unfallmeldung') {
    category = 'arztzeugnis'
    if (label && !label.startsWith('Unfall-/Krankheitsmeldung')) {
      label = 'Unfall-/Krankheitsmeldung — ' + label
    }
  }

  if (!file || !label) {
    return { error: 'Alle Felder sind erforderlich.' }
  }

  if (!DOCUMENT_MIME_TYPES.includes(file.type)) {
    return { error: DOCUMENT_TYPES_ERROR }
  }

  if (file.size > 20 * 1024 * 1024) {
    return { error: 'Die Datei darf maximal 20 MB gross sein.' }
  }

  const timestamp    = Date.now()
  const safeFileName = `${timestamp}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  // Employee docs → `{employeeId}/{file}`, HR docs → `_hr/{file}`
  const storagePath  = employeeId ? `${employeeId}/${safeFileName}` : `_hr/${safeFileName}`

  const { error: uploadError } = await adminClient.storage
    .from('employee-documents')
    .upload(storagePath, file, { contentType: file.type, upsert: false })

  if (uploadError) {
    return { error: `Fehler beim Hochladen: ${uploadError.message}` }
  }

  const fileType = documentFileType(file.type)
  const { error: dbError } = await adminClient
    .from('documents')
    .insert({
      employee_id: employeeId,   // null for HR documents
      file_name: file.name,
      label,
      file_path: storagePath,
      file_type: fileType,
      category,
      uploaded_by: adminId,
    })

  if (dbError) {
    await adminClient.storage.from('employee-documents').remove([storagePath])
    return { error: `Datenbankfehler: ${dbError.message}` }
  }

  if (employeeId) revalidatePath(`/admin/employees/${employeeId}`)
  revalidatePath('/admin/hr-dokumente')
  revalidatePath('/admin/mitarbeiter')
  return { success: true }
}

/** Move a document into another (display) folder. Virtual folders are stored
 *  as an allowed DB category plus a label prefix, so moving adjusts both. */
export async function moveDocument(documentId: string, target: string) {
  const { adminClient } = await requireAdmin()

  const PREFIXES = ['Arbeitszeit- und Ferienkonto', 'Unfall-/Krankheitsmeldung']
  const REAL = ['vertrag', 'lohn', 'zeiterfassung', 'arztzeugnis', 'allgemein']
  if (![...REAL, 'ferienkonto', 'unfallmeldung'].includes(target)) {
    return { error: 'Unbekannter Zielordner.' }
  }

  const { data: doc, error: fetchError } = await adminClient
    .from('documents')
    .select('id, label, employee_id')
    .eq('id', documentId)
    .single()
  if (fetchError || !doc) return { error: 'Dokument nicht gefunden.' }

  // Base label without any virtual-folder prefix
  let base = (doc.label ?? '').trim()
  for (const p of PREFIXES) {
    if (base.startsWith(p)) {
      const rest = base.slice(p.length).replace(/^[\s—–-]+/, '').trim()
      base = rest || base
      break
    }
  }

  let category: string
  let label: string
  if (target === 'ferienkonto') {
    category = 'zeiterfassung'
    label = base.startsWith('Arbeitszeit- und Ferienkonto') || base.startsWith('Ferienkonto')
      ? base : `Arbeitszeit- und Ferienkonto — ${base}`
  } else if (target === 'unfallmeldung') {
    category = 'arztzeugnis'
    label = base.startsWith('Unfall-/Krankheitsmeldung') ? base : `Unfall-/Krankheitsmeldung — ${base}`
  } else {
    category = target
    label = base
  }

  const { error: dbError } = await adminClient
    .from('documents')
    .update({ category, label })
    .eq('id', documentId)
  if (dbError) return { error: `Datenbankfehler: ${dbError.message}` }

  if (doc.employee_id) {
    revalidatePath(`/admin/employees/${doc.employee_id}`)
    revalidatePath('/employee')
  }
  revalidatePath('/admin/hr-dokumente')
  revalidatePath('/admin/mitarbeiter')
  return { success: true }
}

/** Rename a document (its display label). A virtual-folder prefix
 *  (Ferienkonto / Unfallmeldung) is kept automatically so renaming never
 *  moves the document out of its folder — use moveDocument for that. */
export async function renameDocument(documentId: string, newLabel: string) {
  const { adminClient } = await requireAdmin()

  const label = (newLabel ?? '').trim()
  if (!label) return { error: 'Bezeichnung darf nicht leer sein.' }
  if (label.length > 200) return { error: 'Bezeichnung ist zu lang (max. 200 Zeichen).' }

  const { data: doc, error: fetchError } = await adminClient
    .from('documents')
    .select('id, label, employee_id')
    .eq('id', documentId)
    .single()
  if (fetchError || !doc) return { error: 'Dokument nicht gefunden.' }

  const PREFIXES = ['Arbeitszeit- und Ferienkonto', 'Ferienkonto', 'Unfall-/Krankheitsmeldung']
  let finalLabel = label
  const oldPrefix = PREFIXES.find(p => (doc.label ?? '').startsWith(p))
  if (oldPrefix && !PREFIXES.some(p => label.startsWith(p))) {
    finalLabel = `${oldPrefix} — ${label}`
  }

  const { error: dbError } = await adminClient
    .from('documents')
    .update({ label: finalLabel })
    .eq('id', documentId)
  if (dbError) return { error: `Datenbankfehler: ${dbError.message}` }

  if (doc.employee_id) {
    revalidatePath(`/admin/employees/${doc.employee_id}`)
    revalidatePath('/employee')
  }
  revalidatePath('/admin/hr-dokumente')
  revalidatePath('/admin/mitarbeiter')
  return { success: true }
}

export async function deleteDocument(documentId: string) {
  const { adminClient } = await requireAdmin()

  // Fetch doc to get storage path and determine which pages to revalidate
  const { data: doc, error: fetchError } = await adminClient
    .from('documents')
    .select('file_path, employee_id')
    .eq('id', documentId)
    .single()

  if (fetchError || !doc) {
    return { error: 'Dokument nicht gefunden.' }
  }

  const { error: storageError } = await adminClient.storage
    .from('employee-documents')
    .remove([doc.file_path])

  if (storageError) {
    return { error: `Fehler beim Löschen der Datei: ${storageError.message}` }
  }

  const { error: dbError } = await adminClient
    .from('documents')
    .delete()
    .eq('id', documentId)

  if (dbError) {
    return { error: `Datenbankfehler: ${dbError.message}` }
  }

  if (doc.employee_id) {
    revalidatePath(`/admin/employees/${doc.employee_id}`)
    revalidatePath('/employee')
  }
  revalidatePath('/admin/hr-dokumente')
  revalidatePath('/admin/mitarbeiter')
  return { success: true }
}

// Returns a short-lived signed URL. With { download: true } the URL carries a
// Content-Disposition attachment with a clean file name (label + extension),
// so it downloads reliably on desktop AND mobile instead of navigating.
export async function getDocumentUrl(documentId: string, opts?: { download?: boolean }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Nicht authentifiziert' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = (profile as { role: string } | null)?.role

  const { data: doc, error } = await supabase
    .from('documents')
    .select('file_path, file_type, employee_id, file_name, label')
    .eq('id', documentId)
    .single()

  if (error || !doc) return { error: 'Dokument nicht gefunden.' }

  // Employees can only open their own documents (HR docs have null employee_id → blocked)
  if (role === 'employee' && doc.employee_id !== user.id) {
    return { error: 'Keine Berechtigung.' }
  }

  const adminClient = await createAdminClient()

  // Mark as viewed the first time an employee opens their own document
  if (role === 'employee' && doc.employee_id === user.id) {
    await adminClient
      .from('documents')
      .update({ viewed_at: new Date().toISOString() })
      .eq('id', documentId)
      .is('viewed_at', null)
    revalidatePath('/employee')
  }

  // Friendly download name: the displayed label plus the real extension
  const ext = doc.file_name.match(/\.[A-Za-z0-9]+$/)?.[0] ?? ''
  const base = ((doc.label as string | null) ?? '').trim() || doc.file_name.replace(/\.[A-Za-z0-9]+$/, '')
  const downloadName = `${base}${ext}`.replace(/[/\\:*?"<>|]/g, '-')

  const { data: urlData, error: urlError } = await adminClient.storage
    .from('employee-documents')
    .createSignedUrl(doc.file_path, 300, opts?.download ? { download: downloadName } : undefined)

  if (urlError) return { error: urlError.message }

  return { url: urlData.signedUrl, fileType: doc.file_type, fileName: downloadName }
}
