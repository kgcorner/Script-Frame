import { TestBed } from '@angular/core/testing';
import { provideRouter, RouterOutlet } from '@angular/router';
import { App } from './app';
import { AuthService } from './core/services/auth.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App, RouterOutlet],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render navigation links', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('header')).toBeTruthy();
    expect(compiled.querySelectorAll('a').length).toBeGreaterThanOrEqual(2);
  });

  it('should render a sign-out button in the mobile and desktop headers', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const signOutButtons = compiled.querySelectorAll('button[aria-label="Sign out"]');
    expect(signOutButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('should end the session when the sign-out button is clicked', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const authService = TestBed.inject(AuthService);
    const logoutSpy = vi.spyOn(authService, 'logout').mockImplementation(() => undefined);

    const compiled = fixture.nativeElement as HTMLElement;
    const button = compiled.querySelector<HTMLButtonElement>('button[aria-label="Sign out"]');
    expect(button).toBeTruthy();
    button!.click();

    expect(logoutSpy).toHaveBeenCalledTimes(1);
  });
});
