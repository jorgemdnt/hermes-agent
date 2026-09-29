import { expect, it } from 'vitest';
import { advanceCursor, pointerPacket, keyPacket } from './trackpad';

it('moves relatively with acceleration and clamps at desktop edges', () => {
  expect(advanceCursor({ x: 500, y: 400 }, 10, 0, 1000, 800).x).toBeGreaterThan(510);
  expect(advanceCursor({ x: 500, y: 400 }, 0, 0, 1000, 800)).toEqual({ x: 500, y: 400 });
  expect(advanceCursor({ x: 998, y: 799 }, 30, 30, 1000, 800)).toEqual({ x: 999, y: 799 });
});

it('encodes RFB pointer buttons and key transitions', () => {
  expect(Array.from(pointerPacket(300, 400, 4))).toEqual([5, 4, 1, 44, 1, 144]);
  expect(Array.from(keyPacket(0xff08, true))).toEqual([4, 1, 0, 0, 0, 0, 255, 8]);
});
