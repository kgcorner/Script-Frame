import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Angular 22 default (zoneless) change detection. State must be signal-based
    // so async mutations (HTTP responses, timers) explicitly notify the CD
    // scheduler and re-render — plain property writes do not.
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideHttpClient()
  ]
};
