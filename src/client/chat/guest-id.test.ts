import { expect, spyOn, test } from 'bun:test';

import { guestIdValidator } from '@shared/domain/chat';

import { tabGuestId } from './guest-id';

test('a guest id is made without crypto.randomUUID, which plain-http pages lack', () => {
  const randomUUID = spyOn(crypto, 'randomUUID').mockImplementation(() => {
    throw new TypeError('crypto.randomUUID is not a function');
  });
  try {
    const id = tabGuestId();
    expect(guestIdValidator.safeParse(id).ok).toBe(true);
    expect(tabGuestId()).toBe(id); // the same for as long as the tab lives
  } finally {
    randomUUID.mockRestore();
  }
});
