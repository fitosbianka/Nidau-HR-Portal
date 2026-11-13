'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { wirksamerEintrag, verlaufPatch, zurichToday, type VerlaufEintrag } from '@/lib/salary-sync'
import { schreibeBvg, ladeBvgStand } from '@/lib/lohn-bvg'
import { EXTERN_ANCHOR, EXTERN_KATEGORIEN, externKey, ladeExterne, istExternProfil } from '@/lib/externe'
import { EMAIL_RE, hatPortalKonto, platzhalterEmail } from '@/lib/konto-status'
import { istFunktion, istVerwaltungsFunktion } from '@/lib/funktionen'

/** Ist die E-Mail noch frei (Login Konten und Profile)? Gibt eine Fehlermeldung oder null. */
async function emailFrei(adminClient: Awaited<ReturnType<typeof createAdminClient>>, email: string, eigeneId?: string | null): Promise<string | null> {
  const { data: { users } } = await adminClient.auth.admin.listUsers({ perPage: 1000 })
  if (users.some(u => u.id !== eigeneId && u.email?.toLowerCase() === email)) return 'Für diese E-Mail-Adresse existiert bereits ein Konto.'
  const { data } = await adminClient.from('profiles').select('id').ilike('email', email).maybeSingle()
  const p = data as { id: string } | null
  if (p && p.id !== eigeneId) return 'Für diese E-Mail-Adresse existiert bereits ein Profil.'
  return null
}

/** Unbrauchbares Passwort für Profile ohne Login (lang, zufällig, nie angezeigt). */
const unbrauchbaresPasswort = () => `${generateTempPassword()}${generateTempPassword()}${generateTempPassword()}`

/** Darf dieser Person der Admin Zugriff entzogen werden? Nie dem eigenen
 *  Konto und nie dem letzten Admin. Gibt eine Fehlermeldung oder null. */
async function adminEntzugSperre(adminClient: Awaited<ReturnType<typeof createAdminClient>>, employeeId: string, userId: string): Promise<string | null> {
  if (employeeId === userId) return 'Der eigene Admin-Zugriff kann nicht entzogen werden.'
  const { count } = await adminClient.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin')
  if ((count ?? 0) <= 1) return 'Der letzte Admin-Zugriff kann nicht entzogen werden.'
  return null
}

/** Lesbares Startpasswort, zum Beispiel «Kc7Rm4Xp» */
function generateTempPassword(): string {
  const upper  = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower  = 'abcdefghjkmnpqrstuvwxyz'
  const digits = '23456789'
  const parts  = [
    upper [Math.floor(Math.random() * upper.length)],
    upper [Math.floor(Math.random() * upper.length)],
    lower [Math.floor(Math.random() * lower.length)],
    lower [Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    digits[Math.floor(Math.random() * digits.length)],
    digits[Math.floor(Math.random() * digits.length)],
    digits[Math.floor(Math.random() * digits.length)],
  ]
  for (let i = parts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [parts[i], parts[j]] = [parts[j], parts[i]]
  }
  return parts.join('')
}

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
  return { supabase, adminClient, userId: user.id }
}

/** Namen sind im Portal Schlüssel (Zeiterfassung, Arbeitsplan, Rollen wie
 *  Bestellungen). Darum kein zweites Profil mit demselben Namen. Gibt eine
 *  Fehlermeldung zurück oder null. */
async function nameFrei(adminClient: Awaited<ReturnType<typeof createAdminClient>>, fullName: string, eigeneId?: string | null): Promise<string | null> {
  const name = (fullName ?? '').replace(/\s+/g, ' ').trim()
  if (!name) return 'Bitte den vollständigen Namen eingeben.'
  const { data } = await adminClient.from('profiles').select('id, full_name, is_active').ilike('full_name', name)
  const andere = ((data ?? []) as Array<{ id: string; full_name: string; is_active: boolean }>).find(x => x.id !== eigeneId)
  if (andere) return `Den Namen «${andere.full_name}» gibt es schon${andere.is_active ? '' : ' (inaktiv, unter «Ehemalige Mitarbeitende»)'}. Bitte einen eindeutigen Namen verwenden.`
  return null
}

