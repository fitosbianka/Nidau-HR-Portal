'use server'

// Lohnabrechnungen: admin-only actions (Stammdaten, Sätze, Abrechnungen).
// Storage: reserved zeiterfassung_comments rows — see src/lib/lohn.ts.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { schreibeBvg, ladeBvgStand } from '@/lib/lohn-bvg'
import { revalidatePath } from 'next/cache'
import {
  LOHN_STAMM_PREFIX, LOHN_SAETZE_KEY, LOHN_ABR_PREFIX, lohnSeedFor,
  type LohnStamm, type LohnSaetze, type LohnAbrechnung,
  sauberManuell,
} from '@/lib/lohn'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase
    .from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (p?.role !== 'admin') throw new Error('Keine Berechtigung')
  return { admin: await createAdminClient(), adminName: p.full_name }
}

const revalidate = () => revalidatePath('/admin/lohn')

const MONAT_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const escLike = (x: string) => x.replace(/_/g, '\\_')

/** BVG-/PK-Abzug aus einer gespeicherten Abrechnung als gültigen Wert in
 *  die Stammdaten übernehmen (eine Quelle für HR-Seite und Lohn): nur wenn
 *  die Abrechnung der NEUSTE Monat der Person ist und einen Abzug > 0 trägt
 *  (Umsatz-/Bonusabrechnungen ohne PK lassen den Wert unberührt). */
async function uebernimmPkAbzug(admin: SupabaseClient, profileId: string, pkAbzug: number, monat: string): Promise<void> {
  const neu = Math.round(pkAbzug * 100) / 100
  if (!(neu > 0) || neu > 20000) return
  const { data: abrRows } = await admin.from('zeiterfassung_comments')
    .select('schedule_date')
    .like('user_full_name', `${escLike(LOHN_ABR_PREFIX)}${profileId}\\_%`)
  const neuester = ((abrRows ?? []) as Array<{ schedule_date: string }>)
    .map(r => r.schedule_date.slice(0, 7)).sort().pop() ?? monat
  if (monat < neuester) return
  const stand = await ladeBvgStand(admin, profileId)
  if (stand.quelle && Math.abs(stand.betrag - neu) < 0.005) return
  await schreibeBvg(admin, profileId, neu, 'abrechnung', monat)
}

/** BVG-Abzug von der HR-Seite oder einem anderen Ort aus setzen — gilt
 *  sofort als Vorbelegung für neue Lohnabrechnungen. */
export async function saveBvg(profileId: string, betrag: number) {
  const { admin } = await requireAdmin()
  if (!profileId) return { error: 'Keine Mitarbeiterin gewählt.' }
  const err = await schreibeBvg(admin, profileId, betrag, 'hr', null)
  if (err) return { error: err }
  revalidate()
  revalidatePath(`/admin/employees/${profileId}`)
  revalidatePath('/admin/mitarbeiter')
  return { success: true }
}

const ID_RE = /^[a-z0-9]{6,20}$/

function cleanPos(list: Array<{ label: string; betrag: number; frei?: boolean; manuell?: boolean }>, max = 12) {
  return list
    // Betrag 0 fällt weg — AUSSER bei der Lohnpfändungszeile: die wird auch
    // mit 0.00 ausgewiesen (Netto unter Existenzminimum, R6.6) statt zu fehlen
    .filter(l => l.label.trim() && Number.isFinite(l.betrag) && (l.betrag !== 0 || l.label.startsWith('Lohnpfändung')))
    .slice(0, max)
    .map(l => ({
      label: l.label.trim().slice(0, 160),
      betrag: Math.round(l.betrag * 10000) / 10000,
      // frei = Taggeld-Ersatz, nicht abzugspflichtig (R4.2) — MUSS erhalten
      // bleiben, sonst rechnen die Abzüge nach dem Speichern auf dem vollen Brutto
      ...(l.frei ? { frei: true } : {}),
      // manuell = Betrag von Hand überschrieben, wird nie automatisch angepasst
      ...(l.manuell ? { manuell: true } : {}),
    }))
}

