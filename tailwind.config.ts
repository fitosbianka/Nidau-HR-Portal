import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    // utils.ts carries folder/badge class names (DOCUMENT_CATEGORIES) —
    // without this they get purged from the CSS bundle
    './src/lib/**/*.{js,ts}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-archivo)', 'Helvetica Neue', 'sans-serif'],
      },
      colors: {
        // ── Design system (design-reference prototypes) ──────────────
        paper:   '#F5F4F1',                 // page background
        surface: '#FCFBFA',                 // sidebar / card headers / tinted fields
        ink: {
          DEFAULT: '#3E3A45',               // primary text
          2: '#6D6876',                     // secondary
          3: '#8A8492',                     // muted / labels
          4: '#A9A3B1',                     // faint
          5: '#C4BFCA',                     // disabled / empty
        },
        edge: {
          DEFAULT: '#EAE8E3',               // card borders
          soft:    '#EFEDE9',               // inner dividers
          ctl:     '#E2DFD9',               // control borders
          row:     '#F3F1EE',               // hairline row dividers + hover bg
          strong:  '#B9B3C0',
        },
        dusk: {
          DEFAULT: '#55525E',               // dark button
          deep:    '#3E3A45',               // dark button hover
          night:   '#4B4653',               // active-nav border / sidebar avatar
        },
        dune: '#E4DDD4',                    // avatar circles (text ink-2)
        hovrow: '#FAF9F7',                  // table row hover
        active: '#F1EFEA',                  // selected/active background
        mint: {
          bg:  '#DFEDE8', ink: '#3F6B62', mid: '#5F8F86', val: '#4F8278',
          sub: '#6E948B', head: '#EDF4F1', col: '#F4F8F6',
        },
        lilac: {
          bg: '#EAE7F1', ink: '#5A5170', label: '#7A7290', sub: '#8B84A0', soft: '#F3F1F5',
        },
        apricot: { bg: '#F7EAD9', ink: '#96703F', mid: '#B08350', sub: '#BC9668' },
        blush:   { bg: '#F6DFE3', ink: '#A85B6B' },
        steel:   { bg: '#DFE7F2', ink: '#4F6B8F' },

        // ── Legacy scales (kept so unmigrated classes stay on-brand) ──
        teal: {
          50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4',
          400: '#2dd4bf', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e',
          800: '#115e59', 900: '#134e4a', 950: '#042f2e',
        },
        brand: {
          50:  '#F3F1EE',
          100: '#F1EFEA',
          200: '#E2DFD9',
          300: '#B9B3C0',
          400: '#A9A3B1',
          500: '#8A8492',
          600: '#55525E',
          700: '#3E3A45',
          800: '#34313B',
          900: '#2A2830',
          950: '#1B1A1F',
        },
        accent: {
          50:  '#FAF8F5',
          100: '#F2EDE7',
          200: '#E5D8CC',
          300: '#C4B5A5',
          400: '#B09C88',
          500: '#9B846E',
          600: '#866E58',
        },
      },
      borderRadius: {
        card: '14px',
        tile: '12px',
        ctl:  '9px',
      },
    },
  },
  plugins: [],
}
export default config
