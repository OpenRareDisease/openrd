import {
  buildQrMatrix,
  byteCapacity,
  dataCodewordCount,
  formatBits,
  gfExp,
  gfMul,
  MAX_QR_VERSION,
  penaltyScore,
  qrPath,
  rsGenerator,
  rsRemainder,
  utf8Bytes,
  type QrMatrix,
} from '../qr';

/**
 * A hand-written QR encoder is a place where a bug is silent: the
 * screen shows a plausible square of noise, the doctor's phone does
 * nothing, and neither of them can tell whether it is the code, the
 * camera or the lighting. So this file does not check that the output
 * "looks like a QR". It checks two kinds of thing:
 *
 *   1. FIRST PRINCIPLES, not remembered tables. The error correction
 *      is verified by evaluating the generator polynomial at its roots
 *      and by dividing the finished codeword by it — a valid
 *      Reed–Solomon codeword is exactly one that divides cleanly. The
 *      format string is verified as a BCH codeword the same way. If I
 *      had misremembered a coefficient table, these still fail.
 *   2. A DECODER WRITTEN SEPARATELY from the encoder, below. It builds
 *      its own function-pattern map, its own mask table and its own
 *      zigzag, so a mirrored or rotated placement in qr.ts shows up as
 *      a string that does not come back.
 *
 * WHAT THESE TESTS DO NOT PROVE: that a physical scanner locks onto
 * the symbol. That needs a phone and a printed page, and it is worth
 * doing once before this ships.
 */

/* ================================================================
 * An independent decoder.
 * ================================================================ */

/** Which modules are function patterns, derived from the symbol's
 *  geometry rather than from the encoder's drawing order. */
const functionMap = (size: number): boolean[][] => {
  const map = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (r0: number, r1: number, c0: number, c1: number) => {
    for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) map[r][c] = true;
  };
  // The three 9-module corner blocks: finder + separator + format.
  mark(0, 8, 0, 8);
  mark(0, 8, size - 8, size - 1);
  mark(size - 8, size - 1, 0, 8);
  // Timing.
  for (let i = 0; i < size; i += 1) {
    map[6][i] = true;
    map[i][6] = true;
  }
  // The single alignment pattern of versions 2–6.
  if (size > 21) mark(size - 9, size - 5, size - 9, size - 5);
  return map;
};

const MASKS: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Polynomial division over GF(2) — used on the two BCH check words. */
const gf2Mod = (value: number, divisor: number): number => {
  const bit = (n: number) => 32 - Math.clz32(n);
  let rest = value;
  const dLen = bit(divisor);
  while (bit(rest) >= dLen) rest ^= divisor << (bit(rest) - dLen);
  return rest;
};

/** Read the 15 format modules of copy one, in the order the standard
 *  puts them, and return the raw (still XORed) value. */
const readFormatCopyOne = (m: boolean[][]): number => {
  const bits: boolean[] = [];
  for (let i = 0; i <= 5; i += 1) bits.push(m[i][8]);
  bits.push(m[7][8], m[8][8], m[8][7]);
  for (let i = 9; i < 15; i += 1) bits.push(m[8][14 - i]);
  let out = 0;
  for (let i = 0; i < 15; i += 1) if (bits[i]) out |= 1 << i;
  return out;
};

const readFormatCopyTwo = (m: boolean[][], size: number): number => {
  let out = 0;
  // Seven up the left column — the eighth slot down there is the fixed
  // dark module, not a format bit.
  for (let i = 0; i < 7; i += 1) if (m[size - 1 - i][8]) out |= 1 << i;
  for (let i = 7; i < 15; i += 1) if (m[8][size - 15 + i]) out |= 1 << i;
  return out;
};

/**
 * Walk the two-column zigzag. Written with an alternating direction
 * flag rather than the encoder's bit trick, so the two have to agree
 * on the answer without agreeing on the arithmetic.
 */
const readCodewordBits = (m: boolean[][], fn: boolean[][], size: number): number[] => {
  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (!fn[row][col]) bits.push(m[row][col] ? 1 : 0);
      }
    }
    upward = !upward;
  }
  return bits;
};

const EC_M_SPEC: Record<number, { ecPerBlock: number; blocks: number }> = {
  1: { ecPerBlock: 10, blocks: 1 },
  2: { ecPerBlock: 16, blocks: 1 },
  3: { ecPerBlock: 26, blocks: 1 },
  4: { ecPerBlock: 18, blocks: 2 },
  5: { ecPerBlock: 24, blocks: 2 },
  6: { ecPerBlock: 16, blocks: 4 },
};

