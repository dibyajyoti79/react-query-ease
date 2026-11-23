import React from "react";
import {
  AxiosAdapter,
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export type MockReply = { status?: number; data?: unknown };
export type MockHandler = (
  config: InternalAxiosRequestConfig
) => MockReply | Promise<MockReply>;

/** Axios adapter that records every request and answers via `handler`. */
export const createMockAdapter = (handler: MockHandler) => {
  const calls: InternalAxiosRequestConfig[] = [];

  const adapter: AxiosAdapter = async (config) => {
    calls.push(config);
    const { status = 200, data = null } = await handler(config);
    const response: AxiosResponse = {
      data,
      status,
      statusText: String(status),
      headers: {},
      config,
    };
    if (status >= 400) {
      throw new AxiosError(
        `Request failed with status code ${status}`,
        AxiosError.ERR_BAD_REQUEST,
        config,
        null,
        response
      );
    }
    return response;
  };

  return { adapter, calls };
};

/** Never settles until the request's signal aborts. */
export const waitForAbort = (config: InternalAxiosRequestConfig) =>
  new Promise<MockReply>((_, reject) => {
    const signal = config.signal as AbortSignal | undefined;
    signal?.addEventListener?.("abort", () =>
      reject(new AxiosError("canceled", AxiosError.ERR_CANCELED, config))
    );
  });

export const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
};

export const header = (
  config: InternalAxiosRequestConfig,
  name: string
): unknown => config.headers?.get?.(name) ?? config.headers?.[name];
