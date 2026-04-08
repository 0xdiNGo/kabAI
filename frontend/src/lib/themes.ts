/**
 * Theme system — base themes define the palette, accents are independent.
 * Users pick a base theme AND an accent color separately.
 */

export interface BaseTheme {
  id: string;
  name: string;
  colors: Record<string, string>; // all non-accent color tokens
}

export interface Accent {
  id: string;
  name: string;
  color: string;      // primary accent
  hover: string;      // accent hover/darker
}

// ── Gruvbox palettes ────────────────────────────────────────────────

const GRUVBOX_DARK: Record<string, string> = {
  bg: "#1d2021",
  surface: "#282828",
  card: "#3c3836",
  input: "#504945",
  border: "#665c54",
  hover: "#504945",
  text: "#ebdbb2",
  "text-bright": "#fbf1c7",
  "text-dim": "#a89984",
  "text-faint": "#7c6f64",
  green: "#b8bb26",
  "green-dim": "#98971a",
  purple: "#d3869b",
  "purple-dim": "#b16286",
  red: "#fb4934",
  amber: "#fabd2f",
  aqua: "#8ec07c",
  blue: "#83a598",
  yellow: "#fabd2f",
};

const GRUVBOX_LIGHT: Record<string, string> = {
  bg: "#fbf1c7",
  surface: "#f2e5bc",
  card: "#ebdbb2",
  input: "#d5c4a1",
  border: "#bdae93",
  hover: "#d5c4a1",
  text: "#3c3836",
  "text-bright": "#282828",
  "text-dim": "#665c54",
  "text-faint": "#7c6f64",
  green: "#98971a",
  "green-dim": "#79740e",
  purple: "#b16286",
  "purple-dim": "#8f3f71",
  red: "#cc241d",
  amber: "#d79921",
  aqua: "#689d6a",
  blue: "#458588",
  yellow: "#d79921",
};

// ── Artist palettes (inspired by colorlisa.com) ─────────────────────
// Each palette derives bg/surface/card from the darkest colors,
// text from the lightest, and semantic colors from the palette.

const PICASSO: Record<string, string> = {
  bg: "#1C1418",
  surface: "#2A1F24",
  card: "#3D2C32",
  input: "#4E3A40",
  border: "#6B4F56",
  hover: "#4E3A40",
  text: "#DCD6B2",
  "text-bright": "#E8E2C8",
  "text-dim": "#D5898D",
  "text-faint": "#A1544B",
  green: "#80944E",
  "green-dim": "#5E7038",
  purple: "#CD6C74",
  "purple-dim": "#A1544B",
  red: "#A9011B",
  amber: "#E4A826",
  aqua: "#4E7989",
  blue: "#566C7D",
  yellow: "#E4A826",
};

const MONET: Record<string, string> = {
  bg: "#0E2218",
  surface: "#184430",
  card: "#2A4A35",
  input: "#3B5E42",
  border: "#548150",
  hover: "#3B5E42",
  text: "#E5DCBE",
  "text-bright": "#F0E8D4",
  "text-dim": "#82A4BC",
  "text-faint": "#4C7899",
  green: "#7EA860",
  "green-dim": "#2F5136",
  purple: "#B985BA",
  "purple-dim": "#8A5E8B",
  red: "#852419",
  amber: "#DEB738",
  aqua: "#4885A4",
  blue: "#395A92",
  yellow: "#B1B94C",
};

const VAN_GOGH: Record<string, string> = {
  bg: "#0F1A18",
  surface: "#1a3431",
  card: "#283E48",
  input: "#374D5A",
  border: "#5A5F80",
  hover: "#374D5A",
  text: "#E0BA7A",
  "text-bright": "#FBDC30",
  "text-dim": "#9BA7B0",
  "text-faint": "#5A5F80",
  green: "#82A866",
  "green-dim": "#A7A651",
  purple: "#93A0CB",
  "purple-dim": "#6283c8",
  red: "#A35029",
  amber: "#C4B743",
  aqua: "#6283c8",
  blue: "#2b41a7",
  yellow: "#ccc776",
};

