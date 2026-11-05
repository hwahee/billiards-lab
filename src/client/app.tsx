/**
 * App shell: providers (query cache, theme, locale, overlays), router, and the layout
 * with the shared footer, which routes can opt out of one group at a time.
 * The header is just the service name (a link home) and the account controls.
 * Page links live in the footer's link columns, and the global preference
 * switches (theme / design variant / language) in its identity row — see
 * ./ui/footer.tsx and ./ui/app-controls.tsx.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Outlet, Route, Routes } from 'react-router';

import { isRetryableError } from './api/http';
import { AccountControls } from './auth/account-controls';
import { LocaleProvider, useI18n } from './i18n/locale-context';
import { DesignSystemPage } from './pages/design-system-page';
import { HomePage } from './pages/home-page';
import { NotFoundPage } from './pages/not-found-page';
import { SignInFailedPage } from './pages/sign-in-failed-page';
import { TESTID } from './testing/testids';
import { ThemeProvider } from './theme/theme-context';
import { Footer } from './ui/footer';
import { OverlayProvider } from './ui/overlay';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // One retry, and only when it could change the answer (never on a 4xx).
      retry: (failureCount, error) => failureCount < 1 && isRetryableError(error),
    },
  },
});

function Header() {
  const { t } = useI18n();

  return (
    <header className="app-header" data-testid={TESTID.app.header}>
      <div className="app-header__brand">
        {/* With no nav row, the service name is the way home from any page. */}
        <h1 className="app-header__title">
          <Link to="/" data-testid={TESTID.app.homeLink}>
            {t('app.title')}
          </Link>
        </h1>
        <p className="app-header__tagline muted">{t('app.tagline')}</p>
      </div>

      {/* Signing in stays up here; the preference switches that used to share
          this row moved to the footer. */}
      <div className="app-controls">
        <AccountControls />
      </div>
    </header>
  );
}

/**
 * The chrome wrapped around a routed page.
 *
 * `footer` is the per-route switch for the shared footer. It defaults to
 * `true`, so a new route keeps the footer unless it explicitly opts out —
 * the exception has to be declared, never the rule.
 */
function AppLayout({ footer = true }: { footer?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        {t('common.skipToContent')}
      </a>
      <Header />
      <main id="main" className="app-main">
        <Outlet />
      </main>
      {footer && <Footer />}
    </div>
  );
}

/**
 * Route table. Chrome is expressed with layout routes rather than a flag
 * consulted inside the pages, so which routes carry the footer is readable
 * here in one place.
 *
 * Routes are ranked by specificity, not by source order, so the `*` fallback
 * below never shadows a concrete path declared in another group.
 */
function AppRoutes() {
  return (
    <Routes>
      {/* Standard chrome: header + footer. */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/design-system" element={<DesignSystemPage />} />
        <Route path="/sign-in-failed" element={<SignInFailedPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      {/* Pages that own the whole viewport — full-screen editors, embedded
          widgets, kiosk views — go in their own group with the footer off:

      <Route element={<AppLayout footer={false} />}>
        <Route path="/embed/:id" element={<EmbedPage />} />
      </Route> */}
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LocaleProvider>
          <BrowserRouter>
            {/* Inside every provider and the router: overlays opened through
                useOverlay() render here, so they see exactly these contexts
                and nothing from the subtree that opened them. */}
            <OverlayProvider>
              <AppRoutes />
            </OverlayProvider>
          </BrowserRouter>
        </LocaleProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
