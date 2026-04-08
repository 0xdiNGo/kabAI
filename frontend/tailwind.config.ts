import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        matrix: {
          bg: "var(--theme-bg)",
          surface: "var(--theme-surface)",
          card: "var(--theme-card)",
          input: "var(--theme-input)",
          border: "var(--theme-border)",
          hover: "var(--theme-hover)",
          green: "var(--theme-green)",
          "green-dim": "var(--theme-green-dim)",
          "green-muted": "#79740e",
          "green-dark": "#5a5a0a",
          text: "var(--theme-text)",
          "text-bright": "var(--theme-text-bright)",
          "text-dim": "var(--theme-text-dim)",
          "text-faint": "var(--theme-text-faint)",
          accent: "var(--theme-accent)",
          "accent-hover": "var(--theme-accent-hover)",
          purple: "var(--theme-purple)",
          "purple-dim": "var(--theme-purple-dim)",
          red: "var(--theme-red)",
          amber: "var(--theme-amber)",
          aqua: "var(--theme-aqua)",
          blue: "var(--theme-blue)",
          yellow: "var(--theme-yellow)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
