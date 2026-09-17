import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const token = authService.getToken();

  // Exclude login and register routes from adding Authorization header
  const isAuthEndpoint = req.url.includes('/auth/login') || req.url.includes('/auth/register');

  let authReq = req;

  if (token && !isAuthEndpoint) {
    // Check if token is expired before sending request
    if (authService.isTokenExpired(token)) {
      authService.logout();
      return throwError(() => new Error('Session expired. Please sign in again.'));
    }

    authReq = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      // If server responds with 401 Unauthorized on protected routes, redirect to login
      if (error.status === 401 && !isAuthEndpoint) {
        authService.logout();
      }
      return throwError(() => error);
    })
  );
};
