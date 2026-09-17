import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import { ApiClient } from '../api/client.service';
import { catchError, of } from 'rxjs';

export interface ComfyUiHealth {
  service: string;
  label: string;
  endpoint: string;
  connected: boolean;
  status: string;
  latency?: number;
  error?: string | null;
  version?: string;
}

export interface HealthConnectionResponse {
  success: boolean;
  data: {
    llm?: unknown;
    comfyui?: ComfyUiHealth;
    allConnected?: boolean;
    checkedAt?: string;
  };
}

@Injectable({ providedIn: 'root' })
export class HealthService implements OnDestroy {
  private readonly api = inject(ApiClient);

  readonly comfyUiStatus = signal<ComfyUiHealth | null>(null);
  readonly isHealthy = signal<boolean>(false);
  readonly isLoading = signal<boolean>(true);
  readonly statusText = signal<string>('Engine Checking...');

  private pollIntervalId: any = null;

  constructor() {
    this.checkHealth();
    // Poll connection health every 15 seconds
    this.pollIntervalId = setInterval(() => this.checkHealth(), 15000);
  }

  checkHealth(): void {
    this.api
      .get<HealthConnectionResponse>('/api/health/connection')
      .pipe(
        catchError((err) => {
          return of({
            success: false,
            data: {
              comfyui: {
                service: 'comfyui',
                label: 'ComfyUI',
                endpoint: '',
                connected: false,
                status: 'unhealthy',
                error: err.message || 'Health check failed'
              }
            }
          } as HealthConnectionResponse);
        })
      )
      .subscribe((res) => {
        this.isLoading.set(false);
        const comfy = res?.data?.comfyui;
        if (comfy) {
          this.comfyUiStatus.set(comfy);
          const healthy = comfy.connected === true && comfy.status === 'healthy';
          this.isHealthy.set(healthy);

          if (healthy) {
            const versionStr = comfy.version ? `v${comfy.version} ` : '';
            this.statusText.set(`Engine ${versionStr}Ready`);
          } else {
            this.statusText.set('Engine Offline');
          }
        } else {
          this.isHealthy.set(false);
          this.comfyUiStatus.set(null);
          this.statusText.set('Engine Offline');
        }
      });
  }

  ngOnDestroy(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
    }
  }
}
