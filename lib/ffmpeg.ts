import { spawn } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { buildSubtitleForceStyle, type SubtitleStyle } from "@/lib/subtitle-style";

type FfmpegCommand = {
  command: string;
  resolvedPath: string;
};

const require = createRequire(import.meta.url);

async function canAccessFile(filePath: string) {
  try {
    await fs.access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveFfmpegCommand(): Promise<FfmpegCommand> {
  const envPath = process.env.FFMPEG_PATH?.trim();

  if (envPath) {
    const absoluteEnvPath = path.resolve(envPath);

    if (await canAccessFile(absoluteEnvPath)) {
      return {
        command: absoluteEnvPath,
        resolvedPath: absoluteEnvPath
      };
    }
  }

  if (ffmpegStatic && (await canAccessFile(ffmpegStatic))) {
    return {
      command: ffmpegStatic,
      resolvedPath: ffmpegStatic
    };
  }

  const packageRootCandidates: string[] = [];

  try {
    packageRootCandidates.push(path.dirname(require.resolve("ffmpeg-static/package.json")));
  } catch {
    // ignore
  }

  packageRootCandidates.push(path.join(process.cwd(), "node_modules", "ffmpeg-static"));

  const binaryNames =
    process.platform === "win32"
      ? ["ffmpeg.exe"]
      : process.platform === "linux"
        ? process.arch === "arm64"
          ? ["ffmpeg-linux-arm64", "ffmpeg"]
          : ["ffmpeg-linux-x64", "ffmpeg"]
        : ["ffmpeg"];

  for (const packageRoot of packageRootCandidates) {
    for (const binaryName of binaryNames) {
      const candidatePath = path.join(packageRoot, binaryName);

      if (await canAccessFile(candidatePath)) {
        return {
          command: candidatePath,
          resolvedPath: candidatePath
        };
      }
    }
  }

  return {
    command: "ffmpeg",
    resolvedPath: "ffmpeg (PATH)"
  };
}

function getFfmpegSetupHelp() {
  if (process.platform === "win32") {
    return "Windows では ffmpeg-static が使えない場合、ffmpeg をインストールして PATH を通すか、FFMPEG_PATH 環境変数に ffmpeg.exe の場所を設定してください。README の Windows セットアップ手順も確認してください。";
  }

  if (process.platform === "darwin") {
    return "macOS では ffmpeg-static が使えない場合、ffmpeg をインストールするか、FFMPEG_PATH 環境変数に ffmpeg の場所を設定してください。README の macOS セットアップ手順も確認してください。";
  }

  return "ffmpeg をインストールするか、FFMPEG_PATH 環境変数に ffmpeg の場所を設定してください。README のセットアップ手順も確認してください。";
}

async function runFfmpeg(args: string[], failureMessage: string) {
  const ffmpegCommand = await resolveFfmpegCommand();

  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn(ffmpegCommand.command, args);

    let stderr = "";

    ffmpeg.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("error", (error) => {
      reject(
        new Error(
          `ffmpeg の起動に失敗しました。使用しようとした場所: ${ffmpegCommand.resolvedPath} / 詳細: ${error.message} / ${getFfmpegSetupHelp()}`
        )
      );
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${failureMessage}${stderr ? ` ffmpeg: ${stderr}` : ""} / 使用しようとした場所: ${ffmpegCommand.resolvedPath}`
        )
      );
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
