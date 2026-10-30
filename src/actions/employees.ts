'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { wirksamerEintrag, verlaufPatch, zurichToday, type VerlaufEintrag } from '@/lib/salary-sync'
import { schreibeBvg, ladeBvgStand } from '@/lib/lohn-bvg'
import { EXTERN_ANCHOR, EXTERN_KATEGORIEN, externKey, ladeExterne, istExternProfil } from '@/lib/externe'
import { GAST_ANCHOR, GAST_JOB_TITLE, gastKey } from '@/lib/gaeste'

function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  const headersList = headers()
  const host = headersList.get('x-forwarded-host') ?? headersList.get('host') ?? 'localhost:3000'
  const proto = host.startsWith('localhost') ? 'http' : 'https'
  return `${proto}://${host}`
}

/** Generates a readable temporary password, e.g. "Kc7Rm4Xp" */
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

export async function inviteEmployee(formData: FormData) {
  const { adminClient } = await requireAdmin()

  const email    = formData.get('email')    as string
  const fullName = formData.get('full_name') as string
  const jobTitle = formData.get('job_title') as string

  if (!email || !fullName) {
    return { error: 'E-Mail und Name sind erforderlich.' }
  }

  // Callback route exchanges the auth code for a session, then sends the
  // employee to the set-password page.
  const redirectTo = `${getAppUrl()}/auth/callback?next=/update-password`

  // If the user already exists in auth, a re-invite deletes the old account
  // first. That is ONLY safe for a fresh, never-used invite: deleting an
  // account with data orphans everything that hangs on its profile ID
  // (Dokumente, Arbeitsplan, Zeiten, Lohn-Stammdaten) — and deleting an
  // Admin-Konto would den Portal-Zugang zerstören. Darum harte Schutzregeln:
  const { data: { users } } = await adminClient.auth.admin.listUsers({ perPage: 1000 })
  const existing = users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (existing) {
    const { data: exProfile } = await adminClient
      .from('profiles')
      .select('id, role, is_active, full_name')
      .eq('id', existing.id)
      .maybeSingle()
    const p = exProfile as { id: string; role: string; is_active: boolean; full_name: string } | null
    if (p?.role === 'admin') {
      return { error: `Diese E-Mail gehört zum Admin-Konto «${p.full_name}» — es kann nicht durch eine Einladung ersetzt werden.` }
    }
    if (p?.is_active) {
      return { error: `Für diese E-Mail existiert bereits das aktive Konto «${p.full_name}». Bitte dort das Passwort zurücksetzen statt neu einzuladen.` }
    }
    if (p) {
      // Inaktives Konto: nur ersetzen, wenn daran keine Daten hängen —
      // sonst würden Dokumente/Zeiten/Plan an der alten ID verwaisen.
      // Aufbewahrungspflicht (10 Jahre): auch Zeiten und alle Portal-Einträge
      // (Lohn, Konto, Notizen …) zählen als Daten.
      const [{ count: docs }, { count: plan }, { count: verlauf }, { count: zeiten }, { count: eintraegeId }, { count: eintraegeName }] = await Promise.all([
        adminClient.from('documents').select('id', { count: 'exact', head: true }).eq('employee_id', p.id),
        adminClient.from('work_schedule').select('employee_id', { count: 'exact', head: true }).eq('employee_id', p.id),
        adminClient.from('salary_history').select('id', { count: 'exact', head: true }).eq('employee_id', p.id),
        adminClient.from('attendance_events').select('employee_id', { count: 'exact', head: true }).eq('employee_id', p.id),
        adminClient.from('zeiterfassung_comments').select('user_full_name', { count: 'exact', head: true }).like('user_full_name', `%${p.id}%`),
        adminClient.from('zeiterfassung_comments').select('user_full_name', { count: 'exact', head: true }).eq('user_full_name', p.full_name),
      ])
      if ((docs ?? 0) > 0 || (plan ?? 0) > 0 || (verlauf ?? 0) > 0 || (zeiten ?? 0) > 0 || (eintraegeId ?? 0) > 0 || (eintraegeName ?? 0) > 0) {
        return { error: `Das bestehende Konto «${p.full_name}» hat gespeicherte Daten (Dokumente, Plan, Zeiten oder Verlauf) und kann nicht durch eine Neu-Einladung ersetzt werden. Bitte stattdessen das Konto unter «Ehemalige Mitarbeitende» reaktivieren.` }
      }
    }
    const { error: delError } = await adminClient.auth.admin.deleteUser(existing.id)
    if (delError) return { error: `Bestehendes (ungenutztes) Konto konnte nicht entfernt werden: ${delError.message}` }
  }

  // Try to send the invitation email first.
  // If email delivery fails (e.g. Supabase free-tier rate limit, SMTP not configured),
  // fall back to creating the account with a one-time temporary password that the
  // admin can share with the employee via WhatsApp or in person.
  let authUserId: string
  let tempPassword: string | undefined

  const { data: inviteData, error: inviteError } =
    await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo,
    })

  if (inviteError) {
    // Email failed — create the account with a temp password instead.
    tempPassword = generateTempPassword()
    const { data: createData, error: createError } =
      await adminClient.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,           // mark email as verified so they can log in immediately
        user_metadata: { full_name: fullName },
      })
    if (createError) return { error: createError.message }
    authUserId = createData.user.id
  } else {
    authUserId = inviteData.user.id
  }

  const { error: profileError } = await adminClient
    .from('profiles')
    .upsert({
      id: authUserId,
      full_name: fullName,
      email,
      role: 'employee',
      job_title: jobTitle || null,
      is_active: true,
    }, { onConflict: 'id' })

  if (profileError) return { error: profileError.message }

  revalidatePath('/admin/mitarbeiter')
  revalidatePath('/admin/arbeitsplan')
  revalidatePath('/employee/arbeitsplan')
  return { success: true, tempPassword }
}

