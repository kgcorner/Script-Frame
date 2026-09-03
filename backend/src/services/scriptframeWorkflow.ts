import { db, schema, type NewScriptFrameWorkflowRecord } from '../db/index.js';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type {
  ScriptFrameWorkflow,
  ScriptFrameWorkflowCreateRequest,
  ScriptFrameWorkflowUpdateRequest,
  ScriptFrameTestConnectionRequest,
  ScriptFrameTestConnectionResponse,
} from '../types/index.js';
import { llmProviderService } from './llmProvider.js';
import { comfyuiService } from './comfyui.js';

export class ScriptFrameWorkflowService {
  async createWorkflow(input: ScriptFrameWorkflowCreateRequest): Promise<ScriptFrameWorkflow> {
    const id = uuidv4();
    const newWorkflow: NewScriptFrameWorkflowRecord = {
      id,
      name: input.name,
      description: input.description ?? null,
      nodes: input.nodes,
      links: input.links ?? [],
      nsfw: input.nsfw ?? false,
      maxClipLength: input.maxClipLength ?? null,
      maxTimeout: input.maxTimeout ?? null,
    };

    await db.insert(schema.scriptframeWorkflows).values(newWorkflow);
    const created = await this.getWorkflow(id);
    return created!;
  }

  async getWorkflow(id: string): Promise<ScriptFrameWorkflow | null> {
    const [workflow] = await db
      .select()
      .from(schema.scriptframeWorkflows)
      .where(eq(schema.scriptframeWorkflows.id, id));

    if (!workflow) return null;

    return {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description ?? undefined,
      nodes: (workflow.nodes as any) || [],
      links: (workflow.links as any) || [],
      nsfw: workflow.nsfw ?? false,
      maxClipLength: workflow.maxClipLength ?? undefined,
      maxTimeout: workflow.maxTimeout ?? undefined,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    };
  }

  async getWorkflows(filters?: { limit?: number; offset?: number }): Promise<ScriptFrameWorkflow[]> {
    const query = db.select().from(schema.scriptframeWorkflows);
    query.orderBy(desc(schema.scriptframeWorkflows.createdAt));

    if (filters?.limit) query.limit(filters.limit);
    if (filters?.offset) query.offset(filters.offset);

    const rows = await query;
    return rows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description ?? undefined,
      nodes: (workflow.nodes as any) || [],
      links: (workflow.links as any) || [],
      nsfw: workflow.nsfw ?? false,
      maxClipLength: workflow.maxClipLength ?? undefined,
      maxTimeout: workflow.maxTimeout ?? undefined,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    }));
  }

  async updateWorkflow(id: string, updates: ScriptFrameWorkflowUpdateRequest): Promise<ScriptFrameWorkflow | null> {
    const updateData: Partial<NewScriptFrameWorkflowRecord> = {
      updatedAt: new Date(),
    };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.nodes !== undefined) updateData.nodes = updates.nodes;
    if (updates.links !== undefined) updateData.links = updates.links;
    if (updates.nsfw !== undefined) updateData.nsfw = updates.nsfw;
    if (updates.maxClipLength !== undefined) updateData.maxClipLength = updates.maxClipLength;
    if (updates.maxTimeout !== undefined) updateData.maxTimeout = updates.maxTimeout;

    await db
      .update(schema.scriptframeWorkflows)
      .set(updateData)
      .where(eq(schema.scriptframeWorkflows.id, id));

    return this.getWorkflow(id);
  }

  async deleteWorkflow(id: string): Promise<void> {
    await db.delete(schema.scriptframeWorkflows).where(eq(schema.scriptframeWorkflows.id, id));
  }

  async testConnection(target: ScriptFrameTestConnectionRequest): Promise<ScriptFrameTestConnectionResponse> {
    const startTime = Date.now();

    if (target.type === 'llm') {
      try {
        if (!target.appId) {
          return {
            nodeId: target.nodeId,
            type: 'llm',
            status: 'unhealthy',
            message: 'No LLM App selected',
            latency: Date.now() - startTime,
          };
        }

        const app = await llmProviderService.getApp(target.appId);
        if (!app) {
          return {
            nodeId: target.nodeId,
            type: 'llm',
            status: 'unhealthy',
            message: 'Selected LLM App not found in database',
            latency: Date.now() - startTime,
          };
        }

        const provider = await llmProviderService.getProvider(app.providerId);
        if (provider) {
          const res = await llmProviderService.fetchModels({
            provider: provider.name as any,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey ?? undefined,
          });

          if (!res.success) {
            return {
              nodeId: target.nodeId,
              type: 'llm',
              status: 'unhealthy',
              message: `LLM Provider (${provider.displayName}) error: ${res.error || 'Connection failed'}`,
              latency: Date.now() - startTime,
            };
          }
        }

        return {
          nodeId: target.nodeId,
          type: 'llm',
          status: 'healthy',
          message: `Connected to LLM App: ${app.name} (${app.model})`,
          latency: Date.now() - startTime,
        };
      } catch (error) {
        return {
          nodeId: target.nodeId,
          type: 'llm',
          status: 'unhealthy',
          message: error instanceof Error ? error.message : 'LLM connection failed',
          latency: Date.now() - startTime,
        };
      }
    } else if (target.type === 'comfyui-stack' || target.type === 'comfyui-app') {
      try {
        const isHealthy = await comfyuiService.healthCheck();
        const latency = Date.now() - startTime;
        return {
          nodeId: target.nodeId,
          type: target.type,
          status: isHealthy ? 'healthy' : 'unhealthy',
          message: isHealthy ? 'ComfyUI service is online and healthy' : 'ComfyUI service unreachable',
          latency,
        };
      } catch (error) {
        return {
          nodeId: target.nodeId,
          type: target.type,
          status: 'unhealthy',
          message: error instanceof Error ? error.message : 'ComfyUI connection error',
          latency: Date.now() - startTime,
        };
      }
    }

    return {
      nodeId: target.nodeId,
      type: target.type,
      status: 'unhealthy',
      message: 'Unknown node type for connection test',
      latency: Date.now() - startTime,
    };
  }
}

export const scriptframeWorkflowService = new ScriptFrameWorkflowService();