/** Mitarbeiterin anlegen. Mit E-Mail entsteht sofort ein Portal Konto mit
 *  Startpasswort, das der Admin weitergibt (keine Einladungsmail). Ohne
 *  E-Mail wird ein Profil ohne Login angelegt (Platzhalter Adresse,
 *  unbekanntes Passwort); alle Daten hängen an der Profil ID, das Konto
 *  kommt später über kontoErstellen dazu. Admin und HR & Finanzen erhalten
 *  die Rolle admin. */
export async function createEmployee(formData: FormData) {
  const { adminClient } = await requireAdmin()
  const fullName = ((formData.get('full_name') as string) ?? '').replace(/\s+/g, ' ').trim()
  const jobTitle = ((formData.get('job_title') as string) ?? '').trim()
  const emailRaw = ((formData.get('email') as string) ?? '').trim().toLowerCase()
  if (fullName.length < 3) return { error: 'Bitte den vollständigen Namen eingeben.' }
  if (!istFunktion(jobTitle)) return { error: 'Bitte eine Funktion wählen.' }
  if (emailRaw && !EMAIL_RE.test(emailRaw)) return { error: 'Bitte eine gültige E-Mail-Adresse eingeben oder das Feld leer lassen.' }
  const nameFehler = await nameFrei(adminClient, fullName)
  if (nameFehler) return { error: nameFehler }
  if (emailRaw) {
    const belegt = await emailFrei(adminClient, emailRaw)
    if (belegt) return { error: belegt }
  }

  const ohneKonto = !emailRaw
  const email = emailRaw || platzhalterEmail(fullName)
  const tempPassword = generateTempPassword()
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password: ohneKonto ? unbrauchbaresPasswort() : tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (createError) return { error: createError.message }
  const id = created.user.id
  const role = istVerwaltungsFunktion(jobTitle) ? 'admin' : 'employee'
  const { error: profileError } = await adminClient
    .from('profiles')
    .upsert({ id, full_name: fullName, email, role, job_title: jobTitle, is_active: true }, { onConflict: 'id' })
  if (profileError) return { error: profileError.message }
  if (role === 'admin') {
    const syncError = await syncAdminUsers(adminClient)
    if (syncError) return { error: `Angelegt, aber die Datenbank-Freischaltliste konnte nicht aktualisiert werden: ${syncError}` }
  }

  revalidatePath('/admin/mitarbeiter')
  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true, id, ohneKonto, tempPassword: ohneKonto ? undefined : tempPassword }
}

/** Portal Konto für ein Profil ohne Login erstellen: dieselbe Profil ID
 *  bekommt die E-Mail und ein Startpasswort; alles bereits Erfasste bleibt. */
