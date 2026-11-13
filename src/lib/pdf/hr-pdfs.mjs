// HR export PDFs — implementation of the Claude Design handoff
// "HR Export PDFs v2.dc.html" (Ferienkonto + Zeiterfassung views).
// Single source used by the API routes AND maintenance scripts.
// Design px are converted to PDF pt at 0.75 (794px canvas = A4 595pt).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { LOGO_PNG_BASE64 } from './logo-base64.mjs'

// ── palette (from the design) ────────────────────────────────────────────────
const hx = h => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)
const C = {
  page: hx('#FDFDFC'), ink: hx('#4B4653'), gray: hx('#8A8492'), mute: hx('#B5B0BC'),
  teal: hx('#5F8F86'), tealDark: hx('#47756D'), tealDeep: hx('#3F6B62'), tealRow: hx('#4F8278'),
  green: hx('#DFEDE8'), greenSub: hx('#6E948B'),
  lav: hx('#EAE7F1'), lavText: hx('#7A7290'), lavDeep: hx('#5A5170'), lavSub: hx('#8B84A0'),
  tan: hx('#F7EAD9'), tanText: hx('#B08350'), tanDeep: hx('#96703F'), tanSub: hx('#BC9668'), tanBlock: hx('#F2DFC6'),
  sand: hx('#F3F1F5'), lineSoft: hx('#EFEDF1'), lineHead: hx('#B9B3C0'), lineDiv: hx('#D9D4DF'), lineSig: hx('#A8A2B0'),
  track: hx('#F4F2F0'), block: hx('#BBD8D0'), blockText: hx('#33574F'),
  pill: hx('#E8F1EE'), pause: hx('#A9A3B1'), negRed: hx('#A0524E'),
  steel: hx('#DFE7F2'), steelDeep: hx('#4F6B8F'),
}
const TONES = {
  krank: { block: C.tanBlock, text: C.tanDeep, total: C.tanText },
  unfall: { block: hx('#F8E0CF'), text: hx('#A85E38'), total: hx('#A85E38') },
  ferien: { block: C.green, text: C.tealDeep, total: C.tealDeep },
  // Ferien als Minusstunden (Vereinbarung): gedämpftes Grün — kein Ferienbezug, keine Gutschrift
  fm: { block: hx('#DCE5E2'), text: hx('#4F6B62'), total: hx('#4F6B62') },
  komp: { block: C.lav, text: C.lavDeep, total: C.lavDeep },
  teamevent: { block: hx('#EADAC8'), text: hx('#7E5F44'), total: hx('#8A6A4F') },
  uek: { block: hx('#EAE7F1'), text: hx('#5A5170'), total: hx('#5A5170') },
  bf: { block: hx('#EFEBCF'), text: hx('#7E7433'), total: hx('#7E7433') },
  uf: { block: hx('#E3E0D5'), text: hx('#6E6749'), total: hx('#6E6749') },
  wb: { block: hx('#EAE7F1'), text: hx('#5A5170'), total: hx('#5A5170') },
}

// ── geometry ─────────────────────────────────────────────────────────────────
const PW = 595.28, PH = 841.89
const PADX = 39, PADT = 33, PADB = 30
const CW = PW - 2 * PADX     // 517.28

const sane = t => String(t ?? '')
  .replace(/−/g, '-')
  .replace(/[^\x20-\x7E  -ÿ–—‘’“”…€]/g, '')

function makeCtx(doc, fonts, logo) {
  const ctx = { doc, fonts, logo, page: null, y: 0, pageCount: 0 }
  return ctx
}
function addPage(ctx) {
  ctx.page = ctx.doc.addPage([PW, PH])
  ctx.pageCount++
  ctx.page.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: C.page })
  ctx.y = PH - PADT
}
function text(ctx, t, x, yTop, size, font, color, opts = {}) {
  let v = sane(t)
  if (opts.maxWidth) { while (v.length > 1 && font.widthOfTextAtSize(v, size) > opts.maxWidth) v = v.slice(0, -1) }
  ctx.page.drawText(v, { x, y: yTop - size, size, font, color })
  return font.widthOfTextAtSize(v, size)
}
function textRight(ctx, t, xRight, yTop, size, font, color) {
  const v = sane(t)
  const w = font.widthOfTextAtSize(v, size)
  ctx.page.drawText(v, { x: xRight - w, y: yTop - size, size, font, color })
  return w
}
function textCenter(ctx, t, xCenter, yTop, size, font, color) {
  const v = sane(t)
  const w = font.widthOfTextAtSize(v, size)
  ctx.page.drawText(v, { x: xCenter - w / 2, y: yTop - size, size, font, color })
  return w
}
/** uppercase, letter-spaced (eyebrows / table headers) */
function textSpaced(ctx, t, x, yTop, size, font, color, ls) {
  const v = sane(t).toUpperCase()
  let cx = x
  for (const ch of v) {
    ctx.page.drawText(ch, { x: cx, y: yTop - size, size, font, color })
    cx += font.widthOfTextAtSize(ch, size) + ls
  }
  return cx - x - ls
}
function spacedWidth(font, t, size, ls) {
  const v = sane(t).toUpperCase()
  let w = 0
  for (const ch of v) w += font.widthOfTextAtSize(ch, size) + ls
  return w - ls
}
function roundedRect(ctx, x, yTop, w, h, r, color) {
  const y = yTop - h
  ctx.page.drawRectangle({ x: x + r, y, width: w - 2 * r, height: h, color })
  ctx.page.drawRectangle({ x, y: y + r, width: w, height: h - 2 * r, color })
  for (const [cx, cy] of [[x + r, y + r], [x + w - r, y + r], [x + r, y + h - r], [x + w - r, y + h - r]]) {
    ctx.page.drawCircle({ x: cx, y: cy, size: r, color })
  }
}
function hline(ctx, yy, x1, x2, thickness, color) {
  ctx.page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness, color })
}

// ── shared header (logo, meta, eyebrow, H1, right block, divider) ────────────
function drawHeader(ctx, { eyebrow, title, rightTitle, rightSub, createdLabel, metaLine = 'Vertraulich · Personaldossier' }) {
  const yTop = PH - PADT
  // logo: container 91.5x69, image 100.5 wide with design offsets (-4.5, +10.5)
  const imgW = 100.5
  const imgH = imgW * ctx.logo.height / ctx.logo.width
  ctx.page.drawImage(ctx.logo, { x: PADX - 4.5, y: yTop + 10.5 - imgH, width: imgW, height: imgH })
  // right meta
  textRight(ctx, createdLabel, PADX + CW, yTop - 4.5, 8.25, ctx.fonts.reg, C.gray)
  if (metaLine) textRight(ctx, metaLine, PADX + CW, yTop - 4.5 - 12.4, 8.25, ctx.fonts.reg, C.gray)
  // title block
  const titleTop = yTop - 69 - 21
  textSpaced(ctx, eyebrow, PADX, titleTop, 8.25, ctx.fonts.bold, C.teal, 1.8)
  const h1Top = titleTop - 8.25 - 4.5
  text(ctx, title, PADX, h1Top, 22.5, ctx.fonts.bold, C.ink)
  // right: name + sub, bottom-aligned with H1
  const h1Bottom = h1Top - 22.5
  textRight(ctx, rightTitle, PADX + CW, h1Bottom + 12 + 10.5, 12, ctx.fonts.bold, C.ink)
  textRight(ctx, rightSub, PADX + CW, h1Bottom + 9, 9, ctx.fonts.reg, C.gray)
  // divider
  const divY = h1Bottom - 12
  hline(ctx, divY, PADX, PADX + CW, 1.5, C.lineDiv)
  ctx.y = divY
}

