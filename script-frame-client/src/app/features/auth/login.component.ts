import { Component, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './auth.scss'
})
export class LoginComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  identifier = signal('');
  password = signal('');
  showPassword = signal(false);
  isLoading = signal(false);
  errorMessage = signal('');
  returnUrl = '/generate';

  ngOnInit(): void {
    this.returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/generate';
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((v) => !v);
  }

  onSubmit(): void {
    this.errorMessage.set('');
    if (!this.identifier().trim()) {
      this.errorMessage.set('Please enter your username or email.');
      return;
    }
    if (!this.password()) {
      this.errorMessage.set('Please enter your password.');
      return;
    }

    this.isLoading.set(true);

    const payload = {
      identifier: this.identifier().trim(),
      password: this.password()
    };

    this.authService.login(payload).subscribe({
      next: (response) => {
        this.isLoading.set(false);
        if (response.success && response.data?.token) {
          this.router.navigateByUrl(this.returnUrl);
        } else {
          this.errorMessage.set(response.message || 'Login failed. Please check your credentials.');
        }
      },
      error: (err) => {
        this.isLoading.set(false);
        const msg =
          err.error?.message ||
          err.error?.error ||
          err.message ||
          'Invalid username/email or password.';
        this.errorMessage.set(msg);
      }
    });
  }
}
