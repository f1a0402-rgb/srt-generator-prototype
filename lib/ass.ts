import type { TranscriptSegment } from "@/lib/srt";
import type { SubtitleStyle } from "@/lib/subtitle-style";

export function getNormalizedPlayRes(videoWidth: number, videoHeight: number) {
  const isPortrait = videoHeight > videoWidth;

  return isPortrait
    ? { width: 1080, height: 1920 }
    : { width: 1920, height: 1080 };
}

export function getRenderedFontSize(style: SubtitleStyle, videoWidth: number, videoHeight: number) {
  const isPortrait = videoHeight > videoWidth;
  const scale = isPortrait ? 3.2 : 2.2;
  return Math.round(style.fontSize * scale * Math.max(style.exportScale, 1));
}

export function getRenderedVerticalMargin(style: SubtitleStyle) {
  return Math.max(Math.round(style.bottomOffset * 1.4), 10);
}

export function getRenderedHorizontalMargin(style: SubtitleStyle, videoWidth: number, videoHeight: number) {
  const renderedFontSize = getRenderedFontSize(style, videoWidth, videoHeight);
  return Math.max(Math.round(renderedFontSize * 0.8), 20);
}

export function getRenderedOutlineWidth(style: SubtitleStyle) {
  return Math.max(style.outlineWidth, 1);
}

function formatAssTimestamp(seconds: number) {
  const totalCentiseconds = Math.max(0, Math.floor(seconds * 100));
  const hours = Math.floor(totalCentiseconds / 360000);
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
  const secs = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;

  return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}

function normalizeHexColor(color: string) {
  const hex = color.replace("#", "").trim();

  if (hex.length === 3) {
    return hex
      .split("")
      .map((char) => `${char}${char}`)
      .join("")
      .toUpperCase();
  }

  return hex.padEnd(6, "0").slice(0, 6).toUpperCase();
}

function toAssColor(color: string, opacity = 1) {
  const hex = normalizeHexColor(color);
  const red = hex.slice(0, 2);
  const green = hex.slice(2, 4);
  const blue = hex.slice(4, 6);
  const alpha = Math.round((1 - opacity) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();

  return `&H${alpha}${blue}${green}${red}`;
}

function escapeAssText(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\N").replace(/{/g, "\\{").replace(/}/g, "\\}");
}

function alignmentToAss(alignment: SubtitleStyle["alignment"]) {
  if (alignment === "left") {
    return 1;
  }

  if (alignment === "right") {
    return 3;
  }

  return 2;
}

export function createAssSubtitleContent(
  segments: TranscriptSegment[],
  style: SubtitleStyle,
  videoWidth: number,
  videoHeight: number
) {
  const playRes = getNormalizedPlayRes(videoWidth, videoHeight);
  const renderedFontSize = getRenderedFontSize(style, videoWidth, videoHeight);
  const marginHorizontal = getRenderedHorizontalMargin(style, videoWidth, videoHeight);
  const marginVertical = getRenderedVerticalMargin(style);
  const borderStyle = style.backgroundOpacity > 0.01 ? 4 : 1;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playRes.width}
PlayResY: ${playRes.height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontFamily},${renderedFontSize},${toAssColor(style.textColor)},${toAssColor(
    style.textColor
  )},${toAssColor(style.outlineColor)},${toAssColor(style.backgroundColor, style.backgroundOpacity)},0,0,0,0,100,100,0,0,${borderStyle},${getRenderedOutlineWidth(style)},0,${alignmentToAss(
    style.alignment
  )},${marginHorizontal},${marginHorizontal},${marginVertical},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events = segments
    .filter((segment) => segment.text.trim())
    .map((segment) => {
      return `Dialogue: 0,${formatAssTimestamp(segment.start)},${formatAssTimestamp(
        segment.end
      )},Default,,0,0,0,,${escapeAssText(segment.text.trim())}`;
    })
    .join("\n");

  return `${header}\n${events}\n`;
}