function drawFooter(ctx, rightTexts) {
  const pages = ctx.doc.getPages()
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]
    p.drawLine({ start: { x: PADX, y: PADB + 16 }, end: { x: PADX + CW, y: PADB + 16 }, thickness: 0.75, color: C.lineSoft })
    p.drawText('Dentalpraxis Nidau AG · ', { x: PADX, y: PADB + 2, size: 7.5, font: ctx.fonts.reg, color: C.gray })
    const w1 = ctx.fonts.reg.widthOfTextAtSize('Dentalpraxis Nidau AG · ', 7.5)
    p.drawText('dentalpraxisnidau.ch', { x: PADX + w1, y: PADB + 2, size: 7.5, font: ctx.fonts.reg, color: C.teal })
    const rt = sane(typeof rightTexts === 'function' ? rightTexts(i, pages.length) : rightTexts)
    const w = ctx.fonts.reg.widthOfTextAtSize(rt, 7.5)
    p.drawText(rt, { x: PADX + CW - w, y: PADB + 2, size: 7.5, font: ctx.fonts.reg, color: C.gray })
  }
}

async function newDoc(title) {
  const doc = await PDFDocument.create()
  const reg = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo = await doc.embedPng(Buffer.from(LOGO_PNG_BASE64, 'base64'))
  doc.setTitle(title)
  doc.setCreationDate(new Date())
  return makeCtx(doc, { reg, bold }, logo)
}

// ═════════════════════════ Dokument 1: Ferienkonto ═══════════════════════════
export async function generateKontoPdf(d) {
  const ctx = await newDoc(`Arbeitszeit- und Ferienkonto ${d.year} ${d.employeeName}`)
  addPage(ctx)
  drawHeader(ctx, {
    eyebrow: `Jahresübersicht ${d.year}`,
    title: 'Arbeitszeit- & Ferienkonto',
    rightTitle: d.employeeName,
    rightSub: `${d.funktion || '—'} · Pensum ${d.pensumLabel}`,
    createdLabel: d.createdLabel,
  })

  // ── stat cards ──
  const cardTop = ctx.y - 15
  const cardH = 64, cardW = (CW - 27) / 4, gap = 9
  const cards = [
    { bg: C.green, label: 'Zeitkonto-Saldo', lc: C.teal, value: d.stats.saldoDisplay, vc: C.tealDeep, sub: d.stats.saldoSub, sc: C.greenSub },
    { bg: C.lav, label: 'Bleibende Ferien', lc: C.lavText, value: d.stats.restDisplay, vc: C.lavDeep, sub: 'Tage', sc: C.lavSub },
    { bg: C.tan, label: 'Krankheitstage', lc: C.tanText, value: d.stats.krankDisplay, vc: C.tanDeep, sub: d.stats.krankSub, sc: C.tanSub },
    { bg: hx('#F8E0CF'), label: 'Unfalltage', lc: hx('#BC8258'), value: d.stats.unfallDisplay ?? '0', vc: hx('#A85E38'), sub: d.stats.krankSub, sc: hx('#BC8258') },
  ]
  cards.forEach((c, i) => {
    const x = PADX + i * (cardW + gap)
    roundedRect(ctx, x, cardTop, cardW, cardH, 9, c.bg)
    const cxm = x + cardW / 2
    const lw = spacedWidth(ctx.fonts.bold, c.label, 7.5, 1.05)
    textSpaced(ctx, c.label, cxm - lw / 2, cardTop - 12, 7.5, ctx.fonts.bold, c.lc, 1.05)
    textCenter(ctx, c.value, cxm, cardTop - 12 - 7.5 - 3, 19.5, ctx.fonts.bold, c.vc)
    textCenter(ctx, c.sub, cxm, cardTop - 12 - 7.5 - 3 - 19.5 - 1.5, 8, ctx.fonts.reg, c.sc)
  })

  // ── table ──
  const frs = [1.1, .8, .8, .95, .85, .75, .95, .95, .8]
  const colGap = 7.5, padXCell = 7.5
  const totFr = frs.reduce((a, b) => a + b, 0)
  const avail = CW - 2 * padXCell - colGap * (frs.length - 1)
  const colW = frs.map(f => f / totFr * avail)
  const colX = []
  { let x = PADX + padXCell; for (const w of colW) { colX.push(x); x += w + colGap } }
  // Long headers wrap onto two lines (bottom-aligned) so they never run
  // into the neighbouring column's label.
  const HEAD = [
    ['Monat'], ['Soll-Std.'], ['Ist-Std.'], ['Saldo', 'Vormonat'],
    ['Zeitkonto'], ['Ferien', '(Tage)'], ['Bleibende', 'Ferien'], ['Krankheits-', 'tage'], ['Unfall-', 'tage'],
  ]

  let y = cardTop - cardH - 21
  const headLineH = 8.2
  HEAD.forEach((lines, i) => {
    const size = 6.6, ls = 0.4
    lines.forEach((h, j) => {
      const yy = y + (lines.length - 1 - j) * headLineH
      if (i === 0) textSpaced(ctx, h, colX[i], yy, size, ctx.fonts.bold, C.gray, ls)
      else {
        const w = spacedWidth(ctx.fonts.bold, h, size, ls)
        textSpaced(ctx, h, colX[i] + colW[i] - w, yy, size, ctx.fonts.bold, C.gray, ls)
      }
    })
  })
  y -= 6.6 + 6
  hline(ctx, y, PADX, PADX + CW, 1.1, C.lineHead)

  const rowH = 21.4
  for (const r of d.rows) {
    const vals = [r.label, r.soll, r.ist, r.vor, r.konto, r.ferien, r.rest, r.krank, r.unfall ?? '']
    const baseColor = r.empty ? C.mute : C.ink
    const rowTop = y - (rowH - 9) / 2 - 1
    vals.forEach((v, i) => {
      const val = r.empty && i > 0 ? '–' : sane(v || (i > 0 ? '–' : ''))
      const isKonto = i === 4
      const color = isKonto && !r.empty ? (val.trim().startsWith('-') ? C.negRed : C.tealRow) : baseColor
      const font = (i === 0 || isKonto) && !r.empty ? ctx.fonts.bold : (i === 0 ? ctx.fonts.bold : ctx.fonts.reg)
      if (i === 0) text(ctx, val, colX[i], rowTop, 9, font, r.empty ? C.mute : C.ink)
      else textRight(ctx, val, colX[i] + colW[i], rowTop, 9, font, color)
    })
    y -= rowH
    hline(ctx, y, PADX, PADX + CW, 0.75, C.lineSoft)
  }

  // ── Bemerkungen ──
  if (d.bemerkungen) {
    const bTop = y - 18
    const lines = String(d.bemerkungen).split('\n').slice(0, 2)
    const bH = 10.5 + 7.5 + 4 + lines.length * 11.5 + 8
    roundedRect(ctx, PADX, bTop, CW, bH, 9, C.sand)
    textSpaced(ctx, 'Bemerkungen', PADX + 13.5, bTop - 10.5, 7.5, ctx.fonts.bold, C.lavText, 1.2)
    lines.forEach((l, i) => text(ctx, l, PADX + 13.5, bTop - 10.5 - 7.5 - 4 - i * 11.5, 9.4, ctx.fonts.reg, C.ink, { maxWidth: CW - 27 }))
  }

  // ── signatures (anchored above footer) ──
  const sigLineY = PADB + 64
  const sigW = (CW - 36) / 2
  hline(ctx, sigLineY, PADX, PADX + sigW, 0.75, C.lineSig)
  text(ctx, 'Unterschrift Mitarbeiter/in', PADX, sigLineY - 4.5, 7.9, ctx.fonts.reg, C.gray)
  hline(ctx, sigLineY, PADX + sigW + 36, PADX + CW, 0.75, C.lineSig)
  text(ctx, 'Unterschrift Vorgesetzte/r · Kontrolliert / Datum', PADX + sigW + 36, sigLineY - 4.5, 7.9, ctx.fonts.reg, C.gray)

  drawFooter(ctx, 'Persönliche Betreuung')
  return ctx.doc.save()
}

