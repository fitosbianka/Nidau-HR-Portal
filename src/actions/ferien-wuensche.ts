'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { FERIEN_EDITORS } from '@/lib/leitende'
import {
  WUNSCH_PREFIX, PHASEN_KEY, PLAN_YEAR,
  weekdaysBetween, phaseKeyForTitle, phaseStateFor, zurichNow,
  normalizeWunschArt, wunschArtCode, normalizeWunschPrio, sauberTage,
  type FerienWunsch, type PhasenDeadlines, type WunschArt, type WunschPrio,
} from '@/lib/ferien-wuensche'
import { getPhasenDeadlines } from '@/lib/ferien-reminder'
import { ferienTage } from '@/lib/ferien-eintrag'
import { wochenTeile } from '@/lib/ferien-wochen'
import { loescheVertretung, schreibeVertretung } from '@/lib/ferien-vertretung-db'

/** Admins — plus designated Ferien editors (e.g. Laura) — manage wishes. */
async function requireFerienEditor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (p?.role !== 'admin' && !FERIEN_EDITORS.includes(p?.full_name ?? '')) throw new Error('Keine Berechtigung')
  return { admin: await createAdminClient(), editorName: p?.full_name ?? 'Admin', isAdmin: p?.role === 'admin', userId: user.id }
}

const wunschKey = (employeeId: string) => `${WUNSCH_PREFIX}${employeeId}`

function revalidateAll() {
  for (const p of [
    '/admin/zeiterfassung/ferien/planung', '/employee/team/ferien', '/employee/ferien',
    '/admin/arbeitsplan', '/employee/arbeitsplan',
    '/admin/zeiterfassung/konto', '/employee/team/konto',
  ]) revalidatePath(p)
}

function validateRange(from: string, to: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return 'Bitte ein gültiges Datum wählen.'
  if (to < from) return 'Das End-Datum liegt vor dem Start-Datum.'
  if (to < `${PLAN_YEAR}-01-01` || from > `${PLAN_YEAR}-12-31`) return `Der Zeitraum muss im Planungsjahr ${PLAN_YEAR} liegen.`
  if (weekdaysBetween(from, to).length === 0) return 'Keine Arbeitstage (Mo–Fr) im gewählten Zeitraum.'
  return null
}

async function loadWunsch(admin: SupabaseClient, employeeId: string, from: string) {
  const { data } = await admin.from('zeiterfassung_comments')
    .select('comment')
    .eq('user_full_name', wunschKey(employeeId))
    .eq('schedule_date', from)
    .maybeSingle()
  if (!data) return null
  try { return JSON.parse((data as { comment: string }).comment) as Omit<FerienWunsch, 'employeeId' | 'from'> } catch { return null }
}

