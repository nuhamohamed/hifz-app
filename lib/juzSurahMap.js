/**
 * Hafs Uthmani juz boundaries (quran.com metadata).
 * ayahOffsetInJuz is 1-based within the juz.
 */

const SURAH_NAMES = {
  1: 'Al-Fatihah',
  2: 'Al-Baqarah',
  3: 'Ali Imran',
  4: 'An-Nisa',
  5: "Al-Ma'idah",
  6: "Al-An'am",
  7: 'Al-Araf',
  8: 'Al-Anfal',
  9: 'At-Tawbah',
  10: 'Yunus',
  11: 'Hud',
  12: 'Yusuf',
  13: "Ar-Ra'd",
  14: 'Ibrahim',
  15: 'Al-Hijr',
  16: 'An-Nahl',
  17: 'Al-Isra',
  18: 'Al-Kahf',
  19: 'Maryam',
  20: 'Ta-Ha',
  21: 'Al-Anbiya',
  22: 'Al-Hajj',
  23: "Al-Mu'minun",
  24: 'An-Nur',
  25: 'Al-Furqan',
  26: "Ash-Shu'ara",
  27: 'An-Naml',
  28: 'Al-Qasas',
  29: 'Al-Ankabut',
  30: 'Ar-Rum',
  31: 'Luqman',
  32: 'As-Sajdah',
  33: 'Al-Ahzab',
  34: 'Saba',
  35: 'Fatir',
  36: 'Ya-Sin',
  37: 'As-Saffat',
  38: 'Sad',
  39: 'Az-Zumar',
  40: 'Ghafir',
  41: 'Fussilat',
  42: 'Ash-Shura',
  43: 'Az-Zukhruf',
  44: 'Ad-Dukhan',
  45: 'Al-Jathiyah',
  46: 'Al-Ahqaf',
  47: 'Muhammad',
  48: 'Al-Fath',
  49: 'Al-Hujurat',
  50: 'Qaf',
  51: 'Adh-Dhariyat',
  52: 'At-Tur',
  53: 'An-Najm',
  54: 'Al-Qamar',
  55: 'Ar-Rahman',
  56: "Al-Waqi'ah",
  57: 'Al-Hadid',
  58: 'Al-Mujadila',
  59: 'Al-Hashr',
  60: 'Al-Mumtahanah',
  61: 'As-Saf',
  62: "Al-Jumu'ah",
  63: 'Al-Munafiqun',
  64: 'At-Taghabun',
  65: 'At-Talaq',
  66: 'At-Tahrim',
  67: 'Al-Mulk',
  68: 'Al-Qalam',
  69: 'Al-Haqqah',
  70: "Al-Ma'arij",
  71: 'Nuh',
  72: 'Al-Jinn',
  73: 'Al-Muzzammil',
  74: 'Al-Muddaththir',
  75: 'Al-Qiyamah',
  76: 'Al-Insan',
  77: 'Al-Mursalat',
  78: 'An-Naba',
  79: "An-Nazi'at",
  80: 'Abasa',
  81: 'At-Takwir',
  82: 'Al-Infitar',
  83: 'Al-Mutaffifin',
  84: 'Al-Inshiqaq',
  85: 'Al-Buruj',
  86: 'At-Tariq',
  87: 'Al-Ala',
  88: 'Al-Ghashiyah',
  89: 'Al-Fajr',
  90: 'Al-Balad',
  91: 'Ash-Shams',
  92: 'Al-Layl',
  93: 'Ad-Duha',
  94: 'Ash-Sharh',
  95: 'At-Tin',
  96: 'Al-Alaq',
  97: 'Al-Qadr',
  98: 'Al-Bayyinah',
  99: 'Az-Zalzalah',
  100: 'Al-Adiyat',
  101: "Al-Qari'ah",
  102: 'At-Takathur',
  103: 'Al-Asr',
  104: 'Al-Humazah',
  105: 'Al-Fil',
  106: 'Quraysh',
  107: "Al-Ma'un",
  108: 'Al-Kawthar',
  109: 'Al-Kafirun',
  110: 'An-Nasr',
  111: 'Al-Masad',
  112: 'Al-Ikhlas',
  113: 'Al-Falaq',
  114: 'An-Nas',
};

