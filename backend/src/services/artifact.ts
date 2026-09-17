// Service: stored generation artifacts (immutable media fetched from ComfyUI).
//
// PERSISTENCE CONTRACT: artifacts are write-once and kept forever. Nothing in this
// service or the artifact endpoint deletes, moves, truncates or overwrites a stored
// artifact, and they keep being served even after their job row is deleted.
import { existsSync, statSync } from 'fs';
import { dirname, extname, resolve } from 'path';
import { config } from '../config/index.js';

export type ArtifactMediaKind = 'image' | 'video' | 'audio';

export interface ResolvedArtifact {
  name: string;
  path: string;
  mimeType: string;
  size: number;
}

// Only flat file names directly inside the assets directory are addressable.
const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
};

export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
export const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov']);
export const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.ogg']);

export function mimeTypeForFile(filename: string, fallbackKind: ArtifactMediaKind = 'image'): string {
  return (
    MIME_TYPES[extname(filename).toLowerCase()] ??
    (fallbackKind === 'video' ? 'video/mp4' : fallbackKind === 'audio' ? 'audio/mpeg' : 'image/png')
  );
}

/**
 * ComfyUI does not always group outputs by media type: LTX/VHS video nodes report the
 * .mp4 under the `images` array. Prefer the file extension when it is recognized, and
 * fall back to the array the file arrived in.
 */
export function kindForFile(filename: string, listKind: ArtifactMediaKind): ArtifactMediaKind {
  const ext = extname(filename).toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return listKind;
}

export class ArtifactService {
  /** Absolute directory holding every stored artifact (created on first write). */
  directory(): string {
    return resolve(config.generator.assetsPath);
  }

  /**
   * Locate a stored artifact by name. Returns null when the name is not a flat file
   * inside the assets directory (path-traversal guard) or does not exist on disk.
   */
  resolve(name: string): ResolvedArtifact | null {
    if (!ARTIFACT_NAME_PATTERN.test(name)) return null;

    const assetsDir = this.directory();
    const filePath = resolve(assetsDir, name);
    // Defense in depth: the resolved file must sit directly inside the assets directory.
    if (dirname(filePath) !== assetsDir) return null;
    if (!existsSync(filePath)) return null;

    const stat = statSync(filePath);
    if (!stat.isFile()) return null;

    return { name, path: filePath, mimeType: mimeTypeForFile(name), size: stat.size };
  }
}

export const artifactService = new ArtifactService();