// Shared VIN utilities used across the PWA

const LABEL_PATTERN_STRICT = /(?:\bVIN\b|\bV\/N\b|\bVN\b|\bCHASSIS\b|\bCHAS\b|\bNO\b)\s*[:\-#]?\s{2,}([A-Z0-9]{5,})/;
const LABEL_PATTERN_LOOSE = /(?:\bVIN\b|\bV\/N\b|\bVN\b|\bCHASSIS\b|\bCHAS\b|\bNO\b)\s*[:\-#]?\s*([A-Z0-9]{5,})/;

export function normalizeVin(raw: string): string {
  let upper = (raw || '').toUpperCase();

  const spaced = upper.match(LABEL_PATTERN_STRICT);
  if (spaced?.[1]) {
    upper = spaced[1];
  } else {
    const loose = upper.match(LABEL_PATTERN_LOOSE);
    if (loose?.[1] && loose[0].length - loose[1].length >= 3) {
      upper = loose[1];
    }
  }

  upper = upper.replace(/[^A-Z0-9]/g, '').replace(/[IOQ]/g, '');

  if (upper.length > 17) upper = upper.slice(0, 17);
  return upper;
}

export function formatVin(value: string): string {
  return normalizeVin(value);
}

export function isValidVin(vin: string): boolean {
  const normalized = normalizeVin(vin);
  if (!normalized || normalized.length !== 17) return false;
  if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(normalized)) return false;

  if (hasObviousOcrErrors(normalized)) return false;

  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  const values: Record<string, number> = {
    '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6, 'G': 7, 'H': 8,
    'J': 1, 'K': 2, 'L': 3, 'M': 4, 'N': 5, 'P': 7, 'R': 9, 'S': 2,
    'T': 3, 'U': 4, 'V': 5, 'W': 6, 'X': 7, 'Y': 8, 'Z': 9,
  };

  let sum = 0;
  for (let i = 0; i < 17; i++) {
    if (i === 8) continue;
    sum += (values[normalized[i]] || 0) * weights[i];
  }

  const checkDigit = sum % 11;
  const expectedCheck = checkDigit === 10 ? 'X' : checkDigit.toString();

  if (normalized[8] !== expectedCheck) {
    return hasSAVinTolerance(normalized, expectedCheck);
  }

  return true;
}

function hasObviousOcrErrors(vin: string): boolean {
  const suspiciousPatterns = [
    /[IL1]{3,}/,
    /[O0]{4,}/,
    /^[0-9]{17}$/,
    /^[A-Z]{17}$/,
    /(.)\1{5,}/,
  ];
  return suspiciousPatterns.some((pattern) => pattern.test(vin));
}

function hasSAVinTolerance(vin: string, expectedCheck: string): boolean {
  if (!looksLikeSouthAfricanVin(vin)) return false;
  const toleranceMap: Record<string, string[]> = {
    '0': ['O'],
    'O': ['0'],
    '1': ['I', 'L'],
    'I': ['1'],
    'L': ['1'],
    '5': ['S'],
    'S': ['5'],
    '8': ['B'],
    'B': ['8'],
  };
  const alternatives = toleranceMap[expectedCheck];
  return alternatives ? alternatives.includes(vin[8]) : false;
}

function looksLikeSouthAfricanVin(vin: string): boolean {
  return vin.startsWith('A') || vin.startsWith('B') || vin.startsWith('V');
}
