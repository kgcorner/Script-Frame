import { Router } from 'express';
import { llmProviderController } from '../controllers/llmProvider.js';

const router = Router();

// Provider config endpoint (for dropdown)
router.get('/configs', llmProviderController.getProviderConfigs.bind(llmProviderController));

// Fetch models from provider
router.post('/fetch-models', llmProviderController.fetchModels.bind(llmProviderController));

// Provider CRUD
router.post('/', llmProviderController.createProvider.bind(llmProviderController));
router.get('/', llmProviderController.getProviders.bind(llmProviderController));

// LLM App CRUD (must come before /:id to avoid route conflicts)
router.post('/apps', llmProviderController.createApp.bind(llmProviderController));
router.get('/apps', llmProviderController.getApps.bind(llmProviderController));
router.get('/apps/:id', llmProviderController.getApp.bind(llmProviderController));
router.patch('/apps/:id', llmProviderController.updateApp.bind(llmProviderController));
router.delete('/apps/:id', llmProviderController.deleteApp.bind(llmProviderController));

// Provider detail routes (after /apps to avoid conflicts)
router.get('/:id', llmProviderController.getProvider.bind(llmProviderController));
router.patch('/:id', llmProviderController.updateProvider.bind(llmProviderController));
router.delete('/:id', llmProviderController.deleteProvider.bind(llmProviderController));

export default router;