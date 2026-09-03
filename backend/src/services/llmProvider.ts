import axios, { AxiosInstance, AxiosError } from 'axios';
import { db, schema } from '../db/index.js';
import { eq, desc, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type { ZodType } from 'zod';
import { config } from '../config/index.js';
import type { LLMProvider, NewLLMProvider, LLMApp, NewLLMApp, LLMProviderName, LLMModel, LLMProviderConfig, FetchModelsRequest, FetchModelsResponse, LLMProviderCreateRequest, LLMProviderUpdateRequest, LLMAppCreateRequest, LLMAppUpdateRequest } from '../types/index.js';

// Provider response shapes used by completeJson() (only the fields we read).
interface AnthropicMessagesResponse {
  content?: Array<{ type: string; text?: string }>;
}
interface GeminiGenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}
interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/** Extract the first JSON object/array from an LLM text response (strips prose and markdown fences). */
export function extractJsonPayload(raw: string): unknown | null {
  if (!raw) return null;
  let text = raw.trim();
  // Prefer a fenced block when present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const openChar = text[start];
  const closeChar = openChar === '{' ? '}' : ']';
  const end = text.lastIndexOf(closeChar);
  if (end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const PROVIDER_CONFIGS: Record<LLMProviderName, LLMProviderConfig> = {
  anthropic: { name: 'anthropic', displayName: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com', modelsEndpoint: '/v1/models', authType: 'bearer', supportsStreaming: true, requiresApiKey: true },
  openai: { name: 'openai', displayName: 'OpenAI', defaultBaseUrl: 'https://api.openai.com', modelsEndpoint: '/v1/models', authType: 'bearer', supportsStreaming: true, requiresApiKey: true },
  gemini: { name: 'gemini', displayName: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com', modelsEndpoint: '/v1/models', authType: 'api-key', supportsStreaming: true, requiresApiKey: true },
  opencode: { name: 'opencode', displayName: 'OpenCode', defaultBaseUrl: 'http://localhost:8080', modelsEndpoint: '/v1/models', authType: 'bearer', supportsStreaming: true, requiresApiKey: false },
  omniroute: { name: 'omniroute', displayName: 'OmniRoute', defaultBaseUrl: 'http://localhost:8000', modelsEndpoint: '/models', authType: 'bearer', supportsStreaming: true, requiresApiKey: true },
  lmstudio: { name: 'lmstudio', displayName: 'LM Studio', defaultBaseUrl: 'http://localhost:1234', modelsEndpoint: '/v1/models', authType: 'none', supportsStreaming: true, requiresApiKey: false },
  ollama: { name: 'ollama', displayName: 'Ollama', defaultBaseUrl: 'http://localhost:11434', modelsEndpoint: '/api/tags', authType: 'none', supportsStreaming: true, requiresApiKey: false },
};

/**
 * Extracts the first balanced JSON document (object or array) from raw LLM
 * output. Tolerates markdown fences and leading/trailing prose, which models
 * emit despite instructions.
 */
export function extractJsonDocument(raw: string): unknown {
  if (!raw || !raw.trim()) throw new Error('LLM returned an empty response');
  const cleaned = raw.replace(/```(?:json)?/gi, '```').trim();

  const start = cleaned.search(/[[{]/);
  if (start === -1) throw new Error(`No JSON document found in LLM response: ${cleaned.slice(0, 200)}`);

  const open = cleaned[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = false; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const candidate = cleaned.slice(start, i + 1);
        return JSON.parse(candidate);
      }
    }
  }
  throw new Error(`Unbalanced JSON in LLM response: ${cleaned.slice(start, start + 200)}`);
}

export class LLMProviderService {
  private clients: Map<string, AxiosInstance> = new Map();

  private maskApiKey(key: string): string {
    if (!key) return '';
    if (key.length <= 8) return '***';
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }

  private maskHeaders(headers: any): Record<string, any> {
    if (!headers) return {};
    const raw = typeof headers.toJSON === 'function' ? headers.toJSON() : { ...headers };
    const masked: Record<string, any> = {};
    for (const [key, value] of Object.entries(raw)) {
      const lower = key.toLowerCase();
      if (lower === 'authorization') {
        const str = String(value);
        const parts = str.split(' ');
        masked[key] = parts.length === 2 ? `${parts[0]} ${this.maskApiKey(parts[1])}` : this.maskApiKey(str);
      } else if (lower === 'x-goog-api-key' || lower === 'api-key' || lower === 'x-api-key') {
        masked[key] = this.maskApiKey(String(value));
      } else {
        masked[key] = value;
      }
    }
    return masked;
  }

  private getClient(provider: LLMProviderName, baseUrl: string, apiKey?: string): AxiosInstance {
    // Normalize the key so a user-entered "Bearer sk-..." is treated the same as "sk-..."
    // (prevents sending "Bearer Bearer sk-...").
    const normalizedKey = apiKey?.trim().replace(/^Bearer\s+/i, '');
    // Include the normalized key in the cache key so a client created without a key
    // (or with an old key) is never reused for a request that carries a different key.
    const key = provider + ':' + baseUrl + ':' + (normalizedKey || '');
    if (this.clients.has(key)) { return this.clients.get(key)!; }
    const config = PROVIDER_CONFIGS[provider];
    // Set headers on client creation or in a single sequential interceptor.
    // - Bearer providers (and OpenAI-compatible servers like LM Studio, OmniRoute, OpenCode)
    //   use `Authorization: Bearer <key>` whenever a key is provided.
    // - Gemini uses the `x-goog-api-key` header.
    const client = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(config.authType === 'api-key' && normalizedKey ? { 'x-goog-api-key': normalizedKey } : {}),
        // Send Bearer auth for any provider with a key, including LM Studio/Ollama
        // which may have API key auth enabled even though `requiresApiKey` is false.
        ...(normalizedKey && config.authType !== 'api-key' ? { Authorization: `Bearer ${normalizedKey}` } : {}),
      },
    });

    // Request logging interceptor
    client.interceptors.request.use((req) => {
      const fullUrl = (req.baseURL || '') + (req.url || '');
      console.log(`\n==================== [LLM Request: ${config.displayName}] ====================`);
      console.log(`METHOD:  ${req.method?.toUpperCase() || 'GET'}`);
      console.log(`URL:     ${fullUrl}`);
      console.log(`HEADERS: ${JSON.stringify(this.maskHeaders(req.headers || {}), null, 2)}`);
      if (req.data) {
        console.log(`BODY:    ${typeof req.data === 'object' ? JSON.stringify(req.data, null, 2) : req.data}`);
      }
      console.log(`====================================================================\n`);
      return req;
    });

    // Response & Error logging interceptor
    client.interceptors.response.use(
      (response) => {
        const fullUrl = (response.config.baseURL || '') + (response.config.url || '');
        console.log(`\n==================== [LLM Response: ${config.displayName}] ====================`);
        console.log(`STATUS:  ${response.status} ${response.statusText}`);
        console.log(`URL:     ${fullUrl}`);
        console.log(`DATA:    ${JSON.stringify(response.data, null, 2)}`);
        console.log(`=====================================================================\n`);
        return response;
      },
      (error: AxiosError) => {
        const fullUrl = (error.config?.baseURL || '') + (error.config?.url || '');
        console.error(`\n==================== [LLM Error: ${config.displayName}] ====================`);
        console.error(`STATUS:  ${error.response?.status || 'NO_RESPONSE'} ${error.response?.statusText || ''}`);
        console.error(`URL:     ${fullUrl}`);
        console.error(`MESSAGE: ${error.message}`);
        if (error.response?.data) {
          console.error(`RESPONSE DATA: ${JSON.stringify(error.response.data, null, 2)}`);
        }
        console.error(`==================================================================\n`);
        throw error;
      }
    );

    this.clients.set(key, client);
    return client;
  }

  async fetchModels(request: FetchModelsRequest): Promise<FetchModelsResponse> {
    try {
      const config = PROVIDER_CONFIGS[request.provider];
      const client = this.getClient(request.provider, request.baseUrl, request.apiKey);
      const response = await client.get(config.modelsEndpoint);
      const models = this.parseModelsResponse(request.provider, response.data);
      return { success: true, data: models };
    } catch (error) {
      const axiosError = error as AxiosError;
      const responseData = axiosError.response?.data as { error?: { message?: string } } | undefined;
      return { success: false, error: responseData?.error?.message || axiosError.message || 'Failed to fetch models' };
    }
  }

  private parseModelsResponse(provider: LLMProviderName, data: unknown): LLMModel[] {
    switch (provider) {
      case 'anthropic': return (data as { data: Array<{ id: string; display_name: string }> }).data.map(m => ({ id: m.id, name: m.display_name }));
      case 'openai': return (data as { data: Array<{ id: string; owned_by: string }> }).data.filter(m => m.id.startsWith('gpt') || m.id.startsWith('o1') || m.id.startsWith('o3')).map(m => ({ id: m.id, name: m.id }));
      case 'gemini': return (data as { models: Array<{ name: string; displayName: string; description: string }> }).models.filter(m => m.name.includes('gemini')).map(m => ({ id: m.name.replace('models/', ''), name: m.displayName, description: m.description }));
      case 'opencode': case 'lmstudio': return (data as { data: Array<{ id: string; owned_by: string }> }).data.map(m => ({ id: m.id, name: m.id }));
      case 'omniroute': {
        // OmniRoute returns an OpenAI-compatible { object, data: [{ id, ... }] } payload
        const list = data as { data?: Array<{ id: string; owned_by?: string }> };
        if (Array.isArray(list.data)) { return list.data.map(m => ({ id: m.id, name: m.id, description: m.owned_by })); }
        if (Array.isArray(data)) { return (data as string[]).map(m => ({ id: m, name: m })); }
        return [];
      }
      case 'ollama': return (data as { models: Array<{ name: string; size: number; details?: { parameter_size: string } }> }).models.map(m => ({ id: m.name, name: m.name, description: m.details?.parameter_size }));
      default: return [];
    }
  }

  // Database operations for LLM Providers
  async createProvider(input: LLMProviderCreateRequest): Promise<LLMProvider> {
    const providerId = uuidv4();
    const newProvider: NewLLMProvider = { id: providerId, name: input.name, displayName: input.displayName, baseUrl: input.baseUrl, apiKey: input.apiKey, config: input.config || {}, isActive: true };
    await db.insert(schema.llmProviders).values(newProvider);
    const [created] = await db.select().from(schema.llmProviders).where(eq(schema.llmProviders.id, providerId));
    return created!;
  }

  async getProvider(providerId: string): Promise<LLMProvider | null> {
    const [provider] = await db.select().from(schema.llmProviders).where(eq(schema.llmProviders.id, providerId));
    return provider ?? null;
  }

  async getProviders(filters?: { isActive?: boolean; name?: LLMProviderName; limit?: number; offset?: number }): Promise<LLMProvider[]> {
    const conditions = [];
    if (filters?.isActive !== undefined) { conditions.push(eq(schema.llmProviders.isActive, filters.isActive)); }
    if (filters?.name) { conditions.push(eq(schema.llmProviders.name, filters.name)); }
    const query = db.select().from(schema.llmProviders);
    if (conditions.length > 0) { query.where(and(...conditions)); }
    query.orderBy(desc(schema.llmProviders.createdAt));
    if (filters?.limit) { query.limit(filters.limit); }
    if (filters?.offset) { query.offset(filters.offset); }
    return query;
  }

  async updateProvider(providerId: string, updates: LLMProviderUpdateRequest): Promise<LLMProvider | null> {
    const updateData: Partial<NewLLMProvider> = { updatedAt: new Date() };
    if (updates.displayName !== undefined) updateData.displayName = updates.displayName;
    if (updates.baseUrl !== undefined) updateData.baseUrl = updates.baseUrl;
    if (updates.apiKey !== undefined) updateData.apiKey = updates.apiKey;
    if (updates.config !== undefined) updateData.config = updates.config;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;
    await db.update(schema.llmProviders).set(updateData).where(eq(schema.llmProviders.id, providerId));
    return this.getProvider(providerId);
  }

  async deleteProvider(providerId: string): Promise<void> {
    await db.delete(schema.llmProviders).where(eq(schema.llmProviders.id, providerId));
  }

  // Database operations for LLM Apps
  async createApp(input: LLMAppCreateRequest): Promise<LLMApp> {
    const providerId = await this.resolveProviderId(input.providerId, input.apiKey, input.endpoint);
    const appId = uuidv4();
    const newApp: NewLLMApp = { id: appId, name: input.name, description: input.description, providerId, model: input.model, temperature: input.temperature ?? 0.7, maxTokens: input.maxTokens ?? 4096, systemPrompt: input.systemPrompt, config: input.config || {}, isActive: true };
    await db.insert(schema.llmApps).values(newApp);
    const [created] = await db.select().from(schema.llmApps).where(eq(schema.llmApps.id, appId));
    return created!;
  }

  /**
   * Resolve the providerId for an LLM App row.
   * Accepts either a saved provider UUID (users with saved provider configs)
   * or a built-in provider name (e.g. 'anthropic'). For a name, we first look
   * for an existing saved provider with that name; if none exists, a provider
   * row is created on the fly so the llm_apps.provider_id FK is satisfied.
   */
  private async resolveProviderId(providerId: string, apiKey?: string, endpoint?: string): Promise<string> {
    // Already a saved provider UUID?
    const existing = await this.getProvider(providerId);
    if (existing) {
      const updates: { apiKey?: string; baseUrl?: string } = {};
      if (apiKey && apiKey !== existing.apiKey) { updates.apiKey = apiKey; }
      if (endpoint && endpoint !== existing.baseUrl) { updates.baseUrl = endpoint; }
      if (Object.keys(updates).length > 0) {
        await this.updateProvider(existing.id, updates);
      }
      return existing.id;
    }

    // Treat as a built-in provider name
    const name = providerId as LLMProviderName;
    const config = PROVIDER_CONFIGS[name];
    if (!config) { throw new Error('Invalid provider ID'); }

    const [saved] = await db.select().from(schema.llmProviders).where(eq(schema.llmProviders.name, name)).limit(1);
    if (saved) {
      const updates: { apiKey?: string; baseUrl?: string } = {};
      if (apiKey && apiKey !== saved.apiKey) { updates.apiKey = apiKey; }
      if (endpoint && endpoint !== saved.baseUrl) { updates.baseUrl = endpoint; }
      if (Object.keys(updates).length > 0) {
        await this.updateProvider(saved.id, updates);
      }
      return saved.id;
    }

    const providerIdNew = uuidv4();
    const newProvider: NewLLMProvider = {
      id: providerIdNew,
      name,
      displayName: config.displayName,
      baseUrl: endpoint || config.defaultBaseUrl,
      apiKey: apiKey || undefined,
      config: {},
      isActive: true,
    };
    await db.insert(schema.llmProviders).values(newProvider);
    return providerIdNew;
  }

  async getApp(appId: string): Promise<LLMApp | null> {
    const [app] = await db.select().from(schema.llmApps).where(eq(schema.llmApps.id, appId));
    return app ?? null;
  }

  async getApps(filters?: { isActive?: boolean; providerId?: string; limit?: number; offset?: number }): Promise<LLMApp[]> {
    const conditions = [];
    if (filters?.isActive !== undefined) { conditions.push(eq(schema.llmApps.isActive, filters.isActive)); }
    if (filters?.providerId) { conditions.push(eq(schema.llmApps.providerId, filters.providerId)); }
    const query = db.select().from(schema.llmApps);
    if (conditions.length > 0) { query.where(and(...conditions)); }
    query.orderBy(desc(schema.llmApps.createdAt));
    if (filters?.limit) { query.limit(filters.limit); }
    if (filters?.offset) { query.offset(filters.offset); }
    return query;
  }

  async updateApp(appId: string, updates: LLMAppUpdateRequest): Promise<LLMApp | null> {
    const updateData: Partial<NewLLMApp> = { updatedAt: new Date() };
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.model !== undefined) updateData.model = updates.model;
    if (updates.temperature !== undefined) updateData.temperature = updates.temperature;
    if (updates.maxTokens !== undefined) updateData.maxTokens = updates.maxTokens;
    if (updates.systemPrompt !== undefined) updateData.systemPrompt = updates.systemPrompt;
    if (updates.config !== undefined) updateData.config = updates.config;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;
    await db.update(schema.llmApps).set(updateData).where(eq(schema.llmApps.id, appId));
    return this.getApp(appId);
  }

  // ------------------------------------------------------------------
  // JSON-mode completion (used by the VGWorker — VIDEO_GENERATION_PROCESS.md §6)
  // ------------------------------------------------------------------

  async deleteApp(appId: string): Promise<void> {
    await db.delete(schema.llmApps).where(eq(schema.llmApps.id, appId));
  }

  /**
   * Run a JSON-only completion against the LLM App and validate it with a Zod schema.
   *
   * Used by the VGWorker for story generation and clip planning. Provider, model,
   * temperature, max tokens and system instruction all come from the saved LLM App
   * (+ its provider row), never from the caller.
   *
   * When the model returns malformed JSON (or the payload fails validation), the
   * request is retried with a corrective user message including the validation
   * errors (config.videoGeneration.llmCorrectionRetries, default 1).
   */
  async completeJson<T>(options: {
    appId: string;
    userPrompt: string;
    schema: ZodType<T>;
    correctionRetries?: number;
  }): Promise<T> {
    const app = await this.getApp(options.appId);
    if (!app) throw new Error(`LLM App not found: ${options.appId}`);
    const provider = await this.getProvider(app.providerId);
    if (!provider) throw new Error(`LLM Provider not found for app ${app.name}: ${app.providerId}`);

    const providerName = provider.name as LLMProviderName;
    if (!PROVIDER_CONFIGS[providerName]) throw new Error(`Unknown LLM provider: ${providerName}`);
    const client = this.getClient(providerName, provider.baseUrl, provider.apiKey ?? undefined);

    let correctionRetries = options.correctionRetries ?? config.videoGeneration.llmCorrectionRetries;
    let lastError: Error;
    let attemptPrompt = options.userPrompt;

    while (true) {
      let raw = '';
      try {
        raw = await this.rawCompletion(client, {
          provider: providerName,
          model: app.model,
          systemPrompt: app.systemPrompt || undefined,
          userPrompt: attemptPrompt,
          temperature: app.temperature ?? 0.7,
          maxTokens: app.maxTokens ?? 4096,
          apiKey: provider.apiKey ?? undefined,
        });
      } catch (err) {
        // Transport/API errors are not corrected by re-asking the model — fail fast.
        throw err;
      }

      const extracted = extractJsonPayload(raw);
      const parsed = extracted !== null
        ? options.schema.safeParse(extracted)
        : { success: false as const, error: { message: 'no JSON payload found in response' } };

      if (parsed.success) return parsed.data as T;
      lastError = new Error(`LLM JSON invalid: ${parsed.error.message.slice(0, 500)}`);

      if (correctionRetries <= 0) throw lastError;
      correctionRetries -= 1;
      attemptPrompt =
        `${options.userPrompt}\n\nYour previous response was rejected: ${lastError.message}\n` +
        'Respond again with corrected, valid JSON only — no prose, no markdown fences.';
    }
  }

  /**
   * Single provider-aware completion request returning raw text.
   * Dispatches on the provider family: Anthropic Messages API, Gemini
   * generateContent, or OpenAI-compatible chat completions for everything else
   * (OpenAI, OpenCode, OmniRoute, LM Studio, Ollama).
   */
  private async rawCompletion(
    client: AxiosInstance,
    input: {
      provider: LLMProviderName;
      model: string;
      systemPrompt?: string;
      userPrompt: string;
      temperature: number;
      maxTokens: number;
      apiKey?: string;
    }
  ): Promise<string> {
    const reqOpts = { timeout: config.llm.completionTimeout };

    try {
      if (input.provider === 'anthropic') {
        const body: Record<string, unknown> = {
          model: input.model,
          max_tokens: input.maxTokens,
          temperature: input.temperature,
          messages: [{ role: 'user', content: input.userPrompt }],
        };
        if (input.systemPrompt) body.system = input.systemPrompt;
        const { data } = await client.post<AnthropicMessagesResponse>('/v1/messages', body, reqOpts);
        const text = (data.content || [])
          .filter((c) => c.type === 'text')
          .map((c) => c.text || '')
          .join('\n');
        if (!text) throw new Error('Anthropic response contained no text content');
        return text;
      }

      if (input.provider === 'gemini') {
        const body: Record<string, unknown> = {
          contents: [{ role: 'user', parts: [{ text: input.userPrompt }] }],
          generationConfig: {
            temperature: input.temperature,
            maxOutputTokens: input.maxTokens,
          },
        };
        if (input.systemPrompt) {
          body.systemInstruction = { parts: [{ text: input.systemPrompt }] };
        }
        const url = `/v1beta/models/${encodeURIComponent(input.model)}:generateContent`;
        const { data } = await client.post<GeminiGenerateResponse>(url, body, reqOpts);
        const candidate = data.candidates?.[0];
        const text = (candidate?.content?.parts || []).map((p) => p.text || '').join('');
        if (!text) throw new Error('Gemini response contained no text content');
        return text;
      }

      // OpenAI-compatible chat completions (openai, opencode, omniroute, lmstudio, ollama).
      const messages: Array<{ role: string; content: string }> = [];
      if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt });
      messages.push({ role: 'user', content: input.userPrompt });
      const body = {
        model: input.model,
        messages,
        temperature: input.temperature,
        max_tokens: input.maxTokens,
      };

      // OmniRoute exposes /models (no /v1 prefix), so try both path shapes; the
      // alternate path is only attempted on 404 (unknown route).
      const paths = input.provider === 'omniroute'
        ? ['/chat/completions', '/v1/chat/completions']
        : ['/v1/chat/completions', '/chat/completions'];

      let lastErr: unknown = null;
      for (const path of paths) {
        try {
          const { data } = await client.post<OpenAIChatResponse>(path, body, reqOpts);
          const text = data.choices?.[0]?.message?.content;
          if (!text) throw new Error('Chat completion response contained no message content');
          return text;
        } catch (err) {
          lastErr = err;
          const status = (err as AxiosError).response?.status;
          if (status !== 404) throw err;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error('Chat completion failed');
    } catch (err) {
      if (err instanceof AxiosError) {
        const respData = err.response?.data;
        const detail = typeof respData === 'string'
          ? respData.slice(0, 300)
          : JSON.stringify(respData ?? {}).slice(0, 300);
        throw new Error(`LLM completion failed (${err.response?.status ?? err.code}): ${detail || err.message}`);
      }
      throw err;
    }
  }

  getProviderConfig(provider: LLMProviderName): LLMProviderConfig { return PROVIDER_CONFIGS[provider]; }
  getAllProviderConfigs(): LLMProviderConfig[] { return Object.values(PROVIDER_CONFIGS); }
}

export const llmProviderService = new LLMProviderService();