/** Externe Person (selbständig) manuell anlegen: ohne Einladungs-E-Mail.
 *  Mit E-Mail entsteht ein Konto mit Einmalpasswort (Portal-Zugang zum
 *  Beispiel für den Arbeitsplan), ohne E-Mail ein reiner Eintrag ohne
 *  Login. Die Kategorie (ZAZ, DA …) gilt wie bei Angestellten, zusätzlich
 *  wird die Markierung «Extern» gesetzt. */
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
    const { data: { users } } = await adminClient.auth.admin.listUsers({ perPage: 1000 })
    if (users.some(u => u.email?.toLowerCase() === emailRaw)) return { error: 'Für diese E-Mail-Adresse existiert bereits ein Konto.' }
  }

  const ohneLogin = !emailRaw
  const slug = fullName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'extern'
  const email = emailRaw || `extern-${slug}-${Date.now().toString(36)}@kein-login.invalid`
  const tempPassword = generateTempPassword()
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password: ohneLogin ? `${generateTempPassword()}${generateTempPassword()}` : tempPassword,
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

/** Gastkonto für ein Teamevent (z. B. Odette): Rolle employee, Kategorie
 *  «Gast», eigenes Login mit Einmalpasswort. Gäste sehen nur den Ordner
 *  Teamevents und erscheinen in keiner Liste des Portals. */
export async function createGastAccount(formData: FormData) {
  const { adminClient, userId } = await requireAdmin()
  const fullName = ((formData.get('full_name') as string) ?? '').replace(/\s+/g, ' ').trim()
  const email = ((formData.get('email') as string) ?? '').trim().toLowerCase()
  if (fullName.length < 3) return { error: 'Bitte den vollständigen Namen eingeben.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Bitte eine gültige E-Mail-Adresse eingeben.' }
  const { data: gleich } = await adminClient.from('profiles').select('id, is_active').ilike('full_name', fullName).maybeSingle()
  if (gleich) return { error: `«${fullName}» gibt es schon.` }
  const { data: { users } } = await adminClient.auth.admin.listUsers({ perPage: 1000 })
  if (users.some(u => u.email?.toLowerCase() === email)) return { error: 'Für diese E-Mail-Adresse existiert bereits ein Konto.' }
  const tempPassword = generateTempPassword()
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email, password: tempPassword, email_confirm: true, user_metadata: { full_name: fullName },
  })
  if (createError) return { error: createError.message }
  const id = created.user.id
  const { error: profileError } = await adminClient
    .from('profiles')
    .upsert({ id, full_name: fullName, email, role: 'employee', job_title: GAST_JOB_TITLE, is_active: true }, { onConflict: 'id' })
  if (profileError) return { error: profileError.message }
  const am = new Date().toISOString()
  await adminClient.from('zeiterfassung_comments').upsert(
    { user_full_name: gastKey(id), schedule_date: GAST_ANCHOR, comment: JSON.stringify({ seit: am, von: userId }), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  revalidatePath('/admin/mitarbeiter')
  return { success: true, id, tempPassword }
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

  if (!grant) {
    if (employeeId === userId) {
      return { error: 'Der eigene Admin-Zugriff kann nicht entzogen werden.' }
    }
    const { count } = await adminClient
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
    if ((count ?? 0) <= 1) {
      return { error: 'Der letzte Admin-Zugriff kann nicht entzogen werden.' }
    }
  }

  const { error } = await adminClient
    .from('profiles')
    .update(grant ? { role: 'admin', job_title: 'Admin' } : { role: 'employee' })
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
  const { adminClient } = await requireAdmin()
  const id = formData.get('id') as string

  // Login e-mail: lives in Supabase AUTH, not only in the profile — a changed
  // address must be written there too, otherwise the login keeps the old one.
  // The password is a separate credential and stays untouched.
  const newEmail = ((formData.get('email') as string) ?? '').trim().toLowerCase()
  if (newEmail) {
    const { data: current } = await adminClient
      .from('profiles').select('email').eq('id', id).single()
    const oldEmail = ((current as { email?: string } | null)?.email ?? '').toLowerCase()
    if (newEmail !== oldEmail) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return { error: 'Bitte eine gültige E-Mail-Adresse eingeben.' }
      }
      const { error: authErr } = await adminClient.auth.admin.updateUserById(id, {
        email: newEmail,
        email_confirm: true,   // no confirmation mail — login works immediately
      })
      if (authErr) {
        return { error: `Login-E-Mail konnte nicht geändert werden: ${authErr.message}` }
      }
    }
  }

  const { error } = await adminClient
    .from('profiles')
    .update({
      full_name: formData.get('full_name') as string,
      job_title: (formData.get('job_title') as string) || null,
      birthday:  (formData.get('birthday')  as string) || null,
      address:   (formData.get('address')   as string) || null,
      phone:     (formData.get('phone')     as string) || null,
      ...(newEmail ? { email: newEmail } : {}),
    })
    .eq('id', id)

  if (error) return { error: error.message }
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
