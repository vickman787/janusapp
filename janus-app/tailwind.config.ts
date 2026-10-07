import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Janus design system — from the spec
        obsidian:     "#0B0813",
        surface:      "#161224",
        border:       "#2A2242",
        brand:        "#836EF9",  // Monad purple
        "brand-dark": "#6B55D4",
        accent:       "#A0055D",  // Magenta
        success:      "#10B981",  // Biometric green
        "success-glow": "rgba(16, 185, 129, 0.25)",
        "brand-glow":   "rgba(131, 110, 249, 0.25)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      boxShadow: {
        brand:   "0 0 20px rgba(131, 110, 249, 0.35)",
        success: "0 0 20px rgba(16, 185, 129, 0.35)",
        card:    "0 4px 24px rgba(0, 0, 0, 0.4)",
      },
      backgroundImage: {
        "gradient-brand": "linear-gradient(135deg, #836EF9 0%, #A0055D 100%)",
        "gradient-surface": "linear-gradient(180deg, #161224 0%, #0B0813 100%)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "glow-brand": "glowBrand 2s ease-in-out infinite alternate",
      },
      keyframes: {
        glowBrand: {
          "0%":   { boxShadow: "0 0 10px rgba(131, 110, 249, 0.2)" },
          "100%": { boxShadow: "0 0 30px rgba(131, 110, 249, 0.6)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
