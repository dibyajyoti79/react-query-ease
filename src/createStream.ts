import { AxiosInstance, AxiosError, Method } from "axios";

export type StreamConfig = {
  url: string;
  method?: Method;
  headers?: Record<string, string>;
  data?: unknown;
  signal?: AbortSignal;
  credentials?: RequestCredentials;
  /** Skip the auth interceptor: no token is attached and a 401 is not refreshed. */
  skipAuth?: boolean;

  onChunk?: (chunk: string) => void;
  onComplete?: () => void;
  onError?: (error: unknown) => void;
};

export type StreamController = {
  abort: () => void;
  readonly signal: AbortSignal;

  [Symbol.asyncIterator](): AsyncIterator<string>;
};

/** Maps fetch's `credentials` to the value Axios' fetch adapter passes through. */
const toWithCredentials = (credentials?: RequestCredentials) =>
  // The fetch adapter forwards a string `withCredentials` to fetch as-is.
  credentials as unknown as boolean | undefined;

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
      resolve({ value: undefined, done: true });
    }
  };

  // The request goes through the Axios instance, so baseURL, default
  // headers, XSRF handling and every interceptor (including the auth
  // interceptor's token and single-flight refresh) apply to it too. The
  // fetch adapter returns the body as a ReadableStream.
  const openStream = async (): Promise<ReadableStream<Uint8Array>> => {
    try {
      const response = await instance.request<ReadableStream<Uint8Array> | null>({
        url: config.url,
        method: config.method ?? "GET",
        headers: config.headers,
        data: config.data,
        signal: internalSignal,
        skipAuth: config.skipAuth,
        adapter: "fetch",
        responseType: "stream",
        ...(config.credentials !== undefined && {
          withCredentials: toWithCredentials(config.credentials),
        }),
      });

      if (!response.data) {
        throw new Error("Response body is not readable");
      }
      return response.data;
    } catch (error) {
      // Free the connection held by an error response's unread body.
      const body = (error as AxiosError | undefined)?.response?.data as
        | ReadableStream
        | undefined;
      body?.cancel?.().catch(() => {});

      // Keep the documented contract: an aborted stream rejects with an
      // AbortError, not Axios' CanceledError.
      if (internalSignal.aborted) {
        throw new DOMException("The stream was aborted", "AbortError");
      }
      throw error;
    }
  };

  try {
    const body = await openStream();

    const reader = body.getReader();
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
          (!!err &&
            typeof err === "object" &&
            (err as { name?: unknown }).name === "AbortError")
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
              return { value: undefined, done: true };
            }
            return new Promise<IteratorResult<string>>((resolve, reject) => {
              pendingQueue.push({ resolve, reject });
            });
          },
          async return(): Promise<IteratorResult<string>> {
            handleAbort();
            return { value: undefined, done: true };
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
