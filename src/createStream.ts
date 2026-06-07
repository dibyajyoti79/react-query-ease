import { AxiosInstance, AxiosError, Method } from "axios";
import { AuthInterceptorOptions, RefreshResult } from "./interceptors/createAuthInterceptor";

export type StreamConfig = {
  url: string;
  method?: Method;
  headers?: Record<string, string>;
  data?: unknown;
  signal?: AbortSignal;
  credentials?: RequestCredentials;

  onChunk?: (chunk: string) => void;
  onComplete?: () => void;
  onError?: (error: unknown) => void;
};

export type StreamController = {
  abort: () => void;
  readonly signal: AbortSignal;

  [Symbol.asyncIterator](): AsyncIterator<string>;
};

export type ExtendedAxiosInstance = AxiosInstance & {
  __authOptions?: AuthInterceptorOptions;
  __queueRefresh?: (error: AxiosError) => Promise<RefreshResult>;
};

// Default check to see if an error should trigger token refresh
const defaultShouldRefresh = (error: AxiosError) =>
  error.response?.status === 401;

// Resolves absolute URL combining baseURL and relative URL
const getAbsoluteUrl = (url: string, baseURL?: string): string => {
  if (!baseURL) return url;
  if (/^(?:[a-z]+:)?\/\//i.test(url)) return url;

  const base = baseURL.replace(/\/+$/, "");
  const path = url.replace(/^\/+/, "");
  return `${base}/${path}`;
};

const createMockAxiosError = (
  response: Response,
  config: unknown
): AxiosError =>
  ({
    config,
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      config,
      data: null,
    },
    isAxiosError: true,
    name: "AxiosError",
    message: `Request failed with status code ${response.status}`,
  } as AxiosError);

