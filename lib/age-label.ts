/**
 * Friendly age-range formatting (Russian).
 *
 * The `age_label` column in our DB is usually already short ("0", "6+", "12+",
 * "18+"), but legacy NYC rows can still pass through as "Ages 3-5" or
 * "Ages 5-99". We:
 *   1. Collapse NYC "Ages lo-hi" into Russian "от X лет" (unbounded) or "X–Y лет".
 *   2. Also collapse a bare "lo-hi" pair into the same Russian range.
 *   3. Leave everything else (like "6+", "0", "18+") untouched — it's already fine.
 */

const UNBOUNDED_MAX = 25;

const EN_RANGE_RE = /^\s*Ages?\s+(\d+)\s*[-\u2013\u2014]\s*(\d+)\s*$/i;
const BARE_RANGE_RE = /^\s*(\d+)\s*[-\u2013\u2014]\s*(\d+)\s*$/;

function yearsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'года';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'года';
  return 'лет';
}

function formatFrom(lo: number): string {
  // "от 1 года", "от 2 лет", "от 5 лет"
  return `от ${lo} ${yearsWord(lo)}`;
}

export function formatAgeLabel(raw: string | null | undefined): string {
  const label = (raw ?? '').trim();
  if (!label) return '';

  // Bare "0" means "no age restriction" in the RU dataset — render as "0+"
  // so the card reads as "любой возраст" rather than the ambiguous "0".
  if (/^0$/.test(label)) return '0+';

  const m = label.match(EN_RANGE_RE) || label.match(BARE_RANGE_RE);
  if (!m) return label; // already in short form like "6+", "18+"

  const lo = Number(m[1]);
  const hi = Number(m[2]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return label;

  if (hi >= UNBOUNDED_MAX) return `${lo}+`;
  if (lo === hi) return `${lo} ${yearsWord(lo)}`;
  return `${lo}–${hi} ${yearsWord(hi)}`;
}

// Exported helpers for reuse (e.g. profile summary chips).
export { formatFrom, yearsWord };
