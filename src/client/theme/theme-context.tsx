/**
 * Theme context — two independent axes, both applied as attributes on <html>
 * and consumed purely by CSS custom properties (src/client/styles/tokens.css):
 *
 *   data-theme:  'light' | 'dark'     — color scheme
 *   data-design: 'a' | 'b' | 'office' | 'kids' — design variant:
 *       A      = aesthetic-first (refined spacing, softer contrast)
 *       B      = visibility-first (larger type, high contrast, bigger targets)
 *       Office = 2000s MS Office (dense, beveled controls, no motion)
 *       Kids  = playground/toy vibe (chunky, rounded, exaggerated motion)
 *
 * Both persist to localStorage. The initial theme derives from the OS
 * preference — computed once, not stored as extra state.
 */
import type { Design, Theme } from '@shared/domain/appearance';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type { Design, Theme };

interface ThemeContextValue {
  theme: Theme;
  design: Design;
  toggleTheme: () => void;
  /** Picks a design directly — every variant has its own toggle, so there is no cycling. */
  setDesign: (design: Design) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_KEY = 'app.theme';
const DESIGN_KEY = 'app.design';

function initialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initialDesign(): Design {
  const stored = localStorage.getItem(DESIGN_KEY);
  return stored === 'b' || stored === 'office' || stored === 'kids' ? stored : 'a';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [design, setDesign] = useState<Design>(initialDesign);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.design = design;
    localStorage.setItem(DESIGN_KEY, design);
  }, [design]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        design,
        toggleTheme: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')),
        // useState's setter is already stable, so it crosses the context as-is.
        setDesign,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used within <ThemeProvider>');
  return value;
}
