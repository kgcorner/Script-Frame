import { Router } from 'express';
import jobsRouter from './jobs.js';
import workflowsRouter from './workflows.js';
import healthRouter from './health.js';
import servicesRouter from './services.js';
import comfyuiAppsRouter from './comfyuiApps.js';
import comfyuiStacksRouter from './comfyuiStacks.js';
import llmProvidersRouter from './llmProviders.js';
import scriptframeWorkflowsRouter from './scriptframeWorkflows.js';
import videoRunsRouter from './videoRuns.js';

const router = Router();

router.use('/jobs', jobsRouter);
router.use('/workflows', workflowsRouter);
router.use('/health', healthRouter);
router.use('/services', servicesRouter);
router.use('/comfyui-apps', comfyuiAppsRouter);
router.use('/comfyui-stacks', comfyuiStacksRouter);
router.use('/llm-providers', llmProvidersRouter);
router.use('/scriptframe-workflows', scriptframeWorkflowsRouter);
router.use('/video-runs', videoRunsRouter);

router.get('/', (_req, res) => {
  res.json({
    name: 'Video Generator API',
    version: '1.0.0',
    endpoints: {
      jobs: '/api/jobs',
      workflows: '/api/workflows',
      health: '/api/health',
      services: '/api/services',
      comfyuiApps: '/api/comfyui-apps',
      comfyuiStacks: '/api/comfyui-stacks',
      llmProviders: '/api/llm-providers',
      scriptframeWorkflows: '/api/scriptframe-workflows',
    },
  });
});

export default router;