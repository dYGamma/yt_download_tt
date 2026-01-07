/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        cream: "#FEF9E7",
        ink: "#0F172A",
        pop: "#FF6B6B",
        butter: "#FFF1C9",
      },
      boxShadow: {
        brutal: "4px 4px 0 0 #0F172A",
        brutalPop: "6px 6px 0 0 #FF6B6B",
        brutalInset: "2px 2px 0 0 #0F172A",
      },
    },
  },
  plugins: [],
};
