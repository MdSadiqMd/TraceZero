/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        lime: {
          DEFAULT: "#BFFF00",
          50: "#F5FFE6",
          100: "#EAFFCC",
          200: "#DEFF99",
          300: "#D1FF66",
          400: "#C5FF33",
          500: "#BFFF00",
          600: "#99CC00",
          700: "#739900",
          800: "#4D6600",
          900: "#263300",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Courier New", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      animation: {
        scan: "scan 8s linear infinite",
        glitch: "glitch 1s linear infinite",
        terminal: "terminal 0.5s steps(20, end)",
        flicker: "flicker 0.15s infinite",
      },
      keyframes: {
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
        glitch: {
          "0%, 100%": { transform: "translate(0)" },
          "20%": { transform: "translate(-2px, 2px)" },
          "40%": { transform: "translate(-2px, -2px)" },
          "60%": { transform: "translate(2px, 2px)" },
          "80%": { transform: "translate(2px, -2px)" },
        },
        terminal: {
          from: { width: "0" },
          to: { width: "100%" },
        },
        flicker: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.8" },
        },
      },
    },
  },
  plugins: [],
};
