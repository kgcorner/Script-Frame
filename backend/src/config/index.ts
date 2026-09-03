import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    path: process.env.DB_PATH || './data/video-generator.db',
  },

  omniroute: {
    baseUrl: process.env.OMNIROUTE_BASE_URL || 'http://localhost:8000',
    apiKey: process.env.OMNIROUTE_API_KEY || '',
    timeout: parseInt(process.env.OMNIROUTE_TIMEOUT || '30000', 10),
  },

  comfyui: {
    baseUrl: process.env.COMFYUI_BASE_URL || 'http://localhost:8188',
    timeout: parseInt(process.env.COMFYUI_TIMEOUT || '120000', 10),
    userWorkflowsPath: process.env.COMFYUI_USER_WORKFLOWS_PATH || '/tools/ComfyUI/user/default/workflows',
  },

  // Video generation pipeline (VIDEO_GENERATION_PROCESS.md).
  videoGeneration: {
    // Local storage root for fetched ComfyUI media and final stitched videos.
    mediaPath: process.env.VG_MEDIA_PATH || './data/media',
    // Poll cadence for ComfyUI job completion (process doc: 20 seconds).
    pollIntervalMs: parseInt(process.env.VG_POLL_INTERVAL_MS || '20000', 10),
    // Total attempts per video job before it is marked FAILED (auto-retry x2).
    maxJobAttempts: parseInt(process.env.VG_MAX_JOB_ATTEMPTS || '3', 10),
    // Per-job completion timeout when the workflow provides no maxTimeout.
    defaultJobTimeoutSeconds: parseInt(process.env.VG_DEFAULT_JOB_TIMEOUT || '900', 10),
    // Corrective retries when the LLM returns malformed JSON.
    llmCorrectionRetries: parseInt(process.env.VG_LLM_CORRECTION_RETRIES || '1', 10),
    // ffmpeg/ffprobe binaries for frame extraction and stitching.
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  },

  llm: {
    // Wall-clock cap for a single LLM completion (story/clip planning can be slow).
    completionTimeout: parseInt(process.env.LLM_COMPLETION_TIMEOUT || '180000', 10),
  },

  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },
};

export type Config = typeof config;
