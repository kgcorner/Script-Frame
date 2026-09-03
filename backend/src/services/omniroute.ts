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