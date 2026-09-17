import { Router } from 'express';
import jobsRouter from './jobs.js';
import workflowsRouter from './workflows.js';
import healthRouter, { publicHealthRouter } from './health.js';
import servicesRouter from './services.js';
import comfyuiAppsRouter from './comfyuiApps.js';
import comfyuiStacksRouter from './comfyuiStacks.js';
import llmProvidersRouter from './llmProviders.js';
import scriptframeWorkflowsRouter from './scriptframeWorkflows.js';
import videoRunsRouter from './videoRuns.js';
import generatorRouter from './generator.js';
import artifactsRouter from './artifacts.js';
import exportRouter from './export.js';
import authRouter from './auth.js';
import usersRouter from './users.js';
import projectsRouter from './project.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Public token endpoints (register/login). Must be mounted BEFORE the global
// authenticate gate so unauthenticated clients can obtain a token.
router.use('/auth', authRouter);

// Stored artifacts are immutable media and are intentionally public so the media
// URLs returned in job status responses can be used directly by browsers/media players.
router.use('/artifact', artifactsRouter);

// Service-reachability probe (GET /api/health/connection). Intentionally public so
// the client can render its connection indicator before/without a session. Must be
// mounted BEFORE the global authenticate gate; the remaining /api/health/* endpoints
// stay token-protected (see routes/health.ts).
router.use('/health', publicHealthRouter);

// Global authentication gate: every endpoint below requires a valid
// `Authorization: Bearer <token>` header (JWT issued by /api/auth/login|register).
router.use(authenticate);

router.use('/users', usersRouter);
router.use('/projects', projectsRouter);
router.use('/jobs', jobsRouter);
router.use('/workflows', workflowsRouter);
router.use('/health', healthRouter);
router.use('/services', servicesRouter);
router.use('/comfyui-apps', comfyuiAppsRouter);
router.use('/comfyui-stacks', comfyuiStacksRouter);
router.use('/llm-providers', llmProvidersRouter);
router.use('/scriptframe-workflows', scriptframeWorkflowsRouter);
router.use('/video-runs', videoRunsRouter);

// Generator endpoints are mounted at the API root: /api/generate-* and /api/generator-config.
router.use('/', generatorRouter);

// Video export: stitch stored video artifacts into one final video.
router.use('/export', exportRouter);

router.get('/', (_req, res) => {
  res.json({
    name: 'Video Generator API',
    version: '1.0.0',
    endpoints: {
      authRegister: '/api/auth/register',
      authLogin: '/api/auth/login',
      authMe: '/api/auth/me',
      users: '/api/users',
      projects: '/api/projects',
      jobs: '/api/jobs',
      workflows: '/api/workflows',
      health: '/api/health',
      healthConnection: '/api/health/connection',
      services: '/api/services',
      comfyuiApps: '/api/comfyui-apps',
      comfyuiStacks: '/api/comfyui-stacks',
      llmProviders: '/api/llm-providers',
      scriptframeWorkflows: '/api/scriptframe-workflows',
      generateI2V: '/api/generate-i2v',
      generateT2V: '/api/generate-t2v',
      generateT2I: '/api/generate-t2i',
      generatorConfig: '/api/generator-config',
      artifact: '/api/artifact/:name',
      exportVideo: '/api/export/video',
    },
  });
});

export default router;