async function saveWunschRow(admin: SupabaseClient, employeeId: string, from: string, meta: Omit<FerienWunsch, 'employeeId' | 'from'>) {
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    {
      user_full_name: wunschKey(employeeId),
      schedule_date: from,
      comment: JSON.stringify(meta),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error?.message ?? null
}

/** Write the accepted days into work_schedule — the code depends on the
 *  Wunsch-Art: F, UF or WB. Ferien ab 2027 nur an Arbeitstagen ohne
 *  Feiertage und tagesgenau: sind Tage gewählt, nur diese (je ein F). */
async function writeFerienDays(admin: SupabaseClient, employeeId: string, from: string, to: string, art: WunschArt, gewaehlt?: string[] | null) {
  const code = wunschArtCode(art)
  let tage = art === 'ferien' ? ferienTage(from, to) : weekdaysBetween(from, to)
  if (art === 'ferien' && gewaehlt && gewaehlt.length > 0) { const erlaubt = new Set(tage); tage = gewaehlt.filter(d => erlaubt.has(d)) }
  if (tage.length === 0) return null
  const rows = tage.map(d => ({ employee_id: employeeId, schedule_date: d, entry: code }))
  const { error } = await admin.from('work_schedule').upsert(rows, { onConflict: 'employee_id,schedule_date' })
  return error?.message ?? null
}

/** Gewählte Tage eines Wunsches auf einen Zeitraum eingrenzen; leer → null (ganzer Zeitraum). */
function tageImBereich(tage: string[] | null | undefined, from: string, to: string): string[] | null {
  const t = (tage ?? []).filter(d => d >= from && d <= to)
  return t.length > 0 ? t : null
}

/** Remove this Art's entries for the range (leaves other codes untouched). */
async function removeFerienDays(admin: SupabaseClient, employeeId: string, from: string, to: string, art: WunschArt) {
  let q = admin.from('work_schedule').delete()
    .eq('employee_id', employeeId)
    .gte('schedule_date', from)
    .lte('schedule_date', to)
  q = art === 'ferien' ? q.or('entry.eq.F,entry.like.F:*') : q.eq('entry', wunschArtCode(art))
  const { error } = await q
  return error?.message ?? null
}

/** Register a new vacation wish. `createdAt` = now (first come, first served). */
export async function createWunsch(employeeId: string, from: string, to: string, art: WunschArt = 'ferien', prio: WunschPrio = 3, vertretung?: string | null, vertretungTage?: string[] | null, bemerkung?: string | null) {
  const { admin } = await requireFerienEditor()
  if (!employeeId) return { error: 'Bitte eine Mitarbeiterin wählen.' }
  const bad = validateRange(from, to)
  if (bad) return { error: bad }
  // Pro Kalenderwoche ein Eintrag, damit jede Woche einzeln akzeptiert werden kann
  const teile = wochenTeile(from, to)
  for (const t of teile) {
    if (await loadWunsch(admin, employeeId, t.from)) return { error: `Für diese Mitarbeiterin existiert bereits ein Wunsch mit dem Startdatum ${t.from.slice(8, 10)}.${t.from.slice(5, 7)}.` }
  }
  const createdAt = new Date().toISOString()
  const gruppe = teile.length > 1 ? `wn-${Date.now().toString(36)}` : null
  const vt = sauberTage(vertretungTage)
  for (const t of teile) {
    const err = await saveWunschRow(admin, employeeId, t.from, {
      to: t.to, art: normalizeWunschArt(art), prio: normalizeWunschPrio(prio), status: 'offen', createdAt,
      vertretung: (vertretung ?? '').trim() || null,
      vertretungTage: vt ? (vt.filter(d => d >= t.from && d <= t.to).length > 0 ? vt.filter(d => d >= t.from && d <= t.to) : null) : null,
      bemerkung: (bemerkung ?? '').trim().slice(0, 500) || null,
      // keine Tagesauswahl: zählt nach Pensum (Teilzeit 40 Prozent = 2 Tage pro Woche)
      tage: null,
      gruppe,
    })
    if (err) return { error: err }
  }
  revalidateAll()
  return { success: true, teile: teile.length }
}

type WunschMeta = Omit<FerienWunsch, 'employeeId' | 'from'>

/** Einen offenen Wunsch über mehrere Wochen in eine Zeile pro Woche
 *  aufteilen (gemeinsame Gruppe), damit jede Woche einzeln akzeptiert oder
 *  abgelehnt werden kann. Gewählte Tage und Vertretungstage werden auf die
 *  Wochen verteilt. */
async function teileWunschAuf(admin: SupabaseClient, employeeId: string, from: string, meta: WunschMeta): Promise<{ error: string } | { teile: number }> {
  if (meta.status !== 'offen') return { error: 'Nur offene Wünsche lassen sich aufteilen.' }
  const teile = wochenTeile(from, meta.to)
  if (teile.length === 0) return { error: 'Dieser Wunsch enthält keine Arbeitstage (Mo–Fr).' }
  if (teile.length < 2) return { error: 'Dieser Wunsch liegt in einer einzigen Woche.' }
  for (const t of teile) {
    if (t.from !== from && (await loadWunsch(admin, employeeId, t.from))) return { error: `Es gibt schon einen anderen Wunsch mit dem Startdatum ${t.from.slice(8, 10)}.${t.from.slice(5, 7)}. Bitte zuerst diesen löschen oder bearbeiten.` }
  }
  const gruppe = typeof meta.gruppe === 'string' && meta.gruppe ? meta.gruppe : `wn-${Date.now().toString(36)}`
  const alteTage = sauberTage(meta.tage)
  const vt = sauberTage(meta.vertretungTage)
  for (const t of teile) {
    // ohne Tagesauswahl bleibt jede Woche ohne Tagesauswahl (zählt nach Pensum)
    const tage = alteTage ? alteTage.filter(d => d >= t.from && d <= t.to) : []
    const err = await saveWunschRow(admin, employeeId, t.from, {
      ...meta, to: t.to, gruppe, decidedAt: null, decidedBy: null, grund: null,
      tage: normalizeWunschArt(meta.art) === 'ferien' && tage.length > 0 ? tage : null,
      vertretungTage: vt ? (vt.filter(d => d >= t.from && d <= t.to).length > 0 ? vt.filter(d => d >= t.from && d <= t.to) : null) : null,
    })
    if (err) return { error: err }
  }
  // Beginnt der Wunsch an einem Wochenende, liegt sein Schlüssel auf keinem
  // Teil: die alte Zeile entfernen, sonst bliebe der ungeteilte Wunsch neben
  // den einzelnen Wochen offen stehen.
  if (!teile.some(t => t.from === from)) {
    const { error } = await admin.from('zeiterfassung_comments').delete()
      .eq('user_full_name', wunschKey(employeeId)).eq('schedule_date', from)
    if (error) return { error: error.message }
  }
  return { teile: teile.length }
}

export async function wunschAufteilen(employeeId: string, from: string) {
  const { admin } = await requireFerienEditor()
  const meta = await loadWunsch(admin, employeeId, from)
  if (!meta) return { error: 'Wunsch nicht gefunden.' }
  const r = await teileWunschAuf(admin, employeeId, from, meta)
  if ('error' in r) return r
  revalidateAll()
  return { success: true, teile: r.teile }
}

/** Eine Woche eines Wunsches in einem Schritt entscheiden: liegt der Wunsch
 *  noch ungeteilt über mehrere Wochen, wird er zuerst in Wochen aufgeteilt,
 *  dann wird nur die Woche mit Start «teilFrom» akzeptiert (Tage in den
 *  Arbeitsplan) oder abgelehnt. Die übrigen Wochen bleiben offen. */
export async function wunschWocheEntscheiden(employeeId: string, from: string, teilFrom: string, aktion: 'akzeptieren' | 'ablehnen', grund?: string | null, vertretung?: string | null, vertretungTage?: string[] | null) {
  const { admin, editorName } = await requireFerienEditor()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(teilFrom)) return { error: 'Ungültige Angaben.' }
  const ganz = await loadWunsch(admin, employeeId, from)
  if (ganz && ganz.status === 'offen' && wochenTeile(from, ganz.to).length > 1) {
    if (teilFrom < from || teilFrom > ganz.to) return { error: 'Diese Woche gehört nicht zu diesem Wunsch.' }
    const r = await teileWunschAuf(admin, employeeId, from, ganz)
    if ('error' in r) return r
  }
  const meta = await loadWunsch(admin, employeeId, teilFrom)
  if (!meta) { revalidateAll(); return { error: 'Diese Woche wurde nicht gefunden, die Anzeige war nicht mehr aktuell. Bitte die Seite neu laden.' } }
  if (aktion === 'akzeptieren') {
    const r = await akzeptiere(admin, editorName, employeeId, teilFrom, meta, vertretung, vertretungTage)
    if ('error' in r) return r
  } else {
    if (meta.status === 'akzeptiert') {
      const remErr = await removeFerienDays(admin, employeeId, teilFrom, meta.to, normalizeWunschArt(meta.art))
      if (remErr) return { error: remErr }
      await loescheVertretung(admin, employeeId, teilFrom, meta.to)
    }
    const err = await saveWunschRow(admin, employeeId, teilFrom, {
      ...meta, status: 'abgelehnt', decidedAt: new Date().toISOString(), decidedBy: editorName, grund: (grund ?? '').trim().slice(0, 300) || null,
    })
    if (err) return { error: err }
  }
  revalidateAll()
  return { success: true }
}

