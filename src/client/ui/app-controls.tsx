/**
 * Global preference switches: theme (light/dark), design variant and
 * language. Moved out of the header — they are settings a visitor touches
 * once, not navigation, so they belong with the rest of the site-wide
 * housekeeping in the footer.
 */
import { Moon, Palette, Sun } from 'lucide-react';

import { SUPPORTED_LOCALES, type Locale } from '@shared/i18n';

import { useI18n } from '../i18n/locale-context';
import { TESTID } from '../testing/testids';
import { nextDesign, useTheme, type Design } from '../theme/theme-context';
import { Button } from './button';
import { Select } from './select';

const LOCALE_LABELS: Record<Locale, string> = { en: 'English', ko: '한국어' };

/** Short label shown on the design toggle button. */
const DESIGN_BADGES: Record<Design, string> = { a: 'A', b: 'B', office: 'Office', kids: 'Kids' };

/** i18n key describing each design, for the toggle's aria-label. */
const DESIGN_LABEL_KEYS = {
  a: 'common.design.a',
  b: 'common.design.b',
  office: 'common.design.office',
  kids: 'common.design.kids',
} as const;

export function AppControls() {
  const { t, locale, setLocale } = useI18n();
  const { theme, design, toggleTheme, toggleDesign } = useTheme();

  return (
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
        aria-label={t(DESIGN_LABEL_KEYS[nextDesign(design)])}
        testId={TESTID.app.designToggle}
      >
        <Palette aria-hidden size="1em" />
        {DESIGN_BADGES[design]}
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
  );
}
