/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index-shell.html",
    "./fragments/**/*.html",
    "./static/games/**/*.{html,js}",
    "./src/**/*.{css,js}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