/** Edit / prolong a wish (also allowed after acceptance — the planned «F»
 *  days in the Arbeitsplan are rewritten to the new range). */
export async function updateWunsch(employeeId: string, oldFrom: string, from: string, to: string, art?: WunschArt, prio?: WunschPrio, vertretung?: string | null, vertretungTage?: string[] | null, bemerkung?: string | null) {
  const { admin, isAdmin, userId } = await requireFerienEditor()
  const bad = validateRange(from, to)
  if (bad) return { error: bad }
  const meta = await loadWunsch(admin, employeeId, oldFrom)
  if (!meta) return { error: 'Wunsch nicht gefunden.' }
  if (from !== oldFrom && await loadWunsch(admin, employeeId, from)) {
    return { error: 'Für diese Mitarbeiterin existiert bereits ein Wunsch mit diesem Startdatum.' }
  }
  const oldArt = normalizeWunschArt(meta.art)
  let newArt = art != null ? normalizeWunschArt(art) : oldArt
  // Fremde UF-Wünsche sind für Nicht-Admins maskiert (erscheinen als Ferien).
  // Ein Speichern der maskierten Ansicht darf die echte Art nie auf «bezahlt»
  // umstellen — sonst würde unbezahlter Urlaub still zu bezahlten Ferien.
  if (oldArt === 'unbezahlt' && !isAdmin && employeeId !== userId) newArt = oldArt
  // Vertretung (nur ZAZ): nicht übergeben = unverändert, leer = entfernen
  const alteVertretung = typeof meta.vertretung === 'string' && meta.vertretung.trim() ? meta.vertretung.trim() : null
  const neueVertretung = vertretung === undefined ? alteVertretung : ((vertretung ?? '').trim() || null)
  const neueTage = neueVertretung ? (vertretungTage === undefined ? sauberTage(meta.vertretungTage) : sauberTage(vertretungTage)) : null

  if (meta.status === 'akzeptiert') {
    const remErr = await removeFerienDays(admin, employeeId, oldFrom, meta.to, oldArt)
    if (remErr) return { error: remErr }
    await loescheVertretung(admin, employeeId, oldFrom, meta.to)
  }
  if (from !== oldFrom) {
    await admin.from('zeiterfassung_comments').delete()
      .eq('user_full_name', wunschKey(employeeId)).eq('schedule_date', oldFrom)
  }
  const neueBemerkung = bemerkung === undefined ? (typeof meta.bemerkung === 'string' ? meta.bemerkung : null) : ((bemerkung ?? '').trim().slice(0, 500) || null)
  // gewählte Tage: bei gleichem Zeitraum unverändert, sonst auf den neuen Zeitraum eingegrenzt
  const gewaehlteTage = from === meta.to && to === meta.to ? sauberTage(meta.tage) : tageImBereich(sauberTage(meta.tage), from, to)
  const err = await saveWunschRow(admin, employeeId, from, { ...meta, to, art: newArt, prio: prio != null ? normalizeWunschPrio(prio) : normalizeWunschPrio(meta.prio), vertretung: neueVertretung, vertretungTage: neueTage, bemerkung: neueBemerkung, tage: gewaehlteTage })
  if (err) return { error: err }
  if (meta.status === 'akzeptiert') {
    const addErr = await writeFerienDays(admin, employeeId, from, to, newArt, gewaehlteTage)
    if (addErr) return { error: addErr }
    // Vertretung zieht mit dem neuen Zeitraum mit
    await schreibeVertretung(admin, employeeId, weekdaysBetween(from, to), neueVertretung, neueTage)
  }
  revalidateAll()
  return { success: true }
}

