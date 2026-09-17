import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { ApiClient } from '../api/client.service';

export interface User {
  id: string;
  email: string;
  username: string;
  role: string;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RegisterPayload {
  email: string;
  username: string;
  password: string;
}

export interface RegisterResponse {
  success?: boolean;
  message?: string;
  error?: string;
  data?: unknown;
}

export interface LoginPayload {
  identifier: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  data: {
    user: User;
    token: string;
  };
  message?: string;
  error?: string;
}

const TOKEN_KEY = 'scriptframe_auth_token';
const USER_KEY = 'scriptframe_auth_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);

  readonly currentUser = signal<User | null>(this.getStoredUser());

  /** POST /api/auth/login */
  login(payload: LoginPayload): Observable<LoginResponse> {
    return this.api.post<LoginResponse>('/api/auth/login', payload).pipe(
      tap((res) => {
        if (res?.success && res.data?.token) {
          this.saveAuthSession(res.data.token, res.data.user);
        }
      })
    );
  }

  /** POST /api/auth/register */
  register(payload: RegisterPayload): Observable<RegisterResponse> {
    return this.api.post<RegisterResponse>('/api/auth/register', payload);
  }

  /** Save JWT token & user info into localStorage */
  saveAuthSession(token: string, user: User): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      this.currentUser.set(user);
    } catch (e) {
      console.error('Error writing token to storage:', e);
    }
  }

  getToken(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  private getStoredUser(): User | null {
    try {
      const data = localStorage.getItem(USER_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  /** Check if JWT token is expired */
  isTokenExpired(token: string): boolean {
    if (!token) return true;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return true;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (!payload || !payload.exp) return false;
      const expiryMs = payload.exp * 1000;
      return Date.now() >= expiryMs;
    } catch {
      return true;
    }
  }

  /** Returns true if token exists and is not expired */
  isAuthenticated(): boolean {
    const token = this.getToken();
    if (!token) return false;
    return !this.isTokenExpired(token);
  }

  /** Logout user, clear storage and redirect to /login */
  logout(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      // ignore
    }
    this.currentUser.set(null);
    this.router.navigate(['/login']);
  }
}
