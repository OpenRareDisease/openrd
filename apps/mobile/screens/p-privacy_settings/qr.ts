/**
 * A QR encoder, written out longhand, because the alternatives are all
 * worse here.
 *
 * WHY NOT A LIBRARY, AN IMAGE HOST, OR A GENERATOR URL
 *
 * This app ships as a web export that patients open in mainland China,
 * usually inside WeChat's in-app browser. There is no CDN, no external
 * host at runtime, and the CSP forbids one anyway; a QR image fetched
 * from api.qrserver.com is a blank box in a consulting room, and a QR
 * image fetched from anywhere also hands a third party the fact that
 * this person is handing over a medical record right now. Adding an npm
 * dependency is off the table this round. So: byte mode, EC level M,
 * versions 1–6, drawn as SVG paths by react-native-svg, which is
 * already a dependency (screens/common/HumanBodyFigure.tsx).
 *
 * WHAT IT ENCODES — AND WHAT IT DELIBERATELY DOES NOT
 *
 * The pickup URL only. NOT the code. Putting a live credential in a
 * URL puts it in the doctor's browser history, in whatever proxy the
 * hospital runs, and in the Referer of the next page they open — and
 * it would turn a two-factor handover into a one-factor link that
 * anyone who photographed the patient's screen could replay. The QR
 * saves the typing that is actually painful (a URL); the eight
 * characters are the part a human says out loud, which is the point.
 *
 * VERSION CAP
 *
 * Six. Versions 7 and up carry an extra 18-bit version-information
 * block in two more corners, and that is code with no test behind it
 * for a case we do not have: version 6 at EC level M holds 106 bytes,
 * and 「https://」 plus a hostname plus 「/s/passport/pickup」 is well
 * under that. Anything longer returns null and the screen shows the
 * URL as text instead of a QR that would be wrong.
 *
 * HOW IT IS VERIFIED
 *
 * See qr.test.ts. The error-correction codewords are checked by
 * polynomial division rather than against a remembered table (a valid
 * Reed–Solomon codeword is divisible by its generator, and the
 * generator's roots are α^0..α^(n-1) — both provable, neither
 * recalled), and the finished matrix is read back by a decoder written
 * separately from this file. What the tests CANNOT prove is that a
 * physical scanner likes it; that needs a phone.
 */

export type QrMatrix = {
  size: number;
  /** modules[row][col] — true is dark. */
  modules: boolean[][];
};

/** Highest version this file draws. See the note above on why. */
export const MAX_QR_VERSION = 6;

/**
 * Error-correction level M — total codewords, EC codewords per block,
 * and block count, for versions 1–6.
 *
 * M (≈15% recovery) rather than L: this is read off a phone screen at
 * an angle, sometimes a cracked one, under hospital lighting. Two of
 * these numbers are independent of each other and cross-check —
 * `total - ecPerBlock * blocks` must come out to the documented byte
 * capacity, which qr.test.ts asserts, so a typo here cannot pass.
 */
const EC_LEVEL_M = {
  1: { total: 26, ecPerBlock: 10, blocks: 1 },
  2: { total: 44, ecPerBlock: 16, blocks: 1 },
  3: { total: 70, ecPerBlock: 26, blocks: 1 },
  4: { total: 100, ecPerBlock: 18, blocks: 2 },
  5: { total: 134, ecPerBlock: 24, blocks: 2 },
  6: { total: 172, ecPerBlock: 16, blocks: 4 },
} as const;

/** EC level M is 0b00 in the format string. (L=01, M=00, Q=11, H=10 —
 *  the order is not the obvious one, which is why it is written down.) */
const EC_LEVEL_M_BITS = 0b00;

export const dataCodewordCount = (version: number): number => {
  const spec = EC_LEVEL_M[version as keyof typeof EC_LEVEL_M];
  return spec.total - spec.ecPerBlock * spec.blocks;
};

/**
 * How many bytes fit: the payload shares the data codewords with a
 * 4-bit mode indicator and an 8-bit character count, so 12 bits are
 * gone before the first byte of content.
 */
export const byteCapacity = (version: number): number =>
  Math.floor((dataCodewordCount(version) * 8 - 12) / 8);

/* ---------------------------------------------------------------- *
 * GF(256), the field the error correction lives in.
 * ---------------------------------------------------------------- */

/** x^8 + x^4 + x^3 + x^2 + 1 — the QR standard's primitive polynomial. */
const GF_PRIMITIVE = 0x11d;

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= GF_PRIMITIVE;
  }
  // Doubled so a log sum up to 508 needs no modulo in the hot loop.
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
}

