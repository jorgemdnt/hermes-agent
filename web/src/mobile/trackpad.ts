export interface Cursor { x: number; y: number }

export function advanceCursor(cursor: Cursor, dx: number, dy: number, width: number, height: number): Cursor {
  const speed = Math.hypot(dx, dy);
  const gain = 1.2 + Math.min(2, speed / 8);
  return {
    x: Math.max(0, Math.min(width - 1, Math.round(cursor.x + dx * gain))),
    y: Math.max(0, Math.min(height - 1, Math.round(cursor.y + dy * gain))),
  };
}

export function pointerPacket(x: number, y: number, mask: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([5, mask, x >>> 8, x & 255, y >>> 8, y & 255]);
}

export function keyPacket(keysym: number, down: boolean): Uint8Array<ArrayBuffer> {
  return new Uint8Array([4, down ? 1 : 0, 0, 0, keysym >>> 24, (keysym >>> 16) & 255, (keysym >>> 8) & 255, keysym & 255]);
}
