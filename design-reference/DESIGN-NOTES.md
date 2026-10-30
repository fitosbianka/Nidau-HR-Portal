# Design system — distilled from Claude Design prototypes (project 9e1f2d6e, design-reference/*.dc.html)

Font: Archivo (Google, 300–800), fallback 'Helvetica Neue', sans-serif. `font-variant-numeric: tabular-nums` on all numbers.

## Tokens (tailwind.config.ts)
- paper `#F5F4F1` (page bg) · surface `#FCFBFA` (sidebar/card header/tinted) · card `#FFFFFF`
- ink `#3E3A45` · ink-2 `#6D6876` · ink-3 `#8A8492` · ink-4 `#A9A3B1` · ink-5 `#C4BFCA` (disabled/empty)
- edge (card border) `#EAE8E3` · edge-soft `#EFEDE9` (inner dividers) · edge-ctl `#E2DFD9` (controls) · edge-row `#F3F1EE` (hairline + hover bg) · edge-strong `#B9B3C0`
- hover row bg `#FAF9F7`; active/selected bg `#F1EFEA`
- dusk `#55525E` (primary btn; hover `#3E3A45`), dusk-night `#4B4653` (active nav border, sidebar avatar), btn text `#FDFDFC`
- dune `#E4DDD4` avatar bg / `#6D6876` avatar text
- mint: bg `#DFEDE8` ink `#3F6B62` mid `#5F8F86` val `#4F8278` sub `#6E948B` | weekend head `#EDF4F1` col `#F4F8F6`
- lilac: bg `#EAE7F1` ink `#5A5170` label `#7A7290` sub `#8B84A0` soft `#F3F1F5`
- apricot: bg `#F7EAD9` ink `#96703F` mid `#B08350` sub `#BC9668`
- blush: bg `#F6DFE3` ink `#A85B6B` (Frühschicht, K-code)
- steel: bg `#DFE7F2` ink `#4F6B8F` (Spätschicht, KO)

## Shape/type
Cards r14 + 1px edge; tiles r12; buttons/inputs r9; pills r99. Title 26/700 ls -.01em + 13.5 `#8A8492` subtitle mt4. Eyebrow 10.5/600 upper ls .16em `#A9A3B1` (margin 26px 0 10px). Table head 10/600 upper ls .1em `#A9A3B1` border-b 1.5px `#E2DFD9`. Body 13. Btns 13/600, pad 9x16; secondary white + edge-ctl border hover `#F3F1EE`.

## Sidebar (prototype exact)
256px surface, border-r edge, pad 28px 16px 20px. Logo 128px centered + "MITARBEITERPORTAL" 10px ls .28em ink-4 mt10; divider edge-soft (pad 8 0 18). Section label 10/600 ls .18em ink-4, margin 22 0 8 12. Item: flex gap10 pad 9x12 r8 13.5px ink-2 hover bg `#F3F1EE`; icons 15px lucide stroke 1.7. Active: bg `#F1EFEA` ink 600 + border-left 3px `#4B4653` ml -3px. Footer: border-t edge-soft pt16; avatar 32px bg `#4B4653` text `#FDFDFC` 13/600; name 13/600, role 11 ink-4; Abmelden 13 ink-2 pad 12 8 0 gap10.
Icons: users, file-text, calendar, clock, bar-chart(3 lines x=6/12/18), scale, sun, log-out.

## Main column
padding 32px 40px 48px. Header: flex between; buttons gap 10. Employee cards row: gap12 overflow-x, card 168px r12 pad 12x14 flex gap10; avatar 34 dune 12/700; name 12.5/600 truncate; value 13/700 mint-ink. Selected: bg `#F1EFEA` border `#B9B3C0`.

## Konto page
Detail card: header 18x24 surface + border-b edge-soft (avatar 40, name 15/700, meta 12 ink-3; year stepper ‹ 28px r8 ›, year 13/700 min-w 44 center).
Stat tiles: grid 3 gap12 pad 20 24 0; tile pad 16x18 r12 center; label 10/600 upper ls .14em (mint-mid/lilac-label/apricot-mid); value 26/700 mt4 (mint-ink/lilac-ink/apricot-ink); caption 10.5 mt2 (mint-sub/lilac-sub/apricot-sub).
Table: pad 20 24 8; grid cols `1.2fr .85fr .85fr 1fr .9fr .8fr 1fr 1fr` gap10; head pad 0 10 8; rows pad 10, 13 tabular, border-b edge-row, hover `#FAF9F7`; month 600; Zeitkonto col 700 mint-val; empty month all "–" ink-5.
Bemerkungen: margin 14 24 24, bg lilac-soft r12 pad 14x18; label 10/600 ls .16em lilac-label upper; text 13 mt4.

