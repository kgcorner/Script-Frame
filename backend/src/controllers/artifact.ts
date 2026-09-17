// Controller: serve stored generation artifacts as immutable media.
//
// Artifacts are retained permanently; this endpoint only reads (never deletes) them.
import { Request, Response, NextFunction } from 'express';
import { createReadStream } from 'fs';
import { artifactService } from '../services/artifact.js';

function getNameParam(req: Request): string {
  const name = req.params.name;
  return Array.isArray(name) ? name[0] : (name as string);
}

export class ArtifactController {
  // GET /artifact/:name -> stream the media, with byte-range support for video/audio.
  async getArtifact(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const artifact = artifactService.resolve(getNameParam(req));
      if (!artifact) {
        res.status(404).json({ success: false, error: 'Artifact not found' });
        return;
      }

      res.setHeader('Content-Type', artifact.mimeType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `inline; filename="${artifact.name}"`);
      // Artifacts are immutable and kept forever -> safe to cache hard.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

      const range = req.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        if (!match) {
          res.status(416).setHeader('Content-Range', `bytes */${artifact.size}`);
          res.end();
          return;
        }

        const [, startStr, endStr] = match;
        let start: number;
        let end: number;
        if (startStr === '' && endStr !== '') {
          // Suffix range: the last N bytes.
          start = Math.max(artifact.size - parseInt(endStr, 10), 0);
          end = artifact.size - 1;
        } else {
          start = startStr ? parseInt(startStr, 10) : 0;
          end = endStr ? parseInt(endStr, 10) : artifact.size - 1;
        }

        if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= artifact.size) {
          res.status(416).setHeader('Content-Range', `bytes */${artifact.size}`);
          res.end();
          return;
        }

        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${artifact.size}`);
        res.setHeader('Content-Length', String(end - start + 1));
        createReadStream(artifact.path, { start, end }).pipe(res);
        return;
      }

      res.status(200);
      res.setHeader('Content-Length', String(artifact.size));
      createReadStream(artifact.path).pipe(res);
    } catch (error) {
      next(error);
    }
  }
}

export const artifactController = new ArtifactController();