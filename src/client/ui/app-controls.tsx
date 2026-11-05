/**
 * Global preference switches: theme (light/dark), design variant and
 * language. Moved out of the header — they are settings a visitor touches
 * once, not navigation, so they belong with the rest of the site-wide
 * housekeeping in the footer.
 */
import { Moon, Palette, Sun } from 'lucide-react';

import { DESIGNS } from '@shared/domain/appearance';
import { SUPPORTED_LOCALES, type Locale } from '@shared/i18n';

import { useI18n } from '../i18n/locale-context';
import { TESTID } from '../testing/testids';
import { useTheme, type Design } from '../theme/theme-context';
import { Button } from './button';
import { Select } from './select';

const LOCALE_LABELS: Record<Locale, string> = { en: 'English', ko: '한국어' };

/** The visible label of each design's toggle — also its accessible name. */
const DESIGN_BADGES: Record<Design, string> = { a: 'A', b: 'B', office: 'Office', kids: 'Kids' };

/**
 * i18n key describing each design, shown as the toggle's tooltip (and read as
 * its description). Not the accessible name: "오피스 스킨" would not contain
 * the visible "Office", and speech users say what they see.
 */
const DESIGN_LABEL_KEYS = {
  a: 'common.design.a',
  b: 'common.design.b',
  office: 'common.design.office',
  kids: 'common.design.kids',
} as const;

export function AppControls() {
  const { t, locale, setLocale } = useI18n();
  const { theme, design, toggleTheme, setDesign } = useTheme();

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
      {/* One toggle per design, exactly one pressed: every variant is a single
          click away and all four names stay in view. */}
      <div
        className="design-toggle"
        role="group"
        aria-label={t('common.design')}
        data-testid={TESTID.app.designToggle}
      >
        <Palette className="design-toggle__icon" aria-hidden size="1em" />
        {DESIGNS.map((option) => (
          <Button
            key={option}
            variant="ghost"
            aria-pressed={option === design}
            title={t(DESIGN_LABEL_KEYS[option])}
            onClick={() => setDesign(option)}
            testId={TESTID.app.designOption(option)}
          >
            {DESIGN_BADGES[option]}
          </Button>
        ))}
      </div>
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
