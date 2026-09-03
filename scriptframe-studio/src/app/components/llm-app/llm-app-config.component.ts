import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { LLMProviderService } from '../../services';
import {
  LLMProviderConfig,
  LLMProviderName,
  FetchModelsRequest,
  LLMModel,
  LLMApp,
  LLMAppCreateRequest,
  LLMAppUpdateRequest,
} from '../../models';

// Tab types for the management interface (mirrors the ComfyUI App Builder).
type AppTab = 'create' | 'manage';

@Component({
  selector: 'app-llm-app-config',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './llm-app-config.component.html',
  styleUrls: ['./llm-app-config.component.scss'],
})
export class LLMAppConfigComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // ---------- Provider / model selection (create + edit form) ----------
  appForm: FormGroup;
  providerConfigs = signal<LLMProviderConfig[]>([]);
  selectedProviderConfig = signal<LLMProviderConfig | null>(null);
  showApiKey = false;
  models = signal<LLMModel[]>([]);
  filteredModels = signal<LLMModel[]>([]);
  isLoadingModels = signal(false);
  modelsError = signal<string | null>(null);
  isSubmitting = signal(false);

  // Saved provider rows: pre-fill endpoint/API key and resolve app.providerId.
  savedProviders = signal<LLMProviderConfig[]>([]);
  // llm_apps.provider_id stores a provider UUID — map it back to a provider name.
  providerNameMap = signal<Map<string, string>>(new Map());

  // ---------- App management (manage tab) ----------
  activeTab = signal<AppTab>('create');
  apps = signal<LLMApp[]>([]);
  loadingApps = signal(false);
  editingApp = signal<LLMApp | null>(null);
  deletingId = signal<string | null>(null);
  togglingId = signal<string | null>(null);

  // Shared page-level alerts (like the ComfyUI App Builder).
  error = signal<string | null>(null);
  saveSuccess = signal<string | null>(null);

  activeAppCount = computed(() => this.apps().filter((a) => a.isActive).length);

  constructor(
    private fb: FormBuilder,
    private llmProviderService: LLMProviderService
  ) {
    this.appForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(1)]],
      description: [''],
      providerId: ['', [Validators.required]],
      endpoint: [''],
      apiKey: [''],
      model: ['', [Validators.required]],
      temperature: [0.7, [Validators.min(0), Validators.max(2)]],
      maxTokens: [4096, [Validators.min(1)]],
      systemPrompt: [''],
      isActive: [true],
    });
  }

  ngOnInit(): void {
    this.loadProviderConfigs();
    this.setupProviderChange();
    this.loadApps();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ==================================================================
  // Tab management (Create / Manage)
  // ==================================================================

  // Switch between the Create and Manage tabs. Explicitly entering the
  // create tab always starts a fresh create (any in-progress edit is
  // discarded); entering manage refreshes the app list.
  setActiveTab(tab: AppTab): void {
    this.activeTab.set(tab);
    if (tab === 'manage') {
      this.loadApps();
    } else {
      this.resetToCreateMode();
    }
  }

  // ==================================================================
  // Manage tab: list / edit / activate / delete
  // ==================================================================

  loadApps(): void {
    this.loadingApps.set(true);
    // No isActive filter — the manager must also see (and re-activate) apps.
    this.llmProviderService.getApps()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.apps.set(res.data ?? []);
          } else {
            this.error.set('Failed to load LLM Apps');
          }
          this.loadingApps.set(false);
        },
        error: (err) => {
          console.error('Failed to load LLM apps:', err);
          this.error.set('Failed to load LLM Apps');
          this.loadingApps.set(false);
        },
      });
  }

  /** Open the create form pre-filled with the app's configuration (edit mode). */
  editApp(app: LLMApp): void {
    this.editingApp.set(app);
    this.activeTab.set('create');
    this.error.set(null);
    this.saveSuccess.set(null);
    this.isSubmitting.set(false);
    this.showApiKey = false;
    this.models.set([]);
    this.filteredModels.set([]);
    this.modelsError.set(null);

    // providerId / endpoint / apiKey live on the provider row, not the app row
    // (the LLM App update API ignores them), so lock them while editing.
    for (const name of ['providerId', 'endpoint', 'apiKey']) {
      const control = this.appForm.get(name);
      control?.clearValidators();
      control?.disable({ emitEvent: false });
    }
    this.selectedProviderConfig.set(null);

    const providerName = this.providerNameMap().get(app.providerId) ?? '';
    const savedProvider = this.savedProviders().find((p) => p.name === providerName);

    // Patch silently so the provider-change subscription (model fetch, endpoint
    // pre-fill) doesn't clobber the app's stored values.
    this.appForm.patchValue(
      {
        name: app.name,
        description: app.description ?? '',
        providerId: providerName,
        endpoint: savedProvider?.defaultBaseUrl ?? '',
        apiKey: '',
        model: app.model,
        temperature: app.temperature ?? 0.7,
        maxTokens: app.maxTokens ?? 4096,
        systemPrompt: app.systemPrompt ?? '',
        isActive: app.isActive,
      },
      { emitEvent: false }
    );
    this.appForm.markAsPristine();
    this.appForm.markAsUntouched();
  }

  isEditing(): boolean {
    return this.editingApp() !== null;
  }

  // Leave edit mode. Cancelled/finished an edit: return to the manage list.
  cancelEdit(): void {
    const wasEditing = this.editingApp() !== null;
    this.resetToCreateMode();
    if (wasEditing) this.activeTab.set('manage');
  }

  deleteApp(app: LLMApp): void {
    if (!confirm(`Delete the LLM App "${app.name}"? This cannot be undone.`)) return;
    this.deletingId.set(app.id);
    this.llmProviderService.deleteApp(app.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.deletingId.set(null);
          this.saveSuccess.set(`LLM App "${app.name}" deleted`);
          this.loadApps();
        },
        error: (err) => {
          this.deletingId.set(null);
          console.error('Failed to delete LLM app:', err);
          this.error.set('Failed to delete LLM App: ' + (err.message || 'Unknown error'));
        },
      });
  }

  // Activate / deactivate an app straight from the manage table.
  toggleActive(app: LLMApp): void {
    if (this.togglingId()) return;
    this.togglingId.set(app.id);
    this.llmProviderService.updateApp(app.id, { isActive: !app.isActive })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.togglingId.set(null);
          if (response.success && response.data) {
            const updated = response.data;
            this.apps.update((list) => list.map((a) => (a.id === updated.id ? updated : a)));
            this.saveSuccess.set(`LLM App "${app.name}" is now ${updated.isActive ? 'active' : 'inactive'}`);
          } else {
            this.error.set('Failed to update LLM App status');
            this.loadApps();
          }
        },
        error: (err) => {
          this.togglingId.set(null);
          console.error('Failed to toggle LLM app status:', err);
          this.error.set('Failed to update LLM App status: ' + (err.message || 'Unknown error'));
        },
      });
  }

  /** Display name for an app's provider (resolved from its provider UUID). */
  providerDisplayName(app: LLMApp): string {
    const name = this.providerNameMap().get(app.providerId);
    if (!name) return app.providerId; // provider row gone — fall back to the raw id
    const saved = this.savedProviders().find((p) => p.name === name);
    return saved?.displayName ?? this.providerConfigs().find((c) => c.name === name)?.displayName ?? name;
  }

  // ==================================================================
  // Save (create or update — unified submit)
  // ==================================================================

  saveApp(): void {
    if (this.appForm.invalid) {
      this.appForm.markAllAsTouched();
      return;
    }

    const editing = this.editingApp();
    this.isSubmitting.set(true);
    this.error.set(null);
    this.saveSuccess.set(null);

    if (editing) {
      // getRawValue() includes the disabled provider/connection controls.
      const value = this.appForm.getRawValue();
      const request: LLMAppUpdateRequest = {
        name: value.name,
        description: value.description || undefined,
        model: value.model,
        temperature: value.temperature,
        maxTokens: value.maxTokens,
        systemPrompt: value.systemPrompt || undefined,
        isActive: value.isActive,
      };

      this.llmProviderService.updateApp(editing.id, request)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (response) => {
            this.isSubmitting.set(false);
            if (response.success) {
              this.saveSuccess.set(`Successfully updated LLM App "${response.data?.name ?? request.name}"`);
              this.exitEditMode();
            } else {
              this.error.set('Failed to update LLM App');
            }
          },
          error: (err) => {
            this.isSubmitting.set(false);
            this.error.set(err.error?.error || err.message || 'Failed to update LLM App');
          },
        });
      return;
    }

    const value = this.appForm.getRawValue();
    const request: LLMAppCreateRequest = {
      name: value.name,
      description: value.description || undefined,
      providerId: value.providerId,
      endpoint: value.endpoint || undefined,
      apiKey: value.apiKey || undefined,
      model: value.model,
      temperature: value.temperature,
      maxTokens: value.maxTokens,
      systemPrompt: value.systemPrompt || undefined,
    };

    this.llmProviderService.createApp(request)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.isSubmitting.set(false);
          if (response.success) {
            this.saveSuccess.set(`Successfully created LLM App "${response.data?.name ?? request.name}"`);
            // Keep the selected provider so several apps can be created in a
            // row; clear everything else.
            const providerId = value.providerId;
            this.appForm.reset({ name: '', description: '', providerId, endpoint: '', apiKey: '', model: '', temperature: 0.7, maxTokens: 4096, systemPrompt: '', isActive: true });
            this.models.set([]);
            this.filteredModels.set([]);
            this.modelsError.set(null);
            this.loadApps();
          } else {
            this.error.set('Failed to create LLM App');
          }
        },
        error: (err) => {
          this.isSubmitting.set(false);
          this.error.set(err.error?.error || err.message || 'Failed to create LLM App');
        },
      });
  }

  // ==================================================================
  // Create-mode helpers
  // ==================================================================

  private resetToCreateMode(): void {
    this.editingApp.set(null);
    this.enableConnectionControls();
    this.onReset();
  }

  private exitEditMode(): void {
    this.resetToCreateMode();
    this.activeTab.set('manage');
    this.loadApps();
  }

  private enableConnectionControls(): void {
    for (const name of ['providerId', 'endpoint', 'apiKey']) {
      this.appForm.get(name)?.enable({ emitEvent: false });
    }
  }

  onReset(): void {
    this.appForm.reset({ name: '', description: '', providerId: '', endpoint: '', apiKey: '', model: '', temperature: 0.7, maxTokens: 4096, systemPrompt: '', isActive: true });
    this.selectedProviderConfig.set(null);
    this.showApiKey = false;
    this.models.set([]);
    this.filteredModels.set([]);
    this.modelsError.set(null);
  }

  // ==================================================================
  // Provider configs & saved providers (model discovery support)
  // ==================================================================

  private loadProviderConfigs(): void {
    this.llmProviderService.getProviderConfigs()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.providerConfigs.set(response.data);
            this.loadSavedProviders();
          }
        },
        error: (err) => console.error('Failed to load provider configs:', err),
      });
  }

  private loadSavedProviders(): void {
    // Fetch every provider row (active or not) so app.providerId UUIDs can
    // always be resolved back to a provider name for the manage table.
    this.llmProviderService.getProviders()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.providerNameMap.set(new Map(response.data.map((p) => [p.id, p.name])));
            this.savedProviders.set(response.data.map((p) => {
              const builtIn = this.providerConfigs().find((c) => c.name === p.name);
              return {
                name: p.name,
                displayName: p.displayName,
                defaultBaseUrl: p.baseUrl,
                modelsEndpoint: '',
                authType: 'bearer',
                supportsStreaming: true,
                requiresApiKey: builtIn?.requiresApiKey ?? true,
                apiKey: p.apiKey,
              };
            }));
            // Pre-fill the API Key field from a matching saved provider (if any)
            const currentProviderId = this.appForm.get('providerId')?.value;
            if (currentProviderId) {
              const saved = this.savedProviders().find((p) => p.name === currentProviderId);
              if (saved?.apiKey) {
                this.appForm.get('apiKey')?.setValue(saved.apiKey, { emitEvent: false });
              }
            }
          }
        },
        error: (err) => console.error('Failed to load saved providers:', err),
      });
  }

  private setupProviderChange(): void {
    this.appForm.get('providerId')?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe((providerId) => {
        const provider = this.providerConfigs().find((p) => p.name === providerId) ||
                         this.savedProviders().find((p) => p.name === providerId);
        this.selectedProviderConfig.set(provider || null);
        this.appForm.get('model')?.setValue('');
        this.models.set([]);
        this.filteredModels.set([]);
        this.modelsError.set(null);

        // Auto-populate the endpoint with the provider's default (or saved) base URL
        const savedProvider = this.savedProviders().find((p) => p.name === providerId);
        const defaultUrl = savedProvider?.defaultBaseUrl || provider?.defaultBaseUrl || '';
        const endpointControl = this.appForm.get('endpoint');
        endpointControl?.setValue(defaultUrl, { emitEvent: false });
        // The endpoint is required (auto-populated) once a provider is selected
        endpointControl?.setValidators(provider ? [Validators.required] : []);
        endpointControl?.updateValueAndValidity();

        // Pre-fill the API key from the saved provider (if stored), otherwise keep user input
        const apiKeyControl = this.appForm.get('apiKey');
        if (savedProvider?.apiKey) {
          apiKeyControl?.setValue(savedProvider.apiKey, { emitEvent: false });
        }

        // Update apiKey validators based on provider requirements.
        // A saved provider that already has a stored key counts as satisfied.
        const hasStoredKey = !!savedProvider?.apiKey;
        if (provider?.requiresApiKey && !hasStoredKey) {
          apiKeyControl?.setValidators([Validators.required]);
        } else {
          apiKeyControl?.clearValidators();
        }
        apiKeyControl?.updateValueAndValidity();

        if (provider) {
          // Fetch models when the provider does not require an API key, or when one
          // is already present (user-entered or stored on the saved provider).
          const currentApiKey = apiKeyControl?.value;
          if (!provider.requiresApiKey || currentApiKey) {
            this.fetchModelsForProvider(provider.name, currentApiKey);
          }
        }
      });
  }

  toggleApiKeyVisibility(): void {
    this.showApiKey = !this.showApiKey;
  }

  onApiKeyBlur(): void {
    const providerId = this.appForm.get('providerId')?.value;
    const apiKey = this.appForm.get('apiKey')?.value;
    if (providerId && (apiKey || !this.selectedProviderConfig()?.requiresApiKey)) {
      this.fetchModelsForProvider(providerId, apiKey);
    }
  }

  onModelSearchChange(event: Event): void {
    const term = (event.target as HTMLInputElement).value.toLowerCase();
    this.filteredModels.set(this.models().filter((model) =>
      model.name.toLowerCase().includes(term) ||
      model.displayName?.toLowerCase().includes(term) ||
      model.description?.toLowerCase().includes(term)
    ));
  }

  private fetchModelsForProvider(providerName: LLMProviderName, apiKey?: string): void {
    const provider = this.providerConfigs().find((p) => p.name === providerName);
    const savedProvider = this.savedProviders().find((p) => p.name === providerName);
    if (!provider) return;

    this.isLoadingModels.set(true);
    this.modelsError.set(null);

    const request: FetchModelsRequest = {
      provider: providerName,
      // Base URL comes from the endpoint field (auto-populated with the
      // provider's default or saved base URL, editable by the user)
      baseUrl: this.appForm.get('endpoint')?.value || savedProvider?.defaultBaseUrl || provider.defaultBaseUrl,
      apiKey: apiKey || this.appForm.get('apiKey')?.value || undefined,
    };

    this.llmProviderService.fetchModels(request)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.isLoadingModels.set(false);
          if (response.success && response.data) {
            this.models.set(response.data);
            this.filteredModels.set([...response.data]);
          } else {
            this.modelsError.set(response.error || 'Failed to fetch models');
            this.models.set([]);
            this.filteredModels.set([]);
          }
        },
        error: (err) => {
          this.isLoadingModels.set(false);
          this.modelsError.set(err.message || 'Failed to fetch models');
          this.models.set([]);
          this.filteredModels.set([]);
        },
      });
  }

  get nameControl() { return this.appForm.get('name'); }
  get providerIdControl() { return this.appForm.get('providerId'); }
  get endpointControl() { return this.appForm.get('endpoint'); }
  get apiKeyControl() { return this.appForm.get('apiKey'); }
  get modelControl() { return this.appForm.get('model'); }
  get temperatureControl() { return this.appForm.get('temperature'); }
  get maxTokensControl() { return this.appForm.get('maxTokens'); }
}
