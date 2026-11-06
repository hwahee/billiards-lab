/**
 * Theme context — two independent axes, both applied as attributes on <html>
 * and consumed purely by CSS custom properties (src/client/styles/tokens.css):
 *
 *   data-theme:  'light' | 'dark'     — color scheme
 *   data-design: 'standard' | 'contrast' | 'office' | 'kids' — design variant:
 *       Standard      = the default (refined spacing, softer contrast)
 *       Contrast      = standard's shape with high-contrast colors
 *       Office        = 2000s MS Office (dense, beveled controls, no motion)
 *       Kids          = playground/toy vibe (chunky, rounded, exaggerated motion)
 *
 * Both persist to localStorage; a design saved under its old name (a, b) is
 * read as the new one and saved back under it. The initial theme derives from the OS
 * preference — computed once, not stored as extra state.
 */
import { designFrom, type Design, type Theme } from '@shared/domain/appearance';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type { Design, Theme };

/** The design a toggle click moves to next — cycles Standard → Contrast → Office → Kids → Standard. */
const NEXT_DESIGN: Record<Design, Design> = {
  standard: 'contrast',
  contrast: 'office',
  office: 'kids',
  kids: 'standard',
};

export function nextDesign(current: Design): Design {
  return NEXT_DESIGN[current];
}

interface ThemeContextValue {
  theme: Theme;
  design: Design;
  toggleTheme: () => void;
  toggleDesign: () => void;
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
  return designFrom(localStorage.getItem(DESIGN_KEY)) ?? 'standard';
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
        toggleDesign: () => setDesign(nextDesign),
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
