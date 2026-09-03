import { Injectable } from '@angular/core';
import {
  HttpClient,
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, retry } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface ApiError {
  message: string;
  code?: string;
  status: number;
  details?: unknown;
}

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private baseUrl = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  get<T>(endpoint: string, options?: { params?: Record<string, string | number | boolean> }): Observable<T> {
    return this.http.get<T>(`${this.baseUrl}${endpoint}`, options).pipe(
      retry(1),
      catchError(this.handleError)
    );
  }

  post<T>(endpoint: string, body: unknown, options?: { params?: Record<string, string | number | boolean> }): Observable<T> {
    return this.http.post<T>(`${this.baseUrl}${endpoint}`, body, options).pipe(
      catchError(this.handleError)
    );
  }

  /** POST without the retry wrapper, so validation/4xx errors reach the caller immediately. */
  postNoRetry<T>(endpoint: string, body: unknown, options?: { params?: Record<string, string | number | boolean> }): Observable<T> {
    return this.http.post<T>(`${this.baseUrl}${endpoint}`, body, options).pipe(
      catchError(this.handleError)
    );
  }

  patch<T>(endpoint: string, body: unknown, options?: { params?: Record<string, string | number | boolean> }): Observable<T> {
    return this.http.patch<T>(`${this.baseUrl}${endpoint}`, body, options).pipe(
      catchError(this.handleError)
    );
  }

  delete<T>(endpoint: string, options?: { params?: Record<string, string | number | boolean> }): Observable<T> {
    return this.http.delete<T>(`${this.baseUrl}${endpoint}`, options).pipe(
      catchError(this.handleError)
    );
  }

  private handleError = (error: HttpErrorResponse): Observable<never> => {
    let apiError: ApiError;

    if (error.error instanceof ErrorEvent) {
      // Client-side error
      apiError = {
        message: `Client error: ${error.error.message}`,
        code: 'CLIENT_ERROR',
        status: 0,
      };
    } else {
      // Server-side error
      apiError = {
        message: error.error?.error || error.message || 'Unknown server error',
        code: error.error?.code || 'SERVER_ERROR',
        status: error.status,
        details: error.error?.details,
      };
    }

    console.error('API Error:', apiError);
    return throwError(() => apiError);
  };
}

// HTTP Interceptor for adding headers, auth, etc.
export const apiInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> => {
  // Clone request to add headers
  const apiReq = req.clone({
    setHeaders: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    withCredentials: false,
  });

  return next(apiReq);
};