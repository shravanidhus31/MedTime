/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: '#fdf8f0',
        parchment: '#f5ede0',
        blush: '#f7ddd4',
        blush2: '#f2c4b5',
        sage: '#c8d9c4',
        sage2: '#a8c4a2',
        sage3: '#7da876',
        sky: '#c5dff0',
        amberSoft: '#f7e4b0',
        amber2: '#f2cc72',
        sand: '#e8dcc8',
        brown2: '#5c4535',
        textDark: '#2d2418',
        textLight: '#8a7560',
      },
      fontFamily: {
        sans: ['Nunito', 'sans-serif'],
        serif: ['Lora', 'serif'],
      }
    },
  },
  plugins: [],
}