// ═════════════════════════ Dokument 2: Zeiterfassung ═════════════════════════
const DATE_COL = 126, COL_GAP = 10.5, TOTAL_COL = 57
const AXIS_X = PADX + DATE_COL + COL_GAP
const AXIS_W = CW - DATE_COL - TOTAL_COL - 2 * COL_GAP

function axisRange(days) {
  let lo = 420, hi = 1260   // 07:00–21:00 default
  for (const d of days) {
    for (const s of d.stints ?? []) { lo = Math.min(lo, s.startMin); hi = Math.max(hi, s.endMin) }
  }
  return { start: Math.floor(lo / 60) * 60, end: Math.ceil(hi / 60) * 60 }
}

function drawZeTableHeader(ctx, axis) {
  const y = ctx.y
  textSpaced(ctx, 'Datum', PADX + 7.5, y, 7, ctx.fonts.bold, C.gray, 0.7)
  const span = axis.end - axis.start
  for (let m = axis.start; m <= axis.end; m += 120) {
    const label = `${String(Math.floor(m / 60)).padStart(2, '0')}:00`
    let x = AXIS_X + (m - axis.start) / span * AXIS_W
    const w = ctx.fonts.reg.widthOfTextAtSize(label, 7)
    x = Math.max(AXIS_X, Math.min(x - w / 2, AXIS_X + AXIS_W - w))
    text(ctx, label, x, y, 7, ctx.fonts.reg, C.gray)
  }
  const tw = spacedWidth(ctx.fonts.bold, 'Total', 7, 0.7)
  textSpaced(ctx, 'Total', PADX + CW - 7.5 - tw, y, 7, ctx.fonts.bold, C.gray, 0.7)
  hline(ctx, y - 7 - 4.5, PADX, PADX + CW, 1.1, C.lineHead)
  ctx.y = y - 7 - 4.5
}

