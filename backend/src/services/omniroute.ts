import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../config/index.js';
import type { OmnirouteGenerateRequest, OmnirouteGenerateResponse, OmnirouteStatusResponse } from '../types/index.js';

export class OmnirouteService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.omniroute.baseUrl,
      timeout: config.omniroute.timeout,
      headers: {
        'Content-Type': 'application/json',
        ...(config.omniroute.apiKey && { Authorization: `Bearer ${config.omniroute.apiKey}` }),
      },
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        console.error(`Omniroute API Error: ${error.message}`);
        throw error;
      }
    );
  }

  async generate(request: OmnirouteGenerateRequest): Promise<OmnirouteGenerateResponse> {
    const response = await this.client.post<OmnirouteGenerateResponse>('/generate', request);
    return response.data;
  }

  async getStatus(jobId: string): Promise<OmnirouteStatusResponse> {
    const response = await this.client.get<OmnirouteStatusResponse>(`/status/${jobId}`);
    return response.data;
  }

  async cancel(jobId: string): Promise<void> {
    await this.client.post(`/cancel/${jobId}`);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get('/health', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  // Reachability probe for GET /api/health/connection: distinguishes "server
  // unreachable" (no HTTP response at all) from "reachable but the health path
  // is not OK" — many LLM routers (OpenAI-compatible endpoints) have no
  // /health route, yet are perfectly usable.
  async connectionCheck(): Promise<{ connected: boolean; healthy: boolean; error?: string }> {
    try {
      await this.client.get('/health', { timeout: 5000 });
      return { connected: true, healthy: true };
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        return {
          connected: true,
          healthy: false,
          error: `Probe /health returned HTTP ${axiosError.response.status} (service reachable)`,
        };
      }
      const reason = axiosError.code ? `${axiosError.message} (${axiosError.code})` : axiosError.message;
      return { connected: false, healthy: false, error: reason || 'Unknown error' };
    }
  }

  async getModels(): Promise<string[]> {
    try {
      const response = await this.client.get<string[]>('/models');
      return response.data;
    } catch {
      return [];
    }
  }
}

export const omnirouteService = new OmnirouteService();