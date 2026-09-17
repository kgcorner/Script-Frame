import { ComponentFixture, TestBed } from '@angular/core';
import { provideRouter } from '@angular/router';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create LoginComponent', () => {
    expect(component).toBeTruthy();
  });

  it('should validate empty submit', () => {
    component.onSubmit();
    expect(component.errorMessage()).toBe('Please enter your username.');
  });

  it('should validate missing password', () => {
    component.username.set('testuser');
    component.onSubmit();
    expect(component.errorMessage()).toBe('Please enter your password.');
  });

  it('should toggle password visibility', () => {
    expect(component.showPassword()).toBe(false);
    component.togglePasswordVisibility();
    expect(component.showPassword()).toBe(true);
  });
});
