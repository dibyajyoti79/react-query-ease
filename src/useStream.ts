import { useState, useCallback, useRef, useEffect } from "react";
import { StreamConfig, StreamController } from "./createStream";

export type UseStreamOptions = Omit<StreamConfig, "url" | "onChunk" | "onComplete" | "onError"> & {
  url: string;
  onChunk?: (chunk: string) => void;
  onComplete?: () => void;
  onError?: (error: unknown) => void;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error
      ? error.name === "AbortError"
      : !!error &&
        typeof error === "object" &&
        "name" in error &&
        (error as { name?: string }).name === "AbortError";

export const useStream = <TVariables = unknown>(
  streamFn: (config: StreamConfig) => Promise<StreamController>,
  defaultConfig: UseStreamOptions
) => {
  const [data, setData] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [error, setError] = useState<unknown | null>(null);

  // Latest config, read when start() runs. This keeps `start` stable even
  // when the config is an inline object that changes on every render.
  const configRef = useRef(defaultConfig);
  configRef.current = defaultConfig;

  // Each start() call is a "run". Callbacks from an older run are ignored, so
  // a stream that was replaced can't overwrite the state of the new one.
  const runIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  const abort = useCallback(() => {
    // Aborting works during the connect phase too, since the signal is
    // passed to fetch before the stream controller exists.
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (isMountedRef.current) {
      setIsStreaming(false);
      setIsLoading(false);
    }
  }, []);

  const start = useCallback(
    async (variables?: TVariables): Promise<StreamController> => {
      // Abort any existing stream before starting a new one
      abortControllerRef.current?.abort();

      const runId = ++runIdRef.current;
      const isCurrent = () =>
        isMountedRef.current && runIdRef.current === runId;

      const config = configRef.current;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Keep honouring a signal passed in the config.
      const userSignal = config.signal;
      if (userSignal) {
        if (userSignal.aborted) {
          abortController.abort();
        } else {
          userSignal.addEventListener("abort", () => abortController.abort(), {
            once: true,
          });
        }
      }

      const finish = () => {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
        setIsStreaming(false);
        setIsLoading(false);
      };

      setData("");
      setIsLoading(true);
      setIsStreaming(true);
      setError(null);

      try {
        return await streamFn({
          ...config,
          data: variables !== undefined ? variables : config.data,
          signal: abortController.signal,
          onChunk: (chunk) => {
            if (!isCurrent()) return;
            setData((prev: string) => prev + chunk);
            config.onChunk?.(chunk);
          },
          onComplete: () => {
            if (!isCurrent()) return;
            finish();
            config.onComplete?.();
          },
          onError: (err) => {
            if (!isCurrent()) return;
            finish();
            if (isAbortError(err)) return;
            setError(err);
            config.onError?.(err);
          },
        });
      } catch (err) {
        if (isCurrent()) {
          finish();
          if (!isAbortError(err)) {
            setError(err);
          }
        }
        throw err;
      }
    },
    [streamFn]
  );

  return {
    data,
    isLoading,
    isStreaming,
    error,
    start,
    abort,
  };
};
