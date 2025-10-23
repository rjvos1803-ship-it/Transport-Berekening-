/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        primary: '#003366', // Coatinc-blauw (optioneel)
        accent: '#D71920'   // Coatinc-rood (optioneel)
      },
      fontFamily: {
        sans: ['Inter', 'Arial', 'sans-serif']
      }
    },
  },
  plugins: [],
};