export async function kontoErstellen(employeeId: string, emailRaw: string) {
  const { adminClient } = await requireAdmin()
  if (!/^[0-9a-f-]{8,64}$/i.test(employeeId)) return { error: 'Ungültige Angaben.' }
  const email = (emailRaw ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return { error: 'Bitte eine gültige E-Mail-Adresse eingeben.' }
  const { data: prof } = await adminClient.from('profiles').select('id, full_name, email').eq('id', employeeId).maybeSingle()
  const p = prof as { id: string; full_name: string; email: string } | null
  if (!p) return { error: 'Profil nicht gefunden.' }
  if (hatPortalKonto(p.email)) return { error: `${p.full_name} hat schon ein Portal Konto (${p.email}). Für ein neues Passwort «Neues Passwort setzen» verwenden.` }
  const belegt = await emailFrei(adminClient, email, employeeId)
  if (belegt) return { error: belegt }

  const tempPassword = generateTempPassword()
  const { error: authErr } = await adminClient.auth.admin.updateUserById(employeeId, {
    email, password: tempPassword, email_confirm: true, user_metadata: { full_name: p.full_name },
  })
  if (authErr) return { error: `Konto konnte nicht erstellt werden: ${authErr.message}` }
  const { error } = await adminClient.from('profiles').update({ email }).eq('id', employeeId)
  if (error) return { error: `Konto erstellt, aber die E-Mail konnte nicht im Profil gespeichert werden: ${error.message}` }

  revalidatePath(`/admin/employees/${employeeId}`)
  revalidatePath('/admin/mitarbeiter')
  return { success: true, tempPassword }
}

/** Neues Passwort für ein bestehendes Konto durch den Admin (neben dem
 *  Passwort-vergessen-Link beim Login). Das eigene Passwort ändert man
 *  unter «Passwort ändern». */
export async function passwortNeuSetzen(employeeId: string) {
  const { adminClient, userId } = await requireAdmin()
  if (!/^[0-9a-f-]{8,64}$/i.test(employeeId)) return { error: 'Ungültige Angaben.' }
  if (employeeId === userId) return { error: 'Das eigene Passwort bitte unter «Passwort ändern» setzen.' }
  const { data: prof } = await adminClient.from('profiles').select('id, full_name, email').eq('id', employeeId).maybeSingle()
  const p = prof as { id: string; full_name: string; email: string } | null
  if (!p) return { error: 'Profil nicht gefunden.' }
  if (!hatPortalKonto(p.email)) return { error: `${p.full_name} hat noch kein Portal Konto. Zuerst «Konto erstellen».` }
  const tempPassword = generateTempPassword()
  const { error: authErr } = await adminClient.auth.admin.updateUserById(employeeId, { password: tempPassword })
  if (authErr) return { error: `Passwort konnte nicht gesetzt werden: ${authErr.message}` }
  return { success: true, tempPassword }
}

/** Externe Person (selbständig) anlegen. Mit E-Mail entsteht ein Konto mit
 *  Startpasswort (Portal-Zugang zum Beispiel für den Arbeitsplan), ohne
 *  E-Mail ein Profil ohne Login. Die Funktion (ZAZ, DA …) gilt wie bei
 *  Angestellten, zusätzlich wird die Markierung «Extern» gesetzt. */
export async function createExternEmployee(formData: FormData) {
  const { adminClient, userId } = await requireAdmin()
  const fullName = ((formData.get('full_name') as string) ?? '').replace(/\s+/g, ' ').trim()
  const jobTitle = ((formData.get('job_title') as string) ?? '').trim()
  const emailRaw = ((formData.get('email') as string) ?? '').trim().toLowerCase()
  if (fullName.length < 3) return { error: 'Bitte den vollständigen Namen eingeben.' }
  if (!(EXTERN_KATEGORIEN as readonly string[]).includes(jobTitle)) return { error: 'Bitte eine Kategorie wählen.' }
  if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) return { error: 'Bitte eine gültige E-Mail-Adresse eingeben oder das Feld leer lassen.' }

  const { data: gleich } = await adminClient.from('profiles').select('id, is_active').ilike('full_name', fullName).maybeSingle()
  const g = gleich as { id: string; is_active: boolean } | null
  if (g) return { error: `«${fullName}» gibt es schon${g.is_active ? '' : ' (inaktiv, unter «Ehemalige Mitarbeitende» reaktivieren)'}.` }
  if (emailRaw) {
    const belegt = await emailFrei(adminClient, emailRaw)
    if (belegt) return { error: belegt }
  }

  const ohneLogin = !emailRaw
  const email = emailRaw || platzhalterEmail(fullName, 'extern')
  const tempPassword = generateTempPassword()
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password: ohneLogin ? unbrauchbaresPasswort() : tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (createError) return { error: createError.message }
  const id = created.user.id
  const { error: profileError } = await adminClient
    .from('profiles')
    .upsert({ id, full_name: fullName, email, role: 'employee', job_title: jobTitle, is_active: true }, { onConflict: 'id' })
  if (profileError) return { error: profileError.message }
  const am = new Date().toISOString()
  const { error: externError } = await adminClient.from('zeiterfassung_comments').upsert(
    { user_full_name: externKey(id), schedule_date: EXTERN_ANCHOR, comment: JSON.stringify({ seit: am, von: userId, ohneLogin }), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (externError) return { error: `Konto angelegt, aber die Markierung «Extern» konnte nicht gespeichert werden: ${externError.message}` }

  revalidatePath('/admin/mitarbeiter')
  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true, id, ohneLogin, tempPassword: ohneLogin ? undefined : tempPassword }
}

/** Konto endgültig löschen (Admin). Erlaubt nur für Externe (selbständig,
 *  kein Anstellungsverhältnis) oder für inaktive Konten OHNE Dokumente,
 *  Zeiten und Lohndaten — alles andere fällt unter die Aufbewahrungspflicht
 *  (10 Jahre) und bleibt unter «Ehemalige Mitarbeitende». Entfernt werden
 *  Dokumente samt Dateien, Plan-Einträge, Zeiten, Verlauf, alle
 *  Portal-Einträge (nach ID und Name, inkl. Ferienvertretungen mit diesem
 *  Namen) und zuletzt das Login-Konto; das Profil fällt mit dem Konto. */
export async function deleteEmployeePermanently(id: string, bestaetigung: string) {
  const { adminClient } = await requireAdmin()
  if (!/^[0-9a-f-]{8,64}$/i.test(id)) return { error: 'Ungültige Angaben.' }
  if ((bestaetigung ?? '').trim().toLowerCase() !== 'löschen') return { error: 'Bitte zur Bestätigung das Wort löschen eingeben.' }
  const { data: prof } = await adminClient.from('profiles').select('id, full_name, role, is_active').eq('id', id).maybeSingle()
  const p = prof as { id: string; full_name: string; role: string; is_active: boolean } | null
  if (!p) return { error: 'Konto nicht gefunden.' }
  if (p.role === 'admin') return { error: 'Admin-Konten können nicht gelöscht werden.' }
  const extern = istExternProfil(p, await ladeExterne(adminClient))
  if (p.is_active && !extern) return { error: 'Aktive Angestellte können nicht gelöscht werden. Bitte zuerst deaktivieren; die Daten bleiben wegen der Aufbewahrungspflicht erhalten.' }
  if (!extern) {
    const [{ count: docs }, { count: zeiten }, { count: verlauf }] = await Promise.all([
      adminClient.from('documents').select('id', { count: 'exact', head: true }).eq('employee_id', id),
      adminClient.from('attendance_events').select('employee_id', { count: 'exact', head: true }).eq('employee_id', id),
      adminClient.from('salary_history').select('id', { count: 'exact', head: true }).eq('employee_id', id),
    ])
    if ((docs ?? 0) > 0 || (zeiten ?? 0) > 0 || (verlauf ?? 0) > 0) {
      return { error: 'Dieses Konto hat Dokumente, Zeiten oder Lohndaten. Wegen der Aufbewahrungspflicht (10 Jahre) bleibt es unter «Ehemalige Mitarbeitende» erhalten und kann nicht gelöscht werden.' }
    }
  }

  const { data: docRows } = await adminClient.from('documents').select('file_path').eq('employee_id', id)
  const pfade = ((docRows ?? []) as Array<{ file_path: string | null }>).map(d => d.file_path).filter((x): x is string => !!x)
  if (pfade.length > 0) await adminClient.storage.from('employee-documents').remove(pfade)
  const schritte: Array<() => PromiseLike<{ error: { message: string } | null }>> = [
    () => adminClient.from('documents').delete().eq('employee_id', id),
    () => adminClient.from('work_schedule').delete().eq('employee_id', id),
    () => adminClient.from('salary_history').delete().eq('employee_id', id),
    () => adminClient.from('attendance_events').delete().eq('employee_id', id),
    () => adminClient.from('admin_users').delete().eq('user_id', id),
    () => adminClient.from('zeiterfassung_comments').delete().like('user_full_name', `%${id}%`),
    () => adminClient.from('zeiterfassung_comments').delete().eq('user_full_name', p.full_name),
    () => adminClient.from('zeiterfassung_comments').delete().like('user_full_name', '\\_\\_ferien\\_vertretung\\_\\_%').like('comment', `%${p.full_name}%`),
  ]
  for (const schritt of schritte) {
    const { error: e } = await schritt()
    if (e && !/does not exist|relation/i.test(e.message)) return { error: `Daten konnten nicht vollständig gelöscht werden: ${e.message}` }
  }
  const { error } = await adminClient.auth.admin.deleteUser(id)
  if (error) return { error: `Login-Konto konnte nicht gelöscht werden: ${error.message}` }

  for (const pfad of ['/admin/mitarbeiter', '/admin/mitarbeiter/ehemalige', '/admin/arbeitsplan', '/employee/arbeitsplan', '/admin/zeiterfassung/ferien/planung', '/employee/team/ferien']) revalidatePath(pfad)
  return { success: true as const }
}

/** Markierung «Extern» setzen oder entfernen (Admin). */
export async function setExtern(employeeId: string, extern: boolean) {
  const { adminClient, userId } = await requireAdmin()
  if (!/^[0-9a-f-]{8,64}$/i.test(employeeId)) return { error: 'Ungültige Angaben.' }
  const am = new Date().toISOString()
  const { error } = extern
    ? await adminClient.from('zeiterfassung_comments').upsert(
        { user_full_name: externKey(employeeId), schedule_date: EXTERN_ANCHOR, comment: JSON.stringify({ seit: am, von: userId }), updated_at: am },
        { onConflict: 'user_full_name,schedule_date' },
      )
    : await adminClient.from('zeiterfassung_comments').delete().eq('user_full_name', externKey(employeeId)).eq('schedule_date', EXTERN_ANCHOR)
  if (error) return { error: error.message }
  revalidatePath('/admin/mitarbeiter')
  revalidatePath('/admin/mitarbeiter/ehemalige')
  revalidatePath(`/admin/employees/${employeeId}`)
  return { success: true }
}

export async function updateEmployee(formData: FormData) {
  const { adminClient } = await requireAdmin()

  const id       = formData.get('id')        as string
  const fullName = formData.get('full_name') as string
  const jobTitle = formData.get('job_title') as string
  const isActive = formData.get('is_active') === 'true'

  // Kein Umbenennen auf einen vergebenen Namen (und nie auf den Namen der Inhaberin)
  const nameFehler = await nameFrei(adminClient, fullName, id)
  if (nameFehler) return { error: nameFehler }

  const { error } = await adminClient
    .from('profiles')
    .update({ full_name: fullName, job_title: jobTitle || null, is_active: isActive })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/admin/mitarbeiter')
  revalidatePath(`/admin/employees/${id}`)
  return { success: true }
}

/** Grant or revoke FULL admin access (role 'admin' + Kategorie «Admin») —
 *  the same access the practice admin has. Guards: an admin can never
 *  revoke their own access, and the last admin cannot be removed. */
export async function setAdminAccess(employeeId: string, grant: boolean) {
  const { adminClient, userId } = await requireAdmin()
  if (!employeeId) return { error: 'Ungültiges Profil.' }
  const { data: prof } = await adminClient.from('profiles').select('job_title').eq('id', employeeId).maybeSingle()
  const jobTitle = (prof as { job_title: string | null } | null)?.job_title ?? null

  if (!grant) {
    const sperre = await adminEntzugSperre(adminClient, employeeId, userId)
    if (sperre) return { error: sperre }
    if (istVerwaltungsFunktion(jobTitle)) {
      return { error: `Die Funktion «${jobTitle}» hat immer Admin-Rechte. Bitte zuerst unter «Persönliche Angaben» eine andere Funktion wählen.` }
    }
  }

  // Beim Vergeben bleibt eine Verwaltungsfunktion stehen, sonst wird «Admin» gesetzt
  const { error } = await adminClient
    .from('profiles')
    .update(grant ? { role: 'admin', ...(istVerwaltungsFunktion(jobTitle) ? {} : { job_title: 'Admin' }) } : { role: 'employee' })
    .eq('id', employeeId)
  if (error) return { error: error.message }

  // WICHTIG: Die RLS-Funktion is_admin() liest die Lookup-Tabelle
  // public.admin_users, nicht profiles.role. Ohne diesen Sync sieht ein
  // neuer Admin auf Datenbank-Ebene nur die eigenen Zeilen, und ein
  // entzogener Admin behielte DB-Lesezugriff (Ursache der Panne vom
  // 17.09.2026 — hier dauerhaft behoben für Vergeben UND Entziehen).
  const syncError = await syncAdminUsers(adminClient)
  if (syncError) return { error: `Rolle gesetzt, aber die Datenbank-Freischaltliste konnte nicht aktualisiert werden: ${syncError}` }

  revalidatePath('/admin/mitarbeiter')
  revalidatePath(`/admin/employees/${employeeId}`)
  return { success: true }
}

/** Befüllt public.admin_users (die von der RLS-Funktion is_admin() gelesene
 *  Freischaltliste) neu aus allen Profilen mit role='admin'. Muss nach
 *  JEDER Rollenänderung laufen. */
async function syncAdminUsers(adminClient: Awaited<ReturnType<typeof createAdminClient>>): Promise<string | null> {
  const { data: adminRows, error: selErr } = await adminClient
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
  if (selErr) return selErr.message
  const ids = ((adminRows ?? []) as Array<{ id: string }>).map(r => r.id)
  if (ids.length === 0) return 'Kein Admin-Profil gefunden — Liste nicht geleert.'
  const { error: delErr } = await adminClient
    .from('admin_users')
    .delete()
    .neq('user_id', '00000000-0000-0000-0000-000000000000')
  if (delErr) return delErr.message
  const { error: insErr } = await adminClient
    .from('admin_users')
    .insert(ids.map(id => ({ user_id: id })))
  if (insErr) return insErr.message
  return null
}

export async function deactivateEmployee(id: string) {
  const { adminClient } = await requireAdmin()

  const { error } = await adminClient
    .from('profiles')
    .update({ is_active: false })
    .eq('id', id)
    .neq('role', 'admin')

  if (error) return { error: error.message }

  revalidatePath('/admin/mitarbeiter')
  revalidatePath('/admin/mitarbeiter/ehemalige')
  revalidatePath(`/admin/employees/${id}`)
  return { success: true }
}

export async function reactivateEmployee(id: string) {
  const { adminClient } = await requireAdmin()

  const { error } = await adminClient
    .from('profiles')
    .update({ is_active: true })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/admin/mitarbeiter')
  revalidatePath('/admin/mitarbeiter/ehemalige')
  revalidatePath(`/admin/employees/${id}`)
  return { success: true }
}

// ── Section-specific update actions ─────────────────────────────────────────

export async function updatePersonalDetails(formData: FormData) {
  const { adminClient, userId } = await requireAdmin()
  const id = formData.get('id') as string
  const fullName = ((formData.get('full_name') as string) ?? '').replace(/\s+/g, ' ').trim()
  const nameFehler = await nameFrei(adminClient, fullName, id)
  if (nameFehler) return { error: nameFehler }

  const { data: currentRow } = await adminClient.from('profiles').select('email, role, job_title').eq('id', id).single()
  const current = currentRow as { email: string; role: string; job_title: string | null } | null
  if (!current) return { error: 'Profil nicht gefunden.' }

  // Login E-Mail: lebt in Supabase AUTH, nicht nur im Profil; eine geänderte
  // Adresse muss dort ebenfalls geschrieben werden. Das Passwort bleibt
  // unverändert. Ohne Portal Konto bleibt die Platzhalter Adresse stehen,
  // das Konto entsteht unter «Zugriff» (kontoErstellen).
  const newEmail = hatPortalKonto(current.email) ? ((formData.get('email') as string) ?? '').trim().toLowerCase() : ''
  if (newEmail && newEmail !== current.email.toLowerCase()) {
    if (!EMAIL_RE.test(newEmail)) return { error: 'Bitte eine gültige E-Mail-Adresse eingeben.' }
    const belegt = await emailFrei(adminClient, newEmail, id)
    if (belegt) return { error: belegt }
    const { error: authErr } = await adminClient.auth.admin.updateUserById(id, {
      email: newEmail,
      email_confirm: true,   // keine Bestätigungsmail, das Login funktioniert sofort
    })
    if (authErr) return { error: `Login-E-Mail konnte nicht geändert werden: ${authErr.message}` }
  }

  // Rolle folgt der Funktion: Admin und HR & Finanzen haben die Rolle admin,
  // ein Wechsel weg von diesen Funktionen nimmt die Admin-Rechte wieder weg
  const newTitle = ((formData.get('job_title') as string) ?? '').trim() || null
  let newRole: 'admin' | 'employee' | null = null
  if (istVerwaltungsFunktion(newTitle) && current.role !== 'admin') newRole = 'admin'
  if (!istVerwaltungsFunktion(newTitle) && current.role === 'admin' && istVerwaltungsFunktion(current.job_title)) {
    const sperre = await adminEntzugSperre(adminClient, id, userId)
    if (sperre) return { error: `${sperre} Die Funktion bleibt darum «${current.job_title}».` }
    newRole = 'employee'
  }

  const { error } = await adminClient
    .from('profiles')
    .update({
      full_name: fullName,
      job_title: newTitle,
      birthday:  (formData.get('birthday')  as string) || null,
      address:   (formData.get('address')   as string) || null,
      phone:     (formData.get('phone')     as string) || null,
      ...(newEmail ? { email: newEmail } : {}),
      ...(newRole ? { role: newRole } : {}),
    })
    .eq('id', id)

  if (error) return { error: error.message }
  if (newRole) {
    const syncError = await syncAdminUsers(adminClient)
    if (syncError) return { error: `Gespeichert, aber die Datenbank-Freischaltliste konnte nicht aktualisiert werden: ${syncError}` }
  }
  revalidatePath(`/admin/employees/${id}`)
  revalidatePath('/admin/mitarbeiter')
  return { success: true }
}

export async function updateAccountingDetails(formData: FormData) {
  const { adminClient } = await requireAdmin()
  const id = formData.get('id') as string
  const childrenRaw = formData.get('children_count') as string

  const { error } = await adminClient
    .from('profiles')
    .update({
      ahv_nummer:     (formData.get('ahv_nummer')     as string) || null,
      children_count: childrenRaw !== '' ? parseInt(childrenRaw) : null,
      marital_status: (formData.get('marital_status') as string) || null,
    })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath(`/admin/employees/${id}`)
  return { success: true }
}

export async function updateHrDetails(formData: FormData) {
  const { adminClient } = await requireAdmin()
  const id = formData.get('id') as string
  const pensumRaw      = formData.get('pensum')        as string
  const bruttolohnRaw  = formData.get('bruttolohn_100') as string
  const monatslohnRaw  = formData.get('monatslohn')    as string
  // BVG / Pensionskasse: dieselbe Quelle wie die Lohnabrechnung (Lohn-Stammdaten)
  const bvgRaw = formData.get('bvg')
  let bvgNeu: number | null = null
  if (typeof bvgRaw === 'string' && bvgRaw.trim() !== '') {
    bvgNeu = parseFloat(bvgRaw.replace(',', '.'))
    if (!Number.isFinite(bvgNeu) || bvgNeu < 0 || bvgNeu > 20000) return { error: 'Bitte einen gültigen BVG-Abzug eingeben (CHF pro Monat).' }
  }

  const { error } = await adminClient
    .from('profiles')
    .update({
      pensum:         pensumRaw     !== '' ? parseInt(pensumRaw)        : null,
      eintrittsdatum: (formData.get('eintrittsdatum') as string) || null,
      bruttolohn_100: bruttolohnRaw !== '' ? parseFloat(bruttolohnRaw) : null,
      monatslohn:     monatslohnRaw !== '' ? parseFloat(monatslohnRaw) : null,
    })
    .eq('id', id)

  if (error) return { error: error.message }
  if (bvgNeu != null) {
    const stand = await ladeBvgStand(adminClient, id)
    if (stand.quelle == null || Math.abs(stand.betrag - bvgNeu) > 0.004) {
      const err = await schreibeBvg(adminClient, id, bvgNeu, 'hr', null)
      if (err) return { error: err }
    }
    revalidatePath('/admin/lohn')
    revalidatePath('/admin/mitarbeiter')
  }
  revalidatePath(`/admin/employees/${id}`)
  return { success: true }
}

/** Übernimmt den wirksamen Verlaufs-Eintrag (neuster mit Datum bis heute)
 *  in die aktuellen HR-Werte des Profils. Mit `nurWennEintragId` wird nur
 *  übernommen, wenn genau dieser Eintrag der wirksame ist — so verändert
 *  das Korrigieren eines alten Eintrags die aktuellen Werte nicht. */
async function syncProfilAusVerlauf(
  adminClient: Awaited<ReturnType<typeof createAdminClient>>,
  employeeId: string,
  nurWennEintragId?: string,
): Promise<{ uebernommen: boolean; wirksamAb?: string }> {
  const { data } = await adminClient
    .from('salary_history')
    .select('id, effective_date, pensum, bruttolohn_100, monatslohn, created_at')
    .eq('employee_id', employeeId)
  const eff = wirksamerEintrag((data ?? []) as VerlaufEintrag[], zurichToday())
  if (!eff) return { uebernommen: false }
  if (nurWennEintragId && eff.id !== nurWennEintragId) return { uebernommen: false }
  const patch = verlaufPatch(eff)
  if (Object.keys(patch).length === 0) return { uebernommen: false }
  const { error } = await adminClient.from('profiles').update(patch).eq('id', employeeId)
  if (error) return { uebernommen: false }
  return { uebernommen: true, wirksamAb: eff.effective_date }
}

export async function addSalaryHistoryEntry(formData: FormData) {
  const { adminClient, userId } = await requireAdmin()
  const employeeId = formData.get('employee_id') as string
  const pensumRaw     = formData.get('pensum')        as string
  const bruttolohnRaw = formData.get('bruttolohn_100') as string
  const monatslohnRaw = formData.get('monatslohn')    as string
  const effectiveDate = formData.get('effective_date') as string

  const { data: inserted, error } = await adminClient
    .from('salary_history')
    .insert({
      employee_id:    employeeId,
      effective_date: effectiveDate,
      pensum:         pensumRaw     !== '' ? parseInt(pensumRaw)        : null,
      bruttolohn_100: bruttolohnRaw !== '' ? parseFloat(bruttolohnRaw) : null,
      monatslohn:     monatslohnRaw !== '' ? parseFloat(monatslohnRaw) : null,
      notes:          (formData.get('notes') as string) || null,
      created_by:     userId,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  const sync = await syncProfilAusVerlauf(adminClient, employeeId, (inserted as { id: string } | null)?.id)
  revalidatePath(`/admin/employees/${employeeId}`)
  revalidatePath('/admin/mitarbeiter')
  return { success: true, uebernommen: sync.uebernommen, zukunft: effectiveDate > zurichToday() }
}

export async function updateSalaryHistoryEntry(formData: FormData) {
  const { adminClient } = await requireAdmin()
  const entryId       = formData.get('entry_id')       as string
  const employeeId    = formData.get('employee_id')    as string
  const pensumRaw     = formData.get('pensum')         as string
  const bruttolohnRaw = formData.get('bruttolohn_100') as string
  const monatslohnRaw = formData.get('monatslohn')     as string
  const effectiveDate = formData.get('effective_date') as string

  const { error } = await adminClient
    .from('salary_history')
    .update({
      effective_date: effectiveDate,
      pensum:         pensumRaw     !== '' ? parseInt(pensumRaw)        : null,
      bruttolohn_100: bruttolohnRaw !== '' ? parseFloat(bruttolohnRaw) : null,
      monatslohn:     monatslohnRaw !== '' ? parseFloat(monatslohnRaw) : null,
      notes:          (formData.get('notes') as string) || null,
    })
    .eq('id', entryId)

  if (error) return { error: error.message }
  const sync = await syncProfilAusVerlauf(adminClient, employeeId, entryId)
  revalidatePath(`/admin/employees/${employeeId}`)
  revalidatePath('/admin/mitarbeiter')
  return { success: true, uebernommen: sync.uebernommen, zukunft: effectiveDate > zurichToday() }
}

/** «Werte übernehmen»-Knopf: aktuelle HR-Werte bewusst auf den wirksamen
 *  Verlaufs-Eintrag setzen (z.B. nach der Abweichungs-Warnung). */
export async function applyEffectiveSalaryHistory(employeeId: string) {
  const { adminClient } = await requireAdmin()
  if (!employeeId) return { error: 'Keine Mitarbeiterin angegeben.' }
  const sync = await syncProfilAusVerlauf(adminClient, employeeId)
  if (!sync.uebernommen) return { error: 'Kein wirksamer Verlaufs-Eintrag gefunden (Einträge mit Datum in der Zukunft werden erst an ihrem Datum wirksam).' }
  revalidatePath(`/admin/employees/${employeeId}`)
  revalidatePath('/admin/mitarbeiter')
  return { success: true, wirksamAb: sync.wirksamAb }
}

export async function deleteSalaryHistoryEntry(entryId: string, employeeId: string) {
  const { adminClient } = await requireAdmin()

  const { error } = await adminClient
    .from('salary_history')
    .delete()
    .eq('id', entryId)

  if (error) return { error: error.message }
  revalidatePath(`/admin/employees/${employeeId}`)
  return { success: true }
}
