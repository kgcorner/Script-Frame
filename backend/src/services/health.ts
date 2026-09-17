import { db, schema } from '../db/index.js';
import { eq, desc } from 'drizzle-orm';
import { config } from '../config/index.js';
import { omnirouteService } from './omniroute.js';
import { comfyuiService } from './comfyui.js';
import type { ServiceHealthCheck, NewServiceHealth, ServiceConnectionCheck, ServiceConnectionStatus } from '../types/index.js';

export class HealthService {
  async checkOmniroute(): Promise<ServiceHealthCheck> {
    const start = Date.now();
    try {
      const healthy = await omnirouteService.healthCheck();
      const latency = Date.now() - start;
      return {
        service: 'omniroute',
        status: healthy ? 'healthy' : 'unhealthy',
        latency,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        service: 'omniroute',
        status: 'unhealthy',
        latency: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      };
    }
  }

  async checkComfyUI(): Promise<ServiceHealthCheck> {
    const start = Date.now();
    try {
      const healthy = await comfyuiService.healthCheck();
      const latency = Date.now() - start;
      return {
        service: 'comfyui',
        status: healthy ? 'healthy' : 'unhealthy',
        latency,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        service: 'comfyui',
        status: 'unhealthy',
        latency: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      };
    }
  }

  async checkAll(): Promise<ServiceHealthCheck[]> {
    const [omniroute, comfyui] = await Promise.all([
      this.checkOmniroute(),
      this.checkComfyUI(),
    ]);
    return [omniroute, comfyui];
  }

  // Live connection check for GET /api/health/connection: probes the LLM service
  // (Omniroute) and ComfyUI in parallel. Pure read — nothing is recorded to the
  // service_health table, so it is safe to poll for UI status indicators.
  async checkConnections(): Promise<ServiceConnectionStatus> {
    const [llm, comfyui] = await Promise.all([
      this.checkLlmConnection(),
      this.checkComfyuiConnection(),
    ]);
    return {
      llm,
      comfyui,
      allConnected: llm.connected && comfyui.connected,
      checkedAt: new Date().toISOString(),
    };
  }

  private async checkLlmConnection(): Promise<ServiceConnectionCheck> {
    const start = Date.now();
    const result = await omnirouteService.connectionCheck();
    return {
      service: 'omniroute',
      label: 'LLM',
      endpoint: config.omniroute.baseUrl,
      connected: result.connected,
      status: result.healthy ? 'healthy' : 'unhealthy',
      latency: Date.now() - start,
      error: result.error ?? null,
    };
  }

  private async checkComfyuiConnection(): Promise<ServiceConnectionCheck> {
    const start = Date.now();
    const result = await comfyuiService.connectionCheck();
    return {
      service: 'comfyui',
      label: 'ComfyUI',
      endpoint: config.comfyui.baseUrl,
      connected: result.connected,
      status: result.healthy ? 'healthy' : 'unhealthy',
      latency: Date.now() - start,
      error: result.error ?? null,
      version: result.version ?? null,
    };
  }

  async recordHealthCheck(check: ServiceHealthCheck): Promise<void> {
    const record: NewServiceHealth = {
      service: check.service,
      status: check.status,
      latency: check.latency,
      error: check.error,
      checkedAt: new Date(check.timestamp),
    };
    await db.insert(schema.serviceHealth).values(record);
  }

  async getHealthHistory(service: 'omniroute' | 'comfyui', limit = 100): Promise<ServiceHealthCheck[]> {
    const records = await db
      .select()
      .from(schema.serviceHealth)
      .where(eq(schema.serviceHealth.service, service))
      .orderBy(desc(schema.serviceHealth.checkedAt))
      .limit(limit);
    
    return records.map(r => ({
      service: r.service,
      status: r.status,
      latency: r.latency ?? 0,
      error: r.error ?? undefined,
      timestamp: r.checkedAt instanceof Date ? r.checkedAt.getTime() : r.checkedAt,
    }));
  }

  async getLatestHealth(): Promise<Record<string, ServiceHealthCheck>> {
    const [omniroute] = await db
      .select()
      .from(schema.serviceHealth)
      .where(eq(schema.serviceHealth.service, 'omniroute'))
      .orderBy(desc(schema.serviceHealth.checkedAt))
      .limit(1);
    
    const [comfyui] = await db
      .select()
      .from(schema.serviceHealth)
      .where(eq(schema.serviceHealth.service, 'comfyui'))
      .orderBy(desc(schema.serviceHealth.checkedAt))
      .limit(1);

    return {
      omniroute: omniroute ? {
        service: 'omniroute',
        status: omniroute.status,
        latency: omniroute.latency ?? 0,
        error: omniroute.error ?? undefined,
        timestamp: omniroute.checkedAt instanceof Date ? omniroute.checkedAt.getTime() : omniroute.checkedAt,
      } : { service: 'omniroute', status: 'unhealthy', latency: 0, error: 'No health check recorded', timestamp: 0 },
      comfyui: comfyui ? {
        service: 'comfyui',
        status: comfyui.status,
        latency: comfyui.latency ?? 0,
        error: comfyui.error ?? undefined,
        timestamp: comfyui.checkedAt instanceof Date ? comfyui.checkedAt.getTime() : comfyui.checkedAt,
      } : { service: 'comfyui', status: 'unhealthy', latency: 0, error: 'No health check recorded', timestamp: 0 },
    };
  }
}

export const healthService = new HealthService();