export async function generateZeiterfassungPdf(d) {
  const ctx = await newDoc(`Zeiterfassung ${d.employeeName}`)
  addPage(ctx)
  drawHeader(ctx, {
    eyebrow: 'Monatsrapport',
    title: 'Zeiterfassung',
    rightTitle: d.employeeName,
    rightSub: d.periodLabel,
    createdLabel: d.createdLabel,
  })

  // ── summary strip ──
  // Chips wrap onto a second line instead of colliding with the
  // right-aligned "N erfasste Tage" label (the strip grows accordingly).
  const sTop = ctx.y - 13.5
  const chips = d.summary.chips ?? []
  const w = (t, size, font) => font.widthOfTextAtSize(sane(t), size)
  const chipW = c => w(c.value, 9, ctx.fonts.bold) + 3 + w(c.label, 9, ctx.fonts.reg) + 10
  const daysW = w(d.summary.daysLabel, 9, ctx.fonts.reg)
  const leftW = w(d.summary.totalDisplay, 13.5, ctx.fonts.bold) + 4
    + w('Total Arbeitszeit', 9, ctx.fonts.reg) + 10
    + w('|', 10, ctx.fonts.reg) + 10
    + w(d.summary.workedDisplay, 9, ctx.fonts.bold) + 3
    + w('gestempelt', 9, ctx.fonts.reg) + 10
  const line1Limit = PADX + CW - 13.5 - daysW - 12
  let fitCount = 0
  {
    let probe = PADX + 13.5 + leftW
    for (const c of chips) {
      if (probe + chipW(c) > line1Limit) break
      probe += chipW(c)
      fitCount++
    }
  }
  const wrapped = fitCount < chips.length
  const sH = wrapped ? 45 : 31.5
  roundedRect(ctx, PADX, sTop, CW, sH, 9, C.sand)
  {
    const base = sTop - 9.2
    let x = PADX + 13.5
    x += text(ctx, d.summary.totalDisplay, x, base, 13.5, ctx.fonts.bold, C.ink) + 4
    x += text(ctx, 'Total Arbeitszeit', x, base - 3.4, 9, ctx.fonts.reg, C.gray) + 10
    x += text(ctx, '|', x, base - 2, 10, ctx.fonts.reg, C.lineDiv) + 10
    x += text(ctx, d.summary.workedDisplay, x, base - 3, 9, ctx.fonts.bold, C.ink) + 3
    x += text(ctx, 'gestempelt', x, base - 3.4, 9, ctx.fonts.reg, C.gray) + 10
    for (let i = 0; i < chips.length; i++) {
      if (i === fitCount) { x = PADX + 13.5; }
      const base2 = i < fitCount ? base : base - 13.5
      const chip = chips[i]
      const tone = TONES[chip.tone] ?? { total: C.ink }
      x += text(ctx, chip.value, x, base2 - 3, 9, ctx.fonts.bold, tone.total) + 3
      x += text(ctx, chip.label, x, base2 - 3.4, 9, ctx.fonts.reg, C.gray) + 10
    }
    textRight(ctx, d.summary.daysLabel, PADX + CW - 13.5, base - 3.4, 9, ctx.fonts.reg, C.gray)
  }

  // ── timeline table ──
  const axis = axisRange(d.days)
  const span = axis.end - axis.start
  const X = m => AXIS_X + (Math.min(Math.max(m, axis.start), axis.end) - axis.start) / span * AXIS_W
  ctx.y = sTop - sH - 15
  drawZeTableHeader(ctx, axis)

  for (const day of d.days) {
    const noteH = day.note ? 16.5 : 0
    const rowH = 36 + noteH
    if (ctx.y - rowH < PADB + 60) { addPage(ctx); drawZeTableHeader(ctx, axis) }
    const top = ctx.y - 4.5

    // left: date + weekday
    text(ctx, day.dateNum, PADX + 7.5, top - 1, 9.4, ctx.fonts.bold, C.ink)
    text(ctx, day.dayName, PADX + 7.5, top - 1 - 9.4 - 2.5, 7.9, ctx.fonts.reg, C.gray)

    // track
    const trackTop = top - 9
    roundedRect(ctx, AXIS_X, trackTop, AXIS_W, 15, 4.5, C.track)

    // blocks
    const blocks = []
    if (day.absence && (!day.stints || day.stints.length === 0)) {
      const t = TONES[day.absence.tone] ?? TONES.krank
      blocks.push({ x1: X(day.absence.startMin ?? 480), x2: X(day.absence.endMin ?? 990), bg: t.block, fg: t.text, label: day.absence.label })
    }
    for (const s of day.stints ?? []) {
      blocks.push({ x1: X(s.startMin), x2: X(s.endMin), bg: C.block, fg: C.blockText, label: s.label, short: s.shortLabel })
    }
    for (const b of blocks) {
      const w = Math.max(b.x2 - b.x1, 4)
      roundedRect(ctx, b.x1, trackTop, w, 15, Math.min(4.5, w / 2), b.bg)
      const full = sane(b.label)
      const shortL = sane(b.short ?? '')
      const fullW = ctx.fonts.bold.widthOfTextAtSize(full, 7)
      if (fullW <= w - 6) textCenter(ctx, full, b.x1 + w / 2, trackTop - 4, 7, ctx.fonts.bold, b.fg)
      else if (shortL && ctx.fonts.bold.widthOfTextAtSize(shortL, 7) <= w - 4) textCenter(ctx, shortL, b.x1 + w / 2, trackTop - 4, 7, ctx.fonts.bold, b.fg)
    }
    // pauses — nudge neighbouring labels apart so they never print on top of each other
    {
      const gap = 5
      const ps = (day.pauses ?? [])
        .map(p => {
          const label = sane(p.label)
          const w = ctx.fonts.reg.widthOfTextAtSize(label, 6.4)
          return { label, w, left: X(p.centerMin) - w / 2 }
        })
        .sort((a, b) => a.left - b.left)
      for (let i = 0; i < ps.length; i++) {
        const minLeft = i === 0 ? AXIS_X : ps[i - 1].left + ps[i - 1].w + gap
        if (ps[i].left < minLeft) ps[i].left = minLeft
      }
      for (let i = ps.length - 1; i >= 0; i--) {
        const maxLeft = (i === ps.length - 1 ? AXIS_X + AXIS_W : ps[i + 1].left - gap) - ps[i].w
        if (ps[i].left > maxLeft) ps[i].left = maxLeft
      }
      for (const p of ps) {
        if (p.left < AXIS_X - 0.5) continue // row too crowded to fit every label — drop rather than overlap
        text(ctx, p.label, p.left, top + 1.5, 6.4, ctx.fonts.reg, C.pause)
      }
    }

    // total
    const tone = day.totalTone && TONES[day.totalTone] ? TONES[day.totalTone].total : C.ink
    textRight(ctx, day.totalDisplay, PADX + CW - 7.5, top - 8, 9.4, ctx.fonts.bold, tone)

    // note: plain text, styled like the weekday under the date (no box, no prefix)
    if (day.note) {
      textCenter(ctx, sane(day.note), PADX + CW / 2, top - 29 - 2.8, 7.9, ctx.fonts.reg, C.gray)
    }

    ctx.y -= rowH
    hline(ctx, ctx.y, PADX, PADX + CW, 0.75, C.lineSoft)
  }

  // ── total band ──
  if (ctx.y - 45 < PADB + 30) addPage(ctx)
  const bTop = ctx.y - 10.5
  roundedRect(ctx, PADX, bTop, CW, 30, 9, C.green)
  {
    const base = bTop - 9.5
    let x = PADX + 13.5
    x += text(ctx, 'Total Arbeitszeit', x, base, 9.4, ctx.fonts.bold, C.tealDeep) + 4
    if (d.totalNote) text(ctx, `· ${d.totalNote}`, x, base - 0.4, 9, ctx.fonts.reg, C.greenSub)
    textRight(ctx, d.totalDisplay, PADX + CW - 13.5, base - 1.6, 12.75, ctx.fonts.bold, C.tealDeep)
  }

  drawFooter(ctx, (i, n) => `Seite ${i + 1} / ${n}`)
  return ctx.doc.save()
}

// ═════════════════════════ Dokument 3: Arbeitsplan ═══════════════════════════
// One A4 LANDSCAPE page: month grid (groups → employee rows × day columns)
// with the same colors as the portal, Soll line, legend. Hinweise für das
// Team stehen als Bänder über den Tagen; interne Notizen (Admin + Leitende)
// werden nie gezeichnet, die Datei wird gedruckt und weitergegeben.

const AP_W = 841.89, AP_H = 595.28, AP_MX = 24, AP_MT = 20, AP_MB = 18

function apCheck(ctx, cx, cy, s, color) {
  // small vector check mark centered on (cx, cy)
  ctx.page.drawLine({ start: { x: cx - s * 0.45, y: cy - s * 0.05 }, end: { x: cx - s * 0.12, y: cy - s * 0.4 }, thickness: 0.9, color })
  ctx.page.drawLine({ start: { x: cx - s * 0.12, y: cy - s * 0.4 }, end: { x: cx + s * 0.5, y: cy + s * 0.4 }, thickness: 0.9, color })
}

