import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { llmProviderService } from '../services/llmProvider.js';
import type { LLMProviderName, FetchModelsRequest, LLMProviderCreateRequest, LLMProviderUpdateRequest, LLMAppCreateRequest, LLMAppUpdateRequest } from '../types/index.js';

const fetchModelsSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'gemini', 'opencode', 'omniroute', 'lmstudio', 'ollama']),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
});

const createProviderSchema = z.object({
  name: z.enum(['anthropic', 'openai', 'gemini', 'opencode', 'omniroute', 'lmstudio', 'ollama']),
  displayName: z.string().min(1, 'Display name is required'),
  baseUrl: z.string().url('Invalid URL'),
  apiKey: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const updateProviderSchema = z.object({
  displayName: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

const createAppSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  providerId: z.string().min(1, 'Provider is required'), // Provider name (e.g. 'anthropic') or saved provider UUID
  endpoint: z.string().url('Invalid endpoint URL').optional(), // Base URL of the LLM provider
  apiKey: z.string().optional(),
  model: z.string().min(1, 'Model is required'),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(1).optional(),
  systemPrompt: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const updateAppSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  endpoint: z.string().url('Invalid URL').optional(),
  apiKey: z.string().optional(),
  model: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(1).optional(),
  systemPrompt: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

function getIdParam(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

export class LLMProviderController {
  async fetchModels(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = fetchModelsSchema.parse(req.body);
      const result = await llmProviderService.fetchModels(input);
      res.json(result);
    } catch (error) { next(error); }
  }

  async getProviderConfigs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const configs = llmProviderService.getAllProviderConfigs();
      res.json({ success: true, data: configs });
    } catch (error) { next(error); }
  }

  async createProvider(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createProviderSchema.parse(req.body);
      const provider = await llmProviderService.createProvider(input);
      res.status(201).json({ success: true, data: provider });
    } catch (error) { next(error); }
  }

  async getProvider(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const provider = await llmProviderService.getProvider(id);
      if (!provider) { res.status(404).json({ success: false, error: 'LLM Provider not found' }); return; }
      res.json({ success: true, data: provider });
    } catch (error) { next(error); }
  }

  async getProviders(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { isActive, name, limit, offset } = req.query;
      const providers = await llmProviderService.getProviders({
        isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
        name: name as LLMProviderName,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });
      res.json({ success: true, data: providers });
    } catch (error) { next(error); }
  }

  async updateProvider(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const updates = updateProviderSchema.parse(req.body);
      const provider = await llmProviderService.updateProvider(id, updates);
      if (!provider) { res.status(404).json({ success: false, error: 'LLM Provider not found' }); return; }
      res.json({ success: true, data: provider });
    } catch (error) { next(error); }
  }

  async deleteProvider(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      await llmProviderService.deleteProvider(id);
      res.json({ success: true, message: 'LLM Provider deleted' });
    } catch (error) { next(error); }
  }

  // LLM App endpoints
  async createApp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createAppSchema.parse(req.body);
      const app = await llmProviderService.createApp(input);
      res.status(201).json({ success: true, data: app });
    } catch (error) { next(error); }
  }

  async getApp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const app = await llmProviderService.getApp(id);
      if (!app) { res.status(404).json({ success: false, error: 'LLM App not found' }); return; }
      res.json({ success: true, data: app });
    } catch (error) { next(error); }
  }

  async getApps(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { isActive, providerId, limit, offset } = req.query;
      const apps = await llmProviderService.getApps({
        isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
        providerId: providerId as string,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });
      res.json({ success: true, data: apps });
    } catch (error) { next(error); }
  }

  async updateApp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const updates = updateAppSchema.parse(req.body);
      const app = await llmProviderService.updateApp(id, updates);
      if (!app) { res.status(404).json({ success: false, error: 'LLM App not found' }); return; }
      res.json({ success: true, data: app });
    } catch (error) { next(error); }
  }

  async deleteApp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      await llmProviderService.deleteApp(id);
      res.json({ success: true, message: 'LLM App deleted' });
    } catch (error) { next(error); }
  }
}

export const llmProviderController = new LLMProviderController();