/** @type {{ juzNumber: number, verse_mapping: Record<string, string>, verses_count: number }[]} */
const JUZ_VERSE_MAPPINGS = [
  { juzNumber: 1, verse_mapping: { 1: '1-7', 2: '1-141' }, verses_count: 148 },
  { juzNumber: 2, verse_mapping: { 2: '142-252' }, verses_count: 111 },
  { juzNumber: 3, verse_mapping: { 2: '253-286', 3: '1-92' }, verses_count: 126 },
  { juzNumber: 4, verse_mapping: { 3: '93-200', 4: '1-23' }, verses_count: 131 },
  { juzNumber: 5, verse_mapping: { 4: '24-147' }, verses_count: 124 },
  { juzNumber: 6, verse_mapping: { 4: '148-176', 5: '1-81' }, verses_count: 110 },
  { juzNumber: 7, verse_mapping: { 5: '82-120', 6: '1-110' }, verses_count: 149 },
  { juzNumber: 8, verse_mapping: { 6: '111-165', 7: '1-87' }, verses_count: 142 },
  { juzNumber: 9, verse_mapping: { 7: '88-206', 8: '1-40' }, verses_count: 159 },
  { juzNumber: 10, verse_mapping: { 8: '41-75', 9: '1-92' }, verses_count: 127 },
  { juzNumber: 11, verse_mapping: { 9: '93-129', 10: '1-109', 11: '1-5' }, verses_count: 151 },
  { juzNumber: 12, verse_mapping: { 11: '6-123', 12: '1-52' }, verses_count: 170 },
  { juzNumber: 13, verse_mapping: { 12: '53-111', 13: '1-43', 14: '1-52' }, verses_count: 154 },
  { juzNumber: 14, verse_mapping: { 15: '1-99', 16: '1-128' }, verses_count: 227 },
  { juzNumber: 15, verse_mapping: { 17: '1-111', 18: '1-74' }, verses_count: 185 },
  { juzNumber: 16, verse_mapping: { 18: '75-110', 19: '1-98', 20: '1-135' }, verses_count: 269 },
  { juzNumber: 17, verse_mapping: { 21: '1-112', 22: '1-78' }, verses_count: 190 },
  { juzNumber: 18, verse_mapping: { 23: '1-118', 24: '1-64', 25: '1-20' }, verses_count: 202 },
  { juzNumber: 19, verse_mapping: { 25: '21-77', 26: '1-227', 27: '1-55' }, verses_count: 339 },
  { juzNumber: 20, verse_mapping: { 27: '56-93', 28: '1-88', 29: '1-45' }, verses_count: 171 },
  { juzNumber: 21, verse_mapping: { 29: '46-69', 30: '1-60', 31: '1-34', 32: '1-30', 33: '1-30' }, verses_count: 178 },
  { juzNumber: 22, verse_mapping: { 33: '31-73', 34: '1-54', 35: '1-45', 36: '1-27' }, verses_count: 169 },
  { juzNumber: 23, verse_mapping: { 36: '28-83', 37: '1-182', 38: '1-88', 39: '1-31' }, verses_count: 357 },
  { juzNumber: 24, verse_mapping: { 39: '32-75', 40: '1-85', 41: '1-46' }, verses_count: 175 },
  { juzNumber: 25, verse_mapping: { 41: '47-54', 42: '1-53', 43: '1-89', 44: '1-59', 45: '1-37' }, verses_count: 246 },
  { juzNumber: 26, verse_mapping: { 46: '1-35', 47: '1-38', 48: '1-29', 49: '1-18', 50: '1-45', 51: '1-30' }, verses_count: 195 },
  { juzNumber: 27, verse_mapping: { 51: '31-60', 52: '1-49', 53: '1-62', 54: '1-55', 55: '1-78', 56: '1-96', 57: '1-29' }, verses_count: 399 },
  { juzNumber: 28, verse_mapping: { 58: '1-22', 59: '1-24', 60: '1-13', 61: '1-14', 62: '1-11', 63: '1-11', 64: '1-18', 65: '1-12', 66: '1-12' }, verses_count: 137 },
  { juzNumber: 29, verse_mapping: { 67: '1-30', 68: '1-52', 69: '1-52', 70: '1-44', 71: '1-28', 72: '1-28', 73: '1-20', 74: '1-56', 75: '1-40', 76: '1-31', 77: '1-50' }, verses_count: 431 },
  {
    juzNumber: 30,
    verse_mapping: {
      78: '1-40',
      79: '1-46',
      80: '1-42',
      81: '1-29',
      82: '1-19',
      83: '1-36',
      84: '1-25',
      85: '1-22',
      86: '1-17',
      87: '1-19',
      88: '1-26',
      89: '1-30',
      90: '1-20',
      91: '1-15',
      92: '1-21',
      93: '1-11',
      94: '1-8',
      95: '1-8',
      96: '1-19',
      97: '1-5',
      98: '1-8',
      99: '1-8',
      100: '1-11',
      101: '1-11',
      102: '1-8',
      103: '1-3',
      104: '1-9',
      105: '1-5',
      106: '1-4',
      107: '1-7',
      108: '1-3',
      109: '1-6',
      110: '1-3',
      111: '1-5',
      112: '1-4',
      113: '1-5',
      114: '1-6',
    },
    verses_count: 564,
  },
];

