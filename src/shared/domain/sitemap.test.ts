import { describe, expect, test } from 'bun:test';

import { sitemapValidator } from './sitemap';

describe('sitemapValidator', () => {
  test('accepts a directory of services', () => {
    const result = sitemapValidator.safeParse({
      updatedAt: '2026-08-25',
      services: [
        {
          name: 'Boilerplate',
          url: 'https://github.com/hwahee/boilerplate',
          description: 'Starter',
        },
        { name: 'Root relative', url: '/docs' },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.services).toHaveLength(2);
  });

  test('accepts an empty directory', () => {
    expect(sitemapValidator.parse({ services: [] })).toEqual({ services: [] });
  });

  test('drops unknown keys instead of rejecting them', () => {
    const parsed = sitemapValidator.parse({
      services: [{ name: 'A', url: 'https://a.example.com', icon: 'star' }],
      note: 'edited by hand',
    });
    expect(parsed.services[0]).toEqual({ name: 'A', url: 'https://a.example.com' });
    expect(parsed).not.toHaveProperty('note');
  });

  test('rejects link schemes other than http(s) and root-relative paths', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,x',
      'mailto:a@b.c',
      'a.example.com',
    ]) {
      expect(sitemapValidator.safeParse({ services: [{ name: 'X', url }] }).ok).toBe(false);
    }
  });

  test('rejects a service without a name', () => {
    expect(sitemapValidator.safeParse({ services: [{ name: '', url: '/x' }] }).ok).toBe(false);
  });

  test('rejects a missing services list', () => {
    expect(sitemapValidator.safeParse({}).ok).toBe(false);
  });
});