type Decoded = { text: string; version: number; mask: number };

const decode = (matrix: QrMatrix): Decoded => {
  const { size, modules } = matrix;
  const version = (size - 17) / 4;
  expect(Number.isInteger(version)).toBe(true);

  const rawOne = readFormatCopyOne(modules);
  const rawTwo = readFormatCopyTwo(modules, size);
  expect(rawTwo).toBe(rawOne);

  const unmasked = rawOne ^ 0x5412;
  // A valid BCH(15,5) format word divides by 0b10100110111 with no
  // remainder. Checked, not assumed.
  expect(gf2Mod(unmasked, 0x537)).toBe(0);
  const payload = unmasked >>> 10;
  const ecl = payload >>> 3;
  const mask = payload & 0b111;
  expect(ecl).toBe(0b00); // level M

  const fn = functionMap(size);
  const rule = MASKS[mask];
  const clean = modules.map((row, r) => row.map((v, c) => (fn[r][c] ? v : rule(r, c) ? !v : v)));

  const bits = readCodewordBits(clean, fn, size);
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }

  const spec = EC_M_SPEC[version];
  const dataLen = dataCodewordCount(version);
  const perBlock = dataLen / spec.blocks;

  // Undo the interleave.
  const dataBlocks: number[][] = Array.from({ length: spec.blocks }, () => []);
  const ecBlocks: number[][] = Array.from({ length: spec.blocks }, () => []);
  let cursor = 0;
  for (let i = 0; i < perBlock; i += 1) {
    for (let b = 0; b < spec.blocks; b += 1) dataBlocks[b].push(codewords[cursor++]);
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (let b = 0; b < spec.blocks; b += 1) ecBlocks[b].push(codewords[cursor++]);
  }

  // Every block, data plus its EC, must be divisible by the generator.
  // This is the property that makes it a Reed–Solomon codeword; a
  // remembered coefficient table proves much less.
  for (let b = 0; b < spec.blocks; b += 1) {
    const whole = Uint8Array.from([...dataBlocks[b], ...ecBlocks[b]]);
    const gen = rsGenerator(spec.ecPerBlock);
    const buf = Uint8Array.from(whole);
    for (let i = 0; i < whole.length - spec.ecPerBlock; i += 1) {
      const factor = buf[i];
      if (factor === 0) continue;
      for (let j = 0; j < gen.length; j += 1) buf[i + j] ^= gfMul(gen[j], factor);
    }
    expect(Array.from(buf.slice(whole.length - spec.ecPerBlock))).toEqual(
      new Array(spec.ecPerBlock).fill(0),
    );
  }

  const flat = dataBlocks.flat();
  const dataBits: number[] = [];
  for (const byte of flat) for (let i = 7; i >= 0; i -= 1) dataBits.push((byte >> i) & 1);
  const take = (n: number) => {
    let out = 0;
    for (let i = 0; i < n; i += 1) out = (out << 1) | dataBits.shift()!;
    return out;
  };
  expect(take(4)).toBe(0b0100); // byte mode
  const length = take(8);
  const bytes: number[] = [];
  for (let i = 0; i < length; i += 1) bytes.push(take(8));

  // Decode UTF-8 without TextDecoder, mirroring the encoder's manual
  // path from the other direction.
  let text = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    if (b < 0x80) {
      text += String.fromCodePoint(b);
      i += 1;
    } else if (b < 0xe0) {
      text += String.fromCodePoint(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b < 0xf0) {
      text += String.fromCodePoint(
        ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else {
      text += String.fromCodePoint(
        ((b & 0x07) << 18) |
          ((bytes[i + 1] & 0x3f) << 12) |
          ((bytes[i + 2] & 0x3f) << 6) |
          (bytes[i + 3] & 0x3f),
      );
      i += 4;
    }
  }

  return { text, version, mask };
};

/* ================================================================
 * The tests.
 * ================================================================ */

describe('GF(256) 算术', () => {
  it('查表乘法和逐位乘法（俄罗斯农夫）结果一致', () => {
    // The slow one is derived from the definition, so agreeing with it
    // pins the exp/log tables without trusting either.
    const slowMul = (a: number, b: number) => {
      let out = 0;
      let x = a;
      let y = b;
      while (y > 0) {
        if (y & 1) out ^= x;
        y >>= 1;
        x <<= 1;
        if (x & 0x100) x ^= 0x11d;
      }
      return out;
    };
    for (let a = 0; a < 256; a += 1) {
      for (let b = 0; b < 256; b += 7) {
        expect(gfMul(a, b)).toBe(slowMul(a, b));
      }
    }
  });
});

describe('Reed–Solomon', () => {
  it('生成多项式的根就是 α^0..α^(n-1)', () => {
    // The defining property. If a coefficient were wrong, some root
    // would evaluate non-zero here.
    for (const degree of [10, 16, 18, 24, 26]) {
      const gen = rsGenerator(degree);
      expect(gen).toHaveLength(degree + 1);
      expect(gen[0]).toBe(1);
      for (let i = 0; i < degree; i += 1) {
        const root = gfExp(i);
        let value = 0;
        for (const coefficient of gen) value = gfMul(value, root) ^ coefficient;
        expect(value).toBe(0);
      }
    }
  });

  it('数据加校验码整体能被生成多项式整除', () => {
    const data = Uint8Array.from(Array.from({ length: 16 }, (_, i) => (i * 37 + 5) & 0xff));
    const ec = rsRemainder(data, 10);
    const whole = Uint8Array.from([...data, ...ec]);
    const gen = rsGenerator(10);
    const buf = Uint8Array.from(whole);
    for (let i = 0; i < data.length; i += 1) {
      const factor = buf[i];
      if (factor === 0) continue;
      for (let j = 0; j < gen.length; j += 1) buf[i + j] ^= gfMul(gen[j], factor);
    }
    expect(Array.from(buf.slice(data.length))).toEqual(new Array(10).fill(0));
  });
});

describe('容量表自洽', () => {
  it('total − ec×blocks 推出来的字节容量，和标准的字节模式容量对上', () => {
    // Two independently remembered tables. If either the block layout
    // or the capacity had drifted, they would not agree.
    expect([1, 2, 3, 4, 5, 6].map(byteCapacity)).toEqual([14, 26, 42, 62, 84, 106]);
    expect([1, 2, 3, 4, 5, 6].map(dataCodewordCount)).toEqual([16, 28, 44, 64, 86, 108]);
  });
});

describe('格式信息', () => {
  it('八个掩码的格式串都是合法的 BCH 码字，且带得回掩码号', () => {
    const gf2Mod = (value: number, divisor: number) => {
      const bit = (n: number) => 32 - Math.clz32(n);
      let rest = value;
      while (bit(rest) >= bit(divisor)) rest ^= divisor << (bit(rest) - bit(divisor));
      return rest;
    };
    for (let mask = 0; mask < 8; mask += 1) {
      const raw = formatBits(mask) ^ 0x5412;
      expect(gf2Mod(raw, 0x537)).toBe(0);
      expect(raw >>> 10).toBe(mask); // EC level M contributes 0b00
    }
  });

  it('不同掩码的格式串两两之间至少差 3 位', () => {
    // BCH(15,5) has minimum distance 7 across all 32 codewords; the
    // eight that share EC level M must be comfortably apart, or a
    // single misread module would silently select the wrong mask.
    for (let a = 0; a < 8; a += 1) {
      for (let b = a + 1; b < 8; b += 1) {
        let diff = 0;
        let x = formatBits(a) ^ formatBits(b);
        while (x) {
          diff += x & 1;
          x >>>= 1;
        }
        expect(diff).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('矩阵结构', () => {
  const matrix = buildQrMatrix('https://example.com/s/passport/pickup')!;

  it('尺寸是 17 + 4×版本', () => {
    expect((matrix.size - 17) % 4).toBe(0);
    expect(matrix.size).toBeLessThanOrEqual(17 + 4 * MAX_QR_VERSION);
  });

  it('三个定位图案都在，且外面是一圈白色分隔带', () => {
    const { size, modules } = matrix;
    for (const [r0, c0] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ]) {
      // 7×7 finder: dark ring, light ring, 3×3 dark core.
      for (let dr = 0; dr < 7; dr += 1) {
        for (let dc = 0; dc < 7; dc += 1) {
          const dist = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
          expect(modules[r0 + dr][c0 + dc]).toBe(dist !== 2);
        }
      }
    }
    // The separator column beside the top-left finder is light.
    for (let r = 0; r < 8; r += 1) expect(modules[r][7]).toBe(false);
  });

  it('定时图案在第 6 行和第 6 列交替', () => {
    const { size, modules } = matrix;
    for (let i = 8; i < size - 8; i += 1) {
      expect(modules[6][i]).toBe(i % 2 === 0);
      expect(modules[i][6]).toBe(i % 2 === 0);
    }
  });

  it('固定黑点在 (size−8, 8)', () => {
    expect(matrix.modules[matrix.size - 8][8]).toBe(true);
  });

  it('对齐图案在右下角（版本 ≥ 2）', () => {
    const { size, modules } = matrix;
    expect(size).toBeGreaterThan(21);
    const c = size - 7;
    for (let dr = -2; dr <= 2; dr += 1) {
      for (let dc = -2; dc <= 2; dc += 1) {
        expect(modules[c + dr][c + dc]).toBe(Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }
  });
});

describe('用一个独立写的解码器把内容读回来', () => {
  const cases = [
    'https://a.cn/s/passport/pickup',
    'https://jiyutong.example.com/s/passport/pickup',
    'http://192.168.1.24:8081/s/passport/pickup',
    'A', // one byte — version 1
    'x'.repeat(14), // exactly version 1's capacity
    'x'.repeat(15), // one over, must roll to version 2
    'x'.repeat(62), // exactly version 4's capacity
    'x'.repeat(106), // exactly version 6's capacity, the ceiling
    '肌愈通/取件', // multi-byte UTF-8
  ];

  for (const text of cases) {
    it(`「${text.length > 30 ? `${text.slice(0, 12)}…(${text.length})` : text}」原样读回`, () => {
      const matrix = buildQrMatrix(text);
      expect(matrix).not.toBeNull();
      const decoded = decode(matrix!);
      expect(decoded.text).toBe(text);
      expect(decoded.mask).toBeGreaterThanOrEqual(0);
      expect(decoded.mask).toBeLessThan(8);
    });
  }

  it('同一段文字每次编出来都一样 —— 掩码选择不是随机的', () => {
    const text = 'https://example.com/s/passport/pickup';
    expect(buildQrMatrix(text)).toEqual(buildQrMatrix(text));
  });
});

describe('罚分', () => {
  it('全白 21×21 的分数可以手算，对得上', () => {
    // Rule 1: 21 rows + 21 columns, each one run of 21 → 3 + 16 = 19,
    //         42 × 19 = 798.
    // Rule 2: 20 × 20 uniform 2×2 blocks × 3 = 1200.
    // Rule 3: both finder-like patterns contain dark modules → 0.
    // Rule 4: 0% dark, |0 − 50| / 5 = 10, × 10 = 100.
    const white = Array.from({ length: 21 }, () => new Array<boolean>(21).fill(false));
    expect(penaltyScore(white)).toBe(798 + 1200 + 100);
  });

  it('罚分只影响挑哪个掩码，不影响能不能解码', () => {
    // Stated as a test so nobody hardens the scoring under the belief
    // that a wrong score produces an unreadable symbol. The chosen
    // mask is carried in the format string; all eight decode.
    const matrix = buildQrMatrix('https://example.com/s/passport/pickup')!;
    expect(decode(matrix).text).toBe('https://example.com/s/passport/pickup');
  });
});

describe('装不下就返回 null，绝不悄悄截断', () => {
  it('超过版本 6 的容量返回 null', () => {
    // A truncated URL is a page that does not exist, in a consulting
    // room, with no way for either person to tell why.
    expect(buildQrMatrix('x'.repeat(107))).toBeNull();
    expect(buildQrMatrix('')).toBeNull();
  });

  it('多字节字符按 UTF-8 字节数算容量，不是按字符数', () => {
    // 36 Chinese characters is 108 bytes, past version 6.
    expect(utf8Bytes('肌').length).toBe(3);
    expect(buildQrMatrix('肌'.repeat(36))).toBeNull();
    expect(buildQrMatrix('肌'.repeat(35))).not.toBeNull();
  });
});

describe('qrPath', () => {
  it('每个黑格子一个 1×1 的方块，白格子不出现', () => {
    const matrix: QrMatrix = {
      size: 2,
      modules: [
        [true, false],
        [false, true],
      ],
    };
    expect(qrPath(matrix)).toBe('M0 0h1v1h-1zM1 1h1v1h-1z');
  });

  it('真实矩阵里方块数等于黑格子数', () => {
    const matrix = buildQrMatrix('https://example.com/s/passport/pickup')!;
    const dark = matrix.modules.flat().filter(Boolean).length;
    expect(qrPath(matrix).split('z').length - 1).toBe(dark);
  });
});
