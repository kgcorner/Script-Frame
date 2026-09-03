import { db, schema } from '../db/index.js';
import { eq, desc, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type { Workflow, NewWorkflow } from '../types/index.js';

export class WorkflowService {
  async createWorkflow(workflow: Omit<NewWorkflow, 'id' | 'createdAt' | 'updatedAt'>): Promise<Workflow> {
    const workflowId = uuidv4();
    const newWorkflow: NewWorkflow = {
      ...workflow,
      id: workflowId,
    };
    await db.insert(schema.workflows).values(newWorkflow);
    const [created] = await db.select().from(schema.workflows).where(eq(schema.workflows.id, workflowId));
    return created!;
  }

  async getWorkflow(workflowId: string): Promise<Workflow | null> {
    const [workflow] = await db.select().from(schema.workflows).where(eq(schema.workflows.id, workflowId));
    return workflow ?? null;
  }

  async getWorkflows(filters?: { isActive?: boolean; limit?: number; offset?: number }): Promise<Workflow[]> {
    const conditions = [];
    if (filters?.isActive !== undefined) {
      conditions.push(eq(schema.workflows.isActive, filters.isActive));
    }

    const query = db.select().from(schema.workflows);
    if (conditions.length > 0) {
      query.where(and(...conditions));
    }
    query.orderBy(desc(schema.workflows.createdAt));
    if (filters?.limit) {
      query.limit(filters.limit);
    }
    if (filters?.offset) {
      query.offset(filters.offset);
    }

    return query;
  }

  async updateWorkflow(workflowId: string, updates: Partial<NewWorkflow>): Promise<Workflow | null> {
    await db.update(schema.workflows).set({ ...updates, updatedAt: new Date() }).where(eq(schema.workflows.id, workflowId));
    return this.getWorkflow(workflowId);
  }

  async deleteWorkflow(workflowId: string): Promise<void> {
    await db.delete(schema.workflows).where(eq(schema.workflows.id, workflowId));
  }

  async activateWorkflow(workflowId: string): Promise<Workflow | null> {
    return this.updateWorkflow(workflowId, { isActive: true });
  }

  async deactivateWorkflow(workflowId: string): Promise<Workflow | null> {
    return this.updateWorkflow(workflowId, { isActive: false });
  }
}

export const workflowService = new WorkflowService();