import { describe, expect, test } from 'bun:test';

import { planMigrations } from './migrate';

const files = ['0001_init.sql', '0002_users.sql', '0003_chat.sql', 'README.md'];

describe('planMigrations', () => {
  test('a fresh database applies every migration file, in order', () => {
    expect(planMigrations([...files].reverse(), new Map()).map((m) => m.name)).toEqual([
      '0001_init',
      '0002_users',
      '0003_chat',
    ]);
  });

  test('only what is not recorded yet', () => {
    const applied = new Map([
      ['0001', '0001_init'],
      ['0002', '0002_users'],
    ]);
    expect(planMigrations(files, applied)).toEqual([
      { version: '0003', name: '0003_chat', file: '0003_chat.sql' },
    ]);
  });

  test('two files sharing a number stop the run instead of one being skipped', () => {
    expect(() => planMigrations([...files, '0003_orders.sql'], new Map())).toThrow(
      /share the number 0003/,
    );
  });

  test('a number recorded under another name stops the run instead of being skipped', () => {
    // A project that already used 0003 for its own migration, then merged 0003_chat.
    const applied = new Map([
      ['0001', '0001_init'],
      ['0002', '0002_users'],
      ['0003', '0003_orders'],
    ]);
    expect(() => planMigrations(files, applied)).toThrow(/recorded as "0003_orders"/);
  });
});
