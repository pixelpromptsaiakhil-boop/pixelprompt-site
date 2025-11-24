/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,js}",
    "./public/**/*.html",
    "./**/*.html",
    "./js/**/*.js"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f6fbff',
          500: '#2563eb',
        }
      },
      borderRadius: {
        '2xl': '1rem'
      }
    }
  },
  plugins: []
};
