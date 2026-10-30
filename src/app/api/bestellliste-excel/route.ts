import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { LEITENDE_TITLE } from '@/lib/leitende'
import {
  LISTE_PREFIX, FIRMEN_KEY, BESTELL_ANCHOR, FIRMEN_EMPFOHLEN,
  hatBestellZugang, itemsNachFirma, parseListeRow,
} from '@/lib/bestellungen'

// Bestellliste für Excel: CSV (UTF-8 mit BOM, Semikolon-getrennt — öffnet
// sich in Excel/Numbers per Doppelklick mit korrekten Umlauten und Spalten).
// GET ?id=<listeId>
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const { data: profRow } = await supabase
    .from('profiles').select('role, full_name, job_title').eq('id', user.id).single()
  const prof = profRow as { role: string; full_name: string; job_title: string | null } | null
  if (!hatBestellZugang(prof?.role, prof?.job_title, prof?.full_name, LEITENDE_TITLE)) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
  }

  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!/^[a-z0-9]{6,40}$/.test(id)) return NextResponse.json({ error: 'Ungültige Liste' }, { status: 400 })

  const admin = await createAdminClient()
  const [{ data: listeRow }, { data: firmenRow }] = await Promise.all([
    admin.from('zeiterfassung_comments')
      .select('user_full_name, comment')
      .eq('user_full_name', `${LISTE_PREFIX}${id}`)
      .maybeSingle(),
    admin.from('zeiterfassung_comments')
      .select('comment').eq('user_full_name', FIRMEN_KEY).eq('schedule_date', BESTELL_ANCHOR).maybeSingle(),
  ])
  if (!listeRow) return NextResponse.json({ error: 'Liste nicht gefunden' }, { status: 404 })
  const liste = parseListeRow(
    (listeRow as { user_full_name: string }).user_full_name,
    (listeRow as { comment: string }).comment,
  )
  if (!liste) return NextResponse.json({ error: 'Liste nicht lesbar' }, { status: 500 })

  let firmen = [...FIRMEN_EMPFOHLEN]
  if (firmenRow) { try { firmen = JSON.parse((firmenRow as { comment: string }).comment) as string[] } catch { /* Vorbelegung */ } }

  // Formel-Schutz: Zellen, die mit =, + oder @ beginnen, würde Excel als
  // Formel ausführen — ein führendes Hochkomma macht daraus reinen Text.
  const esc = (roh: string) => {
    const v = /^[=+@]/.test(roh) ? `'${roh}` : roh
    return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  }
  const zeilen: string[] = ['Firma;Artikel;Artikel-Nr.;Menge']
  const gruppen = liste.typ === 'laura'
    ? [{ firma: 'WhatsApp (Andrea Willen)', items: liste.items }]
    : itemsNachFirma(liste.items, firmen).map(g => ({ firma: g.firma || 'Ohne Firma', items: g.items }))
  for (const g of gruppen) {
    for (const it of g.items) {
      zeilen.push([g.firma, it.name, it.artikelNr, it.menge].map(esc).join(';'))
    }
  }
  const csv = '﻿' + zeilen.join('\r\n') + '\r\n'
  const fname = `Bestellliste_${liste.geschlossenAm ?? liste.erstellt}.csv`
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fname}"`,
    },
  })
}
