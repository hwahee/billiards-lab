/**
 * Hybrid footer, in three bands separated from the page body by one thin
 * border: the identity row (service name, tagline and the global preference
 * switches), the link columns below it, and a minimal copyright line last.
 *
 * The identity row is closed with a hairline of its own — that rule is what
 * keeps the service's identity from reading as just another link column.
 *
 * The "Other Services" column is data-driven: it renders whatever
 * `/sitemap.json` serves, so adding a service is a data edit (see
 * `public/sitemap.json`) rather than a change here. While that list loads —
 * or if it fails — the column heading stays and the list is simply omitted:
 * chrome below the fold should never show a spinner or an error banner.
 *
 * This service's own reference pages (the design system) are not services, so
 * they sit in the bottom line beside the legal links — site information, not
 * destinations. They move to a sidebar if the app grows one.
 */
import { NavLink } from 'react-router';

import type { MessageKey } from '@shared/i18n';

import { useSitemap } from '../api/queries';
import { useI18n } from '../i18n/locale-context';
import { TESTID } from '../testing/testids';
import { AppControls } from './app-controls';

/** The domain every service on this footer belongs to. */
const SITE_NAME = 'hwahee.com';

const GITHUB_URL = 'https://github.com/hwahee';

/**
 * Legal pages live on the umbrella domain, not per service, so every service
 * embedding this footer points at the same two documents.
 */
const LEGAL_LINKS: readonly { key: MessageKey; href: string }[] = [
  { key: 'footer.terms', href: `https://${SITE_NAME}/terms` },
  { key: 'footer.privacy', href: `https://${SITE_NAME}/privacy` },
];

/**
 * GitHub's mark. lucide dropped brand icons in v1, so it is inlined here;
 * `currentColor` keeps it in step with the footer's muted text color.
 */
function GithubMark() {
  return (
    <svg className="app-footer__icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function Footer() {
  const { t } = useI18n();
  const { data: sitemap } = useSitemap();
  const services = sitemap?.services ?? [];

  return (
    <footer className="app-footer" data-testid={TESTID.app.footer}>
      <div className="app-footer__identity">
        <div>
          <p className="app-footer__brand">{t('app.title')}</p>
          <p className="app-footer__tagline">{t('app.tagline')}</p>
        </div>
        <AppControls />
      </div>

      <div className="app-footer__columns">
        <nav className="app-footer__column" aria-labelledby="footer-services-heading">
          <h2 className="app-footer__heading" id="footer-services-heading">
            {t('footer.otherServices')}
          </h2>
          {services.length > 0 && (
            <ul className="app-footer__list" data-testid={TESTID.app.footerServices}>
              {services.map((service) => (
                <li key={service.url}>
                  <a href={service.url} title={service.description}>
                    {service.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <nav className="app-footer__column" aria-labelledby="footer-connect-heading">
          <h2 className="app-footer__heading" id="footer-connect-heading">
            {t('footer.connect')}
          </h2>
          <ul className="app-footer__list">
            <li>
              <a
                className="app-footer__link-icon"
                href={GITHUB_URL}
                data-testid={TESTID.app.footerGithub}
              >
                <GithubMark />
                {t('footer.github')}
              </a>
            </li>
          </ul>
        </nav>
      </div>

      <div className="app-footer__bottom">
        <small data-testid={TESTID.app.footerCopyright}>
          {t('footer.copyright', { year: new Date().getFullYear(), site: SITE_NAME })}
        </small>
        <nav className="app-footer__legal" data-testid={TESTID.app.footerLegal}>
          {/* A route, so it is localized and navigates without a reload;
              NavLink marks it aria-current="page" while on it. */}
          <NavLink to="/design-system" data-testid={TESTID.app.navDesignSystem}>
            {t('nav.designSystem')}
          </NavLink>
          {LEGAL_LINKS.map((link) => (
            <a key={link.key} href={link.href}>
              {t(link.key)}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
