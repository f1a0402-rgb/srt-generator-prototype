import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createAssSubtitleContent } from "@/lib/ass";
import { burnSubtitlesToVideo } from "@/lib/ffmpeg";
import { ACCEPTED_VIDEO_TYPES, MAX_UPLOAD_SIZE_BYTES } from "@/lib/constants";
import { DEFAULT_SUBTITLE_STYLE, type SubtitleStyle } from "@/lib/subtitle-style";
import type { TranscriptSegment } from "@/lib/srt";

export const runtime = "nodejs";
export const maxDuration = 300;

function badRequest(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const video = formData.get("video");
  const srtContentValue = formData.get("srtContent");
  const fileNameValue = formData.get("fileName");
  const segmentsValue = formData.get("segments");
  const styleValue = formData.get("style");
  const videoDimensionsValue = formData.get("videoDimensions");

  if (!(video instanceof File)) {
    return badRequest("動画ファイルが見つかりませんでした。");
  }

  if (typeof srtContentValue !== "string" || !srtContentValue.trim()) {
    return badRequest("字幕内容が見つかりませんでした。");
  }

  let subtitleStyle: SubtitleStyle = DEFAULT_SUBTITLE_STYLE;
  let segments: TranscriptSegment[] = [];
  let videoDimensions = { width: 1080, height: 1920 };

  if (typeof styleValue === "string" && styleValue.trim()) {
    try {
      subtitleStyle = {
        ...DEFAULT_SUBTITLE_STYLE,
        ...(JSON.parse(styleValue) as Partial<SubtitleStyle>)
      };
    } catch {
      return badRequest("字幕スタイル設定の読み込みに失敗しました。");
    }
  }

  if (typeof segmentsValue === "string" && segmentsValue.trim()) {
    try {
      segments = JSON.parse(segmentsValue) as TranscriptSegment[];
    } catch {
      return badRequest("字幕ブロックの読み込みに失敗しました。");
    }
  }

  if (typeof videoDimensionsValue === "string" && videoDimensionsValue.trim()) {
    try {
      videoDimensions = {
        ...videoDimensions,
        ...(JSON.parse(videoDimensionsValue) as Partial<typeof videoDimensions>)
      };
    } catch {
      return badRequest("動画サイズ情報の読み込みに失敗しました。");
    }
  }

  if (!ACCEPTED_VIDEO_TYPES.includes(video.type as (typeof ACCEPTED_VIDEO_TYPES)[number])) {
    return badRequest("対応している動画形式は mp4 / mov / webm のみです。");
  }

  if (video.size === 0) {
    return badRequest("空の動画ファイルは処理できません。");
  }

  if (video.size > MAX_UPLOAD_SIZE_BYTES) {
    return badRequest("動画ファイルが大きすぎます。2GB以下の動画で試してください。");
  }

  const jobId = crypto.randomUUID();
  const workDir = path.join(os.tmpdir(), `subtitle-burner-${jobId}`);
  const inputExtension = path.extname(video.name) || ".mp4";
  const inputPath = path.join(workDir, `input${inputExtension}`);
  const subtitlePath = path.join(workDir, "captions.ass");
  const outputPath = path.join(workDir, "output.mp4");
  const baseName = path.basename(
    typeof fileNameValue === "string" && fileNameValue ? fileNameValue : video.name,
    path.extname(typeof fileNameValue === "string" && fileNameValue ? fileNameValue : video.name)
  );

  try {
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(inputPath, Buffer.from(await video.arrayBuffer()));
    const assContent = createAssSubtitleContent(
      segments.length > 0
        ? segments
        : [
            {
              start: 0,
              end: 1,
              text: srtContentValue
            }
          ],
      subtitleStyle,
      videoDimensions.width,
      videoDimensions.height
    );
    await fs.writeFile(subtitlePath, assContent, "utf8");

    await burnSubtitlesToVideo(inputPath, subtitlePath, outputPath, subtitleStyle);

    const outputBuffer = await fs.readFile(outputPath);

    return new Response(outputBuffer, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${baseName}.subtitled.mp4"`,
        "Content-Length": String(outputBuffer.byteLength)
      }
    });
  } catch (error) {
    console.error(error);

    const message =
      error instanceof Error
        ? error.message
        : "字幕付き動画の生成に失敗しました。動画ファイルと字幕内容を確認してください。";

    return badRequest(message, 500);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
