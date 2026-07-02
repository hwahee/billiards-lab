/**
 * App shell: providers (query cache, theme, locale), router, and the layout
 * with the global controls (theme / design-variant / language switching).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Moon, Palette, Sun } from 'lucide-react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router';

import { SUPPORTED_LOCALES, type Locale } from '@shared/i18n';

import { LocaleProvider, useI18n } from './i18n/locale-context';
import { BilliardsPage } from './pages/billiards-page';
import { DesignSystemPage } from './pages/design-system-page';
import { NotFoundPage } from './pages/not-found-page';
import { TodosPage } from './pages/todos-page';
import { TESTID } from './testing/testids';
import { ThemeProvider, useTheme } from './theme/theme-context';
import { Button } from './ui/button';
import { Select } from './ui/select';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const LOCALE_LABELS: Record<Locale, string> = { en: 'English', ko: '한국어' };

function Header() {
  const { t, locale, setLocale } = useI18n();
  const { theme, design, toggleTheme, toggleDesign } = useTheme();

  return (
    <header className="app-header" data-testid={TESTID.app.header}>
      <div className="app-header__brand">
        <h1 className="app-header__title">{t('app.title')}</h1>
        <p className="app-header__tagline muted">{t('app.tagline')}</p>
      </div>

      <nav className="app-nav" aria-label={t('app.title')}>
        {/* NavLink sets aria-current="page" on the active route automatically. */}
        <NavLink to="/" end data-testid={TESTID.app.navTodos}>
          {t('nav.todos')}
        </NavLink>
        <NavLink to="/billiards" data-testid={TESTID.app.navBilliards}>
          {t('nav.billiards')}
        </NavLink>
        <NavLink to="/design-system" data-testid={TESTID.app.navDesignSystem}>
          {t('nav.designSystem')}
        </NavLink>
      </nav>

      <div className="app-controls">
        <Button
          variant="ghost"
          onClick={toggleTheme}
          aria-label={theme === 'light' ? t('common.theme.dark') : t('common.theme.light')}
          testId={TESTID.app.themeToggle}
        >
          {theme === 'light' ? <Moon aria-hidden size="1em" /> : <Sun aria-hidden size="1em" />}
        </Button>
        <Button
          variant="ghost"
          onClick={toggleDesign}
          aria-label={design === 'a' ? t('common.design.b') : t('common.design.a')}
          testId={TESTID.app.designToggle}
        >
          <Palette aria-hidden size="1em" />
          {design.toUpperCase()}
        </Button>
        <Select<Locale>
          label={t('common.language')}
          hideLabel
          value={locale}
          options={SUPPORTED_LOCALES.map((code) => ({ value: code, label: LOCALE_LABELS[code] }))}
          onChange={setLocale}
          testId={TESTID.app.localeSelect}
        />
      </div>
    </header>
  );
}

function Shell() {
  const { t } = useI18n();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        {t('common.skipToContent')}
      </a>
      <Header />
      <main id="main" className="app-main">
        <Routes>
          <Route path="/" element={<TodosPage />} />
          <Route path="/billiards" element={<BilliardsPage />} />
          <Route path="/design-system" element={<DesignSystemPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LocaleProvider>
          <BrowserRouter>
            <Shell />
          </BrowserRouter>
        </LocaleProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