export const createStream = async (
  instance: AxiosInstance,
  config: StreamConfig
): Promise<StreamController> => {
  const internalController = new AbortController();
  const internalSignal = internalController.signal;

  const handleAbort = () => {
    internalController.abort();
  };

  // Connect config's external signal to our internal abort controller
  if (config.signal) {
    if (config.signal.aborted) {
      handleAbort();
    } else {
      config.signal.addEventListener("abort", handleAbort);
    }
  }

  // Cleanup helper to remove signal listener and prevent leaks
  const cleanupSignal = () => {
    if (config.signal) {
      config.signal.removeEventListener("abort", handleAbort);
    }
  };

  // Set up async iterator queue state
  const chunkQueue: string[] = [];
  type QueuePromise = {
    resolve: (res: IteratorResult<string>) => void;
    reject: (err: unknown) => void;
  };
  const pendingQueue: QueuePromise[] = [];
  let isDone = false;
  let streamError: unknown = null;

  const pushChunk = (chunk: string) => {
    if (pendingQueue.length > 0) {
      const { resolve } = pendingQueue.shift()!;
      resolve({ value: chunk, done: false });
    } else {
      chunkQueue.push(chunk);
    }
  };

  const pushError = (err: unknown) => {
    streamError = err;
    while (pendingQueue.length > 0) {
      const { reject } = pendingQueue.shift()!;
      reject(err);
    }
  };

  const pushComplete = () => {
    isDone = true;
    while (pendingQueue.length > 0) {
      const { resolve } = pendingQueue.shift()!;
      resolve({ value: undefined as any, done: true });
    }
  };

  // Helper to build merged headers from Axios defaults and config.headers
  const getMergedHeaders = (
    configHeaders?: Record<string, string>,
    method?: string
  ): Record<string, string> => {
    const merged: Record<string, string> = {};

    // 1. Common headers from Axios instance defaults
    const defaults = instance.defaults?.headers;
    if (defaults) {
      if (defaults.common) {
        const common = defaults.common as unknown as Record<string, unknown>;
        for (const [key, val] of Object.entries(common)) {
          if (typeof val === "string") {
            merged[key] = val;
          }
        }
      }
      if (method) {
        const methodKey = method.toLowerCase();
        const methodDefaults = (defaults as Record<string, unknown>)[methodKey] as Record<string, unknown> | undefined;
        if (methodDefaults) {
          for (const [key, val] of Object.entries(methodDefaults)) {
            if (typeof val === "string") {
              merged[key] = val;
            }
          }
        }
      }
    }

    // 2. Override with config headers
    if (configHeaders) {
      for (const [key, val] of Object.entries(configHeaders)) {
        if (val !== undefined && val !== null) {
          merged[key] = String(val);
        }
      }
    }

    return merged;
  };

  // Parse and serialize body data
  let body: BodyInit | null | undefined = undefined;
  if (config.data !== undefined) {
    if (typeof config.data === "string") {
      body = config.data;
    } else if (
      config.data instanceof FormData ||
      config.data instanceof Blob ||
      config.data instanceof ArrayBuffer
    ) {
      body = config.data;
    } else {
      body = JSON.stringify(config.data);
    }
  }

  // Define executeFetch to support retry on 401
  const executeFetch = async (isRetry = false): Promise<Response> => {
    const headers = getMergedHeaders(config.headers, config.method);

    const isJsonBody =
      config.data !== undefined &&
      typeof config.data !== "string" &&
      !(config.data instanceof FormData) &&
      !(config.data instanceof Blob) &&
      !(config.data instanceof ArrayBuffer);

    if (isJsonBody) {
      const hasContentType = Object.keys(headers).some(
        (h) => h.toLowerCase() === "content-type"
      );

      if (!hasContentType) {
        headers["Content-Type"] = "application/json";
      }
    }

    const authInstance = instance as ExtendedAxiosInstance;
    const authOptions = authInstance.__authOptions;
    const queueRefresh = authInstance.__queueRefresh;

    const mockAxiosConfig = {
      url: config.url,
      method: config.method ?? "GET",
      headers,
    };

    if (authOptions) {
      const {
        getAccessToken,
        headerName = "Authorization",
        formatToken = (t: string) => `Bearer ${t}`,
        shouldSkipAuth,
      } = authOptions;

      const skipAuth = shouldSkipAuth
        ? await shouldSkipAuth(mockAxiosConfig as any)
        : false;

      if (!skipAuth) {
        const token = await getAccessToken();
        if (token) {
          headers[headerName] = formatToken(token);
        }
      }
    }

    const absoluteUrl = getAbsoluteUrl(config.url, instance.defaults.baseURL);

    const fetchConfig: RequestInit = {
      method: config.method ?? "GET",
      headers,
      signal: internalSignal,
    };
    if (config.credentials) {
      fetchConfig.credentials = config.credentials;
    }
    if (body !== undefined) {
      fetchConfig.body = body;
    }

    const response = await fetch(absoluteUrl, fetchConfig);

    if (!response.ok) {
      // If we failed with 401 (or other status defined in shouldRefresh), refresh and retry once
      if (authOptions && queueRefresh && !isRetry) {
        const mockError = createMockAxiosError(response, mockAxiosConfig);

        const shouldRefresh = authOptions.shouldRefresh ?? defaultShouldRefresh;
        if (shouldRefresh(mockError)) {
          try {
            await queueRefresh(mockError);
            return executeFetch(true);
          } catch (refreshErr) {
            throw refreshErr;
          }
        }
      }

      const err = new Error(`Request failed with status ${response.status}`);
      (err as any).response = response;
      throw err;
    }

    return response;
  };

  try {
    const response = await executeFetch();

    if (!response.body) {
      throw new Error("Response body is not readable");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    // Close reader immediately if we get aborted during/after connection
    const cancelReader = () => {
      reader.cancel().catch(() => { });
    };
    internalSignal.addEventListener("abort", cancelReader);

    // Background reader loop
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            if (chunk) {
              config.onChunk?.(chunk);
              pushChunk(chunk);
            }
          }
        }

        const remaining = decoder.decode();
        if (remaining) {
          config.onChunk?.(remaining);
          pushChunk(remaining);
        }

        config.onComplete?.();
        pushComplete();
      } catch (err) {
        if (
          (err instanceof DOMException && err.name === "AbortError") ||
          (err instanceof Error && err.name === "AbortError") ||
          (err && (err as any).name === "AbortError")
        ) {
          pushComplete();
          return;
        }

        config.onError?.(err);
        pushError(err);
      } finally {
        cleanupSignal();
        internalSignal.removeEventListener("abort", cancelReader);

        try {
          reader.releaseLock();
        } catch {}
      }
    })();

    const controller: StreamController = {
      abort() {
        handleAbort();
      },
      get signal() {
        return internalSignal;
      },
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<string>> {
            if (chunkQueue.length > 0) {
              return { value: chunkQueue.shift()!, done: false };
            }
            if (streamError) {
              throw streamError;
            }
            if (isDone) {
              return { value: undefined as any, done: true };
            }
            return new Promise<IteratorResult<string>>((resolve, reject) => {
              pendingQueue.push({ resolve, reject });
            });
          },
          async return(): Promise<IteratorResult<string>> {
            handleAbort();
            return { value: undefined as any, done: true };
          },
        };
      },
    };

    return controller;
  } catch (error) {
    cleanupSignal();
    if (config.onError) {
      config.onError(error);
    }
    throw error;
  }
};
