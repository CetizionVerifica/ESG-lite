/**
 * #209 review · how wide a chart text is, on the wide side, without a browser (the renderer is pure).
 *
 * ADVANCE holds each character's advance width (em) in the widest of the eight studio faces
 * (render/fonts.ts, the @fontsource Latin files the studio serves), regular (400) and bold (700),
 * measured in Chromium 1194 (canvas measureText and SVG text with the .ds-doc CSS, lining-nums)
 * and rounded up to 0.01 em. Sub- and superscript digits can come from a fallback face, so they
 * take 0.6 em. A character not listed takes the widest advance of any (1.1 em). The measurements
 * per face are in ci/fixtures/studio/font-advances.json; ci/unit/ds-209-layout.test.cjs checks
 * that textWidth is never smaller than any face.
 */
const ADVANCE: Record<string, readonly [number, number]> = {
  "0": [0.65, 0.71], "1": [0.60, 0.60], "2": [0.60, 0.65], "3": [0.60, 0.60], "4": [0.60, 0.67],
  "5": [0.60, 0.61], "6": [0.60, 0.65], "7": [0.60, 0.60], "8": [0.60, 0.66], "9": [0.60, 0.65],
  " ": [0.26, 0.26], "!": [0.34, 0.35], "\"": [0.43, 0.54], "#": [0.72, 0.68], "$": [0.60, 0.62],
  "%": [0.95, 0.98], "&": [0.75, 0.79], "'": [0.25, 0.30], "(": [0.37, 0.41], ")": [0.37, 0.41],
  "*": [0.63, 0.63], "+": [0.63, 0.65], ",": [0.31, 0.32], "-": [0.42, 0.41], ".": [0.31, 0.32],
  "/": [0.50, 0.51], ":": [0.31, 0.34], ";": [0.31, 0.34], "<": [0.63, 0.65], "=": [0.63, 0.65],
  ">": [0.63, 0.65], "?": [0.58, 0.62], "@": [1.01, 1.01], "A": [0.72, 0.77], "B": [0.70, 0.75],
  "C": [0.73, 0.74], "D": [0.79, 0.82], "E": [0.68, 0.69], "F": [0.63, 0.64], "G": [0.80, 0.81],
  "H": [0.83, 0.88], "I": [0.40, 0.44], "J": [0.56, 0.61], "K": [0.76, 0.83], "L": [0.62, 0.65],
  "M": [0.94, 0.96], "N": [0.78, 0.82], "O": [0.80, 0.80], "P": [0.67, 0.74], "Q": [0.80, 0.81],
  "R": [0.73, 0.80], "S": [0.68, 0.68], "T": [0.68, 0.73], "U": [0.76, 0.77], "V": [0.71, 0.74],
  "W": [1.04, 1.09], "X": [0.73, 0.75], "Y": [0.69, 0.70], "Z": [0.64, 0.66], "[": [0.35, 0.38],
  "\\": [0.50, 0.51], "]": [0.35, 0.38], "^": [0.63, 0.65], "_": [0.57, 0.56], "`": [0.60, 0.60],
  "a": [0.57, 0.60], "b": [0.62, 0.65], "c": [0.52, 0.58], "d": [0.62, 0.64], "e": [0.57, 0.60],
  "f": [0.37, 0.43], "g": [0.62, 0.64], "h": [0.65, 0.67], "i": [0.33, 0.35], "j": [0.31, 0.34],
  "k": [0.60, 0.64], "l": [0.33, 0.35], "m": [0.96, 0.99], "n": [0.65, 0.67], "o": [0.61, 0.63],
  "p": [0.63, 0.65], "q": [0.62, 0.64], "r": [0.46, 0.51], "s": [0.51, 0.56], "t": [0.37, 0.44],
  "u": [0.63, 0.66], "v": [0.58, 0.59], "w": [0.84, 0.87], "x": [0.57, 0.61], "y": [0.59, 0.60],
  "z": [0.51, 0.52], "{": [0.39, 0.42], "|": [0.56, 0.56], "}": [0.39, 0.42], "~": [0.64, 0.65],
  "−": [0.63, 0.65], "·": [0.34, 0.36], "…": [0.95, 0.98], "₂": [0.60, 0.60], "₃": [0.60, 0.60],
  "₄": [0.60, 0.60], "²": [0.60, 0.60], "³": [0.60, 0.60], "°": [0.47, 0.47], "€": [0.70, 0.73],
  "£": [0.64, 0.66], "¥": [0.69, 0.71], "‰": [1.00, 1.00], "–": [0.59, 0.60], "—": [1.00, 1.00],
  "‘": [0.28, 0.30], "’": [0.28, 0.30], "“": [0.48, 0.54], "”": [0.48, 0.54], "×": [0.63, 0.65],
  "÷": [0.63, 0.65], "µ": [0.63, 0.66]
};
const WIDEST: readonly [number, number] = [1.1, 1.1];
/** Safety margin on every text width (em): kerning, hinting and rounding never make a text wider than this estimate. */
export const TEXT_MARGIN_EM = 0.1;

