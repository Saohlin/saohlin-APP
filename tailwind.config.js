const colors = require('./theme/tailwind-colors');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './index.ts', './app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './screens/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors,
      fontFamily: {
        // Michroma for brand, headings, buttons and labels; Inter for reading text.
        // `sans-medium` avoids clashing with Tailwind's `font-medium` weight utility.
        display: ['Michroma_400Regular'],
        sans: ['Inter_400Regular'],
        'sans-medium': ['Inter_500Medium'],
        'sans-semibold': ['Inter_600SemiBold'],
      },
      // Must match theme/typography.ts exactly. These classes are what render.
      fontSize: {
        display: ['34px', { lineHeight: '40px', letterSpacing: '1.6px' }],
        'title-lg': ['22px', { lineHeight: '31px', letterSpacing: '2.2px' }],
        greeting: ['18.5px', { lineHeight: '26px', letterSpacing: '0.3px' }],
        title: ['15px', { lineHeight: '23px', letterSpacing: '1.8px' }],
        button: ['10px', { lineHeight: '15px', letterSpacing: '1.1px' }],
        section: ['11px', { lineHeight: '16px', letterSpacing: '1.3px' }],
        label: ['9px', { lineHeight: '12px', letterSpacing: '1.35px' }],
        'nav-item': ['13.5px', { lineHeight: '20px', letterSpacing: '1.2px' }],
        body: ['15px', { lineHeight: '24px' }],
        tagline: ['20px', { lineHeight: '28px' }],
        lead: ['13px', { lineHeight: '23px' }],
        chat: ['13.5px', { lineHeight: '21px' }],
        caption: ['12px', { lineHeight: '21px' }],
        micro: ['10px', { lineHeight: '14px', letterSpacing: '0.6px' }],
      },
      borderRadius: {
        sm: '8px',
        cell: '12px',
        DEFAULT: '14px',
        input: '14px',
        card: '20px',
        sheet: '28px',
        pill: '999px',
      },
      // Named spacing steps mirroring theme/layout.ts.
      spacing: {
        xxs: '4px',
        xs: '8px',
        sm: '12px',
        md: '16px',
        lg: '24px',
        xl: '32px',
        xxl: '48px',
        gutter: '26px',
        field: '13px',
        section: '32px',
      },
      opacity: { glass: '0.62', 'glass-soft': '0.48' },
      transitionDuration: { fast: '90ms', base: '160ms', slow: '240ms' },
    },
  },
  plugins: [],
};
