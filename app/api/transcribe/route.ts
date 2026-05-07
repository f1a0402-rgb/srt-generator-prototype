import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { ACCEPTED_VIDEO_TYPES, MAX_UPLOAD_SIZE_BYTES } from "@/lib/constants";
import { extractAudioToWav } from "@/lib/ffmpeg";
import { transcribeLocalAudio } from "@/lib/local-transcription";
import { buildSrtFromSegments, formatTranscriptSegments } from "@/lib/srt";

export const runtime = "nodejs";
export const maxDuration = 300;

function badRequest(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const hintsValue = formData.get("hints");
  const video = formData.get("video");
  const hints = typeof hintsValue === "string" ? hintsValue : "";

  if (!(video instanceof File)) {
    return badRequest("動画ファイルが見つかりませんでした。");
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
  const workDir = path.join(os.tmpdir(), `srt-generator-${jobId}`);
  const inputExtension = path.extname(video.name) || ".mp4";
  const inputPath = path.join(workDir, `input${inputExtension}`);
  const audioPath = path.join(workDir, "audio.wav");
  const baseName = path.basename(video.name, inputExtension);

  try {
    await fs.mkdir(workDir, { recursive: true });
    const inputBuffer = Buffer.from(await video.arrayBuffer());
    await fs.writeFile(inputPath, inputBuffer);

    await extractAudioToWav(inputPath, audioPath);
    const transcription = await transcribeLocalAudio(audioPath, hints);

    if (transcription.segments.length === 0) {
      return badRequest("音声は読み取れましたが、文字起こし結果が空でした。");
    }

    const formattedSegments = formatTranscriptSegments(transcription.segments);
    const srtContent = buildSrtFromSegments(formattedSegments);

    return Response.json({
      fileName: `${baseName}.srt`,
      hints: transcription.hints,
      mode: "local",
      model: transcription.model,
      segments: formattedSegments,
      srtContent,
      transcript: formattedSegments.map((segment) => segment.text).join("\n")
    });
  } catch (error) {
    console.error(error);

    const message =
      error instanceof Error
        ? error.message
        : "ローカル文字起こしに失敗しました。動画ファイルを確認してください。";

    return badRequest(message, 500);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
