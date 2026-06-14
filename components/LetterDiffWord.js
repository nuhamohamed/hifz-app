import { Text } from 'react-native';
import { computeLetterSegments } from '../lib/letterDiff';

const WRONG_COLOR = '#c62828';

/**
 * Renders a single Arabic word with per-letter wrong/correct coloring.
 * Returns a React.Fragment of nested Text spans — must be placed inside
 * a parent <Text> element so Arabic shaping covers the whole line.
 *
 * @param {string}      displayWord   Uthmanic display text (tashkeel preserved)
 * @param {string|null} spokenWord    Normalized spoken word; null = word was missing
 */
/**
 * Must be placed inside a parent <Text> as an inline child.
 * Returns a React Fragment of nested Text spans — one per letter-cluster run.
 */
export function LetterDiffWord({ displayWord, spokenWord }) {
  if (!displayWord) return null;
  const segments = computeLetterSegments(displayWord, spokenWord ?? null);
  return (
    <>
      {segments.map((seg, i) => (
        <Text key={i} style={seg.wrong ? { color: WRONG_COLOR } : null}>
          {seg.text}
        </Text>
      ))}
    </>
  );
}
