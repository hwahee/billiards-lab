import { describe, expect, test } from 'bun:test';

import { contrastRatio, hexColor, isHexColor, parseHexColor } from './index';

/** Widens the brand away so results can be compared to plain string literals. */
const parsed = (input: string): string | null => parseHexColor(input);

describe('parseHexColor', () => {
  test('accepts the canonical form unchanged', () => {
    expect(parsed('#5b5bd6')).toBe('#5b5bd6');
  });

  test('normalizes case, whitespace and a missing #', () => {
    expect(parsed('  #5B5BD6 ')).toBe('#5b5bd6');
    expect(parsed('5B5BD6')).toBe('#5b5bd6');
  });

  test('expands 3- and 4-digit shorthand', () => {
    expect(parsed('#abc')).toBe('#aabbcc');
    expect(parsed('#abc8')).toBe('#aabbcc88');
  });

  test('keeps alpha when translucent', () => {
    expect(parsed('#5b5bd680')).toBe('#5b5bd680');
    expect(parsed('#5b5bd600')).toBe('#5b5bd600');
  });

  test('drops a fully opaque alpha pair so one color has one spelling', () => {
    expect(parsed('#5b5bd6ff')).toBe('#5b5bd6');
    expect(parsed('#abcf')).toBe('#aabbcc');
  });

  test('rejects anything that is not a hex color', () => {
    for (const input of ['', '#', '#12', '#12345', '#1234567', '#gggggg', 'rebeccapurple']) {
      expect(parsed(input)).toBeNull();
    }
  });
});

describe('isHexColor', () => {
  test('accepts only the canonical spelling', () => {
    expect(isHexColor('#5b5bd6')).toBe(true);
    expect(isHexColor('#5b5bd680')).toBe(true);

    // Parseable, but not canonical — accepting these would break `===`.
    expect(isHexColor('#5B5BD6')).toBe(false);
    expect(isHexColor('#5b5bd6ff')).toBe(false);
    expect(isHexColor('#abc')).toBe(false);
  });
});

describe('hexColor', () => {
  test('normalizes valid literals', () => {
    expect(hexColor('#ABC') as string).toBe('#aabbcc');
  });

  test('throws on invalid literals', () => {
    expect(() => hexColor('nope')).toThrow('Not a hex color');
  });
});

describe('contrastRatio', () => {
  const white = hexColor('#ffffff');
  const black = hexColor('#000000');

  test('is 21 for black on white and symmetric', () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5);
  });

  test('is 1 for a color against itself', () => {
    expect(contrastRatio(hexColor('#5b5bd6'), hexColor('#5b5bd6'))).toBeCloseTo(1, 5);
  });

  test('matches the known ratio of the design-A primary on white', () => {
    // #5b5bd6 on #ffffff — passes AA for normal text (>= 4.5).
    expect(contrastRatio(hexColor('#5b5bd6'), white)).toBeGreaterThan(4.5);
    expect(contrastRatio(hexColor('#5b5bd6'), white)).toBeLessThan(21);
  });

  test('composites a translucent foreground onto the background', () => {
    // Black at 50% over white is mid grey, not black: far less than 21:1.
    const half = contrastRatio(hexColor('#00000080'), white);
    expect(half).toBeGreaterThan(1);
    expect(half).toBeLessThan(21);

    // Fully transparent has no contrast at all.
    expect(contrastRatio(hexColor('#00000000'), white)).toBeCloseTo(1, 5);
  });

  test('composites a translucent background onto white before comparing', () => {
    expect(contrastRatio(black, hexColor('#ffffff00'))).toBeCloseTo(21, 5);
  });
});
