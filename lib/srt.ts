export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

const END_PUNCTUATION = /[。．.!！?？]$/;
const MID_PUNCTUATION = /[、,]$/;
const FORBIDDEN_LINE_START = new Set([
  "、",
  "。",
  "）",
  ")",
  "】",
  "」",
  "』",
  "〉",
  "》",
  "ァ",
  "ィ",
  "ゥ",
  "ェ",
  "ォ",
  "ッ",
  "ャ",
  "ュ",
  "ョ",
  "ぁ",
  "ぃ",
  "ぅ",
  "ぇ",
  "ぉ",
  "っ",
  "ゃ",
  "ゅ",
  "ょ",
  "ー"
]);
const FORBIDDEN_LINE_END = new Set([
  "（",
  "(",
  "【",
  "「",
  "『",
  "〈",
  "《"
]);

function normalizeCaptionText(text: string) {
  return text.replace(/\s+/g, "").replace(/[，､]/g, "、").replace(/[｡]/g, "。").trim();
}

function appendHeuristicPunctuation(text: string, pauseAfter: number, isLast: boolean) {
  if (!text) {
    return text;
  }

  if (END_PUNCTUATION.test(text) || MID_PUNCTUATION.test(text)) {
    return text;
  }

  if (isLast || pauseAfter >= 0.8 || text.length >= 26) {
    return `${text}。`;
  }

  if (pauseAfter >= 0.35 || text.length >= 14) {
    return `${text}、`;
  }

  return text;
}

function scoreBreakPoint(text: string, index: number, target: number, maxCharsPerLine: number) {
  const previousChar = text[index - 1] ?? "";
  const nextChar = text[index] ?? "";
  let score = Math.abs(index - target);

  if (index > maxCharsPerLine) {
    score += (index - maxCharsPerLine) * 4;
  }

  if (FORBIDDEN_LINE_END.has(previousChar)) {
    score += 100;
  }

  if (FORBIDDEN_LINE_START.has(nextChar)) {
    score += 100;
  }

  if (previousChar === "、") {
    score -= 14;
  } else if (["。", "？", "！"].includes(previousChar)) {
    score -= 18;
  }

  if (index < Math.max(4, Math.floor(maxCharsPerLine * 0.6))) {
    score += 20;
  }

  return score;
}

function pickBreakIndex(text: string, maxCharsPerLine: number) {
  const hardLimit = Math.min(text.length - 1, Math.max(maxCharsPerLine + 2, 1));
  const softStart = Math.max(4, Math.floor(maxCharsPerLine * 0.6));
  const target = Math.min(maxCharsPerLine, text.length - 1);
  const candidates: number[] = [];

  for (let index = softStart; index <= hardLimit; index += 1) {
    candidates.push(index);
  }

  if (candidates.length === 0) {
    return Math.min(maxCharsPerLine, text.length);
  }

  return candidates.reduce((best, current) =>
    scoreBreakPoint(text, current, target, maxCharsPerLine) <
    scoreBreakPoint(text, best, target, maxCharsPerLine)
      ? current
      : best
  );
}

function wrapCaptionLines(text: string, maxCharsPerLine: number) {
  if (text.length <= maxCharsPerLine) {
    return text;
  }

  const lines: string[] = [];
  let remaining = text.trim();

  while (remaining.length > maxCharsPerLine) {
    const breakIndex = pickBreakIndex(remaining, maxCharsPerLine);
    const nextLine = remaining.slice(0, breakIndex).trim();

    if (!nextLine) {
      break;
    }

    lines.push(nextLine);
    remaining = remaining.slice(breakIndex).trim();
  }

  if (remaining) {
    lines.push(remaining);
  }

  return lines.join("\n");
}

export function estimateMaxCharsPerLine(videoWidth: number | null | undefined, fontSize = 28) {
  if (!videoWidth || Number.isNaN(videoWidth)) {
    return 12;
  }

  const usableWidth = Math.max(videoWidth * 0.64, 96);
  const estimatedCharWidth = Math.max(fontSize * 1.02, 12);
  const estimatedChars = Math.floor(usableWidth / estimatedCharWidth);

  return Math.min(Math.max(estimatedChars, 6), 16);
}

export function estimateOutputMaxCharsPerLine(
  videoWidth: number | null | undefined,
  videoHeight: number | null | undefined,
  fontSize = 28
) {
  if (!videoWidth || !videoHeight || Number.isNaN(videoWidth) || Number.isNaN(videoHeight)) {
    return 11;
  }

  const aspectRatio = videoWidth / videoHeight;
  const baseChars =
    aspectRatio >= 1.3 ? 13 : aspectRatio >= 0.9 ? 11 : 9;
  const fontAdjustment = 27 / Math.max(fontSize, 18);
  const estimatedChars = Math.round(baseChars * fontAdjustment);

  return Math.min(Math.max(estimatedChars, 5), 16);
}

export function wrapTextForCaptionDisplay(text: string, maxCharsPerLine = 18) {
  return text
    .split("\n")
    .map((line) => wrapCaptionLines(line.trim(), maxCharsPerLine))
    .filter(Boolean)
    .join("\n");
}

export function formatTranscriptSegments(segments: TranscriptSegment[]) {
  return segments
    .map((segment, index, source) => {
      const nextSegment = source[index + 1];
      const pauseAfter = nextSegment ? Math.max(0, nextSegment.start - segment.end) : 1;
      const normalized = normalizeCaptionText(segment.text);
      const punctuated = appendHeuristicPunctuation(normalized, pauseAfter, index === source.length - 1);

      return {
        ...segment,
        text: wrapTextForCaptionDisplay(punctuated)
      };
    })
    .filter((segment) => segment.text.trim().length > 0);
}

export function prepareSegmentsForDisplay(
  segments: TranscriptSegment[],
  options?: { maxCharsPerLine?: number }
) {
  const maxCharsPerLine = options?.maxCharsPerLine ?? 18;

  return segments.map((segment) => ({
    ...segment,
    text: wrapTextForCaptionDisplay(segment.text.trim(), maxCharsPerLine)
  }));
}

export function formatTimestamp(seconds: number) {
  const totalMilliseconds = Math.max(0, Math.floor(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return [hours, minutes, secs]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":")
    .concat(",", milliseconds.toString().padStart(3, "0"));
}

export function buildSrtFromSegments(segments: TranscriptSegment[]) {
  return segments
    .map((segment, index) => {
      return [
        String(index + 1),
        `${formatTimestamp(segment.start)} --> ${formatTimestamp(segment.end)}`,
        segment.text.trim()
      ].join("\n");
    })
    .join("\n\n");
}
