/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#7C3AED', dark: '#5B21B6' },
        ink: '#0B0B0F',
        surface: 'rgb(var(--surface) / <alpha-value>)',
      },
      fontFamily: { display: ['Montserrat-Bold'], body: ['Montserrat-Regular'] },
    },
  },
};
