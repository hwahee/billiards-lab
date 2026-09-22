import { describe, expect, test } from 'bun:test';

import { placePopover } from './popover-position';

const viewport = { width: 1000, height: 800 };
/** A 120×32 trigger sitting comfortably in the middle of the viewport. */
const anchor = { top: 300, left: 400, width: 120, height: 32 };
const popup = { width: 260, height: 200 };

describe('placePopover', () => {
  test('sits below the anchor, left-aligned, when there is room', () => {
    const placement = placePopover(anchor, popup, viewport);

    expect(placement.side).toBe('bottom');
    expect(placement.top).toBe(338); // 300 + 32 + 6 gap
    expect(placement.left).toBe(400);
  });

  test('flips above when the anchor is near the bottom edge', () => {
    const low = { ...anchor, top: 700 };
    const placement = placePopover(low, popup, viewport);

    expect(placement.side).toBe('top');
    expect(placement.top).toBe(494); // 700 - 6 gap - 200 height
  });

  test('stays below when neither side fits but below is roomier', () => {
    const placement = placePopover({ ...anchor, top: 40 }, { ...popup, height: 900 }, viewport);

    expect(placement.side).toBe('bottom');
    expect(placement.maxHeight).toBe(714); // 800 - 72 - 6 - 8
  });

  test('reports the available room as maxHeight so tall content can scroll', () => {
    const placement = placePopover(anchor, { ...popup, height: 1000 }, viewport);

    expect(placement.maxHeight).toBe(454); // 800 - 332 - 6 - 8
    expect(placement.top).toBe(338);
  });

  test('clamps against the right edge instead of overflowing', () => {
    const placement = placePopover({ ...anchor, left: 900 }, popup, viewport);

    expect(placement.left).toBe(732); // 1000 - 260 - 8
  });

  test('pins to the left margin when the popup is wider than the viewport', () => {
    const placement = placePopover(anchor, { ...popup, width: 1200 }, viewport);

    expect(placement.left).toBe(8);
  });

  test('centers on the anchor and prefers above (the tooltip case)', () => {
    const tooltip = { width: 140, height: 28 };
    const placement = placePopover(anchor, tooltip, viewport, {
      align: 'center',
      preferred: 'top',
      gap: 6,
    });

    expect(placement.side).toBe('top');
    expect(placement.top).toBe(266); // 300 - 6 - 28
    expect(placement.left).toBe(390); // 400 + 60 - 70
  });

  test('flips a centered tooltip below when it would clear the viewport top', () => {
    const placement = placePopover({ ...anchor, top: 4 }, { width: 140, height: 28 }, viewport, {
      align: 'center',
      preferred: 'top',
    });

    expect(placement.side).toBe('bottom');
  });
});
