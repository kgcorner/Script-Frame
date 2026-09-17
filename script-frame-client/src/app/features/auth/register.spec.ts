import { ComponentFixture, TestBed } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { RegisterComponent } from './register.component';
import { AuthService } from '../../core/services/auth.service';

describe('RegisterComponent', () => {
  let component: RegisterComponent;
  let fixture: ComponentFixture<RegisterComponent>;
  let mockAuthService: { register: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockAuthService = {
      register: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [RegisterComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: mockAuthService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create RegisterComponent', () => {
    expect(component).toBeTruthy();
  });

  it('should detect password mismatch', () => {
    component.password.set('password123');
    component.confirmPassword.set('different123');
    expect(component.passwordMismatch()).toBe(true);
  });

  it('should validate invalid email', () => {
    component.email.set('invalid-email');
    component.onSubmit();
    expect(component.errorMessage()).toBe('Please enter a valid email format.');
  });

  it('should call AuthService.register on valid submit and display success message', () => {
    mockAuthService.register.mockReturnValue(of({ success: true, message: 'Registration is successful, please proceed with login.' }));

    component.email.set('test@example.com');
    component.username.set('testuser');
    component.password.set('password123');
    component.confirmPassword.set('password123');

    component.onSubmit();

    expect(mockAuthService.register).toHaveBeenCalledWith({
      email: 'test@example.com',
      username: 'testuser',
      password: 'password123'
    });
    expect(component.isRegistered()).toBe(true);
    expect(component.successMessage()).toBe('Registration is successful, please proceed with login.');
  });

  it('should display error message on registration failure', () => {
    mockAuthService.register.mockReturnValue(throwError(() => ({ error: { message: 'Username already exists.' } })));

    component.email.set('test@example.com');
    component.username.set('existinguser');
    component.password.set('password123');
    component.confirmPassword.set('password123');

    component.onSubmit();

    expect(component.isRegistered()).toBe(false);
    expect(component.errorMessage()).toBe('Username already exists.');
  });
});
