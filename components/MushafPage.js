import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { getPageLines } from '../lib/mushafDb';
import { LetterDiffWord } from './LetterDiffWord';

// Loaded at runtime in App.js via useFonts from assets/UthmanicHafs_V22.ttf.
export const MUSHAF_FONT_FAMILY = 'UthmanicHafs';

const BASMALLAH = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';

const ARABIC_DIGIT_MAP = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

function toArabicDigits(n) {
  return String(n)
    .split('')
    .map((d) => ARABIC_DIGIT_MAP[Number(d)] ?? d)
    .join('');
}

/**
 * One mushaf page (15-line Madinah layout) with per-word visibility/status.
 *
 * ayahStatuses: { ['surah:ayah']: status }
 *
 * Status shapes:
 *   { revealedCount: number, liveWrongIndices: number[] }
 *     → current live ayah: words 0..revealedCount-1 are visible,
 *       green tint if correct, red tint if in liveWrongIndices.
 *   { wrongIndices: number[], letterDiffByIndex?: Record<number, string|null>, cue?: boolean }
 *     → confirmed ayah: all words visible; wrongIndices shown in red;
 *       if letterDiffByIndex present, uses per-letter coloring for those words;
 *       cue:true renders in gray (reciter's starting prompt).
 *   absent from map → all words hidden (unread text never disclosed).
 *
 * Ayah-end markers are always visible.
 */
export default function MushafPage({ pageNumber, ayahStatuses }) {
  const db = useSQLiteContext();
  const [lines, setLines] = useState(null);
  const [error, setError] = useState('');
  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    let mounted = true;
    setLines(null);
    getPageLines(db, pageNumber)
      .then((result) => {
        if (mounted) setLines(result);
      })
      .catch((err) => {
        if (mounted) setError(err.message ?? 'Failed to load mushaf page.');
      });
    return () => {
      mounted = false;
    };
  }, [db, pageNumber]);

  if (error) {
    return <Text style={styles.error}>{error}</Text>;
  }
  if (!lines) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  // Always target 15-line height so every page fits the same grid.
  // Pages 1 and 2 have only 8 lines in the DB (special pages); their lines
  // use the same per-line height and leave blank space at the bottom —
  // matching how those pages look in the physical Madinah mushaf.
  const lineHeight = containerHeight > 0 ? Math.floor(containerHeight / 15) : 0;

  return (
    <View style={styles.page}>
      <View
        style={styles.linesContainer}
        onLayout={(e) => setContainerHeight(e.nativeEvent.layout.height)}
      >
        {lines.map((line) => (
          <MushafLine
            key={line.lineNumber}
            line={line}
            ayahStatuses={ayahStatuses}
            lineHeight={lineHeight}
          />
        ))}
      </View>
      <Text style={styles.pageNumber}>{toArabicDigits(pageNumber)}</Text>
    </View>
  );
}

function MushafLine({ line, ayahStatuses, lineHeight }) {
  const heightStyle = lineHeight > 0 ? { height: lineHeight } : undefined;

  if (line.lineType === 'surah_name') {
    return (
      <View style={[styles.surahNameLine, heightStyle]}>
        <Text style={styles.surahNameText}>
          {line.surahName ? `سُورَةُ ${line.surahName}` : `سورة ${line.surahNumber ?? ''}`}
        </Text>
      </View>
    );
  }

  if (line.lineType === 'basmallah') {
    return (
      <View style={[styles.line, styles.centeredLine, heightStyle]}>
        <Text style={styles.word}>{BASMALLAH}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.line, line.isCentered && styles.centeredLine, heightStyle]}>
      {line.words.map((word) => {
        if (word.isMarker) {
          return (
            <Text key={word.id} style={[styles.word, styles.marker]}>
              {word.text}
            </Text>
          );
        }

        const ayahStatus = ayahStatuses[`${word.surah}:${word.ayah}`];
        const wordIndex = word.word - 1;
        const isWordReveal = ayahStatus?.revealedCount != null;
        const isRevealed = isWordReveal && wordIndex < ayahStatus.revealedCount;
        const isLiveWrong = isWordReveal && (ayahStatus.liveWrongIndices ?? []).includes(wordIndex);
        const isVisiblyWrong = isRevealed && isLiveWrong;
        const isLiveCorrect = isRevealed && !isLiveWrong;
        const isConfirmedWrong =
          !isWordReveal &&
          ayahStatus != null &&
          !ayahStatus.cue &&
          (ayahStatus.wrongIndices ?? []).includes(wordIndex);
        const isHidden = ayahStatus == null || (isWordReveal && !isRevealed);

        const letterDiffByIndex = ayahStatus?.letterDiffByIndex;
        if (isConfirmedWrong && letterDiffByIndex != null && wordIndex in letterDiffByIndex) {
          return (
            <Text key={word.id} style={styles.word}>
              <LetterDiffWord
                displayWord={word.text}
                spokenWord={letterDiffByIndex[wordIndex]}
              />
            </Text>
          );
        }

        return (
          <Text
            key={word.id}
            style={[
              styles.word,
              ayahStatus?.cue && styles.wordCue,
              isConfirmedWrong && styles.wordWrong,
              (isHidden || isVisiblyWrong) && styles.wordHidden,
              isLiveCorrect && styles.wordLiveCorrect,
              isVisiblyWrong && styles.wordLiveWrong,
            ]}
          >
            {word.text}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  linesContainer: {
    flex: 1,
  },
  pageNumber: {
    textAlign: 'center',
    marginTop: 8,
    fontSize: 18,
    color: '#8a6d2f',
    fontFamily: 'UthmanicHafs',
  },
  loading: {
    minHeight: 200,
    justifyContent: 'center',
  },
  error: {
    color: '#c00',
  },
  line: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    flexWrap: 'nowrap',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e3ddd0',
  },
  centeredLine: {
    justifyContent: 'center',
  },
  surahNameLine: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 2,
    backgroundColor: '#f6f2e8',
    borderRadius: 6,
  },
  surahNameText: {
    fontSize: 16,
    color: '#5d4a1f',
    fontFamily: MUSHAF_FONT_FAMILY,
  },
  word: {
    fontSize: 21,
    lineHeight: 36,
    color: '#1b1b1b',
    fontFamily: MUSHAF_FONT_FAMILY,
    writingDirection: 'rtl',
  },
  marker: {
    color: '#8a6d2f',
  },
  wordWrong: {
    color: '#c62828',
  },
  wordLiveCorrect: {
    color: '#2e7d32',
  },
  wordLiveWrong: {
    backgroundColor: 'rgba(198, 40, 40, 0.22)',
  },
  wordCue: {
    color: '#9e9e9e',
  },
  wordHidden: {
    color: 'transparent',
  },
});
