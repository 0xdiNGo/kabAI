import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        matrix: {
          bg: "#1d2021",
          surface: "#282828",
          card: "#3c3836",
          input: "#504945",
          border: "#665c54",
          hover: "#504945",
          green: "#b8bb26",
          "green-dim": "#98971a",
          "green-muted": "#79740e",
          "green-dark": "#5a5a0a",
          text: "#ebdbb2",
          "text-bright": "#fbf1c7",
          "text-dim": "#a89984",
          "text-faint": "#7c6f64",
          accent: "#fe8019",
          "accent-hover": "#d65d0e",
          purple: "#d3869b",
          "purple-dim": "#b16286",
          red: "#fb4934",
          amber: "#fabd2f",
          aqua: "#8ec07c",
          blue: "#83a598",
          yellow: "#fabd2f",
        },
      },
    },
  },
  plugins: [],
};

export default config;
