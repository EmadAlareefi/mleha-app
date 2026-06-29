// ---------------------------------------------------------------------------
// Minimal Code 128 (code set B / C) encoder.
//
// Produces the run-length module pattern for a value so it can be drawn as
// black/white bars in a PDF (matches the barcodes printed on the Salla
// "فاتورة" invoice template). No DOM/canvas dependency.
// ---------------------------------------------------------------------------

// Standard Code 128 bar/space width patterns, indexed by symbol value 0..106.
// Each entry is the widths of bar,space,bar,space,bar,space (the stop symbol
// has a 7th bar). The first run is always a bar (black).
const PATTERNS: string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const START_C = 105;
const STOP = 106;

/**
 * Encodes `value` as Code 128 and returns the module run-lengths. The result
 * always begins with a bar; runs then alternate bar/space. The total module
 * count can be used with a target width to derive the unit module width.
 */
export function encodeCode128(value: string): { runs: number[]; modules: number } {
  const codes: number[] = [];
  const isAllDigits = value.length >= 2 && /^\d+$/.test(value) && value.length % 2 === 0;

  if (isAllDigits) {
    // Code set C: encode pairs of digits.
    codes.push(START_C);
    for (let i = 0; i < value.length; i += 2) {
      codes.push(Number(value.slice(i, i + 2)));
    }
  } else {
    // Code set B: each ASCII char maps to value (charCode - 32).
    codes.push(START_B);
    for (const ch of value) {
      const v = ch.charCodeAt(0) - 32;
      codes.push(v >= 0 && v < 95 ? v : 0);
    }
  }

  // Checksum: weighted modulo 103 of the symbol values (start weight = 1).
  let sum = codes[0];
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103);
  codes.push(STOP);

  const runs: number[] = [];
  let modules = 0;
  for (const code of codes) {
    for (const ch of PATTERNS[code]) {
      const w = Number(ch);
      runs.push(w);
      modules += w;
    }
  }
  return { runs, modules };
}
