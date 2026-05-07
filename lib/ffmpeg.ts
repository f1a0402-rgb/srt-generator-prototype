import { spawn } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { buildSubtitleForceStyle, type SubtitleStyle } from "@/lib/subtitle-style";

function getFfmpegBinaryPath() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin") {
    return path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");
  }

  if (platform === "linux") {
    const fileName = arch === "arm64" ? "ffmpeg-linux-arm64" : "ffmpeg-linux-x64";
    return path.join(process.cwd(), "node_modules", "ffmpeg-static", fileName);
  }

  if (platform === "win32") {
    return path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe");
  }

  throw new Error(`この環境では ffmpeg の実行ファイル場所を特定できませんでした: ${platform} ${arch}`);
}

async function runFfmpeg(args: string[], failureMessage: string) {
  const ffmpegBinary = getFfmpegBinaryPath();
  await fs.access(ffmpegBinary, constants.X_OK);

  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn(ffmpegBinary, args);

    let stderr = "";

    ffmpeg.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("error", (error) => {
      reject(
        new Error(
          `ffmpeg の起動に失敗しました。実行ファイル: ${ffmpegBinary} / 詳細: ${error.message}`
        )
      );
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${failureMessage}${stderr ? ` ffmpeg: ${stderr}` : ""}`));
    });
  });
}

export async function extractAudioToMp3(inputPath: string, outputPath: string) {
  await runFfmpeg(
    ["-y", "-i", inputPath, "-vn", "-acodec", "libmp3lame", "-ar", "16000", "-ac", "1", "-b:a", "48k", outputPath],
    "音声抽出に失敗しました。"
  );
}

export async function extractAudioToWav(inputPath: string, outputPath: string) {
  await runFfmpeg(
    ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outputPath],
    "音声抽出に失敗しました。"
  );
}

function escapeSubtitleFilterPath(filePath: string) {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export async function burnSubtitlesToVideo(
  inputPath: string,
  subtitlePath: string,
  outputPath: string,
  subtitleStyle: SubtitleStyle
) {
  const subtitleFilterPath = escapeSubtitleFilterPath(subtitlePath);
  const useAssFile = subtitlePath.toLowerCase().endsWith(".ass");
  const forceStyle = buildSubtitleForceStyle(subtitleStyle).replace(/,/g, "\\,");
  const subtitleFilter = useAssFile
    ? `ass='${subtitleFilterPath}'`
    : `subtitles='${subtitleFilterPath}':force_style='${forceStyle}'`;

  await runFfmpeg(
    [
      "-y",
      "-i",
      inputPath,
      "-vf",
      subtitleFilter,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      "-pix_fmt",
      "yuv420p",
      outputPath
    ],
    "字幕付き動画の生成に失敗しました。"
  );
}