/** Accept a wish: mark it and enter the days with the Art's code (F/UF/WB)
 *  in the Arbeitsplan. `vertretung` (nur ZAZ): Ferienvertretung für die Tage. */
/** Wunsch akzeptieren: Tage in den Arbeitsplan, Vertretung speichern, Status setzen. */
async function akzeptiere(admin: SupabaseClient, editorName: string, employeeId: string, from: string, meta: WunschMeta, vertretung?: string | null, vertretungTage?: string[] | null): Promise<{ error: string } | { days: number }> {
  const days = weekdaysBetween(from, meta.to).length
  if (meta.status === 'akzeptiert') return { days }
  const addErr = await writeFerienDays(admin, employeeId, from, meta.to, normalizeWunschArt(meta.art), sauberTage(meta.tage))
  if (addErr) return { error: addErr }
  // ohne Angabe gilt die beim Erfassen hinterlegte Vertretung; eine leere Angabe entfernt sie
  const vName = (vertretung === undefined ? (typeof meta.vertretung === 'string' ? meta.vertretung : '') : (vertretung ?? '')).trim() || null
  const vTage = vName ? (vertretungTage === undefined ? sauberTage(meta.vertretungTage) : sauberTage(vertretungTage)) : null
  if (vName) {
    const vErr = await schreibeVertretung(admin, employeeId, weekdaysBetween(from, meta.to), vName, vTage)
    if (vErr) return { error: `Tage eingetragen, aber die Vertretung konnte nicht gespeichert werden: ${vErr}` }
  }
  const err = await saveWunschRow(admin, employeeId, from, {
    ...meta, status: 'akzeptiert', decidedAt: new Date().toISOString(), decidedBy: editorName, vertretung: vName, vertretungTage: vTage, grund: null,
  })
  if (err) return { error: err }
  return { days }
}

