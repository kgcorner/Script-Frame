import express from 'express';
import type { Server } from 'http';
import { config } from './config/index.js';
import { initDb } from './db/index.js';
import apiRoutes from './routes/index.js';
import artifactsRouter from './routes/artifacts.js';
import { requestLogger, corsHeaders } from './middleware/request.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { recoverWorkers } from './workers/orchestrator.js';

const app = express();

app.use(corsHeaders);
app.use(requestLogger);
// Base64 image payloads for the I2V endpoints (`data:image/...;base64,...`) ride in
// the JSON body, so the default 100kb limit is far too small.
app.use(express.json({ limit: '25mb' }));

app.use('/api', apiRoutes);

// Stored artifacts are also served at the app root so the /artifact/<name> link
// returned by GET /api/jobs/:id/status works verbatim (as well as /api/artifact/<name>).
// Artifact URLs are public immutable media links and do not require authorization.
app.use('/artifact', artifactsRouter);

// Liveness probe only (status + timestamp, no sensitive data). Kept unauthenticated
// so orchestrators/healthchecks can verify the process is up without a token.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(notFoundHandler);
app.use(errorHandler);

let httpServer: Server | undefined;

async function start(): Promise<void> {
  try {
    // Fail fast in production without a signing secret — tokens would otherwise
    // be unusable (or, worse, default to a guessable one).
    if (!config.auth.jwtSecret) {
      throw new Error('JWT_SECRET is required when NODE_ENV=production');
    }

    await initDb();
    console.log('Database initialized');

    // Re-attach any video runs left non-terminal before a previous crash.
    try {
      await recoverWorkers();
      console.log('VGWorker recovery complete');
    } catch (error) {
      console.error('Failed to recover VGWorkers:', error);
    }

    httpServer = app.listen(config.port, () => {
      console.log(`Server running on port ${config.port} in ${config.nodeEnv} mode`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown handle (used by the test suite and embedders).
export async function stopServer(): Promise<void> {
  if (!httpServer) return;
  const server = httpServer;
  httpServer = undefined;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeAllConnections?.();
}

start();

export default app;