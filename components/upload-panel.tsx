"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  buildSrtFromSegments,
  estimateMaxCharsPerLine,
  estimateOutputMaxCharsPerLine,
  formatTimestamp,
  prepareSegmentsForDisplay,
  type TranscriptSegment
} from "@/lib/srt";
import {
  DEFAULT_SUBTITLE_STYLE,
  FONT_OPTIONS,
  getSubtitleHorizontalMargin,
  hexToRgba,
  type SubtitleStyle
} from "@/lib/subtitle-style";
import {
  getNormalizedPlayRes,
  getRenderedFontSize,
  getRenderedHorizontalMargin,
  getRenderedOutlineWidth,
  getRenderedVerticalMargin
} from "@/lib/ass";

const ACCEPTED_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const HINTS_STORAGE_KEY = "srt-app:hints";
const STYLE_STORAGE_KEY = "srt-app:subtitle-style";
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
const FORBIDDEN_LINE_END = new Set(["（", "(", "【", "「", "『", "〈", "《"]);

type ApiSuccess = {
  fileName: string;
  hints?: string;
  mode?: "local";
  model?: string;
  segments: TranscriptSegment[];
  srtContent: string;
  transcript: string;
};

type ApiError = {
  error: string;
};

type EditorMode = "blocks" | "fullText";

