import { describe, expect, it } from 'vitest';
import { crc32, makeZip, safeFileName } from './zip';

describe('zip', () => {
  it('crc32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('ファイルを入れた zip の形', () => {
    const z = makeZip([{ name: 'QR_見本店_Instagram.png', data: new Uint8Array([1, 2, 3]) }, { name: 'b.png', data: new Uint8Array([4]) }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(v.getUint16(z.length - 22 + 10, true)).toBe(2);
  });
  it('ファイル名', () => {
    expect(safeFileName('11月 チラシ/A')).toBe('11月_チラシ_A');
  });
});