/** A text's width in viewBox units at `size`, on the wide side: every studio face fits inside it (`bold` for weight 700). */
export const textWidth = (s: string, size: number, bold = false): number => {
  const k = bold ? 1 : 0;
  let em = TEXT_MARGIN_EM;
  for (const c of s) em += (ADVANCE[c] ?? WIDEST)[k];
  return em * size;
};

/**
 * #209 round 4 · how far a text's ink reaches above and below its `y` (em), on the high side: the eight studio faces
 * measured in Chromium 1194 (canvas actualBoundingBox per character, regular and bold; ci/fixtures/studio/font-advances.json
 * `top`, `bottom`, `middleShift`), so a fit is decided on the glyphs, not on a whole em box plus air.
 *   figures (digits, % . + − - · space): 0.75 above the baseline, 0.05 below;
 *   a comma or semicolon reaches 0.21 below; a descender (g j p q y Q J µ) 0.26, brackets, slashes, @ $ _ 0.27; subscripts
 *   0.11; any other letter or sign 0.80 above; quotes, ° and superscripts 0.87; a character the table doesn't list (an
 *   accented capital, a fallback glyph) 1.0 above and 0.3 below.
 * With dominant-baseline "middle" the baseline sits 0.237–0.273 em under y (per face), so a figure's ink spans 0.50 above
 * y and 0.30 below it (0.45 with a comma, 0.52 with a descender); a letter's 0.62 above.
 */
const FIGURE = new Set("0123456789%.+−-· ");
const COMMA = new Set(",;");
const DESCENDER = new Set("gjpqyQJµ");
const DEEP = new Set("()[]{}/\\|@$_");
const SUBSCRIPT = new Set("₂₃₄");
const TALL = new Set("\"'‘’“”`²³°*^");
export const inkExtent = (s: string, baseline: "alphabetic" | "middle" = "alphabetic"): { up: number; down: number } => {
  const chars = [...s];
  const unknown = chars.some((c) => !(c in ADVANCE));
  const tall = chars.some((c) => TALL.has(c));
  const figures = chars.every((c) => FIGURE.has(c) || COMMA.has(c));
  const has = (set: Set<string>) => chars.some((c) => set.has(c));
  const down = unknown ? 5 : has(DEEP) ? 3 : has(DESCENDER) ? 2 : has(COMMA) ? 1 : has(SUBSCRIPT) ? 4 : 0;
  if (baseline === "middle") return { up: unknown ? 0.77 : tall ? 0.62 : figures ? 0.5 : 0.56, down: [0.3, 0.45, 0.52, 0.52, 0.37, 0.58][down] };
  return { up: unknown ? 1 : tall ? 0.87 : figures ? 0.75 : 0.8, down: [0.05, 0.21, 0.26, 0.27, 0.11, 0.3][down] };
};
