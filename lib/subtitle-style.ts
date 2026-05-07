export type SubtitleAlignment = "left" | "center" | "right";

export type SubtitleStyle = {
  alignment: SubtitleAlignment;
  backgroundColor: string;
  backgroundOpacity: number;
  bottomOffset: number;
  exportScale: number;
  fontFamily: string;
  fontSize: number;
  outlineColor: string;
  outlineWidth: number;
  textColor: string;
};

export const FONT_OPTIONS = [
  "Hiragino Sans",
  "Yu Gothic",
  "Arial",
  "Helvetica",
  "Verdana",
  "Trebuchet MS",
  "Georgia"
] as const;

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  alignment: "center",
  backgroundColor: "#000000",
  backgroundOpacity: 0.35,
  bottomOffset: 40,
  exportScale: 1.2,
  fontFamily: "Hiragino Sans",
  fontSize: 28,
  outlineColor: "#000000",
  outlineWidth: 2,
  textColor: "#ffffff"
};

export function getSubtitleHorizontalMargin(style: SubtitleStyle) {
  return Math.max(Math.round(style.fontSize * 1.15), 20);
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

export function hexToRgba(color: string, opacity: number) {
  const hex = normalizeHexColor(color);
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

function hexToAssColor(color: string, opacity = 1) {
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

function alignmentToAssValue(alignment: SubtitleAlignment) {
  if (alignment === "left") {
    return 1;
  }

  if (alignment === "right") {
    return 3;
  }

  return 2;
}

export function buildSubtitleForceStyle(style: SubtitleStyle) {
  const borderStyle = style.backgroundOpacity > 0.01 ? 4 : 1;
  const horizontalMargin = getSubtitleHorizontalMargin(style);

  return [
    `FontName=${style.fontFamily}`,
    `FontSize=${style.fontSize}`,
    `PrimaryColour=${hexToAssColor(style.textColor)}`,
    `OutlineColour=${hexToAssColor(style.outlineColor)}`,
    `BackColour=${hexToAssColor(style.backgroundColor, style.backgroundOpacity)}`,
    `BorderStyle=${borderStyle}`,
    `Outline=${style.outlineWidth}`,
    `Shadow=0`,
    `Alignment=${alignmentToAssValue(style.alignment)}`,
    `MarginL=${horizontalMargin}`,
    `MarginR=${horizontalMargin}`,
    `MarginV=${style.bottomOffset}`
  ].join(",");
}
