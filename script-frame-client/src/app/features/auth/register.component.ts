import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './auth.scss'
})
export class RegisterComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  email = signal('');
  username = signal('');
  password = signal('');
  confirmPassword = signal('');
  
  showPassword = signal(false);
  showConfirmPassword = signal(false);
  isLoading = signal(false);
  errorMessage = signal('');
  successMessage = signal('');
  isRegistered = signal(false);

  readonly passwordMismatch = computed(() => {
    return this.confirmPassword().length > 0 && this.password() !== this.confirmPassword();
  });

  togglePasswordVisibility(): void {
    this.showPassword.update((v) => !v);
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword.update((v) => !v);
  }

  onSubmit(): void {
    this.errorMessage.set('');
    this.successMessage.set('');

    if (!this.email().trim()) {
      this.errorMessage.set('Please enter a valid email address.');
      return;
    }

    if (!this.email().includes('@') || !this.email().includes('.')) {
      this.errorMessage.set('Please enter a valid email format.');
      return;
    }

    if (!this.username().trim()) {
      this.errorMessage.set('Please enter a username.');
      return;
    }

    if (!this.password()) {
      this.errorMessage.set('Please enter a password.');
      return;
    }

    if (this.password().length < 6) {
      this.errorMessage.set('Password must be at least 6 characters long.');
      return;
    }

    if (this.password() !== this.confirmPassword()) {
      this.errorMessage.set('Passwords do not match.');
      return;
    }

    const payload = {
      email: this.email().trim(),
      username: this.username().trim(),
      password: this.password()
    };

    this.isLoading.set(true);

    this.authService.register(payload).subscribe({
      next: (response) => {
        this.isLoading.set(false);
        this.isRegistered.set(true);
        const msg = response?.message || 'Registration is successful, please proceed with login.';
        this.successMessage.set(msg);
      },
      error: (error) => {
        this.isLoading.set(false);
        const errorMsg =
          error.error?.message ||
          error.error?.error ||
          error.message ||
          'Registration failed. Please try again.';
        this.errorMessage.set(errorMsg);
      }
    });
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }
}