export const gfMul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];

/** α^i, exported so the tests can check the generator's roots. */
export const gfExp = (i: number): number => GF_EXP[((i % 255) + 255) % 255];

/**
 * The generator polynomial for `degree` EC codewords: the product of
 * (x − α^i) for i in 0..degree-1. Coefficients are highest-power first.
 */
export const rsGenerator = (degree: number): Uint8Array => {
  let poly = Uint8Array.from([1]);
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j]; // × x
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]); // × α^i
    }
    poly = next;
  }
  return poly;
};

/** The EC codewords for one block: data · x^degree mod generator. */
export const rsRemainder = (data: Uint8Array, degree: number): Uint8Array => {
  const gen = rsGenerator(degree);
  const buf = new Uint8Array(data.length + degree);
  buf.set(data);
  for (let i = 0; i < data.length; i += 1) {
    const factor = buf[i];
    if (factor === 0) continue;
    // gen[0] is 1, so this zeroes buf[i] and walks the remainder along.
    for (let j = 0; j < gen.length; j += 1) buf[i + j] ^= gfMul(gen[j], factor);
  }
  return buf.slice(data.length);
};

/* ---------------------------------------------------------------- *
 * Encoding.
 * ---------------------------------------------------------------- */

/**
 * UTF-8, by hand.
 *
 * Not TextEncoder: this runs in Hermes on some devices and in a WeChat
 * webview on most, and a missing global here would fail at the moment
 * the patient presses the button rather than at build time. Twelve
 * lines is cheaper than finding that out in a clinic.
 */
export const utf8Bytes = (text: string): number[] => {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000)
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  return out;
};

const smallestVersion = (byteLength: number): number | null => {
  for (let v = 1; v <= MAX_QR_VERSION; v += 1) {
    if (byteLength <= byteCapacity(v)) return v;
  }
  return null;
};

/** Byte mode, with the 8-bit character count that versions 1–9 use. */
const buildDataCodewords = (bytes: number[], version: number): Uint8Array => {
  const capacity = dataCodewordCount(version);
  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);

  // Terminator: up to four zeros, but never past the end.
  const room = capacity * 8 - bits.length;
  for (let i = 0; i < Math.min(4, room); i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const out = new Uint8Array(capacity);
  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i]) out[i >> 3] |= 0x80 >> (i & 7);
  }
  // The standard's alternating pad bytes, 0xEC / 0x11.
  for (let i = bits.length / 8, alt = 0; i < capacity; i += 1, alt += 1) {
    out[i] = alt % 2 === 0 ? 0xec : 0x11;
  }
  return out;
};

/**
 * Split into blocks, error-correct each, then interleave.
 *
 * The interleave is not cosmetic: it is what makes a QR survive a
 * thumb over one corner. A burst of damage in the symbol becomes one
 * or two lost codewords spread across every block instead of wiping a
 * single block past its correction capacity.
 */
const buildFinalCodewords = (data: Uint8Array, version: number): Uint8Array => {
  const spec = EC_LEVEL_M[version as keyof typeof EC_LEVEL_M];
  const perBlock = data.length / spec.blocks;
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  for (let i = 0; i < spec.blocks; i += 1) {
    const block = data.slice(i * perBlock, (i + 1) * perBlock);
    dataBlocks.push(block);
    ecBlocks.push(rsRemainder(block, spec.ecPerBlock));
  }

  const out: number[] = [];
  for (let i = 0; i < perBlock; i += 1) for (const b of dataBlocks) out.push(b[i]);
  for (let i = 0; i < spec.ecPerBlock; i += 1) for (const b of ecBlocks) out.push(b[i]);
  return Uint8Array.from(out);
};

/* ---------------------------------------------------------------- *
 * The symbol.
 * ---------------------------------------------------------------- */

const versionSize = (version: number): number => version * 4 + 17;

/**
 * Where the alignment patterns go.
 *
 * For versions 2–6 there are exactly two coordinates, 6 and size−7,
 * giving four combinations of which three sit under a finder pattern.
 * Versions 7+ need the general formula, and this file does not go
 * there — see MAX_QR_VERSION.
 */
const alignmentCoordinates = (version: number): number[] =>
  version === 1 ? [] : [6, versionSize(version) - 7];

type Grid = {
  size: number;
  modules: boolean[][];
  /** Function patterns and reserved areas: never masked, never written
   *  over by data. */
  reserved: boolean[][];
};

const makeGrid = (size: number): Grid => ({
  size,
  modules: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  reserved: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
});