function parseAyahRange(rangeStr) {
  const [start, end] = rangeStr.split('-').map(Number);
  return { startAyah: start, endAyah: end, ayahsInJuz: end - start + 1 };
}

function buildJuzData() {
  return JUZ_VERSE_MAPPINGS.map((entry) => {
    const surahs = Object.entries(entry.verse_mapping)
      .map(([surahKey, rangeStr]) => {
        const surahNumber = Number(surahKey);
        const { startAyah, endAyah, ayahsInJuz } = parseAyahRange(rangeStr);
        return {
          surahNumber,
          surahName: SURAH_NAMES[surahNumber],
          startAyah,
          endAyah,
          ayahsInJuz,
        };
      })
      .sort((a, b) => a.surahNumber - b.surahNumber);

    return {
      juzNumber: entry.juzNumber,
      totalAyahs: entry.verses_count,
      surahs,
    };
  });
}

export const JUZ_DATA = buildJuzData();

/**
 * @param {number} juzNumber 1–30
 * @returns {number}
 */
export function getJuzTotalAyahs(juzNumber) {
  const juz = JUZ_DATA[juzNumber - 1];
  if (!juz) {
    throw new Error(`Invalid juz number: ${juzNumber}`);
  }
  return juz.totalAyahs;
}

/**
 * Map a 1-based ayah offset within a juz to surah coordinates.
 *
 * @param {number} juzNumber 1–30
 * @param {number} ayahOffsetInJuz 1-based position within the juz
 * @returns {{ surahNumber: number, ayahNumber: number, surahName: string }}
 */
export function getAyahLocation(juzNumber, ayahOffsetInJuz) {
  const juz = JUZ_DATA[juzNumber - 1];
  if (!juz) {
    throw new Error(`Invalid juz number: ${juzNumber}`);
  }
  if (ayahOffsetInJuz < 1 || ayahOffsetInJuz > juz.totalAyahs) {
    throw new Error(
      `Ayah offset ${ayahOffsetInJuz} out of range for juz ${juzNumber} (1–${juz.totalAyahs})`
    );
  }

  let remaining = ayahOffsetInJuz;
  for (const segment of juz.surahs) {
    if (remaining <= segment.ayahsInJuz) {
      return {
        surahNumber: segment.surahNumber,
        ayahNumber: segment.startAyah + remaining - 1,
        surahName: segment.surahName,
      };
    }
    remaining -= segment.ayahsInJuz;
  }

  throw new Error(
    `Could not resolve ayah offset ${ayahOffsetInJuz} in juz ${juzNumber}`
  );
}