export async function saveLohnStamm(profileId: string, stamm: LohnStamm) {
  const { admin } = await requireAdmin()
  if (!profileId) return { error: 'Keine Mitarbeiterin gewählt.' }
  if (!(stamm.pkAbzug >= 0) || stamm.pkAbzug > 20000) return { error: 'Bitte einen gültigen PK-Abzug eingeben.' }
  if (stamm.monatslohn != null && !(stamm.monatslohn > 0 && stamm.monatslohn < 100000)) return { error: 'Bitte einen gültigen Monatslohn eingeben.' }
  if (stamm.qstSatz != null && !(stamm.qstSatz > 0 && stamm.qstSatz < 50)) return { error: 'Bitte einen gültigen Quellensteuer-Satz eingeben.' }
  if (stamm.stundensatz != null && !(stamm.stundensatz > 0 && stamm.stundensatz < 500)) return { error: 'Bitte einen gültigen Stundensatz eingeben.' }
  if (stamm.umsatzsatz != null && !(stamm.umsatzsatz > 0 && stamm.umsatzsatz < 1)) return { error: 'Die Umsatzbeteiligung als Anteil eingeben (z.B. 0.4).' }
  if (stamm.akontoBetrag != null && !(stamm.akontoBetrag > 0 && stamm.akontoBetrag < 100000)) return { error: 'Bitte einen gültigen Akontolohn eingeben.' }

  const { error } = await admin.from('zeiterfassung_comments').upsert(
    {
      user_full_name: `${LOHN_STAMM_PREFIX}${profileId}`,
      schedule_date: '1970-01-01',
      comment: JSON.stringify({
        art: stamm.art,
        dreizehnter: !!stamm.dreizehnter,
        monatslohn: stamm.monatslohn,
        stundensatz: stamm.stundensatz,
        grundlohn: stamm.grundlohn,
        ferienAufGrundlohn: stamm.ferienAufGrundlohn !== false,
        umsatzsatz: stamm.umsatzsatz,
        umsatzPeriode: stamm.umsatzPeriode,
        akontoBetrag: stamm.akontoBetrag,
        ahv: !!stamm.ahv, alv: !!stamm.alv, nbu: !!stamm.nbu,
        ktg: stamm.ktg,
        pkAbzug: Math.round(stamm.pkAbzug * 100) / 100,
        // Stammdaten-Speichern bestätigt den BVG-Abzug ausdrücklich
        pkAbzugStand: { quelle: 'stammdaten', monat: null, am: new Date().toISOString() },
        qstTarif: stamm.qstTarif?.trim() || null,
        qstSatz: stamm.qstSatz,
        zulagen: (stamm.zulagen ?? []).filter(z => z.name.trim()).slice(0, 8)
          .map(z => ({ name: z.name.trim().slice(0, 60), typ: z.typ === 'ausbildung' ? 'ausbildung' : 'kind' })),
        zuschlaege: (stamm.zuschlaege ?? [])
          .filter(z => z.label.trim() && Number.isFinite(z.betrag) && z.betrag !== 0).slice(0, 6)
          .map(z => ({ label: z.label.trim().slice(0, 80), betrag: Math.round(z.betrag * 100) / 100 })),
        nachZeilen: (stamm.nachZeilen ?? [])
          .filter(z => z.label.trim() && Number.isFinite(z.betrag) && z.betrag !== 0).slice(0, 6)
          .map(z => ({ label: z.label.trim().slice(0, 80), betrag: Math.round(z.betrag * 100) / 100 })),
        // Regelwerk Krankheit/Unfall: KTG-Klausel (R3.7) und Lohnpfändung (R5)
        ktgKlausel: stamm.ktgKlausel !== false,
        pfaendungArt: stamm.pfaendungArt === 'betrag' || stamm.pfaendungArt === 'quote' ? stamm.pfaendungArt : 'keine',
        pfaendungBetrag: stamm.pfaendungBetrag != null && stamm.pfaendungBetrag >= 0 ? Math.round(stamm.pfaendungBetrag * 100) / 100 : null,
        pfaendungExistenzminimum: stamm.pfaendungExistenzminimum != null && stamm.pfaendungExistenzminimum >= 0 ? Math.round(stamm.pfaendungExistenzminimum * 100) / 100 : null,
        notiz: stamm.notiz?.trim() || null,
      }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  revalidate()
  return { success: true }
}

export async function saveLohnSaetze(saetze: LohnSaetze) {
  const { admin } = await requireAdmin()
  const jahr = Math.round(saetze.jahr)
  if (!(jahr >= 2024 && jahr <= 2099)) return { error: 'Ungültiges Jahr.' }
  for (const key of ['ahv', 'alv', 'nbu', 'ktgStandard', 'ktgErhoeht', 'ferienzuschlag'] as const) {
    if (!(saetze[key] >= 0 && saetze[key] < 0.5)) return { error: 'Bitte alle Sätze als Anteil eingeben (z.B. 0.053 für 5.3%).' }
  }
  if (!(saetze.alvDeckelMonat > 0)) return { error: 'Bitte einen gültigen ALV/NBU-Deckel eingeben.' }
  if (!(saetze.kinderzulage >= 0) || !(saetze.ausbildungszulage >= 0)) return { error: 'Bitte gültige Zulagen-Beträge eingeben.' }

  const { error } = await admin.from('zeiterfassung_comments').upsert(
    {
      user_full_name: LOHN_SAETZE_KEY,
      schedule_date: `${jahr}-01-01`,
      comment: JSON.stringify({ ...saetze, jahr }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  revalidate()
  return { success: true }
}

export async function saveLohnAbrechnung(profileId: string, abr: LohnAbrechnung) {
  const { admin, adminName } = await requireAdmin()
  if (!profileId) return { error: 'Keine Mitarbeiterin gewählt.' }
  if (!ID_RE.test(abr.id)) return { error: 'Ungültige Abrechnungs-ID.' }
  if (!MONAT_RE.test(abr.monat)) return { error: 'Bitte einen gültigen Monat wählen.' }
  if (!abr.titel.trim()) return { error: 'Bitte einen Titel wählen.' }
  const lines = cleanPos(abr.lines)
  if (lines.length === 0) return { error: 'Bitte mindestens einen Lohnbestandteil erfassen.' }
  const nach = cleanPos(abr.nach, 6)

  // R6.9 Pfändungssperre: eine Lohnpfändungszeile darf nur bei Personen mit
  // aktiver hinterlegter Verfügung (Stammdaten bzw. Seed) gespeichert werden —
  // bei allen anderen bricht der Lohnlauf mit Fehler ab (R5.7).
  if ([...lines, ...nach].some(l => l.label.startsWith('Lohnpfändung'))) {
    const [{ data: stammRow }, { data: profRow }] = await Promise.all([
      admin.from('zeiterfassung_comments').select('comment')
        .eq('user_full_name', `${LOHN_STAMM_PREFIX}${profileId}`).eq('schedule_date', '1970-01-01').maybeSingle(),
      admin.from('profiles').select('full_name').eq('id', profileId).single(),
    ])
    let art: string | undefined
    try { art = (JSON.parse((stammRow as { comment: string } | null)?.comment ?? '{}') as Partial<LohnStamm>).pfaendungArt } catch { /* unten geprüft */ }
    if (art == null && profRow) art = lohnSeedFor((profRow as { full_name: string }).full_name)?.pfaendungArt
    if (art !== 'quote' && art !== 'betrag') {
      return { error: 'Pfändungssperre (R6.9): Diese Person hat keine aktive Pfändungs-Verfügung in den Stammdaten — die Zeile «Lohnpfändung» darf hier nicht erscheinen. Bitte die Zeile entfernen oder zuerst die Verfügung in den Lohn-Stammdaten hinterlegen.' }
    }
  }

  const { error } = await admin.from('zeiterfassung_comments').upsert(
    {
      user_full_name: `${LOHN_ABR_PREFIX}${profileId}_${abr.id}`,
      schedule_date: `${abr.monat}-01`,
      comment: JSON.stringify({
        titel: abr.titel.trim().slice(0, 60),
        periode: abr.periode.trim().slice(0, 60),
        lines,
        zulagen: cleanPos(abr.zulagen, 8),
        nach,
        ahv: !!abr.ahv, alv: !!abr.alv, nbu: !!abr.nbu,
        ktg: abr.ktg,
        pkAbzug: Math.round(abr.pkAbzug * 100) / 100,
        qstSatz: abr.qstSatz,
        deckelMonate: abr.deckelMonate && abr.deckelMonate >= 1 && abr.deckelMonate <= 12 ? Math.round(abr.deckelMonate) : 1,
        // Von Hand überschriebene Abzüge (Basis, Satz, Betrag)
        ...(Object.keys(sauberManuell(abr.manuell)).length > 0 ? { manuell: sauberManuell(abr.manuell) } : {}),
        // Audit-Spur unbezahlte Ferien: verwendete UF-/Plantage samt
        // Arbeitsplan-Stand; wer/wann wird hier serverseitig gesetzt, damit
        // manuelle Anpassungen revisionssicher nachvollziehbar bleiben.
        ...(abr.ufAudit && abr.ufAudit.tage > 0 ? {
          ufAudit: {
            tage: abr.ufAudit.tage,
            planTage: abr.ufAudit.planTage,
            tageAuto: abr.ufAudit.tageAuto,
            planTageAuto: abr.ufAudit.planTageAuto,
            manuell: !!abr.ufAudit.manuell,
            von: adminName,
            am: new Date().toISOString(),
          },
        } : {}),
        ...(abr.prorataAudit ? {
          prorataAudit: {
            tage: abr.prorataAudit.tage,
            planTage: abr.prorataAudit.planTage,
            tageAuto: abr.prorataAudit.tageAuto,
            datum: abr.prorataAudit.datum,
            manuell: !!abr.prorataAudit.manuell,
            von: adminName,
            am: new Date().toISOString(),
          },
        } : {}),
        erstelltAm: new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' }),
        von: adminName,
      }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  // Eingegebener PK-Abzug wird zum Standard für die folgenden Monate
  await uebernimmPkAbzug(admin, profileId, abr.pkAbzug, abr.monat)
  revalidate()
  return { success: true }
}

export async function deleteLohnAbrechnung(profileId: string, abrId: string) {
  const { admin } = await requireAdmin()
  if (!ID_RE.test(abrId)) return { error: 'Ungültige Abrechnungs-ID.' }
  const { error } = await admin
    .from('zeiterfassung_comments')
    .delete()
    .eq('user_full_name', `${LOHN_ABR_PREFIX}${profileId}_${abrId}`)
  if (error) return { error: error.message }
  revalidate()
  return { success: true }
}
