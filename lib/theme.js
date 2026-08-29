// Dawrah brand palette and app design tokens, matching the live site
// (dawrah.ai). These were shared with the June design mockups, which have since
// been deleted: the coded screens had moved well past them and keeping a stale
// second copy of the design around only invited notes against the wrong thing.
export const colors = {
  navy: '#06152C',
  blue: '#1A3D8A',
  cobaltLight: '#4A7AB8',
  orange: '#D4580A',
  goldLight: '#FAEADE',
  slate: '#9AA8BC',
  white: '#FFFFFF',
  cream: '#FDFAF6',
  offWhite: '#F6F2ED',
  red: '#C42828',
  green: '#1A6B42',
  border: '#EEEAE3',
  brown: '#703010',
  espresso: '#5E2600',
  ice: '#E6EFF9',
  parchment: '#FAEADE',

  // semantic aliases
  primary: '#1A3D8A',
  primaryDim: 'rgba(26, 61, 138, 0.08)',
  accent: '#D4580A',
  background: '#FDFAF6',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  text: '#06152C',
  textMid: '#3D4F6B',
  textMuted: '#7A8FA8',
  success: '#1E7A4A',
  error: '#C0392B',

  // light tints, for state-card backgrounds
  primaryLight: 'rgba(26, 61, 138, 0.08)',
  accentLight: 'rgba(212, 88, 10, 0.08)',
  successLight: 'rgba(30, 122, 74, 0.08)',
  errorLight: 'rgba(192, 57, 43, 0.08)',
};

export const fonts = {
  regular: 'Outfit_400Regular',
  medium: 'Outfit_500Medium',
  semiBold: 'Outfit_600SemiBold',
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

/**
 * A colour some fraction of the way between two hex colours.
 *
 * Here so an ombre can be built from the palette itself rather than from six
 * hardcoded hexes that would not follow if a brand colour ever changed.
 * Straight RGB interpolation, which is enough for two colours this far apart:
 * the steps between blue and brown pass through indigo and rust, which is the
 * warm shift you want, rather than through anything grey.
 */
export function mixColors(fromHex, toHex, t) {
  const parse = (h) => {
    const v = h.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  };
  const [r1, g1, b1] = parse(fromHex);
  const [r2, g2, b2] = parse(toHex);
  const clamped = Math.max(0, Math.min(1, t));
  const channel = (a, b) => Math.round(a + (b - a) * clamped);
  const hex = (n) => n.toString(16).padStart(2, '0');
  return `#${hex(channel(r1, r2))}${hex(channel(g1, g2))}${hex(channel(b1, b2))}`;
}

/**
 * Evenly spaced colours across a run, for tinting a wordmark letter by letter.
 * A single-character run gets the starting colour rather than dividing by zero.
 */
export function ombre(fromHex, toHex, steps) {
  if (steps <= 1) return [fromHex];
  return Array.from({ length: steps }, (_, i) => mixColors(fromHex, toHex, i / (steps - 1)));
}
