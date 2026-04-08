import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  applyTheme,
  defaultAccentId,
  defaultThemeId,
  getAccent,
  getBaseTheme,
} from "@/lib/themes";

interface ThemeState {
  themeId: string;
  accentId: string;
  glass: boolean;
  background: string;       // "none" | "matrix-rain" | future options
  rainBaseSpeed: number;     // 0–1, user-controlled base speed for matrix rain
  streamingIntensity: number; // 0–1, set by ChatPage during LLM streaming
  setThemeId: (id: string) => void;
  setAccentId: (id: string) => void;
  setGlass: (v: boolean) => void;
  setBackground: (bg: string) => void;
  setRainBaseSpeed: (v: number) => void;
  setStreamingIntensity: (v: number) => void;
  apply: () => void;
}

function applyFromState(themeId: string, accentId: string, glass: boolean) {
  applyTheme(getBaseTheme(themeId), getAccent(accentId), glass);
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      themeId: defaultThemeId,
      accentId: defaultAccentId,
      glass: false,
      background: "none",
      rainBaseSpeed: 0.3,
      streamingIntensity: 0,
      setThemeId: (id) => {
        set({ themeId: id });
        applyFromState(id, get().accentId, get().glass);
      },
      setAccentId: (id) => {
        set({ accentId: id });
        applyFromState(get().themeId, id, get().glass);
      },
      setGlass: (v) => {
        set({ glass: v });
        applyFromState(get().themeId, get().accentId, v);
      },
      setBackground: (bg) => set({ background: bg }),
      setRainBaseSpeed: (v) => set({ rainBaseSpeed: Math.max(0, Math.min(1, v)) }),
      setStreamingIntensity: (v) => set({ streamingIntensity: Math.max(0, Math.min(1, v)) }),
      apply: () => {
        const { themeId, accentId, glass } = get();
        applyFromState(themeId, accentId, glass);
      },
    }),
    {
      name: "kabai-theme",
      partialize: (s) => ({
        themeId: s.themeId,
        accentId: s.accentId,
        glass: s.glass,
        background: s.background,
        rainBaseSpeed: s.rainBaseSpeed,
        // streamingIntensity is NOT persisted — always starts at 0
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyFromState(state.themeId, state.accentId, state.glass);
        }
      },
    },
  ),
);
