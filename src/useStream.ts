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

  const controllerRef = useRef<StreamController | null>(null);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (controllerRef.current) {
        controllerRef.current.abort();
      }
    };
  }, []);

  const abort = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
    if (isMountedRef.current) {
      setIsStreaming(false);
      setIsLoading(false);
    }
  }, []);

  const start = useCallback(
    async (variables?: TVariables): Promise<StreamController> => {
      // Abort any existing stream before starting a new one
      if (controllerRef.current) {
        controllerRef.current.abort();
      }

      if (isMountedRef.current) {
        setData("");
        setIsLoading(true);
        setIsStreaming(true);
        setError(null);
      }

      const mergedConfig: StreamConfig = {
        ...defaultConfig,
        data: variables !== undefined ? variables : defaultConfig.data,
      };

      try {
        const controller = await streamFn({
          ...mergedConfig,
          onChunk: (chunk) => {
            if (isMountedRef.current) {
              setData((prev: string) => prev + chunk);
              mergedConfig.onChunk?.(chunk);
            }
          },
          onComplete: () => {
            controllerRef.current = null;

            if (isMountedRef.current) {
              setIsStreaming(false);
              setIsLoading(false);
              mergedConfig.onComplete?.();
            }
          },
          onError: (err) => {
            controllerRef.current = null;

            if (isAbortError(err)) {
              if (isMountedRef.current) {
                setIsStreaming(false);
                setIsLoading(false);
              }
              return;
            }

            if (isMountedRef.current) {
              setError(err);
              setIsStreaming(false);
              setIsLoading(false);
              mergedConfig.onError?.(err);
            }
          },
        });

        controllerRef.current = controller;
        return controller;
      } catch (err) {
        controllerRef.current = null;

        if (isAbortError(err)) {
          if (isMountedRef.current) {
            setIsStreaming(false);
            setIsLoading(false);
          }
          throw err;
        }

        if (isMountedRef.current) {
          setError(err);
          setIsStreaming(false);
          setIsLoading(false);
        }
        throw err;
      }
    },
    [streamFn, defaultConfig]
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
