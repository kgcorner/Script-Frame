import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);

  /** Base API URL (backend runs on port 3000, /api prefix). */
  get baseUrl(): string {
    return environment.apiUrl;
  }

  protected request<T>(path: string, method = 'GET', body?: unknown): Observable<T> {
    const cleanPath = path.startsWith('/api/') ? path.substring(4) : path;
    const pathWithLeadingSlash = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
    const url = `${this.baseUrl}${pathWithLeadingSlash}`;
    return this.http.request<T>(method as any, url, { body });
  }

  get<T>(path: string, options?: { responseType?: 'blob' }): Observable<T> {
    if (options?.responseType === 'blob') {
      // Angular's typed `get`/`request` don't expose the 'blob' responseType in this build; fall back to a raw request.
      return new Observable((subscriber) => {
        const req = this.http.request('GET', `${this.baseUrl}${path}`, { responseType: 'blob' } as any);
        req.subscribe({ next: (v: unknown) => subscriber.next(v as Blob), error: (e) => subscriber.error(e), complete: () => subscriber.complete() });
      }) as unknown as Observable<T>;
    }
    return this.request<T>(path);
  }

  post<T>(path: string, body?: unknown): Observable<T> {
    return this.request<T>(path, 'POST', body);
  }

  patch<T>(path: string, body?: unknown): Observable<T> {
    return this.request<T>(path, 'PATCH', body);
  }

  delete<T>(path: string): Observable<T> {
    return this.request<T>(path, 'DELETE');
  }
}