export async function acceptWunsch(employeeId: string, from: string, vertretung?: string | null, vertretungTage?: string[] | null) {
  const { admin, editorName } = await requireFerienEditor()
  const meta = await loadWunsch(admin, employeeId, from)
  if (!meta) return { error: 'Wunsch nicht gefunden.' }
  const r = await akzeptiere(admin, editorName, employeeId, from, meta, vertretung, vertretungTage)
  if ('error' in r) return r
  revalidateAll()
  return { success: true, days: r.days }
}

/** Delete a wish. If it was accepted, its «F» days are removed as well. */
export async function deleteWunsch(employeeId: string, from: string) {
  const { admin } = await requireFerienEditor()
  const meta = await loadWunsch(admin, employeeId, from)
  if (!meta) return { error: 'Wunsch nicht gefunden.' }
  if (meta.status === 'akzeptiert') {
    const remErr = await removeFerienDays(admin, employeeId, from, meta.to, normalizeWunschArt(meta.art))
    if (remErr) return { error: remErr }
    await loescheVertretung(admin, employeeId, from, meta.to)
  }
  const { error } = await admin.from('zeiterfassung_comments').delete()
    .eq('user_full_name', wunschKey(employeeId)).eq('schedule_date', from)
  if (error) return { error: error.message }
  revalidateAll()
  return { success: true }
}

/** A signed-in employee registers a vacation wish for THEMSELVES.
 *  Allowed only while their group's phase is ACTIVE (opened and deadline
 *  not passed); before the opening and after the deadline only Admin and
 *  the Ferien editors may change anything.
 *  Mitarbeiter reichen ausschliesslich FERIEN-Wünsche ein — unbezahlte
 *  Ferien und Weiterbildung erfassen nur Laura/Bianka (createWunsch);
 *  die Art ist deshalb serverseitig fest 'ferien'. */
