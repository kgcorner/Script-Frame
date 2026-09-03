// FFmpeg-based clip utilities for the VGWorker pipeline:
//  - last-frame extraction for clip continuation (start frames)
//  - final stitching of completed clips in priority order
// (VIDEO_GENERATION_PROCESS.md §8 — concat demuxer with re-encode fallback.)
import { spawn } from 'child_process';
import { mkdir, writeFile, unlink, stat } from 'fs/promises';
import { dirname, resolve } from 'path';
import { config } from '../config/index.js';

interface RunResult {
  code: number;
  stderr: string;
}

function runBinary(bin: string, args: string[]): Promise<RunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 16000) stderr = stderr.slice(-8000);
    });
    child.on('error', (err) => rejectPromise(err));
    child.on('close', (code) => resolvePromise({ code: code ?? -1, stderr }));
  });
}

export class VideoStitcherService {
  private get ffmpeg(): string { return config.videoGeneration.ffmpegPath; }
  private get ffprobe(): string { return config.videoGeneration.ffprobePath; }

  /** Probe a media file's duration in seconds (null when ffprobe is unavailable). */
  async probeDurationSeconds(videoPath: string): Promise<number | null> {
    try {
      const { code, stderr } = await runBinary(this.ffprobe, [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', videoPath,
      ]);
      if (code !== 0) return null;
      const parsed = parseFloat(stderr.trim());
      return Number.isFinite(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * Extract the last frame of a clip as the start frame for the next clip.
   * Strategy: seek near the end (-sseof) first; fall back to an absolute seek
   * using the probed duration.
   */
  async extractLastFrame(videoPath: string, outputPath: string): Promise<string> {
    await mkdir(dirname(outputPath), { recursive: true });

    // 1) Seek from the end of the file.
    let result = await runBinary(this.ffmpeg, [
      '-y', '-sseof', '-0.3', '-i', videoPath,
      '-frames:v', '1', '-update', '1', '-q:v', '2', outputPath,
    ]);
    if (result.code !== 0 || !(await this.fileExists(outputPath))) {
      // 2) Absolute seek based on probed duration.
      const duration = await this.probeDurationSeconds(videoPath);
      const seekTo = duration !== null ? Math.max(duration - 0.2, 0) : undefined;
      const args = ['-y'];
      if (seekTo !== undefined) args.push('-ss', String(seekTo));
      args.push('-i', videoPath, '-frames:v', '1', '-update', '1', '-q:v', '2', outputPath);
      result = await runBinary(this.ffmpeg, args);
    }
    if (result.code !== 0 || !(await this.fileExists(outputPath))) {
      throw new Error(`Last-frame extraction failed for ${videoPath}: ${result.stderr.slice(-400)}`);
    }
    return outputPath;
  }

  /**
   * Stitch clips in the given order into a single MP4 using the concat demuxer.
   * First attempt is stream-copy (fast, no quality loss); on failure the clips
   * are re-encoded so mixed codecs / resolutions still concatenate cleanly.
   */
  async stitchClips(clipPaths: string[], outputPath: string): Promise<string> {
    if (clipPaths.length === 0) throw new Error('No clips to stitch');

    await mkdir(dirname(outputPath), { recursive: true });
    const listPath = `${outputPath}.concat.txt`;
    // Escape single quotes for the concat demuxer file directive.
    const listContent = clipPaths
      .map((p) => `file '${resolve(p).replace(/'/g, "'\\''")}'`)
      .join('\n');
    await writeFile(listPath, listContent, 'utf8');

    try {
      // 1) Stream copy.
      const copyResult = await runBinary(this.ffmpeg, [
        '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
        '-c', 'copy', '-movflags', '+faststart', outputPath,
      ]);
      if (copyResult.code === 0 && await this.fileExists(outputPath)) {
        return outputPath;
      }

      // 2) Re-encode fallback (normalizes codecs / fps / resolution).
      const encodeResult = await runBinary(this.ffmpeg, [
        '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart', '-fflags', '+genpts', outputPath,
      ]);
      if (encodeResult.code !== 0 || !(await this.fileExists(outputPath))) {
        throw new Error(`Stitching failed: ${encodeResult.stderr.slice(-500) || copyResult.stderr.slice(-500)}`);
      }
      return outputPath;
    } finally {
      await unlink(listPath).catch(() => undefined);
    }
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      const info = await stat(path);
      return info.isFile() && info.size > 0;
    } catch {
      return false;
    }
  }
}

export const videoStitcher = new VideoStitcherService();
