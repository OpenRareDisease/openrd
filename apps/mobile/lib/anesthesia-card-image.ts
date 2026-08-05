import type { AnesthesiaCardModel } from './anesthesia-card';

/**
 * Draws the anesthesia card to a PNG data URL.
 *
 * A PNG rather than a print dialog or a PDF, because of how this
 * actually gets used: the patient shows their phone to the
 * anesthetist, or long-presses the image to save it to their photo
 * roll so it is there without a network. Print dialogs do not exist in
 * WeChat's in-app browser, which is where a lot of these patients open
 * the site, and a PDF there opens a viewer they then have to get back
 * out of.
 *
 * Canvas, not SVG-serialized-to-image: an SVG drawn through an <img>
 * is font-isolated, and the entire card is Chinese. Canvas text uses
 * the document's resolved fonts.
 */

const WIDTH = 750;
const SCALE = 2;
const PAD = 44;

const INK = '#12212e';
const INK_SOFT = '#41525f';
const RULE = '#c9d3db';
const ACCENT = '#0b4f6c';
const PAPER = '#ffffff';

const FONT_STACK =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const font = (weight: number, size: number) => `${weight} ${size}px ${FONT_STACK}`;

/**
 * Greedy wrap. CJK breaks between any two characters, but a run of
 * ASCII must not: 「TOF」 split across lines stops being a word an
 * anesthetist can recognize, and 「57 小时」 breaking after the 5 turns
 * a duration into a different number. So ASCII runs (drug names,
 * percentages, citations, digits) are treated as single units.
 */
export const wrapText = (
  text: string,
  maxWidth: number,
  measure: (chunk: string) => number,
): string[] => {
  const tokens = text.match(/[A-Za-z0-9][A-Za-z0-9./%:-]*|[\s\S]/g) ?? [];
  const lines: string[] = [];
  let current = '';

  for (const token of tokens) {
    const candidate = current + token;
    if (current && measure(candidate) > maxWidth) {
      lines.push(current);
      // A wrapped line never opens with a space.
      current = token === ' ' ? '' : token;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
};

type Block =
  | { kind: 'title'; text: string }
  | { kind: 'name'; text: string }
  | { kind: 'patient'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'fine'; text: string }
  | { kind: 'rule' }
  | { kind: 'gap'; height: number };

const toBlocks = (model: AnesthesiaCardModel): Block[] => {
  const blocks: Block[] = [
    { kind: 'title', text: model.title },
    { kind: 'name', text: model.patientName },
    { kind: 'gap', height: 6 },
  ];
  model.patientLines.forEach((text) => blocks.push({ kind: 'patient', text }));
  model.sections.forEach((section) => {
    blocks.push({ kind: 'gap', height: 14 });
    blocks.push({ kind: 'heading', text: section.title });
    section.lines.forEach((text) => blocks.push({ kind: 'bullet', text }));
  });
  blocks.push({ kind: 'gap', height: 16 });
  blocks.push({ kind: 'rule' });
  blocks.push({ kind: 'gap', height: 12 });
  blocks.push({ kind: 'fine', text: model.disclaimer });
  blocks.push({ kind: 'gap', height: 8 });
  model.sources.forEach((text) => blocks.push({ kind: 'fine', text }));
  return blocks;
};

const STYLE: Record<
  Exclude<Block['kind'], 'rule' | 'gap'>,
  { font: string; color: string; lineHeight: number; after: number; indent: number }
> = {
  title: { font: font(700, 30), color: ACCENT, lineHeight: 40, after: 6, indent: 0 },
  name: { font: font(600, 22), color: INK, lineHeight: 32, after: 4, indent: 0 },
  patient: { font: font(400, 20), color: INK, lineHeight: 30, after: 2, indent: 0 },
  heading: { font: font(700, 22), color: ACCENT, lineHeight: 32, after: 6, indent: 0 },
  bullet: { font: font(400, 19), color: INK_SOFT, lineHeight: 29, after: 8, indent: 18 },
  fine: { font: font(400, 16), color: INK_SOFT, lineHeight: 24, after: 2, indent: 0 },
};

export type RenderedCard = {
  uri: string;
  width: number;
  height: number;
};

/**
 * Renders the card and returns a PNG data URL plus its pixel size.
 *
 * The size is part of the return value because the height is not
 * knowable up front — it falls out of how the clinical text wraps, and
 * a patient with a long FVC line gets a taller card than one with
 * none. The caller needs it to set an aspect ratio; a fixed guess
 * letterboxes the card and shrinks the type that has to be read across
 * a pre-op desk.
 *
 * Returns null where there is no canvas — native. The caller decides
 * what to offer instead rather than getting an exception on a screen
 * the patient opened for something else.
 */
export const renderAnesthesiaCardPng = (model: AnesthesiaCardModel): RenderedCard | null => {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const canvas = document.createElement('canvas');
  const probe = canvas.getContext('2d');
  if (!probe) return null;

  const blocks = toBlocks(model);
  const contentWidth = WIDTH - PAD * 2;

  // Pass one: lay out at scale 1 to learn the height. Measuring has to
  // happen with the same font that will draw the line, so the style is
  // applied before each measure rather than once up front.
  const laid: Array<{ block: Block; lines: string[] }> = [];
  let height = PAD;
  for (const block of blocks) {
    if (block.kind === 'gap') {
      height += block.height;
      laid.push({ block, lines: [] });
      continue;
    }
    if (block.kind === 'rule') {
      height += 1;
      laid.push({ block, lines: [] });
      continue;
    }
    const style = STYLE[block.kind];
    probe.font = style.font;
    const lines = wrapText(
      block.text,
      contentWidth - style.indent,
      (chunk) => probe.measureText(chunk).width,
    );
    height += lines.length * style.lineHeight + style.after;
    laid.push({ block, lines });
  }
  height += PAD;

  canvas.width = WIDTH * SCALE;
  canvas.height = Math.ceil(height) * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, WIDTH, height);

  // A left rule the whole way down. On a grayscale printout — which is
  // what a hospital printer produces — it is the only thing keeping
  // the card from reading as an anonymous wall of text.
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, 8, height);

  let y = PAD;
  ctx.textBaseline = 'top';
  for (const { block, lines } of laid) {
    if (block.kind === 'gap') {
      y += block.height;
      continue;
    }
    if (block.kind === 'rule') {
      ctx.fillStyle = RULE;
      ctx.fillRect(PAD, y, contentWidth, 1);
      y += 1;
      continue;
    }
    const style = STYLE[block.kind];
    ctx.font = style.font;
    ctx.fillStyle = style.color;
    lines.forEach((line, index) => {
      if (block.kind === 'bullet' && index === 0) {
        ctx.fillText('·', PAD + 4, y);
      }
      ctx.fillText(line, PAD + style.indent, y);
      y += style.lineHeight;
    });
    y += style.after;
  }

  return { uri: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
};