const setFunction = (grid: Grid, row: number, col: number, dark: boolean) => {
  if (row < 0 || col < 0 || row >= grid.size || col >= grid.size) return;
  grid.modules[row][col] = dark;
  grid.reserved[row][col] = true;
};

const drawFunctionPatterns = (grid: Grid, version: number) => {
  const size = grid.size;

  // Timing patterns, row 6 and column 6.
  for (let i = 0; i < size; i += 1) {
    setFunction(grid, 6, i, i % 2 === 0);
    setFunction(grid, i, 6, i % 2 === 0);
  }

  // Finder patterns, drawn as a 9×9 so the light separator ring comes
  // out of the same rule (Chebyshev distance 2 and 4 are the light
  // rings, everything else is dark).
  for (const [cr, cc] of [
    [3, 3],
    [3, size - 4],
    [size - 4, 3],
  ]) {
    for (let dr = -4; dr <= 4; dr += 1) {
      for (let dc = -4; dc <= 4; dc += 1) {
        const dist = Math.max(Math.abs(dr), Math.abs(dc));
        setFunction(grid, cr + dr, cc + dc, dist !== 2 && dist !== 4);
      }
    }
  }

  // Alignment patterns, skipping the three that overlap a finder.
  const coords = alignmentCoordinates(version);
  for (let i = 0; i < coords.length; i += 1) {
    for (let j = 0; j < coords.length; j += 1) {
      const first = i === 0;
      const last = i === coords.length - 1;
      const firstCol = j === 0;
      const lastCol = j === coords.length - 1;
      if ((first && firstCol) || (first && lastCol) || (last && firstCol)) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          setFunction(
            grid,
            coords[i] + dr,
            coords[j] + dc,
            Math.max(Math.abs(dr), Math.abs(dc)) !== 1,
          );
        }
      }
    }
  }

  // Reserve the two format-information strips and the dark module.
  //
  // Index 6 is skipped in both directions: (8, 6) and (6, 8) belong to
  // the timing patterns, not to the format strip, which is why the
  // real format layout jumps from bit 5 to position 7. Reserving them
  // as blank here overwrote two timing modules with light, and a
  // broken timing pattern is a symbol a scanner cannot even find the
  // grid of — caught by the structural test in qr.test.ts, not by the
  // round-trip, because this decoder does not need timing to read.
  for (let i = 0; i <= 8; i += 1) {
    if (i === 6) continue;
    setFunction(grid, 8, i, false);
    setFunction(grid, i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    setFunction(grid, size - 1 - i, 8, false);
    setFunction(grid, 8, size - 1 - i, false);
  }
  setFunction(grid, size - 8, 8, true); // always dark, by definition
};

/**
 * The 15-bit format string: two bits of EC level, three of mask, then a
 * BCH(15,5) check, XORed with 0x5412 so an all-zero format is not an
 * all-white strip.
 */
export const formatBits = (mask: number): number => {
  const data = (EC_LEVEL_M_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
};

const drawFormat = (grid: Grid, mask: number) => {
  const size = grid.size;
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >>> i) & 1) === 1;

  // Copy one, wrapped around the top-left finder.
  for (let i = 0; i <= 5; i += 1) setFunction(grid, i, 8, bit(i));
  setFunction(grid, 7, 8, bit(6));
  setFunction(grid, 8, 8, bit(7));
  setFunction(grid, 8, 7, bit(8));
  for (let i = 9; i < 15; i += 1) setFunction(grid, 8, 14 - i, bit(i));

  // Copy two, split between the bottom-left and top-right corners, so
  // a symbol with one corner destroyed can still be read.
  //
  // SEVEN modules go up the left column, not eight. The eighth
  // position below the bottom-left finder — (size−8, 8) — is the fixed
  // dark module, which is not part of the format string. Writing eight
  // bits there and then stamping the dark module on top costs bit 7 of
  // this copy: the two copies disagree, and a decoder that trusts the
  // second one reads the wrong mask number and gets noise. That is
  // exactly what this file did until qr.test.ts compared the copies.
  for (let i = 0; i < 7; i += 1) setFunction(grid, size - 1 - i, 8, bit(i));
  for (let i = 7; i < 15; i += 1) setFunction(grid, 8, size - 15 + i, bit(i));
  setFunction(grid, size - 8, 8, true);
};

