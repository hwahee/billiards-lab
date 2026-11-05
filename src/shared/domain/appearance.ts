/**
 * How the page looks — theme, design and language — as it travels to the
 * member server's pages, so signing in looks like the service it started on.
 *
 * The member server reads these query parameters from the authorization
 * request Hydra keeps as requested (boilerplate-auth
 * `src/shared/domain/appearance.ts`); OAuth ignores parameters it doesn't
 * know, and `ui_locales` is the OIDC standard one. The sign-in link to
 * `/api/auth/login` carries the same names, so one parser serves both hops:
 *
 *   theme=light|dark
 *   design=a|b|office|kids
 *   ui_locales=ko en   — the first one we speak wins
 *
 * Anything missing or unknown is left out.
 */
import { isLocale, type Locale } from '../i18n';

const THEMES = ['light', 'dark'] as const;
const DESIGNS = ['a', 'b', 'office', 'kids'] as const;

export type Theme = (typeof THEMES)[number];
export type Design = (typeof DESIGNS)[number];

export interface Appearance {
  theme?: Theme;
  design?: Design;
  locale?: Locale;
}

function oneOf<T extends string>(options: readonly T[], value: string | null): T | undefined {
  return options.find((option) => option === value);
}

export function appearanceFromParams(params: URLSearchParams): Appearance {
  const theme = oneOf(THEMES, params.get('theme'));
  const design = oneOf(DESIGNS, params.get('design'));
  const locale = (params.get('ui_locales') ?? '')
    .split(' ')
    .map((tag) => tag.split('-')[0]?.toLowerCase())
    .find(isLocale);
  return {
    ...(theme && { theme }),
    ...(design && { design }),
    ...(locale && { locale }),
  };
}

/** The query parameters for `appearance`, ready for a URL; nothing for what is unset. */
export function appearanceParams(appearance: Appearance): Record<string, string> {
  return {
    ...(appearance.theme && { theme: appearance.theme }),
    ...(appearance.design && { design: appearance.design }),
    ...(appearance.locale && { ui_locales: appearance.locale }),
  };
}