export async function generateArbeitsplanPdf(d) {
  const ctx = await newDoc(`Arbeitsplan ${d.monthLabel} Dentalpraxis Nidau`)
  ctx.page = ctx.doc.addPage([AP_W, AP_H])
  ctx.pageCount++
  ctx.page.drawRectangle({ x: 0, y: 0, width: AP_W, height: AP_H, color: C.page })
  const reg = ctx.fonts.reg, bold = ctx.fonts.bold
  const cw = AP_W - 2 * AP_MX
  const border = hx('#E3E1DC')
  let y = AP_H - AP_MT

  // ── header ──
  textCenter(ctx, 'Dentalpraxis Nidau — Arbeitsplan', AP_W / 2, y, 14, bold, C.ink)
  y -= 17.5
  textCenter(ctx, d.monthLabel, AP_W / 2, y, 10, reg, C.gray)
  y -= 12.5
  textCenter(ctx, d.createdLabel, AP_W / 2, y, 6.5, reg, C.mute)
  y -= 9.5
  if (d.monthNote) {
    const w = bold.widthOfTextAtSize(sane(d.monthNote), 7.5) + 16
    roundedRect(ctx, AP_W / 2 - w / 2, y, w, 13, 3, C.tanBlock)
    textCenter(ctx, d.monthNote, AP_W / 2, y - 2.2, 7.5, bold, C.tanDeep)
    y -= 17
  }

  // ── Soll line ──
  {
    const label = `Soll (${d.workingDays} Arbeitstage × 8.5 h):   `
    const parts = d.soll.map(s => ({ a: `${s.pct}% `, b: s.val }))
    let total = bold.widthOfTextAtSize(label, 7)
    for (const p of parts) total += reg.widthOfTextAtSize(p.a, 7) + bold.widthOfTextAtSize(p.b, 7) + 10
    let x = AP_W / 2 - total / 2
    x += text(ctx, label, x, y, 7, bold, C.gray)
    for (const p of parts) {
      x += text(ctx, p.a, x, y, 7, reg, C.gray)
      x += text(ctx, p.b, x, y, 7, bold, C.ink) + 10
    }
    y -= 12
  }

  // ── grid geometry ──
  const nameW = 88
  const dayW = (cw - nameW) / d.days.length
  const gx = i => AP_MX + nameW + i * dayW   // left edge of day column i

  // Hinweise für das Team: Bänder über der Tagesleiste, Text läuft über
  // freie Nachbarspalten hinaus, damit auch ein Hinweis an einem Tag lesbar ist
  if (d.hinweise && d.hinweise.length) {
    const bandH = 12
    const belegt = (tag) => d.hinweise.some(h => tag >= h.start && tag <= h.end)
    for (const h of d.hinweise) {
      const x1 = gx(h.start - 1) + 1, x2 = gx(h.end) - 1
      let freiRechts = 0
      for (let k = h.end + 1; k <= d.days.length && !belegt(k); k++) freiRechts++
      let freiLinks = 0
      for (let k = h.start - 1; k >= 1 && !belegt(k); k--) freiLinks++
      const nachRechts = freiRechts >= freiLinks
      const platz = (nachRechts ? (x2 - x1) + freiRechts * dayW : (x2 - x1) + freiLinks * dayW) - 2
      let v = sane(h.note)
      while (v.length > 1 && bold.widthOfTextAtSize(v, 5.6) + 8 > platz) v = v.slice(0, -1)
      const tw = bold.widthOfTextAtSize(v, 5.6)
      // Die Pille ist mindestens so breit wie ihre Tage und deckt den ganzen Text
      const pw = Math.max(x2 - x1, tw + 8)
      const px1 = nachRechts ? x1 : x2 - pw
      roundedRect(ctx, px1, y, pw, bandH - 1, 2.5, C.steel)
      text(ctx, v, px1 + pw / 2 - tw / 2, y - 2.2, 5.6, bold, C.steelDeep)
    }
    y -= bandH + 1
  }

  // day header row
  const headH = 15
  ctx.page.drawRectangle({ x: AP_MX, y: y - headH, width: nameW, height: headH, color: hx('#FFFFFF'), borderColor: border, borderWidth: 0.4 })
  text(ctx, 'Mitarbeiter', AP_MX + 3, y - 3.2, 6, bold, C.gray)
  d.days.forEach((day, i) => {
    // Reihenfolge wie im Portal: rot, Teamevent/Feiertag, Teamhinweis (blau), Wochenende
    const bg = day.review ? hx('#F6C6C6') : day.te ? hx('#E5D3BC') : day.hinweis ? C.steel : day.we ? hx('#EDF4F1') : hx('#FFFFFF')
    const fg = day.review ? hx('#7F1D1D') : day.te ? hx('#7E5F44') : day.hinweis ? C.steelDeep : day.we ? C.teal : C.ink
    ctx.page.drawRectangle({ x: gx(i), y: y - headH, width: dayW, height: headH, color: bg, borderColor: border, borderWidth: 0.4 })
    textCenter(ctx, String(day.num), gx(i) + dayW / 2, y - 1.6, 6.3, bold, fg)
    textCenter(ctx, day.wd, gx(i) + dayW / 2, y - 8.6, 4.6, reg, day.hinweis && !day.te && !day.review ? C.steelDeep : day.we ? C.teal : C.mute)
  })
  y -= headH

  // rows — height adapts so everything fits above the legend
  const empRows = d.groups.reduce((s, g) => s + g.rows.length, 0)
  const groupH = 10
  const legendSpace = 44
  const avail = y - AP_MB - legendSpace
  const rowH = Math.max(9, Math.min(16.5, (avail - d.groups.length * groupH) / Math.max(1, empRows)))

  for (const g of d.groups) {
    const gc = d.groupColors[g.key] ?? { bg: '#F3F1EE', fg: '#55525E' }
    ctx.page.drawRectangle({ x: AP_MX, y: y - groupH, width: cw, height: groupH, color: hx(gc.bg), borderColor: border, borderWidth: 0.4 })
    textSpaced(ctx, g.label, AP_MX + 3, y - 1.6, 5.4, bold, hx(gc.fg), 0.5)
    y -= groupH
    for (const row of g.rows) {
      ctx.page.drawRectangle({ x: AP_MX, y: y - rowH, width: nameW, height: rowH, color: hx('#FFFFFF'), borderColor: border, borderWidth: 0.4 })
      text(ctx, row.name, AP_MX + 3, y - (rowH - 6.2) / 2, 6.2, bold, C.ink, { maxWidth: nameW - 6 })
      row.cells.forEach((cell, i) => {
        const day = d.days[i]
        const baseBg = day.review ? hx('#FBE3E3') : day.te ? hx('#F4EBDF') : day.hinweis ? hx('#EEF3F8') : day.we ? hx('#F4F8F6') : hx('#FFFFFF')
        const bg = cell && cell.bg ? hx(cell.bg) : baseBg
        ctx.page.drawRectangle({ x: gx(i), y: y - rowH, width: dayW, height: rowH, color: bg, borderColor: border, borderWidth: 0.4 })
        if (cell && cell.text) {
          if (cell.text === '✓') apCheck(ctx, gx(i) + dayW / 2, y - rowH / 2, 4.6, hx(cell.fg))
          else textCenter(ctx, cell.text, gx(i) + dayW / 2, y - (rowH - 6.2) / 2, 6.2, bold, hx(cell.fg))
        }
      })
      y -= rowH
    }
  }

  // ── legend ──
  y -= 7
  {
    const items = d.legend
    const boxW = 11, boxH = 8
    const itemW = it => boxW + 2.5 + reg.widthOfTextAtSize(sane(it.label), 5.8) + 8
    const shiftW = it => 8 + 2.5 + reg.widthOfTextAtSize(sane(it.label), 5.8) + 8
    const total = items.reduce((s, it) => s + itemW(it), 0) + 10 + d.shifts.reduce((s, it) => s + shiftW(it), 0)
    let x = AP_W / 2 - total / 2
    for (const it of items) {
      ctx.page.drawRectangle({ x, y: y - boxH, width: boxW, height: boxH, color: hx(it.bg), borderColor: hx(it.bd), borderWidth: 0.5 })
      if (it.code === '✓') apCheck(ctx, x + boxW / 2, y - boxH / 2, 4, hx(it.fg))
      else textCenter(ctx, it.code, x + boxW / 2, y - 1.1, 4.8, bold, hx(it.fg))
      x += boxW + 2.5
      x += text(ctx, it.label, x, y - 1.2, 5.8, reg, C.gray) + 8
    }
    x += 10
    for (const it of d.shifts) {
      ctx.page.drawRectangle({ x, y: y - boxH, width: 8, height: boxH, color: hx(it.bg) })
      x += 8 + 2.5
      x += text(ctx, it.label, x, y - 1.2, 5.8, reg, C.gray) + 8
    }
    y -= boxH + 6
  }
  for (const line of d.timeLines) {
    textCenter(ctx, line, AP_W / 2, y, 5.8, reg, C.gray)
    y -= 8
  }

  // footer
  ctx.page.drawText('Dentalpraxis Nidau AG · dentalpraxisnidau.ch', { x: AP_MX, y: 8, size: 6.5, font: reg, color: C.gray })
  const ft = sane(`Arbeitsplan ${d.monthLabel}`)
  const fw = reg.widthOfTextAtSize(ft, 6.5)
  ctx.page.drawText(ft, { x: AP_W - AP_MX - fw, y: 8, size: 6.5, font: reg, color: C.gray })

  return ctx.doc.save()
}