const REMBRANDT: Record<string, string> = {
  bg: "#090A04",
  surface: "#1A1708",
  card: "#2E2812",
  input: "#3F3820",
  border: "#5B5224",
  hover: "#3F3820",
  text: "#DBC99A",
  "text-bright": "#E8D8B0",
  "text-dim": "#A68329",
  "text-faint": "#7A6520",
  green: "#8A7B30",
  "green-dim": "#5B5224",
  purple: "#8A6840",
  "purple-dim": "#6B4E2E",
  red: "#8A350C",
  amber: "#A68329",
  aqua: "#7A8050",
  blue: "#5B5224",
  yellow: "#DBC99A",
};

const KLIMT: Record<string, string> = {
  bg: "#141620",
  surface: "#1E2232",
  card: "#2A3048",
  input: "#384060",
  border: "#4A5FAB",
  hover: "#384060",
  text: "#E3C454",
  "text-bright": "#F0D468",
  "text-dim": "#A27CBA",
  "text-faint": "#609F5C",
  green: "#609F5C",
  "green-dim": "#4A7A46",
  purple: "#A27CBA",
  "purple-dim": "#7C5A90",
  red: "#B85031",
  amber: "#E3C454",
  aqua: "#609F5C",
  blue: "#4A5FAB",
  yellow: "#E3C454",
};

// ── Accent definitions ──────────────────────────────────────────────

export const accents: Accent[] = [
  { id: "orange",  name: "Orange",  color: "#fe8019", hover: "#d65d0e" },
  { id: "green",   name: "Green",   color: "#b8bb26", hover: "#98971a" },
  { id: "purple",  name: "Purple",  color: "#d3869b", hover: "#b16286" },
  { id: "aqua",    name: "Aqua",    color: "#8ec07c", hover: "#689d6a" },
  { id: "blue",    name: "Blue",    color: "#83a598", hover: "#458588" },
  { id: "yellow",  name: "Yellow",  color: "#fabd2f", hover: "#d79921" },
  { id: "red",     name: "Red",     color: "#fb4934", hover: "#cc241d" },
];

// ── Base theme definitions ──────────────────────────────────────────

export const baseThemes: BaseTheme[] = [
  { id: "gruvbox-dark",  name: "Gruvbox Dark",  colors: GRUVBOX_DARK },
  { id: "gruvbox-light", name: "Gruvbox Light", colors: GRUVBOX_LIGHT },
  { id: "picasso",       name: "Picasso",       colors: PICASSO },
  { id: "monet",         name: "Monet",         colors: MONET },
  { id: "van-gogh",      name: "Van Gogh",      colors: VAN_GOGH },
  { id: "rembrandt",     name: "Rembrandt",     colors: REMBRANDT },
  { id: "klimt",         name: "Klimt",         colors: KLIMT },
];

export const defaultThemeId = "gruvbox-dark";
export const defaultAccentId = "orange";

export function getBaseTheme(id: string): BaseTheme {
  return baseThemes.find((t) => t.id === id) ?? baseThemes[0]!;
}

export function getAccent(id: string): Accent {
  return accents.find((a) => a.id === id) ?? accents[0]!;
}

/**
 * Apply a base theme + accent as CSS custom properties on the document root.
 * Glass mode makes card/surface/input semi-transparent.
 */
export function applyTheme(
  theme: BaseTheme,
  accent: Accent,
  glass: boolean = false,
): void {
  const root = document.documentElement;
  const colors = { ...theme.colors };

  // Apply accent
  colors.accent = accent.color;
  colors["accent-hover"] = accent.hover;

  if (glass) {
    colors.card = hexToRgba(colors.card ?? "#3c3836", 0.55);
    colors.surface = hexToRgba(colors.surface ?? "#282828", 0.6);
    colors.input = hexToRgba(colors.input ?? "#504945", 0.6);
    colors.hover = hexToRgba(colors.hover ?? "#504945", 0.65);
  }

  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(`--theme-${key}`, value);
  }

  const surfaceColor = theme.colors.surface ?? "#282828";
  root.style.setProperty("--theme-glass-blur", glass ? "12px" : "0px");
  root.style.setProperty(
    "--theme-glass-sidebar-bg",
    glass ? hexToRgba(surfaceColor, 0.7) : surfaceColor,
  );
  root.style.setProperty("--theme-glass-sidebar-blur", glass ? "16px" : "0px");
}

function hexToRgba(hex: string, alpha: number): string {
  if (hex.startsWith("rgba")) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