/** The eight masks, in (row, col). Applied to data modules only. */
export const MASK_RULES: Array<(row: number, col: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/**
 * Lay the codewords down in the standard two-column zigzag, from the
 * bottom-right corner, skipping the vertical timing pattern at column
 * 6 and everything already reserved.
 */
const drawCodewords = (grid: Grid, codewords: Uint8Array) => {
  const size = grid.size;
  let bitIndex = 0;
  const totalBits = codewords.length * 8;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // column 6 is the timing pattern
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vert : vert;
        if (grid.reserved[row][col]) continue;
        if (bitIndex < totalBits) {
          grid.modules[row][col] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) === 1;
          bitIndex += 1;
        }
        // Remainder bits past the end of the codewords stay light,
        // which is what the standard says they are.
      }
    }
  }
};

const applyMask = (grid: Grid, mask: number) => {
  const rule = MASK_RULES[mask];
  for (let r = 0; r < grid.size; r += 1) {
    for (let c = 0; c < grid.size; c += 1) {
      if (!grid.reserved[r][c] && rule(r, c)) grid.modules[r][c] = !grid.modules[r][c];
    }
  }
};

/**
 * The standard's four penalty rules, used only to pick between the
 * eight masks.
 *
 * Worth knowing while reading this: getting the score subtly wrong
 * cannot produce an unreadable code. The chosen mask is recorded in
 * the format string, so any of the eight decodes correctly — a bad
 * score just picks a symbol that is harder for a camera to lock onto.
 */
export const penaltyScore = (modules: boolean[][]): number => {
  const size = modules.length;
  let score = 0;

  // Rule 1 — runs of five or more in a row or column.
  const runPenalty = (get: (a: number, b: number) => boolean) => {
    for (let a = 0; a < size; a += 1) {
      let run = 1;
      for (let b = 1; b < size; b += 1) {
        if (get(a, b) === get(a, b - 1)) {
          run += 1;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  };
  runPenalty((r, c) => modules[r][c]);
  runPenalty((c, r) => modules[r][c]);

  // Rule 2 — every 2×2 block of one colour.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  // Rule 3 — sequences that look like a finder pattern and would send
  // a scanner hunting for a corner that is not there.
  const FINDER_LIKE = [
    [true, false, true, true, true, false, true, false, false, false, false],
    [false, false, false, false, true, false, true, true, true, false, true],
  ];
  const matchesAt = (get: (i: number) => boolean, start: number, pattern: boolean[]) => {
    for (let i = 0; i < pattern.length; i += 1) if (get(start + i) !== pattern[i]) return false;
    return true;
  };
  for (let a = 0; a < size; a += 1) {
    for (let b = 0; b + 11 <= size; b += 1) {
      for (const pattern of FINDER_LIKE) {
        if (matchesAt((i) => modules[a][i], b, pattern)) score += 40;
        if (matchesAt((i) => modules[i][a], b, pattern)) score += 40;
      }
    }
  }

  // Rule 4 — drift away from half dark.
  let dark = 0;
  for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) if (modules[r][c]) dark += 1;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
};

/**
 * Encode `text` as a QR matrix, or null when it does not fit.
 *
 * Null is a real answer and the caller must handle it: the screen shows
 * the URL as selectable text instead. A QR that silently encoded a
 * truncated URL would send a clinician to a page that does not exist,
 * and neither of them could tell why.
 */
export const buildQrMatrix = (text: string): QrMatrix | null => {
  if (!text) return null;
  const bytes = utf8Bytes(text);
  const version = smallestVersion(bytes.length);
  if (version === null) return null;

  const codewords = buildFinalCodewords(buildDataCodewords(bytes, version), version);
  const size = versionSize(version);

  let best: Grid | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const grid = makeGrid(size);
    drawFunctionPatterns(grid, version);
    drawCodewords(grid, codewords);
    drawFormat(grid, mask);
    applyMask(grid, mask);
    const score = penaltyScore(grid.modules);
    if (score < bestScore) {
      bestScore = score;
      best = grid;
    }
  }

  return { size, modules: best!.modules };
};

/**
 * One SVG path covering every dark module.
 *
 * One path rather than one `<Rect>` per module because a version-4
 * symbol is 1089 modules and roughly half of them are dark: five
 * hundred native views is a visible stall on the mid-range Android
 * half of this audience, on a screen they opened because they are
 * standing in front of a doctor.
 */
export const qrPath = (matrix: QrMatrix): string => {
  const parts: string[] = [];
  for (let r = 0; r < matrix.size; r += 1) {
    for (let c = 0; c < matrix.size; c += 1) {
      if (matrix.modules[r][c]) parts.push(`M${c} ${r}h1v1h-1z`);
    }
  }
  return parts.join('');
};