// ── Lohnabrechnung ───────────────────────────────────────────────────────────
// d: { titel, periode, name, anrede, adresse, plzOrt, ahvNr, bgLabel, bank,
//      erstelltAm, lines: [{label, chf}], bruttoChf,
//      zulagen: [{label, chf}], zulagenTotalChf,
//      abzuege: [{label, basisChf, satzPct, chf}], abzugTotalChf,
//      qst: {label, chf} | null, nach: [{label, chf}], auszahlungChf }
// Alle Beträge vorformatiert (exakte Rappen, Apostroph-Gruppierung).
export async function generateLohnPdf(d) {
  const ctx = await newDoc(`${d.titel} ${d.periode} ${d.name}`)
  addPage(ctx)
  const reg = ctx.fonts.reg, bold = ctx.fonts.bold

  drawHeader(ctx, {
    eyebrow: d.periode,
    title: d.titel,
    rightTitle: d.name,
    rightSub: d.ahvNr ? `AHV-Nr. ${d.ahvNr}` : '',
    createdLabel: `Erstellt am ${d.erstelltAm}`,
    metaLine: 'Vertraulich · Lohn',
  })

  // ── Kopf: Empfängerin + Eckdaten ──
  let y = ctx.y - 24
  const kopfTop = y
  textSpaced(ctx, 'Mitarbeiterin', PADX, y, 7.5, bold, C.gray, 1.2)
  y -= 7.5 + 6
  text(ctx, `${d.anrede ? d.anrede + ' ' : ''}${d.name}`, PADX, y, 11, bold, C.ink)
  y -= 15
  for (const line of [d.adresse, d.plzOrt].filter(Boolean)) {
    text(ctx, line, PADX, y, 9.5, reg, C.ink)
    y -= 12.5
  }
  let ry = kopfTop
  const meta = (label, value) => {
    if (!value) return
    textSpaced(ctx, label, PADX + CW - 190, ry, 7, bold, C.gray, 1)
    textRight(ctx, value, PADX + CW, ry - 0.5, 9.5, reg, C.ink)
    ry -= 15
  }
  meta('Beschäftigungsgrad', d.bgLabel)
  meta('Auszahlung auf', d.bank)
  y = Math.min(y, ry) - 12

  const rowH = 15.5
  const section = (label) => {
    hline(ctx, y, PADX, PADX + CW, 1.1, C.lineHead)
    y -= 7
    textSpaced(ctx, label, PADX, y, 7.5, bold, C.gray, 1.2)
    y -= 7.5 + 7
  }
  const row = (label, chf, opts = {}) => {
    const f = opts.bold ? bold : reg
    const size = opts.bold ? 10 : 9.5
    text(ctx, label, PADX + (opts.indent ? 10 : 0), y, size, f, opts.color ?? C.ink)
    if (chf != null) textRight(ctx, chf, PADX + CW, y, size, f, opts.color ?? C.ink)
    y -= opts.bold ? 18 : rowH
  }

  // ── Monatsgehalt ──
  section(d.titel === 'Umsatzabrechnung' ? 'Abrechnung' : 'Monatsgehalt')
  for (const l of d.lines) row(l.label, l.chf)
  hline(ctx, y + 4, PADX, PADX + CW, 0.75, C.lineSoft)
  y -= 3
  row('Bruttoeinkommen', d.bruttoChf, { bold: true })
  y -= 4

  // ── Versicherungsabzüge ──
  if (d.abzuege.length > 0 || d.qst) {
    section('Abzüge')
    // Spaltenköpfe Basis / Satz / Betrag
    const basisX = PADX + CW - 235, satzX = PADX + CW - 120
    textSpaced(ctx, 'BASIS', basisX - 30, y + 2, 6.5, bold, C.mute, 1)
    textSpaced(ctx, 'SATZ', satzX - 22, y + 2, 6.5, bold, C.mute, 1)
    y -= 9
    for (const a of d.abzuege) {
      text(ctx, a.label, PADX, y, 9, reg, C.ink)
      if (a.basisChf) textRight(ctx, a.basisChf, basisX, y, 8.5, reg, C.gray)
      if (a.satzPct) textRight(ctx, a.satzPct, satzX, y, 8.5, reg, C.gray)
      textRight(ctx, a.chf, PADX + CW, y, 9, reg, C.ink)
      y -= rowH
    }
    if (d.qst) {
      text(ctx, d.qst.label, PADX, y, 9, reg, C.ink)
      if (d.qst.satzPct) textRight(ctx, d.qst.satzPct, satzX, y, 8.5, reg, C.gray)
      textRight(ctx, d.qst.chf, PADX + CW, y, 9, reg, C.ink)
      y -= rowH
    }
    hline(ctx, y + 4, PADX, PADX + CW, 0.75, C.lineSoft)
    y -= 3
    row('Total Abzüge', d.abzugTotalChf, { bold: true })
    y -= 4
  }

  // ── Sozialzulagen ──
  if (d.zulagen.length > 0) {
    section('Sozialzulagen (nicht AHV-pflichtig)')
    for (const l of d.zulagen) row(l.label, l.chf)
    hline(ctx, y + 4, PADX, PADX + CW, 0.75, C.lineSoft)
    y -= 3
    row('Total Sozialzulagen', d.zulagenTotalChf, { bold: true })
    y -= 4
  }

  // ── Nach den Abzügen (z.B. bereits ausbezahlt) ──
  if (d.nach.length > 0) {
    for (const l of d.nach) row(l.label, l.chf)
    y -= 4
  }

  // ── Auszahlung ──
  y -= 6
  roundedRect(ctx, PADX, y, CW, 42, 9, C.green)
  text(ctx, 'Auszahlung', PADX + 15, y - 9, 10.5, bold, C.tealDeep)
  textRight(ctx, `CHF ${d.auszahlungChf}`, PADX + CW - 15, y - 11, 13.5, bold, C.tealDeep)
  y -= 58

  text(ctx, 'Aus ökonomischen und ökologischen Gründen verzichten wir auf eine monatlich', PADX, y, 8, reg, C.gray)
  y -= 10.5
  text(ctx, 'ausgedruckte Lohnabrechnung, sofern Lohn und Personalien nicht geändert haben.', PADX, y, 8, reg, C.gray)

  drawFooter(ctx, `${d.titel} ${d.periode}`)
  return ctx.doc.save()
}