export async function createOwnWunsch(from: string, to: string, prio: WunschPrio = 3, bemerkung?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Nicht angemeldet.' }
  const { data: profile } = await supabase.from('profiles').select('id, full_name, job_title').eq('id', user.id).single()
  const p = profile as { id: string; full_name: string; job_title: string | null } | null
  if (!p) return { error: 'Profil konnte nicht geladen werden.' }

  const bad = validateRange(from, to)
  if (bad) return { error: bad }

  const admin = await createAdminClient()

  // Phase state of the user's group (editors are exempt — they plan directly).
  // Minutengenau: die Eingabe öffnet am Starttag um 06:00 und schliesst am
  // Fristtag um 23:55 (Europe/Zurich).
  if (!FERIEN_EDITORS.includes(p.full_name)) {
    const phasen = await getPhasenDeadlines(admin)
    const state = phaseStateFor(phasen, phaseKeyForTitle(p.job_title), zurichNow())
    if (state === 'abgeschlossen') {
      return { error: 'Die Eingabefrist für deine Gruppe ist abgelaufen (Fristtag 23:55). Bitte melde dich bei der Praxisleitung.' }
    }
    if (state !== 'aktiv') {
      return { error: `Die Ferienplanung ${PLAN_YEAR} ist für deine Gruppe noch nicht eröffnet — die Eingabe startet am Starttag deiner Gruppe um 06:00 Uhr.` }
    }
  }

  // Pro Kalenderwoche ein Eintrag, damit die Praxisleitung jede Woche einzeln entscheiden können
  const teile = wochenTeile(from, to)
  for (const t of teile) {
    if (await loadWunsch(admin, p.id, t.from)) return { error: `Du hast bereits einen Wunsch mit dem Startdatum ${t.from.slice(8, 10)}.${t.from.slice(5, 7)}.` }
  }
  const createdAt = new Date().toISOString()
  const gruppe = teile.length > 1 ? `wn-${Date.now().toString(36)}` : null
  for (const t of teile) {
    const err = await saveWunschRow(admin, p.id, t.from, { to: t.to, art: 'ferien', prio: normalizeWunschPrio(prio), status: 'offen', createdAt, bemerkung: (bemerkung ?? '').trim().slice(0, 500) || null, tage: null, gruppe })
    if (err) return { error: err }
  }
  revalidateAll()
  return { success: true, teile: teile.length }
}

/** A signed-in employee withdraws their OWN still-open wish. */
export async function deleteOwnWunsch(from: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Nicht angemeldet.' }

  const admin = await createAdminClient()
  const meta = await loadWunsch(admin, user.id, from)
  if (!meta) return { error: 'Wunsch nicht gefunden.' }
  if (meta.status !== 'offen') {
    return { error: 'Dieser Wunsch wurde bereits akzeptiert. Bitte melde dich bei der Praxisleitung.' }
  }
  const { error } = await admin.from('zeiterfassung_comments').delete()
    .eq('user_full_name', wunschKey(user.id)).eq('schedule_date', from)
  if (error) return { error: error.message }
  revalidateAll()
  return { success: true }
}

/** Save the three phase deadlines (Zahnärzte → DH/PA → DA) — je Phase
 *  optional mit explizitem Startdatum (ersetzt die Öffnungs-Kaskade). */
export async function savePhasen(deadlines: PhasenDeadlines) {
  const { admin } = await requireFerienEditor()
  const felder = [
    deadlines.zahnaerzte, deadlines.dhpa, deadlines.da,
    deadlines.zahnaerzteStart, deadlines.dhpaStart, deadlines.daStart,
  ]
  for (const v of felder) {
    if (v != null && v !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: 'Bitte gültige Daten wählen.' }
  }
  const clean: PhasenDeadlines = {
    zahnaerzte: deadlines.zahnaerzte || null,
    dhpa: deadlines.dhpa || null,
    da: deadlines.da || null,
    zahnaerzteStart: deadlines.zahnaerzteStart || null,
    dhpaStart: deadlines.dhpaStart || null,
    daStart: deadlines.daStart || null,
  }
  for (const [start, ende, label] of [
    [clean.zahnaerzteStart, clean.zahnaerzte, 'Zahnärzte/-innen'],
    [clean.dhpaStart, clean.dhpa, 'DH / PA'],
    [clean.daStart, clean.da, 'DA'],
  ] as const) {
    if (start && ende && start > ende) return { error: `${label}: Das Startdatum liegt nach der Frist.` }
    if (start && !ende) return { error: `${label}: Bitte zum Startdatum auch eine Frist setzen.` }
  }
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    {
      user_full_name: PHASEN_KEY,
      schedule_date: `${PLAN_YEAR}-01-01`,
      comment: JSON.stringify(clean),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  revalidateAll()
  return { success: true }
}
