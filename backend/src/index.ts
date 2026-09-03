import express from 'express';
import { config } from './config/index.js';
import { initDb } from './db/index.js';
import apiRoutes from './routes/index.js';
import { requestLogger, corsHeaders } from './middleware/request.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { recoverWorkers } from './workers/orchestrator.js';

const app = express();

app.use(corsHeaders);
app.use(requestLogger);
app.use(express.json());

app.use('/api', apiRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(notFoundHandler);
app.use(errorHandler);

async function start(): Promise<void> {
  try {
    await initDb();
    console.log('Database initialized');

    // Re-attach any video runs left non-terminal before a previous crash.
    try {
      await recoverWorkers();
      console.log('VGWorker recovery complete');
    } catch (error) {
      console.error('Failed to recover VGWorkers:', error);
    }

    app.listen(config.port, () => {
      console.log(`Server running on port ${config.port} in ${config.nodeEnv} mode`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();

export default app;