// ═══════════════════════════ Dokument 6: Ferienplan ══════════════════════════
// One-page A4 landscape export of the Ferienplanung (accepted entries only),
// same look as the Arbeitsplan PDF: centered header, group bands, bordered
// grid, legend, footer. Two column modes so ANY interval fits on one page:
//   mode 'days'  — one column per weekday (short intervals), cell shows the
//                  colored code (F/UF/WB/ND) like the portal month view
//   mode 'weeks' — one column per calendar week with 5 day segments, like
//                  the portal year view («Ganzes Jahr» bars)
// Row height adapts to the employee count so the page never overflows.

export async function generateFerienplanPdf(d) {
  const ctx = await newDoc(`Ferienplan ${d.rangeLabel} Dentalpraxis Nidau`)
  ctx.page = ctx.doc.addPage([AP_W, AP_H])
  ctx.pageCount++
  ctx.page.drawRectangle({ x: 0, y: 0, width: AP_W, height: AP_H, color: C.page })
  const reg = ctx.fonts.reg, bold = ctx.fonts.bold
  const cw = AP_W - 2 * AP_MX
  const border = hx('#E3E1DC')
  const track = hx('#F4F2F0')
  let y = AP_H - AP_MT

  // ── header (same pattern as the Arbeitsplan PDF) ──
  textCenter(ctx, 'Dentalpraxis Nidau — Ferienplan', AP_W / 2, y, 14, bold, C.ink)
  y -= 17.5
  textCenter(ctx, d.rangeLabel, AP_W / 2, y, 10, reg, C.gray)
  y -= 12.5
  textCenter(ctx, d.createdLabel, AP_W / 2, y, 6.5, reg, C.mute)
  y -= 13

  // ── grid geometry ──
  const nameW = 92
  const totalW = d.showTotals ? 36 : 0
  const nCols = d.columns.length
  const colW = (cw - nameW - totalW) / nCols
  const gx = i => AP_MX + nameW + i * colW
  const totalX = AP_MX + nameW + nCols * colW

  // ── header band 1: month names (weeks mode) / KW (days mode) ──
  const spanH = 11
  ctx.page.drawRectangle({ x: AP_MX, y: y - spanH, width: nameW, height: spanH, color: hx('#FFFFFF'), borderColor: border, borderWidth: 0.4 })
  let ci = 0
  for (const s of d.headSpans) {
    const x1 = gx(ci), x2 = gx(ci + s.count)
    ctx.page.drawRectangle({ x: x1, y: y - spanH, width: x2 - x1, height: spanH, color: hx('#F7F5F2'), borderColor: border, borderWidth: 0.4 })
    let v = sane(s.label)
    while (v.length > 1 && bold.widthOfTextAtSize(v, 5.4) > x2 - x1 - 3) v = v.slice(0, -1)
    if (v.length > 1 || bold.widthOfTextAtSize(v, 5.4) <= x2 - x1 - 3) textCenter(ctx, v, (x1 + x2) / 2, y - 2.2, 5.4, bold, C.gray)
    ci += s.count
  }
  if (d.showTotals) ctx.page.drawRectangle({ x: totalX, y: y - spanH, width: totalW, height: spanH, color: hx('#FFFFFF'), borderColor: border, borderWidth: 0.4 })
  y -= spanH

  // ── header band 2: KW numbers (weeks) / day number + weekday (days) ──
  const headH = d.mode === 'days' ? 15 : 11
  ctx.page.drawRectangle({ x: AP_MX, y: y - headH, width: nameW, height: headH, color: hx('#FFFFFF'), borderColor: border, borderWidth: 0.4 })
  text(ctx, 'Mitarbeiter', AP_MX + 3, y - 3.2, 6, bold, C.gray)
  d.columns.forEach((col, i) => {
    ctx.page.drawRectangle({ x: gx(i), y: y - headH, width: colW, height: headH, color: hx('#FFFFFF'), borderColor: border, borderWidth: 0.4 })
    if (d.mode === 'days') {
      textCenter(ctx, String(col.num), gx(i) + colW / 2, y - 1.6, 6.3, bold, C.ink)
      textCenter(ctx, col.wd, gx(i) + colW / 2, y - 8.6, 4.6, reg, C.mute)
    } else {
      textCenter(ctx, String(col.kw), gx(i) + colW / 2, y - 2.4, 5, bold, C.gray)
    }
  })
  if (d.showTotals) {
    ctx.page.drawRectangle({ x: totalX, y: y - headH, width: totalW, height: headH, color: hx('#FFFFFF'), borderColor: border, borderWidth: 0.4 })
    textCenter(ctx, 'Tage', totalX + totalW / 2, y - (headH - 6) / 2, 6, bold, C.gray)
  }
  y -= headH

  // ── rows, height adapts so everything fits above the legend ──
  const empRows = d.groups.reduce((s, g) => s + g.rows.length, 0)
  const groupH = 10
  const legendSpace = 36
  const avail = y - AP_MB - legendSpace
  const rowH = Math.max(8, Math.min(18, (avail - d.groups.length * groupH) / Math.max(1, empRows)))

  for (const g of d.groups) {
    ctx.page.drawRectangle({ x: AP_MX, y: y - groupH, width: cw, height: groupH, color: hx(g.bg), borderColor: border, borderWidth: 0.4 })
    textSpaced(ctx, g.label, AP_MX + 3, y - 1.6, 5.4, bold, hx(g.fg), 0.5)
    y -= groupH
    for (const row of g.rows) {
      ctx.page.drawRectangle({ x: AP_MX, y: y - rowH, width: nameW, height: rowH, color: hx('#FFFFFF'), borderColor: border, borderWidth: 0.4 })
      text(ctx, row.name, AP_MX + 3, y - (rowH - 6.2) / 2, 6.2, bold, C.ink, { maxWidth: nameW - 6 })
      if (d.mode === 'days') {
        row.cells.forEach((code, i) => {
          const fill = code ? hx(d.fills[code].bg) : hx('#FFFFFF')
          ctx.page.drawRectangle({ x: gx(i), y: y - rowH, width: colW, height: rowH, color: fill, borderColor: border, borderWidth: 0.4 })
          if (code && colW >= 9 && rowH >= 8) {
            textCenter(ctx, code, gx(i) + colW / 2, y - (rowH - 5.4) / 2, 5.4, bold, hx(d.fills[code].fg))
          }
        })
      } else {
        // weeks mode: 5 day segments per week on a soft track (year-view bars)
        row.cells.forEach((days5, i) => {
          ctx.page.drawRectangle({ x: gx(i), y: y - rowH, width: colW, height: rowH, color: hx('#FFFFFF'), borderColor: border, borderWidth: 0.4 })
          const barH = Math.min(7, Math.max(4, rowH - 5))
          const barY = y - (rowH - barH) / 2 - barH
          const inset = 1.1
          const segW = (colW - 2 * inset) / 5
          ctx.page.drawRectangle({ x: gx(i) + inset, y: barY, width: colW - 2 * inset, height: barH, color: track })
          days5.forEach((code, k) => {
            if (!code) return
            ctx.page.drawRectangle({ x: gx(i) + inset + k * segW, y: barY, width: segW, height: barH, color: hx(d.fills[code].bg) })
          })
        })
      }
      if (d.showTotals) {
        ctx.page.drawRectangle({ x: totalX, y: y - rowH, width: totalW, height: rowH, color: hx('#FFFFFF'), borderColor: border, borderWidth: 0.4 })
        const t = row.total
        if (t) textCenter(ctx, t, totalX + totalW / 2, y - (rowH - 6.2) / 2, 6.2, bold, C.tealDeep)
        else textCenter(ctx, '-', totalX + totalW / 2, y - (rowH - 6.2) / 2, 6.2, reg, C.mute)
      }
      y -= rowH
    }
  }

  // ── legend ──
  y -= 8
  {
    const boxW = 11, boxH = 8
    const itemW = it => boxW + 2.5 + reg.widthOfTextAtSize(sane(it.label), 5.8) + 10
    const total = d.legend.reduce((s, it) => s + itemW(it), 0)
    let x = AP_W / 2 - total / 2
    for (const it of d.legend) {
      ctx.page.drawRectangle({ x, y: y - boxH, width: boxW, height: boxH, color: hx(it.bg), borderColor: border, borderWidth: 0.5 })
      if (d.mode === 'days') textCenter(ctx, it.code, x + boxW / 2, y - 1.1, 4.8, bold, hx(it.fg))
      x += boxW + 2.5
      x += text(ctx, it.label, x, y - 1.2, 5.8, reg, C.gray) + 10
    }
    y -= boxH + 6
  }
  if (d.hint) {
    textCenter(ctx, d.hint, AP_W / 2, y, 5.8, reg, C.gray)
  }

  // footer
  ctx.page.drawText('Dentalpraxis Nidau AG · dentalpraxisnidau.ch', { x: AP_MX, y: 8, size: 6.5, font: reg, color: C.gray })
  const ft = sane(`Ferienplan ${d.rangeLabel}`)
  const fw = reg.widthOfTextAtSize(ft, 6.5)
  ctx.page.drawText(ft, { x: AP_W - AP_MX - fw, y: 8, size: 6.5, font: reg, color: C.gray })

  return ctx.doc.save()
}

