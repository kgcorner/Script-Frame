import { Component, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { HealthService } from './core/services/health.service';
import { AuthService } from './core/services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly router = inject(Router);
  readonly healthService = inject(HealthService);
  readonly authService = inject(AuthService);
  readonly isAuthRoute = signal(false);

  constructor() {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        const url = event.urlAfterRedirects || event.url;
        this.isAuthRoute.set(url.startsWith('/login') || url.startsWith('/register'));
      });
  }

  /** Clear the stored session; AuthService redirects to /login. */
  logout(): void {
    this.authService.logout();
  }
}
