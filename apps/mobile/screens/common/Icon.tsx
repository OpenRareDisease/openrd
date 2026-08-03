import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

/**
 * The app's icon set.
 *
 * Why this exists
 * ---------------
 * Every icon used to come from FontAwesome6, whose glyphs are drawn on
 * a heavier, more geometric armature than anything else on an iPhone:
 * solid fills, thick strokes, squared terminals. Beside Chinese text at
 * 13–15pt they read as stickers rather than as controls, and they are a
 * large part of why the app looked, in the user's words, 一眼 AI.
 *
 * Ionicons is the set drawn *for* iOS. Its outline variants share SF
 * Symbols' proportions — 1.5pt strokes, rounded terminals, the same
 * optical weight as text of the same size — so an icon beside a label
 * now looks like it belongs to the label instead of sitting on top of
 * it.
 *
 * Why the FontAwesome names stayed
 * --------------------------------
 * The map below is keyed by the FontAwesome vocabulary the ~90 existing
 * call sites already use. Rewriting all of them to Ionicons names would
 * have been the same amount of churn with none of the benefit, and it
 * would have put the design decision in ninety places instead of one.
 * A screen asks for `chevron-right`; what that means is decided here.
 *
 * Adding an icon: add the name to `GLYPH`. An unmapped name renders the
 * fallback and warns in development rather than crashing — a missing
 * icon should not take a screen down.
 */

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * FontAwesome6 name → Ionicons glyph.
 *
 * Outline by default. Filled variants appear only where fill carries
 * meaning: a state that is *on* (a selected tab, a completed step, a
 * severity marker), never mere decoration.
 */
const GLYPH: Record<string, IoniconName> = {
  // Navigation and chrome
  'chevron-right': 'chevron-forward',
  'chevron-left': 'chevron-back',
  'chevron-up': 'chevron-up',
  'chevron-down': 'chevron-down',
  'arrow-right': 'arrow-forward',
  'arrow-left': 'arrow-back',
  'arrow-up': 'arrow-up',
  'arrow-down': 'arrow-down',
  xmark: 'close',
  house: 'home-outline',
  'right-from-bracket': 'log-out-outline',
  'rotate-right': 'refresh',

  // Actions
  plus: 'add',
  minus: 'remove',
  check: 'checkmark',
  'trash-can': 'trash-outline',
  'pen-to-square': 'create-outline',
  download: 'download-outline',
  camera: 'camera-outline',
  images: 'images-outline',
  stop: 'stop',
  // Send. Apple's compose affordance is an arrow, not a paper plane —
  // the plane belongs to email clients, and this button is already a
  // filled disc, so the glyph only has to say "up and away".
  'paper-plane': 'arrow-up',
  eye: 'eye-outline',
  'eye-slash': 'eye-off-outline',
  link: 'link-outline',
  'link-slash': 'unlink-outline',

  // Status. Filled, because a status marker *is* a fill — an outline
  // ring reads as an empty checkbox waiting to be ticked.
  'circle-check': 'checkmark-circle',
  'circle-exclamation': 'alert-circle',
  'triangle-exclamation': 'warning',

  // Info and help are the exception, and they are outline. They read
  // as status glyphs but they are used as *category* icons — 关于我们
  // in a settings list, a help affordance beside a label — where a
  // filled disc beside an outline shield is the loudest thing on the
  // screen and means nothing by being loud.
  'circle-info': 'information-circle-outline',
  'circle-question': 'help-circle-outline',

  // Content
  'file-lines': 'document-text-outline',
  'file-medical': 'document-text-outline',
  'file-arrow-up': 'cloud-upload-outline',
  'file-shield': 'shield-checkmark-outline',
  'shield-halved': 'shield-outline',
  'wave-square': 'pulse-outline',
  'chart-line': 'trending-up-outline',
  clock: 'time-outline',
  'clock-rotate-left': 'time-outline',
  calendar: 'calendar-outline',
  'location-dot': 'location-outline',
  phone: 'call-outline',
  comments: 'chatbubbles-outline',
  'comment-dots': 'chatbubble-ellipses-outline',
  star: 'star-outline',
  heart: 'heart-outline',
  sun: 'sunny-outline',
  /** The app's own mark, on the login screen and 关于我们. Filled:
   *  it is a logo, not a control. */
  heartbeat: 'pulse',

  // People
  user: 'person-outline',
  users: 'people-outline',
  'user-plus': 'person-add-outline',
  'user-xmark': 'person-remove-outline',
  'user-doctor': 'medkit-outline',
  'address-card': 'id-card-outline',
  'id-card': 'id-card-outline',

  // Trend direction. Not semantic on their own — 上升 is good for a
  // stair time and bad for a fall count — so the colour at the call
  // site carries the judgement and the arrow carries only direction.
  'arrow-trend-up': 'trending-up-outline',
  'arrow-trend-down': 'trending-down-outline',

  // Clinical. Ionicons has no anatomy set, so these map to the nearest
  // honest abstraction rather than to a lookalike: a lung is not a
  // balloon, and a wrong organ is worse than a neutral glyph.
  dna: 'git-branch-outline',
  lungs: 'fitness-outline',
  'heart-pulse': 'pulse-outline',
  'hand-fist': 'barbell-outline',
  microscope: 'search-circle-outline',
  flask: 'flask-outline',
  'flask-vial': 'flask-outline',
  vial: 'thermometer-outline',
  droplet: 'water-outline',
  magnet: 'magnet-outline',
  seedling: 'leaf-outline',

  // Misc
  'circle-plus': 'add-circle-outline',
  'clipboard-list': 'list-outline',
  'file-pdf': 'document-outline',
  'arrow-up-right-from-square': 'open-outline',
  'map-location-dot': 'map-outline',
  flag: 'flag-outline',
  bolt: 'flash-outline',
  palette: 'color-palette-outline',
  'rotate-left': 'arrow-undo-outline',
  'wand-magic-sparkles': 'sparkles-outline',
};

const FALLBACK: IoniconName = 'ellipse-outline';

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
  style?: ComponentProps<typeof Ionicons>['style'];
}

const Icon = ({ name, size = 16, color, style }: IconProps) => {
  const glyph = GLYPH[name];
  if (!glyph && __DEV__) {
    // Loud in development, silent and harmless in production.
    console.warn(`[Icon] no glyph mapped for "${name}" — add it to GLYPH in Icon.tsx`);
  }
  return <Ionicons name={glyph ?? FALLBACK} size={size} color={color} style={style} />;
};

export default Icon;