// ═══════════════════════════ Dokument 7: Bestellliste ════════════════════════
// A4 portrait on the practice letterhead (same header/footer as the Konto
// PDFs): items grouped by Firma, each with Artikel-Nr., Menge and an empty
// checkbox to tick while ordering. Paginates cleanly for long lists.

export async function generateBestelllistePdf(d) {
  const ctx = await newDoc(`Bestellliste ${d.datumLabel} Dentalpraxis Nidau`)
  const reg = () => ctx.fonts.reg, bold = () => ctx.fonts.bold
  addPage(ctx)
  drawHeader(ctx, {
    eyebrow: 'Bestellwesen',
    title: d.titel,
    rightTitle: 'Dentalpraxis Nidau',
    rightSub: d.statusLabel,
    createdLabel: d.createdLabel,
    metaLine: 'Intern · Bestellwesen',
  })
  let y = ctx.y - 16

  // column geometry
  const xName = PADX + 2
  const xNr   = PADX + 265
  const xMenge = PADX + 385
  const xBox  = PADX + CW - 30
  const rowH = 17

  const ensureSpace = (need) => {
    if (y - need < PADB + 26) { addPage(ctx); y = ctx.y - 6 }
  }
  const tableHead = () => {
    textSpaced(ctx, 'Artikel', xName, y, 6.8, bold(), C.gray, 1.2)
    textSpaced(ctx, 'Artikel-Nr.', xNr, y, 6.8, bold(), C.gray, 1.2)
    textSpaced(ctx, 'Menge', xMenge, y, 6.8, bold(), C.gray, 1.2)
    textSpaced(ctx, 'Bestellt', xBox - 18, y, 6.8, bold(), C.gray, 1.2)
    y -= 10
    hline(ctx, y, PADX, PADX + CW, 0.9, C.lineHead)
    y -= 4
  }

  for (const g of d.gruppen) {
    ensureSpace(46)
    // Firma section header
    roundedRect(ctx, PADX, y, CW, 16.5, 3, C.green)
    text(ctx, g.firma, PADX + 7, y - 3, 9, bold(), C.tealDeep)
    textRight(ctx, `${g.items.length} Position${g.items.length === 1 ? '' : 'en'}`, PADX + CW - 7, y - 4.4, 7.5, reg(), C.greenSub)
    y -= 16.5 + 7
    tableHead()
    for (const it of g.items) {
      ensureSpace(rowH + 4)
      text(ctx, it.name, xName, y, 8.6, bold(), C.ink, { maxWidth: xNr - xName - 10 })
      text(ctx, it.artikelNr || '—', xNr, y - 0.6, 8, reg(), it.artikelNr ? C.ink : C.mute)
      text(ctx, it.menge || '—', xMenge, y - 0.6, 8, reg(), it.menge ? C.ink : C.mute)
      // empty checkbox for ticking on paper
      ctx.page.drawRectangle({ x: xBox, y: y - 9.5, width: 9, height: 9, borderColor: C.lineSig, borderWidth: 0.9 })
      y -= rowH * 0.55
      hline(ctx, y - rowH * 0.32, PADX, PADX + CW, 0.5, C.lineSoft)
      y -= rowH * 0.45
    }
    y -= 10
  }

  if (d.hinweis) {
    ensureSpace(20)
    text(ctx, d.hinweis, PADX, y, 7.5, reg(), C.gray)
    y -= 12
  }

  drawFooter(ctx, (i, n) => `Bestellliste · Seite ${i + 1} von ${n}`)
  return ctx.doc.save()
}

// ═════════════════════════ Dokument 8: Anekdoten ═════════════════════════════
/** Text in Zeilen umbrechen, die in maxWidth passen (sehr lange Wörter hart getrennt). */
function wrapLines(font, t, size, maxWidth) {
  const out = []
  for (const para of sane(t).replace(/\r/g, '').split('\n')) {
    let line = ''
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const probe = line ? `${line} ${w}` : w
      if (font.widthOfTextAtSize(probe, size) <= maxWidth) { line = probe; continue }
      if (line) out.push(line)
      let rest = w
      while (rest.length > 1 && font.widthOfTextAtSize(rest, size) > maxWidth) {
        let cut = rest.length
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--
        out.push(rest.slice(0, cut)); rest = rest.slice(cut)
      }
      line = rest
    }
    out.push(line)
  }
  return out
}

