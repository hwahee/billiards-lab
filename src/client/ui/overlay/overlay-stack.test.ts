import { describe, expect, test } from 'bun:test';

import { beginClose, derive, open, remove, type OverlayStackEntry } from './overlay-stack';

const empty: readonly OverlayStackEntry[] = [];

describe('overlay stack', () => {
  test('nothing is claimed while the stack is empty', () => {
    expect(derive(empty)).toEqual({ scrimOwner: null, scrollLocked: false, depth: 0 });
  });

  test('a single overlay paints the scrim and locks scrolling', () => {
    expect(derive(open(empty, 'a'))).toEqual({
      scrimOwner: 'a',
      scrollLocked: true,
      depth: 1,
    });
  });

  test('exactly one scrim no matter how deep the stack is', () => {
    const stack = open(open(open(empty, 'a'), 'b'), 'c');

    // The invariant that stacked backdrops violate: one owner, always the top.
    expect(derive(stack).scrimOwner).toBe('c');
    expect(derive(stack).depth).toBe(3);
  });

  test('the scrim moves down the instant the top starts closing', () => {
    const stack = beginClose(open(open(empty, 'a'), 'b'), 'b');

    expect(derive(stack).scrimOwner).toBe('a');
  });

  test('a closing overlay still holds the scroll lock', () => {
    // Releasing it while the exit transition plays would jump the page.
    const stack = beginClose(open(empty, 'a'), 'a');

    expect(derive(stack)).toEqual({ scrimOwner: null, scrollLocked: true, depth: 0 });
  });

  test('scrolling unlocks only once the last entry is gone', () => {
    const two = open(open(empty, 'a'), 'b');

    expect(derive(remove(two, 'b')).scrollLocked).toBe(true);
    expect(derive(remove(remove(two, 'b'), 'a')).scrollLocked).toBe(false);
  });

  test('closing the inner overlay hands the scrim back to the outer one', () => {
    const nested = open(open(empty, 'form'), 'confirm');
    const settled = remove(beginClose(nested, 'confirm'), 'confirm');

    expect(derive(settled)).toEqual({ scrimOwner: 'form', scrollLocked: true, depth: 1 });
  });

  test('re-opening while closing moves the entry back to the top', () => {
    const stack = open(beginClose(open(open(empty, 'a'), 'b'), 'b'), 'b');

    expect(stack).toEqual([
      { id: 'a', active: true },
      { id: 'b', active: true },
    ]);
    expect(derive(stack).scrimOwner).toBe('b');
  });

  test('re-opening an overlay that is below the top raises it', () => {
    const stack = open(open(open(empty, 'a'), 'b'), 'a');

    expect(stack.map((entry) => entry.id)).toEqual(['b', 'a']);
    expect(derive(stack).scrimOwner).toBe('a');
  });

  test('removing an unknown id is a no-op', () => {
    const stack = open(empty, 'a');

    expect(remove(stack, 'ghost')).toEqual(stack);
    expect(beginClose(stack, 'ghost')).toEqual(stack);
  });
});
