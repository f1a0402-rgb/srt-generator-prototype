import { promises as fs } from "node:fs";
import { pipeline } from "@huggingface/transformers";
import { WaveFile } from "wavefile";

type TimestampChunk = {
  text?: string;
  timestamp?: [number | null, number | null];
};

type TranscriptionOutput = {
  text?: string;
  chunks?: TimestampChunk[];
};

type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

type WhisperLikeTranscriber = ((
  audio: Float32Array,
  options?: Record<string, unknown>
) => Promise<TranscriptionOutput>) & {
  processor?: {
    tokenizer?: {
      encode: (
        text: string,
        options?: { add_special_tokens?: boolean; return_token_type_ids?: boolean }
      ) => number[];
    };
  };
};

const MODEL_ID = process.env.LOCAL_WHISPER_MODEL || "Xenova/whisper-small";
const LANGUAGE = "japanese";

let transcriberPromise: Promise<WhisperLikeTranscriber> | null = null;

async function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = pipeline("automatic-speech-recognition", MODEL_ID);
  }

  return transcriberPromise;
}

function getAudioDurationSeconds(samples: Float32Array, sampleRate: number) {
  return sampleRate > 0 ? samples.length / sampleRate : 0;
}

async function loadWaveAsFloat32Array(wavPath: string) {
  const wavBuffer = await fs.readFile(wavPath);
  const wav = new WaveFile(wavBuffer);

  wav.toSampleRate(16000);
  wav.toBitDepth("32f");

  const rawSamples = wav.getSamples(false, Float32Array) as unknown;
  const samples =
    rawSamples instanceof Float32Array ? rawSamples : Float32Array.from(rawSamples as Iterable<number>);

  return {
    samples,
    sampleRate: 16000
  };
}

function normalizeSegments(chunks: TimestampChunk[] | undefined, fallbackText: string, duration: number) {
  const normalized =
    chunks
      ?.map((chunk) => {
        const start = chunk.timestamp?.[0] ?? null;
        const end = chunk.timestamp?.[1] ?? null;
        const text = chunk.text?.trim() ?? "";

        if (start === null || end === null || !text) {
          return null;
        }

        return {
          start,
          end: end > start ? end : start + 0.5,
          text
        };
      })
      .filter((segment): segment is TranscriptSegment => segment !== null) ?? [];

  if (normalized.length > 0) {
    return normalized;
  }

  if (!fallbackText.trim()) {
    return [];
  }

  return [
    {
      start: 0,
      end: Math.max(duration, 1),
      text: fallbackText.trim()
    }
  ];
}

function buildPromptIds(transcriber: WhisperLikeTranscriber, hints?: string) {
  const trimmedHints = hints?.trim();

  if (!trimmedHints) {
    return undefined;
  }

  const tokenizer = transcriber.processor?.tokenizer;

  if (!tokenizer) {
    return undefined;
  }

  const promptText = `固有名詞や方言のヒント: ${trimmedHints}`;
  const promptIds = tokenizer.encode(promptText, {
    add_special_tokens: false,
    return_token_type_ids: false
  });

  return promptIds.length > 0 ? promptIds : undefined;
}

export async function transcribeLocalAudio(wavPath: string, hints?: string) {
  const { samples, sampleRate } = await loadWaveAsFloat32Array(wavPath);
  const duration = getAudioDurationSeconds(samples, sampleRate);
  const transcriber = await getTranscriber();
  const promptIds = buildPromptIds(transcriber, hints);

  const result = await transcriber(samples, {
    language: LANGUAGE,
    task: "transcribe",
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
    top_k: 0,
    do_sample: false,
    prompt_ids: promptIds
  });

  const text = result.text?.trim() ?? "";
  const segments = normalizeSegments(result.chunks, text, duration);

  return {
    hints: hints?.trim() ?? "",
    text,
    segments,
    model: MODEL_ID
  };
}