function createEmptySegment(start: number, end: number): TranscriptSegment {
  return {
    start,
    end,
    text: ""
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatSecondsForInput(seconds: number) {
  return seconds.toFixed(2);
}

function measureTextWidth(
  context: CanvasRenderingContext2D | null,
  text: string,
  style: SubtitleStyle
) {
  if (!context) {
    return text.length * style.fontSize;
  }

  context.font = `${style.fontSize}px "${style.fontFamily}"`;
  return context.measureText(text).width;
}

function chooseBreakIndexByWidth(
  text: string,
  maxWidthPx: number,
  context: CanvasRenderingContext2D | null,
  style: SubtitleStyle
) {
  let bestPreferred = -1;
  let bestAllowed = -1;

  for (let index = 1; index < text.length; index += 1) {
    const prefix = text.slice(0, index).trimEnd();
    const width = measureTextWidth(context, prefix, style);

    if (width > maxWidthPx) {
      break;
    }

    const previousChar = text[index - 1] ?? "";
    const nextChar = text[index] ?? "";
    const isAllowed = !FORBIDDEN_LINE_END.has(previousChar) && !FORBIDDEN_LINE_START.has(nextChar);

    if (!isAllowed) {
      continue;
    }

    bestAllowed = index;

    if (["。", "、", "？", "！"].includes(previousChar)) {
      bestPreferred = index;
    }
  }

  return bestPreferred > 0 ? bestPreferred : bestAllowed > 0 ? bestAllowed : Math.max(1, text.length - 1);
}

function wrapLineByPixelWidth(
  text: string,
  maxWidthPx: number,
  context: CanvasRenderingContext2D | null,
  style: SubtitleStyle
) {
  if (!text) {
    return text;
  }

  const lines: string[] = [];
  let remaining = text.trim();

  while (remaining && measureTextWidth(context, remaining, style) > maxWidthPx) {
    const breakIndex = chooseBreakIndexByWidth(remaining, maxWidthPx, context, style);
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

function prepareSegmentsByPixelWidth(
  segments: TranscriptSegment[],
  maxWidthPx: number | null,
  context: CanvasRenderingContext2D | null,
  style: SubtitleStyle,
  fallbackCharsPerLine: number
) {
  if (!maxWidthPx || maxWidthPx <= 0) {
    return prepareSegmentsForDisplay(segments, { maxCharsPerLine: fallbackCharsPerLine });
  }

  return segments.map((segment) => ({
    ...segment,
    text: segment.text
      .split("\n")
      .map((line) => wrapLineByPixelWidth(line.trim(), maxWidthPx, context, style))
      .filter(Boolean)
      .join("\n")
  }));
}

export function UploadPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [hints, setHints] = useState("");
  const [isBurningVideo, setIsBurningVideo] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState(0);
  const [editorMode, setEditorMode] = useState<EditorMode>("blocks");
  const [fullTextDraft, setFullTextDraft] = useState("");
  const [timingDrafts, setTimingDrafts] = useState<Record<string, string>>({});
  const [renderedVideoWidth, setRenderedVideoWidth] = useState<number | null>(null);
  const [renderedVideoHeight, setRenderedVideoHeight] = useState<number | null>(null);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE);
  const [error, setError] = useState<string | null>(null);
  const [editedSegments, setEditedSegments] = useState<TranscriptSegment[]>([]);
  const [result, setResult] = useState<ApiSuccess | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const canSubmit = useMemo(() => !!file && !isLoading, [file, isLoading]);

  useEffect(() => {
    const savedHints = window.localStorage.getItem(HINTS_STORAGE_KEY);

    if (savedHints) {
      setHints(savedHints);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(HINTS_STORAGE_KEY, hints);
  }, [hints]);

  useEffect(() => {
    const savedStyle = window.localStorage.getItem(STYLE_STORAGE_KEY);

    if (!savedStyle) {
      return;
    }

    try {
      setSubtitleStyle({
        ...DEFAULT_SUBTITLE_STYLE,
        ...(JSON.parse(savedStyle) as Partial<SubtitleStyle>)
      });
    } catch {
      // ignore broken saved values
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(subtitleStyle));
  }, [subtitleStyle]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  useEffect(() => {
    const videoElement = videoElementRef.current;

    if (!videoElement) {
      return;
    }

    const updateRenderedVideoWidth = () => {
      setRenderedVideoWidth(videoElement.clientWidth || null);
      setRenderedVideoHeight(videoElement.clientHeight || null);
    };

    updateRenderedVideoWidth();

    const resizeObserver = new ResizeObserver(() => {
      updateRenderedVideoWidth();
    });

    resizeObserver.observe(videoElement);
    window.addEventListener("resize", updateRenderedVideoWidth);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateRenderedVideoWidth);
    };
  }, [previewUrl]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    setResult(null);
    setError(null);

    if (!nextFile) {
      setFile(null);
      setVideoDimensions(null);
      return;
    }

    if (!ACCEPTED_TYPES.includes(nextFile.type)) {
      setFile(null);
      setVideoDimensions(null);
      setError("mp4 / mov / webm の動画ファイルを選択してください。");
      return;
    }

    setFile(nextFile);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!file) {
      setError("先に動画ファイルを選択してください。");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append("video", file);
    formData.append("hints", hints);

    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData
      });

      const payload = (await response.json()) as ApiSuccess | ApiError;

      if (!response.ok) {
        setError("error" in payload ? payload.error : "字幕生成に失敗しました。");
        return;
      }

      const successPayload = payload as ApiSuccess;
      setResult(successPayload);
      setEditedSegments(successPayload.segments);
      setFullTextDraft(successPayload.segments.map((segment) => segment.text).join("\n"));
      setTimingDrafts({});
      setSelectedSegmentIndex(0);
      setEditorMode("blocks");
    } catch {
      setError("通信に失敗しました。開発サーバーが起動しているか確認してください。");
    } finally {
      setIsLoading(false);
    }
  };

  const downloadSrt = (fileName: string, srtContent: string) => {
    const blob = new Blob([srtContent], { type: "application/x-subrip;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleOriginalDownload = () => {
    if (!result) {
      return;
    }

    downloadSrt(result.fileName, result.srtContent);
  };

  const handleEditedTextChange = (index: number, text: string) => {
    setEditedSegments((current) =>
      current.map((segment, segmentIndex) => {
        if (segmentIndex !== index) {
          return segment;
        }

        return {
          ...segment,
          text
        };
      })
    );
  };

  useEffect(() => {
    setFullTextDraft(editedSegments.map((segment) => segment.text).join("\n"));
  }, [editedSegments]);

  const updateSegmentRange = (
    index: number,
    nextValues: Partial<Pick<TranscriptSegment, "start" | "end">>
  ) => {
    setEditedSegments((current) => {
      const segment = current[index];

      if (!segment) {
        return current;
      }

      const previousSegment = current[index - 1];
      const nextSegment = current[index + 1];

      const minStart = previousSegment ? previousSegment.end : 0;
      const maxEnd = nextSegment ? nextSegment.start : Math.max(segment.end + 30, segment.start + 1);

      let start = nextValues.start ?? segment.start;
      let end = nextValues.end ?? segment.end;

      start = clamp(start, minStart, maxEnd - 0.1);
      end = clamp(end, start + 0.1, maxEnd);

      return current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              start,
              end
            }
          : item
      );
    });
  };

  const handleTimingDraftChange = (key: string, value: string) => {
    setTimingDrafts((current) => ({
      ...current,
      [key]: value
    }));
  };

  const handleTimingDraftCommit = (index: number, field: "start" | "end") => {
    const key = `${index}-${field}`;
    const draftValue = timingDrafts[key];

    if (!draftValue) {
      return;
    }

    const parsedValue = Number.parseFloat(draftValue);

    if (!Number.isFinite(parsedValue)) {
      return;
    }

    updateSegmentRange(index, { [field]: parsedValue } as Partial<Pick<TranscriptSegment, "start" | "end">>);
    setTimingDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[key];
      return nextDrafts;
    });
  };

  const seekPreviewToSegment = (index: number) => {
    const segment = editedSegments[index];
    const videoElement = videoElementRef.current;

    if (!segment || !videoElement) {
      return;
    }

    videoElement.currentTime = segment.start;
    setPreviewTime(segment.start);
    setSelectedSegmentIndex(index);
  };

  const applyPreviewTimeToSegment = (index: number, field: "start" | "end") => {
    updateSegmentRange(index, { [field]: previewTime } as Partial<Pick<TranscriptSegment, "start" | "end">>);
    setSelectedSegmentIndex(index);
  };

  const handleInsertSegmentAfter = (index: number) => {
    setEditedSegments((current) => {
      const currentSegment = current[index];
      const nextSegment = current[index + 1];

      if (!currentSegment) {
        return current;
      }

      const insertionStart = currentSegment.end;
      const insertionEnd = nextSegment
        ? Math.max(insertionStart + 0.3, (currentSegment.end + nextSegment.start) / 2)
        : insertionStart + 1.5;
      const nextSegments = [...current];
      nextSegments.splice(index + 1, 0, createEmptySegment(insertionStart, insertionEnd));
      return nextSegments;
    });

    setSelectedSegmentIndex(index + 1);
  };

  const handleMergeWithNext = (index: number) => {
    setEditedSegments((current) => {
      const currentSegment = current[index];
      const nextSegment = current[index + 1];

      if (!currentSegment || !nextSegment) {
        return current;
      }

      const mergedSegment: TranscriptSegment = {
        start: currentSegment.start,
        end: nextSegment.end,
        text: [currentSegment.text.trim(), nextSegment.text.trim()].filter(Boolean).join("\n")
      };

      const nextSegments = [...current];
      nextSegments.splice(index, 2, mergedSegment);
      return nextSegments;
    });

    setSelectedSegmentIndex(index);
  };

  const handleSplitSegment = (index: number) => {
    setEditedSegments((current) => {
      const targetSegment = current[index];

      if (!targetSegment) {
        return current;
      }

      const splitLines = targetSegment.text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (splitLines.length < 2) {
        const text = targetSegment.text.trim();
        const midpoint = Math.ceil(text.length / 2);
        const firstText = text.slice(0, midpoint).trim();
        const secondText = text.slice(midpoint).trim();

        if (!firstText || !secondText) {
          return current;
        }

        splitLines.push(secondText);
        splitLines[0] = firstText;
      }

      const midpointTime = targetSegment.start + (targetSegment.end - targetSegment.start) / 2;
      const nextSegments = [...current];
      nextSegments.splice(
        index,
        1,
        {
          start: targetSegment.start,
          end: midpointTime,
          text: splitLines[0]
        },
        {
          start: midpointTime,
          end: targetSegment.end,
          text: splitLines.slice(1).join("\n")
        }
      );
      return nextSegments;
    });

    setSelectedSegmentIndex(index + 1);
  };

  const handleApplyFullText = () => {
    setEditedSegments((current) => {
      const lines = fullTextDraft
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        return current;
      }

      if (lines.length === current.length) {
        return current.map((segment, index) => ({
          ...segment,
          text: lines[index] ?? segment.text
        }));
      }

      if (lines.length < current.length) {
        return current.map((segment, index) => {
          if (index < lines.length) {
            return {
              ...segment,
              text: lines[index]
            };
          }

          if (index === lines.length) {
            const remainingText = current
              .slice(lines.length - 1)
              .map((item) => item.text.trim())
              .filter(Boolean)
              .join("\n");

            return {
              ...segment,
              text: remainingText || segment.text
            };
          }

          return {
            ...segment,
            text: ""
          };
        });
      }

      return lines.map((line, index) => {
        const fallbackSegment = current[Math.min(index, current.length - 1)];

        return {
          start:
            current[index]?.start ??
            (index === 0 ? fallbackSegment?.start ?? 0 : current[current.length - 1]?.end ?? index),
          end:
            current[index]?.end ??
            (index === lines.length - 1
              ? Math.max(
                  (current[current.length - 1]?.end ?? lines.length) + 0.6 * (index - current.length + 1),
                  (current[current.length - 1]?.end ?? lines.length) + 0.6
                )
              : Math.max(
                  (current[current.length - 1]?.end ?? lines.length) + 0.6 * (index - current.length + 1),
                  (current[current.length - 1]?.end ?? lines.length) + 0.6
                )),
          text: line
        };
      });
    });

    setSelectedSegmentIndex(0);
    setEditorMode("blocks");
  };

  const maxCharsPerLine = useMemo(
    () => estimateMaxCharsPerLine(renderedVideoWidth, subtitleStyle.fontSize),
    [renderedVideoWidth, subtitleStyle.fontSize]
  );

  const previewJustifyContent =
    subtitleStyle.alignment === "left"
      ? "flex-start"
      : subtitleStyle.alignment === "right"
        ? "flex-end"
        : "center";

  const previewAspectRatio =
    videoDimensions && videoDimensions.width > 0 && videoDimensions.height > 0
      ? `${videoDimensions.width} / ${videoDimensions.height}`
      : "16 / 9";

  const previewRenderMetrics = useMemo(() => {
    if (!videoDimensions || !renderedVideoWidth || !renderedVideoHeight) {
      return {
        bottomPx: subtitleStyle.bottomOffset,
        fontSizePx: subtitleStyle.fontSize,
        maxWidthPx: renderedVideoWidth ? renderedVideoWidth * 0.82 : 280,
        outlinePx: subtitleStyle.outlineWidth
      };
    }

    const playRes = getNormalizedPlayRes(videoDimensions.width, videoDimensions.height);
    const fontSize = getRenderedFontSize(subtitleStyle, videoDimensions.width, videoDimensions.height);
    const horizontalMargin = getRenderedHorizontalMargin(
      subtitleStyle,
      videoDimensions.width,
      videoDimensions.height
    );
    const verticalMargin = getRenderedVerticalMargin(subtitleStyle);
    const outlineWidth = getRenderedOutlineWidth(subtitleStyle);
    const widthScale = renderedVideoWidth / playRes.width;
    const heightScale = renderedVideoHeight / playRes.height;

    return {
      bottomPx: verticalMargin * heightScale,
      fontSizePx: fontSize * heightScale,
      maxWidthPx: Math.max((playRes.width - horizontalMargin * 2) * widthScale, 80),
      outlinePx: Math.max(outlineWidth * heightScale, 1)
    };
  }, [renderedVideoHeight, renderedVideoWidth, subtitleStyle, videoDimensions]);

  const previewMeasureStyle = useMemo<SubtitleStyle>(
    () => ({
      ...subtitleStyle,
      fontSize: Math.max(Math.round(previewRenderMetrics.fontSizePx), 1)
    }),
    [previewRenderMetrics.fontSizePx, subtitleStyle]
  );

  const outputMeasureStyle = useMemo<SubtitleStyle>(() => {
    if (!videoDimensions) {
      return {
        ...subtitleStyle,
        fontSize: Math.round(subtitleStyle.fontSize * subtitleStyle.exportScale)
      };
    }

    return {
      ...subtitleStyle,
      fontSize: getRenderedFontSize(subtitleStyle, videoDimensions.width, videoDimensions.height)
    };
  }, [subtitleStyle, videoDimensions]);

  const outputMaxCharsPerLine = useMemo(
    () =>
      estimateOutputMaxCharsPerLine(
        videoDimensions?.width,
        videoDimensions?.height,
        outputMeasureStyle.fontSize
      ),
    [outputMeasureStyle.fontSize, videoDimensions?.height, videoDimensions?.width]
  );

  const measureContext = useMemo(() => {
    if (typeof document === "undefined") {
      return null;
    }

    if (!measureCanvasRef.current) {
      measureCanvasRef.current = document.createElement("canvas");
    }

    return measureCanvasRef.current.getContext("2d");
  }, []);

  const previewMaxWidthPx = useMemo(() => {
    if (!renderedVideoWidth) {
      return null;
    }

    return Math.max(previewRenderMetrics.maxWidthPx, 80);
  }, [previewRenderMetrics.maxWidthPx, renderedVideoWidth]);

  const outputMaxWidthPx = useMemo(() => {
    if (!videoDimensions?.width || !videoDimensions?.height) {
      return null;
    }

    const playRes = getNormalizedPlayRes(videoDimensions.width, videoDimensions.height);
    return Math.max(
      playRes.width -
        getRenderedHorizontalMargin(subtitleStyle, videoDimensions.width, videoDimensions.height) * 2,
      80
    );
  }, [outputMeasureStyle, videoDimensions]);

  const previewPreparedSegments = useMemo(
    () =>
      prepareSegmentsByPixelWidth(
        editedSegments,
        previewMaxWidthPx,
        measureContext,
        previewMeasureStyle,
        maxCharsPerLine
      ),
    [editedSegments, maxCharsPerLine, measureContext, previewMaxWidthPx, previewMeasureStyle]
  );

  const outputPreparedSegments = useMemo(
    () =>
      prepareSegmentsByPixelWidth(
        editedSegments,
        outputMaxWidthPx,
        measureContext,
        outputMeasureStyle,
        outputMaxCharsPerLine
      ),
    [editedSegments, measureContext, outputMaxCharsPerLine, outputMaxWidthPx, outputMeasureStyle]
  );

  const editedSrtContent = useMemo(
    () => buildSrtFromSegments(outputPreparedSegments),
    [outputPreparedSegments]
  );

  const activePreviewSegment = useMemo(() => {
    const byTime = previewPreparedSegments.find(
      (segment) => previewTime >= segment.start && previewTime <= segment.end
    );

    if (byTime) {
      return byTime;
    }

    return previewPreparedSegments[selectedSegmentIndex] ?? previewPreparedSegments[0] ?? null;
  }, [previewPreparedSegments, previewTime, selectedSegmentIndex]);

  const handleEditedDownload = () => {
    if (!result) {
      return;
    }

    const editedFileName = result.fileName.replace(/\.srt$/i, ".edited.srt");
    downloadSrt(editedFileName, editedSrtContent);
  };

  const handleBurnedVideoDownload = async () => {
    if (!file || !result) {
      setError("元の動画ファイルが見つかりません。もう一度動画を選択して生成してください。");
      return;
    }

    setIsBurningVideo(true);
    setError(null);

    const formData = new FormData();
    formData.append("video", file);
    formData.append("srtContent", editedSrtContent);
    formData.append("fileName", result.fileName);
    formData.append("segments", JSON.stringify(outputPreparedSegments));
    formData.append("style", JSON.stringify(subtitleStyle));
    formData.append("videoDimensions", JSON.stringify(videoDimensions));

    try {
      const response = await fetch("/api/burn-subtitles", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const payload = (await response.json()) as ApiError;
        setError(payload.error || "字幕付き動画の生成に失敗しました。");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName.replace(/\.srt$/i, ".subtitled.mp4");
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("字幕付き動画の生成中に通信エラーが発生しました。");
    } finally {
      setIsBurningVideo(false);
    }
  };

  const updateSubtitleStyle = <K extends keyof SubtitleStyle>(key: K, value: SubtitleStyle[K]) => {
    setSubtitleStyle((current) => ({
      ...current,
      [key]: value
    }));
  };

  return (
    <div className="w-full max-w-2xl rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-panel backdrop-blur sm:p-10">
      <div className="space-y-3 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">Prototype</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          動画からSRT字幕を生成
        </h1>
        <p className="text-sm leading-6 text-slate-600 sm:text-base">
          Macの中でローカル文字起こしを行い、SRT字幕ファイルを生成します。OpenAI APIは使いません。
        </p>
      </div>

      <div className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-800">
        最初の1回だけ、文字起こしモデルの準備に時間がかかることがあります。今は精度重視の少し大きめのローカルモデルを使います。
      </div>

      <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-line bg-mist px-6 py-12 text-center transition hover:border-accent hover:bg-teal-50">
          <span className="text-base font-medium text-slate-800">動画ファイルを選択</span>
          <span className="mt-2 text-sm text-slate-500">対応形式: mp4 / mov / webm</span>
          <input
            accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
            className="sr-only"
            name="video"
            onChange={handleFileChange}
            type="file"
          />
        </label>

        <div className="rounded-2xl border border-line bg-white px-4 py-3 text-sm text-slate-600">
          {file ? (
            <span>
              選択中: <strong className="font-semibold text-slate-900">{file.name}</strong>
            </span>
          ) : (
            <span>まだ動画は選択されていません。</span>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-800" htmlFor="hints">
            方言ヒント・地名・人名
          </label>
          <textarea
            className="min-h-28 w-full rounded-2xl border border-line bg-white px-4 py-3 text-sm leading-6 text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-accent"
            id="hints"
            onChange={(event) => setHints(event.target.value)}
            placeholder="例: 鹿児島弁 / 〇〇町 / たかこ / よく出る言い回し など"
            value={hints}
          />
          <p className="text-xs leading-5 text-slate-500">
            認識してほしい方言、地名、人名、よく出る単語を入れておくと改善することがあります。
          </p>
        </div>

        <button
          className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={!canSubmit}
          type="submit"
        >
          {isLoading ? "生成中です" : "字幕を生成する"}
        </button>
      </form>

      {error ? (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          生成中です。動画サイズによっては少し時間がかかります。
        </div>
      ) : null}

      {isBurningVideo ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          字幕付き動画を生成中です。動画の長さによっては少し時間がかかります。
        </div>
      ) : null}

      {result ? (
        <div className="mt-6 space-y-4">
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50/70 px-5 py-4 sm:px-6">
            <h2 className="text-lg font-semibold text-slate-900">生成が完了しました</h2>
            <p className="mt-1 text-sm text-slate-600">
              SRTファイルのダウンロードと、ローカル文字起こし結果のプレビューを確認できます。
            </p>
          </div>

          {result.mode === "local" ? (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              ローカルモデル: <strong>{result.model ?? "local-whisper"}</strong>
              {result.hints ? (
                <div className="mt-2 text-sky-900">
                  使ったヒント: <strong>{result.hints}</strong>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-2xl border border-emerald-100 bg-white p-4">
            <div className="mb-4 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Video Preview
              </p>
              <p className="text-sm leading-6 text-slate-600">
                動画を再生しながら、字幕の見た目を調整できます。再生位置に合う字幕を上に重ねて表示します。
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.25fr_0.95fr]">
              <div className="space-y-4">
                <div
                  className="relative overflow-hidden rounded-3xl bg-slate-950"
                  style={{ aspectRatio: previewAspectRatio }}
                >
                  {previewUrl ? (
                    <>
                      <video
                        className="h-full w-full object-contain"
                        controls
                        ref={videoElementRef}
                        onLoadedMetadata={(event) => {
                          setVideoDimensions({
                            width: event.currentTarget.videoWidth,
                            height: event.currentTarget.videoHeight
                          });
                          setRenderedVideoWidth(event.currentTarget.clientWidth || null);
                        }}
                        onTimeUpdate={(event) => setPreviewTime(event.currentTarget.currentTime)}
                        src={previewUrl}
                      />
                      <div
                        className="pointer-events-none absolute inset-x-0 bottom-0 flex px-4"
                        style={{ bottom: `${previewRenderMetrics.bottomPx}px`, justifyContent: previewJustifyContent }}
                      >
                        {activePreviewSegment ? (
                          <div
                            className="rounded-2xl px-4 py-2 whitespace-pre-wrap"
                            style={{
                              backgroundColor: hexToRgba(
                                subtitleStyle.backgroundColor,
                                subtitleStyle.backgroundOpacity
                              ),
                              boxSizing: "border-box",
                              color: subtitleStyle.textColor,
                              fontFamily: subtitleStyle.fontFamily,
                              fontSize: `${previewRenderMetrics.fontSizePx}px`,
                              display: "inline-block",
                              lineHeight: 1.4,
                              maxWidth: `${previewRenderMetrics.maxWidthPx}px`,
                              overflowWrap: "anywhere",
                              textAlign:
                                subtitleStyle.alignment === "left"
                                  ? "left"
                                  : subtitleStyle.alignment === "right"
                                    ? "right"
                                    : "center",
                              wordBreak: "break-word",
                              textShadow: `0 0 1px ${subtitleStyle.outlineColor}, 0 0 ${previewRenderMetrics.outlinePx}px ${subtitleStyle.outlineColor}, 0 1px ${previewRenderMetrics.outlinePx}px ${subtitleStyle.outlineColor}`
                            }}
                          >
                            {activePreviewSegment.text}
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div className="flex aspect-video items-center justify-center px-6 text-center text-sm text-slate-300">
                      動画を選択すると、ここにプレビューが表示されます。
                    </div>
                  )}
                </div>

              </div>

              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                  <label className="space-y-2 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">フォント</span>
                    <select
                      className="w-full rounded-2xl border border-line bg-white px-4 py-3 outline-none transition focus:border-accent"
                      onChange={(event) => updateSubtitleStyle("fontFamily", event.target.value)}
                      value={subtitleStyle.fontFamily}
                    >
                      {FONT_OPTIONS.map((fontOption) => (
                        <option key={fontOption} value={fontOption}>
                          {fontOption}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">文字サイズ: {subtitleStyle.fontSize}px</span>
                    <input
                      className="w-full"
                      max="48"
                      min="18"
                      onChange={(event) => updateSubtitleStyle("fontSize", Number(event.target.value))}
                      type="range"
                      value={subtitleStyle.fontSize}
                    />
                  </label>

                  <label className="space-y-2 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">
                      書き出しサイズ補正: {subtitleStyle.exportScale.toFixed(2)}x
                    </span>
                    <input
                      className="w-full"
                      max="2"
                      min="1"
                      onChange={(event) => updateSubtitleStyle("exportScale", Number(event.target.value))}
                      step="0.05"
                      type="range"
                      value={subtitleStyle.exportScale}
                    />
                  </label>

                  <label className="space-y-2 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">字幕位置: 下から {subtitleStyle.bottomOffset}px</span>
                    <input
                      className="w-full"
                      max="120"
                      min="10"
                      onChange={(event) => updateSubtitleStyle("bottomOffset", Number(event.target.value))}
                      type="range"
                      value={subtitleStyle.bottomOffset}
                    />
                  </label>

                  <label className="space-y-2 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">背景透過: {Math.round(subtitleStyle.backgroundOpacity * 100)}%</span>
                    <input
                      className="w-full"
                      max="0.9"
                      min="0"
                      onChange={(event) => updateSubtitleStyle("backgroundOpacity", Number(event.target.value))}
                      step="0.05"
                      type="range"
                      value={subtitleStyle.backgroundOpacity}
                    />
                  </label>
                </div>

                <p className="text-xs leading-5 text-slate-500">
                  書き出しサイズ補正は、ダウンロード動画での字幕サイズを大きめにしたいときに使います。プレビューにも反映して、見た目を合わせやすくしています。
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">文字色</span>
                    <input
                      className="h-12 w-full rounded-2xl border border-line bg-white p-2"
                      onChange={(event) => updateSubtitleStyle("textColor", event.target.value)}
                      type="color"
                      value={subtitleStyle.textColor}
                    />
                  </label>

                  <label className="space-y-2 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">背景色</span>
                    <input
                      className="h-12 w-full rounded-2xl border border-line bg-white p-2"
                      onChange={(event) => updateSubtitleStyle("backgroundColor", event.target.value)}
                      type="color"
                      value={subtitleStyle.backgroundColor}
                    />
                  </label>

                  <label className="space-y-2 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">縁取り色</span>
                    <input
                      className="h-12 w-full rounded-2xl border border-line bg-white p-2"
                      onChange={(event) => updateSubtitleStyle("outlineColor", event.target.value)}
                      type="color"
                      value={subtitleStyle.outlineColor}
                    />
                  </label>

                  <label className="space-y-2 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">縁取り太さ: {subtitleStyle.outlineWidth}px</span>
                    <input
                      className="w-full"
                      max="6"
                      min="0"
                      onChange={(event) => updateSubtitleStyle("outlineWidth", Number(event.target.value))}
                      type="range"
                      value={subtitleStyle.outlineWidth}
                    />
                  </label>
                </div>

                <div className="space-y-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-800">横位置</span>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      ["left", "左寄せ"],
                      ["center", "中央"],
                      ["right", "右寄せ"]
                    ] as const).map(([value, label]) => (
                      <button
                        className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${
                          subtitleStyle.alignment === value
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                        key={value}
                        onClick={() => updateSubtitleStyle("alignment", value)}
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-100 bg-white p-4">
            <div className="mb-4 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Subtitle Editor
              </p>
              <p className="text-sm leading-6 text-slate-600">
                会話向けのブロック編集と、一人語り向けの全文編集を切り替えられます。長い行は、プレビューと書き出し時に自動で改行されます。
              </p>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2">
              <button
                className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${
                  editorMode === "blocks"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
                onClick={() => setEditorMode("blocks")}
                type="button"
              >
                ブロック編集
              </button>
              <button
                className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${
                  editorMode === "fullText"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
                onClick={() => setEditorMode("fullText")}
                type="button"
              >
                全文編集
              </button>
            </div>

            {editorMode === "fullText" ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-line bg-slate-50 p-4">
                  <p className="mb-3 text-sm leading-6 text-slate-600">
                    一人語りや長めの動画向けです。改行ごとに字幕ブロックへ戻します。
                  </p>
                  <textarea
                    className="min-h-[320px] w-full rounded-2xl border border-line bg-white px-4 py-3 text-sm leading-7 text-slate-700 outline-none transition focus:border-accent"
                    onChange={(event) => setFullTextDraft(event.target.value)}
                    value={fullTextDraft}
                  />
                </div>

                <button
                  className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
                  onClick={handleApplyFullText}
                  type="button"
                >
                  全文編集を反映してブロックへ戻す
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {editedSegments.map((segment, index) => (
                  <div className="rounded-2xl border border-line bg-slate-50 p-4" key={`${segment.start}-${segment.end}-${index}`}>
                    <div className="mb-3 grid grid-cols-2 gap-3 text-sm text-slate-600">
                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                        <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                          開始時間
                        </span>
                        <input
                          className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-2 font-medium text-slate-800 outline-none focus:border-accent"
                          onBlur={() => handleTimingDraftCommit(index, "start")}
                          onChange={(event) => handleTimingDraftChange(`${index}-start`, event.target.value)}
                          onFocus={() => setSelectedSegmentIndex(index)}
                          step="0.1"
                          type="number"
                          value={timingDrafts[`${index}-start`] ?? formatSecondsForInput(segment.start)}
                        />
                        <span className="mt-2 block text-xs text-slate-500">{formatTimestamp(segment.start)}</span>
                        <button
                          className="mt-2 w-full rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-200"
                          onClick={() => applyPreviewTimeToSegment(index, "start")}
                          type="button"
                        >
                          セット
                        </button>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                        <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                          終了時間
                        </span>
                        <input
                          className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-2 font-medium text-slate-800 outline-none focus:border-accent"
                          onBlur={() => handleTimingDraftCommit(index, "end")}
                          onChange={(event) => handleTimingDraftChange(`${index}-end`, event.target.value)}
                          onFocus={() => setSelectedSegmentIndex(index)}
                          step="0.1"
                          type="number"
                          value={timingDrafts[`${index}-end`] ?? formatSecondsForInput(segment.end)}
                        />
                        <span className="mt-2 block text-xs text-slate-500">{formatTimestamp(segment.end)}</span>
                        <button
                          className="mt-2 w-full rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-200"
                          onClick={() => applyPreviewTimeToSegment(index, "end")}
                          type="button"
                        >
                          セット
                        </button>
                      </div>
                    </div>

                    <label className="block text-sm font-medium text-slate-800" htmlFor={`segment-${index}`}>
                      字幕本文
                    </label>
                    <textarea
                      className="mt-2 min-h-24 w-full rounded-2xl border border-line bg-white px-4 py-3 text-sm leading-6 text-slate-700 outline-none transition focus:border-accent"
                      id={`segment-${index}`}
                      onFocus={() => setSelectedSegmentIndex(index)}
                      onChange={(event) => handleEditedTextChange(index, event.target.value)}
                      value={segment.text}
                    />

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                        onClick={() => seekPreviewToSegment(index)}
                        type="button"
                      >
                        この字幕へ移動
                      </button>
                      <button
                        className="rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                        onClick={() => handleInsertSegmentAfter(index)}
                        type="button"
                      >
                        下に字幕を追加
                      </button>
                      <button
                        className="rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                        onClick={() => handleSplitSegment(index)}
                        type="button"
                      >
                        この字幕を分割
                      </button>
                      <button
                        className="rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                        disabled={index === editedSegments.length - 1}
                        onClick={() => handleMergeWithNext(index)}
                        type="button"
                      >
                        次の字幕と結合
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-emerald-100 bg-white p-4">
            <div className="mb-4 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Downloads
              </p>
              <p className="text-sm leading-6 text-slate-600">
                編集後SRTが主役です。必要なら文字起こし直後のSRTも残してダウンロードできます。
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <button
                className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
                onClick={handleEditedDownload}
                type="button"
              >
                編集後SRTをダウンロード
              </button>

              <button
                className="inline-flex items-center justify-center rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                disabled={isBurningVideo}
                onClick={handleBurnedVideoDownload}
                type="button"
              >
                {isBurningVideo ? "字幕付き動画を生成中" : "字幕付き動画をダウンロード"}
              </button>

              <button
                className="inline-flex items-center justify-center rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:bg-teal-700"
                onClick={handleOriginalDownload}
                type="button"
              >
                文字起こし直後のSRTをダウンロード
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-100 bg-white p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Transcript Preview
            </p>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{result.transcript}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
