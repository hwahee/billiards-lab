import { describe, expect, test } from 'bun:test';

import { appearanceFromParams, appearanceParams, designFrom } from './appearance';

describe('appearance', () => {
  test('reads theme, design and the first spoken ui_locales tag', () => {
    const params = new URLSearchParams({
      theme: 'dark',
      design: 'office',
      ui_locales: 'fr ko-KR en',
    });
    expect(appearanceFromParams(params)).toEqual({ theme: 'dark', design: 'office', locale: 'ko' });
  });

  test('leaves out what is missing or unknown', () => {
    const params = new URLSearchParams({ theme: 'sepia', design: 'office', ui_locales: 'fr' });
    expect(appearanceFromParams(params)).toEqual({ design: 'office' });
    expect(appearanceFromParams(new URLSearchParams())).toEqual({});
  });

  test('reads the old design names as the new ones', () => {
    expect(designFrom('a')).toBe('standard');
    expect(designFrom('b')).toBe('contrast');
    expect(designFrom('contrast')).toBe('contrast');
    expect(designFrom('constructor')).toBeUndefined();
    expect(designFrom(null)).toBeUndefined();
    expect(appearanceFromParams(new URLSearchParams({ design: 'b' }))).toEqual({
      design: 'contrast',
    });
  });

  test('writes the same parameters it reads', () => {
    const appearance = { theme: 'light', design: 'kids', locale: 'en' } as const;
    expect(appearanceParams(appearance)).toEqual({
      theme: 'light',
      design: 'kids',
      ui_locales: 'en',
    });
    expect(appearanceFromParams(new URLSearchParams(appearanceParams(appearance)))).toEqual(
      appearance,
    );
    expect(appearanceParams({})).toEqual({});
  });
});
