/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: '#f4f7f5',
        parchment: '#eaf3ee',
        blush: '#fdecea',
        blush2: '#f5c6c0',
        sage: '#d6ebe0',
        sage2: '#a9d6c1',
        sage3: '#3f8f74',
        sky: '#dbeaf7',
        amberSoft: '#fbefd2',
        amber2: '#e9c46a',
        sand: '#e2e9e5',
        brown2: '#2f6f5e',
        textDark: '#1c2b26',
        textLight: '#66756f',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        serif: ['Plus Jakarta Sans', 'sans-serif'],
      }
    },
  },
  plugins: [],
}