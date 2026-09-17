import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GenerateComponent } from './generate.component';

describe('GenerateComponent', () => {
  let component: GenerateComponent;
  let fixture: ComponentFixture<GenerateComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GenerateComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(GenerateComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create GenerateComponent', () => {
    expect(component).toBeTruthy();
  });

  it('should default to T2V-minimax workflow', () => {
    expect(component.selectedWorkflowId()).toBe('T2V-minimax');
    expect(component.selectedWorkflow().label).toBe('T2V MiniMax');
  });

  it('should update workflow when selected', () => {
    component.selectWorkflow('I2V-LTX');
    expect(component.selectedWorkflowId()).toBe('I2V-LTX');
    expect(component.selectedWorkflow().isImageToVideo).toBe(true);
  });

  it('should update aspect ratio when selected', () => {
    component.selectRatio('9:16');
    expect(component.selectedRatioId()).toBe('9:16');
    expect(component.selectedRatio().label).toBe('9:16 Vertical');
  });

  it('should toggle turbo mode', () => {
    const initial = component.turboMode();
    component.toggleTurbo();
    expect(component.turboMode()).toBe(!initial);
  });

  it('should append preset tag to prompt', () => {
    const initial = component.promptText();
    component.appendTag('+ 8k Panavision');
    expect(component.promptText()).toContain('8k Panavision');
  });
});
