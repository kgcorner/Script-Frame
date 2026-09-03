import { db, schema } from '../db/index.js';
import { eq, desc, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type { ComfyUIApp, NewComfyUIApp } from '../types/index.js';
import type { ComfyUIAppCreateRequest, ComfyUIAppUpdateRequest, ComfyUIAppExecuteRequest, ComfyUIAppPrimaryField, ComfyUIWorkflow } from '../types/index.js';
import type { ComfyUIStack, ComfyUIStackCreateRequest, ComfyUIStackUpdateRequest } from '../types/index.js';
import type { NewComfyUIStack } from '../db/index.js';
import { workflowService } from './workflow.js';

export class ComfyUIAppService {
  async createApp(input: ComfyUIAppCreateRequest): Promise<ComfyUIApp> {
    let definition = input.workflowDefinition;

    // The workflow-input route can create an app from a ComfyUI workflow that may
    // not be persisted as a `workflows` row. Resolve the definition from the
    // explicit definition when provided, otherwise fall back to the `workflows` table.
    if (!definition && input.workflowId) {
      const workflow = await workflowService.getWorkflow(input.workflowId);
      if (workflow) {
        definition = workflow.definition as Record<string, unknown>;
      }
    }
    if (!definition) {
      throw new Error('Workflow not found: provide a valid workflowId or workflowDefinition');
    }

    const appId = uuidv4();
    const newApp: NewComfyUIApp = {
      id: appId,
      name: input.name,
      description: input.description,
      workflowId: input.workflowId,
      definition,
      primaryFields: input.primaryFields,
      defaultValues: input.defaultValues || {},
      isActive: true,
    };

    await db.insert(schema.comfyuiApps).values(newApp);
    const [created] = await db.select().from(schema.comfyuiApps).where(eq(schema.comfyuiApps.id, appId));
    return created!;
  }

  async getApp(appId: string): Promise<ComfyUIApp | null> {
    const [app] = await db.select().from(schema.comfyuiApps).where(eq(schema.comfyuiApps.id, appId));
    return app ?? null;
  }

  async getApps(filters?: { isActive?: boolean; workflowId?: string; limit?: number; offset?: number }): Promise<ComfyUIApp[]> {
    const conditions = [];
    if (filters?.isActive !== undefined) {
      conditions.push(eq(schema.comfyuiApps.isActive, filters.isActive));
    }
    if (filters?.workflowId) {
      conditions.push(eq(schema.comfyuiApps.workflowId, filters.workflowId));
    }

    const query = db.select().from(schema.comfyuiApps);
    if (conditions.length > 0) {
      query.where(and(...conditions));
    }
    query.orderBy(desc(schema.comfyuiApps.createdAt));
    if (filters?.limit) {
      query.limit(filters.limit);
    }
    if (filters?.offset) {
      query.offset(filters.offset);
    }

    return query;
  }

  async updateApp(appId: string, updates: ComfyUIAppUpdateRequest): Promise<ComfyUIApp | null> {
    const updateData: Partial<NewComfyUIApp> = { updatedAt: new Date() };
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.primaryFields !== undefined) updateData.primaryFields = updates.primaryFields;
    if (updates.defaultValues !== undefined) updateData.defaultValues = updates.defaultValues;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    await db.update(schema.comfyuiApps).set(updateData).where(eq(schema.comfyuiApps.id, appId));
    return this.getApp(appId);
  }

  async deleteApp(appId: string): Promise<void> {
    await db.delete(schema.comfyuiApps).where(eq(schema.comfyuiApps.id, appId));
  }

  // ---------------------------------------------------------------
  // ComfyUI Stack management (a named collection of ComfyUI apps)
  // ---------------------------------------------------------------

  async createStack(input: ComfyUIStackCreateRequest): Promise<ComfyUIStack> {
    const stackId = uuidv4();
    await db.insert(schema.comfyuiStacks).values({
      id: stackId,
      name: input.name,
      description: input.description,
      baseUrl: input.baseUrl,
      port: input.port,
      isActive: true,
    });

    const appIds = input.appIds ?? [];
    for (let i = 0; i < appIds.length; i++) {
      const app = await this.getApp(appIds[i]);
      if (!app) continue;
      await db.insert(schema.comfyuiStackApps).values({
        stackId,
        appId: appIds[i],
        order: i,
      });
    }

    const stack = await this.getStack(stackId);
    if (!stack) throw new Error('Failed to create ComfyUI stack');
    return stack;
  }

  async getStack(stackId: string): Promise<ComfyUIStack | null> {
    const [stack] = await db.select().from(schema.comfyuiStacks).where(eq(schema.comfyuiStacks.id, stackId));
    if (!stack) return null;

    const appRows = await db
      .select({ appId: schema.comfyuiStackApps.appId })
      .from(schema.comfyuiStackApps)
      .where(eq(schema.comfyuiStackApps.stackId, stackId))
      .orderBy(schema.comfyuiStackApps.order);

    return {
      id: stack.id,
      name: stack.name,
      description: stack.description,
      baseUrl: stack.baseUrl,
      port: stack.port,
      isActive: stack.isActive,
      appIds: appRows.map((r) => r.appId),
      createdAt: stack.createdAt,
      updatedAt: stack.updatedAt,
    };
  }

  async getStacks(filters?: { isActive?: boolean; limit?: number; offset?: number }): Promise<ComfyUIStack[]> {
    const conditions = [];
    if (filters?.isActive !== undefined) {
      conditions.push(eq(schema.comfyuiStacks.isActive, filters.isActive));
    }

    const query = db.select().from(schema.comfyuiStacks);
    if (conditions.length > 0) {
      query.where(and(...conditions));
    }
    query.orderBy(desc(schema.comfyuiStacks.createdAt));
    if (filters?.limit) {
      query.limit(filters.limit);
    }
    if (filters?.offset) {
      query.offset(filters.offset);
    }

    const rows = await query;
    const stacks: ComfyUIStack[] = [];
    for (const row of rows) {
      const stack = await this.getStack(row.id);
      if (stack) stacks.push(stack);
    }
    return stacks;
  }

  async updateStack(stackId: string, updates: ComfyUIStackUpdateRequest): Promise<ComfyUIStack | null> {
    const stack = await this.getStack(stackId);
    if (!stack) return null;

    const updateData: Partial<NewComfyUIStack> = { updatedAt: new Date() };
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.baseUrl !== undefined) updateData.baseUrl = updates.baseUrl;
    if (updates.port !== undefined) updateData.port = updates.port;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    await db.update(schema.comfyuiStacks).set(updateData).where(eq(schema.comfyuiStacks.id, stackId));

    if (updates.appIds !== undefined) {
      await db.delete(schema.comfyuiStackApps).where(eq(schema.comfyuiStackApps.stackId, stackId));
      const appIds = updates.appIds;
      for (let i = 0; i < appIds.length; i++) {
        const existing = await this.getApp(appIds[i]);
        if (!existing) continue;
        await db.insert(schema.comfyuiStackApps).values({
          stackId,
          appId: appIds[i],
          order: i,
        });
      }
    }

    return this.getStack(stackId);
  }

  async deleteStack(stackId: string): Promise<void> {
    const stack = await this.getStack(stackId);
    if (!stack) return;
    await db.delete(schema.comfyuiStackApps).where(eq(schema.comfyuiStackApps.stackId, stackId));
    await db.delete(schema.comfyuiStacks).where(eq(schema.comfyuiStacks.id, stackId));
  }

  /** Health check for a stack. If the stack targets a specific instance, we
   * still report the global ComfyUI health — stacks reuse the configured
   * ComfyUI service unless a per-stack base URL + port is set. */
  async stackHealthCheck(stackId: string): Promise<{ healthy: boolean; message: string; latency: number }> {
    const startTime = Date.now();
    const stack = await this.getStack(stackId);
    if (!stack) {
      return { healthy: false, message: 'ComfyUI stack not found', latency: Date.now() - startTime };
    }
    if (stack.appIds.length === 0) {
      return { healthy: false, message: 'ComfyUI stack has no apps configured', latency: Date.now() - startTime };
    }

    try {
      const { comfyuiService } = await import('./comfyui.js');
      const isHealthy = await comfyuiService.healthCheck();
      return {
        healthy: isHealthy,
        message: isHealthy ? `ComfyUI stack "${stack.name}" is reachable (${stack.appIds.length} app(s))` : 'ComfyUI service unreachable',
        latency: Date.now() - startTime,
      };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'ComfyUI stack health check failed',
        latency: Date.now() - startTime,
      };
    }
  }

  async executeApp(appId: string, executeInput: ComfyUIAppExecuteRequest): Promise<{ workflow: ComfyUIWorkflow; promptId: string }> {
    const app = await this.getApp(appId);
    if (!app) {
      throw new Error('ComfyUI App not found');
    }
    if (!app.isActive) {
      throw new Error('ComfyUI App is not active');
    }

    const workflow = await workflowService.getWorkflow(app.workflowId).catch(() => null);
    const workflowDef = (app.definition as ComfyUIWorkflow | null)
      ?? workflow?.definition as ComfyUIWorkflow | undefined
      ?? null;

    if (!workflowDef || typeof workflowDef !== 'object') {
      throw new Error('Associated workflow definition not found');
    }

    const mergedWorkflow = this.mergeWorkflowInputs(workflowDef, app.primaryFields as ComfyUIAppPrimaryField[], app.defaultValues as Record<string, unknown>, executeInput.primaryValues);

    const { comfyuiService } = await import('./comfyui.js');
    const response = await comfyuiService.queuePrompt(mergedWorkflow);

    return {
      workflow: mergedWorkflow,
      promptId: response.prompt_id,
    };
  }

  async getAppWorkflowInputs(appId: string): Promise<{ primaryFields: ComfyUIAppPrimaryField[]; allInputs: Record<string, { nodeId: string; inputName: string; defaultValue: unknown; isPrimary: boolean }> }> {
    const app = await this.getApp(appId);
    if (!app) {
      throw new Error('ComfyUI App not found');
    }

    const workflow = await workflowService.getWorkflow(app.workflowId).catch(() => null);
    const workflowDef = (app.definition as ComfyUIWorkflow | null)
      ?? workflow?.definition as ComfyUIWorkflow | undefined
      ?? null;

    if (!workflowDef || typeof workflowDef !== 'object') {
      throw new Error('Associated workflow definition not found');
    }

    const primaryFields = app.primaryFields as ComfyUIAppPrimaryField[];
    
    const allInputs: Record<string, { nodeId: string; inputName: string; defaultValue: unknown; isPrimary: boolean }> = {};
    
    for (const [nodeId, node] of Object.entries(workflowDef)) {
      for (const [inputName, defaultValue] of Object.entries(node.inputs || {})) {
        const key = `${nodeId}:${inputName}`;
        const isPrimary = primaryFields.some(pf => pf.nodeId === nodeId && pf.inputName === inputName);
        allInputs[key] = {
          nodeId,
          inputName,
          defaultValue,
          isPrimary,
        };
      }
    }

    return { primaryFields, allInputs };
  }

  /**
   * Build the executable ComfyUI workflow for an app with default values and the
   * given primary values merged in (keys: "nodeId:inputName"), WITHOUT queueing it.
   * Used by the VGWorker so continuation clips can inject an uploaded start-frame
   * image before submission.
   */
  async buildMergedWorkflow(appId: string, primaryValues: Record<string, unknown>): Promise<{ app: ComfyUIApp; workflow: ComfyUIWorkflow }> {
    const app = await this.getApp(appId);
    if (!app) throw new Error(`ComfyUI App not found: ${appId}`);
    const workflow = await workflowService.getWorkflow(app.workflowId).catch(() => null);
    const workflowDef = (app.definition as ComfyUIWorkflow | null)
      ?? workflow?.definition as ComfyUIWorkflow | undefined
      ?? null;
    if (!workflowDef || typeof workflowDef !== 'object') {
      throw new Error(`ComfyUI App ${appId} has no workflow definition`);
    }
    const merged = this.mergeWorkflowInputs(
      workflowDef,
      app.primaryFields as ComfyUIAppPrimaryField[],
      app.defaultValues as Record<string, unknown>,
      primaryValues,
    );
    return { app, workflow: merged };
  }

  private mergeWorkflowInputs(
    workflowDef: ComfyUIWorkflow,
    primaryFields: ComfyUIAppPrimaryField[],
    appDefaultValues: Record<string, unknown>,
    userPrimaryValues: Record<string, unknown>
  ): ComfyUIWorkflow {
    const merged = JSON.parse(JSON.stringify(workflowDef)) as ComfyUIWorkflow;

    const primaryFieldMap = new Map<string, ComfyUIAppPrimaryField>();
    for (const pf of primaryFields) {
      primaryFieldMap.set(`${pf.nodeId}:${pf.inputName}`, pf);
    }

    for (const [nodeId, node] of Object.entries(merged)) {
      if (!node.inputs) continue;

      for (const [inputName, currentValue] of Object.entries(node.inputs)) {
        const key = `${nodeId}:${inputName}`;
        const primaryField = primaryFieldMap.get(key);

        let finalValue = currentValue;

        if (appDefaultValues[key] !== undefined) {
          finalValue = appDefaultValues[key];
        }

        if (primaryField && userPrimaryValues[key] !== undefined) {
          finalValue = userPrimaryValues[key];
        }

        node.inputs[inputName] = finalValue;
      }
    }

    return merged;
  }

  validatePrimaryValues(primaryFields: ComfyUIAppPrimaryField[], primaryValues: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const pf of primaryFields) {
      const key = `${pf.nodeId}:${pf.inputName}`;
      const value = primaryValues[key];

      if (pf.required && (value === undefined || value === null || value === '')) {
        errors.push(`Required field '${pf.label}' (${key}) is missing`);
        continue;
      }

      if (value !== undefined && value !== null) {
        switch (pf.type) {
          case 'number':
            if (typeof value !== 'number' && isNaN(Number(value))) {
              errors.push(`Field '${pf.label}' must be a number`);
            } else if (pf.min !== undefined && Number(value) < pf.min) {
              errors.push(`Field '${pf.label}' must be at least ${pf.min}`);
            } else if (pf.max !== undefined && Number(value) > pf.max) {
              errors.push(`Field '${pf.label}' must be at most ${pf.max}`);
            }
            break;
          case 'boolean':
            if (typeof value !== 'boolean') {
              errors.push(`Field '${pf.label}' must be a boolean`);
            }
            break;
          case 'select':
            if (pf.options && !pf.options.includes(value as string)) {
              errors.push(`Field '${pf.label}' must be one of: ${pf.options.join(', ')}`);
            }
            break;
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

export const comfyuiAppService = new ComfyUIAppService();