## Zeiterfassung page
Eyebrow "AUGUST 2026 — ARBEITSSTUNDEN" + hour cards (7-8, value teal e.g. "53:50 h").
Filter card: r14 pad 18x24 flex items-end gap18 wrap. Field label 10/600 ls .14em ink-4 mb6. date input: 13 ink border edge-ctl r9 pad 8x12 bg surface. Chips: 12.5/600 pill pad 8x14; active dusk bg white text; inactive white + edge-ctl. MITARBEITER select right (margin-left auto), min-w 190.
Report card: header 18x24 surface border-b edge-soft; avatar 40; name 15/700; sub 12 ink-3 "26 Schichten"; right: TOTAL label 10/600 ls .14em ink-4, total 19/700 tabular, note 11 apricot-mid "inkl. +59:30 h Krank".
Day bar: flex between pad 10x24 bg lilac-soft 12.5; date 600; total 700 lilac-label.
Rows container pad 6 24 16. Entry row: grid `90px 90px 90px 1fr auto` gap14 pad 9 0, 13.5 tabular, r8, hover `#FAF9F7`; in/out 600; dur 700 mint-ink; ort 12.5 ink-4; actions flex gap14 13px ink-5 (＋ ✎ hover ink-2, ✕ hover `#B0654F`).
Pause row: flex gap12 pad 4 0; flanking 1px dashed edge-ctl lines; pill 10.5/600 lilac-label bg lilac-bg r99 pad 3x12 "46 min Pause".
Note filled: border edge-ctl r9 pad 10x14 13 mt6 bg surface. Note empty: input full-width same but bg white, placeholder "Tagesnotiz…".

## Arbeitsplan page
Subtitle: "Monatliche Dienstplanung — klicken Sie eine Zelle um sie zu bearbeiten".
Month card: r14 pad 16x24; centered stepper ‹ 30px r9 ›; month 16/700; sub 11.5 ink-3 "31 Tage · 21 Arbeitstage · Entwurf" (Entwurf mint-ink 600). Soll chips row: center gap8 mt14 wrap; chip border edge r9 pad 6x12 center bg surface; pct 10/700 ink-3; hours 11.5/600 tabular.
Grid card: r14 mt18 pad 16x18 overflow-x. Head: grid `176px repeat(31, minmax(24px,1fr))` border-b 1.5px edge-ctl pb6; "MITARBEITER" 10.5 ls .12em ink-4 self-end; day head cell center r6 top pad 3 0; num 11/700 (weekend mint-mid, else ink), wd 8.5 ink-4; weekend head bg `#EDF4F1`.
Group pill row: pad 10 0 4; pill 10/700 ls .1em r6 pad 3x10 (ZAZ mint, DH/PA steel, DA apricot, LERNENDE lilac, ADMIN `#6D6876` on `#F1EFEA`).
Employee row: same grid; border-b edge-row; name cell flex gap8 pad 5 0 (avatar 22 dune 8.5/700; name 11.5/600 truncate). Cell: h30 center, weekend bg `#F4F8F6`; hover inset ring 1.5px `#B9B3C0`; selected inset ring 1.5px `#4B4653`. Chip: min-w 19 h19 r5 9.5/700 tabular pad 0 2; colors: Früh blush, Tag apricot, Spät steel, Halbtag mint, HO/Schule/WB lilac, plain code transparent/`#6D6876`.
Legend: flex gap14 wrap mt16 pt12 border-t edge-soft 10.5 ink-2; chip 17px r5 8.5/700 + 1px edge border. Codes: ✓ Anwesend, E Empfang, St Steri, / Tagesleitende (plain); HO/S/WB lilac; F mint; K blush; KO steel; + 4 color chips Früh/Tag/Spät/Halbtag.
Shift times line: mt12 10px ink-4 lh 1.7, labels bold ink-3: Assistenz 7:45–12:00 (flexibel) 13:00–17:15 · Steri 8:00–12:15 13:00–17:15 · Empfang 7:45–12:15 13:15–17:15 · Tagesleitende 8:00–17:00 · Frühschicht 06:30–13:30 · Halbtagsschicht 6:45 / 7:45–12:15 · Tagesschicht 6:45–16:15 · Spätschicht 12:00–20:15.
