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
  setThemeId: (id: string) => void;
  setAccentId: (id: string) => void;
  setGlass: (v: boolean) => void;
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
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyFromState(state.themeId, state.accentId, state.glass);
        }
      },
    },
  ),
);
