import type { AxiosError, AxiosInstance } from "axios";
import type {
  AuthInterceptorOptions,
  RefreshResult,
} from "../interceptors/createAuthInterceptor";

export type AuthState = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: AuthInterceptorOptions<any>;
  queueRefresh: (error: AxiosError) => Promise<RefreshResult>;
};

type LegacyAuthInstance = AxiosInstance & {
  __authOptions?: AuthState["options"];
  __queueRefresh?: AuthState["queueRefresh"];
};

const registry = new WeakMap<AxiosInstance, AuthState>();

export const registerAuth = (instance: AxiosInstance, state: AuthState) => {
  registry.set(instance, state);

  // Deprecated: kept so code that read these private fields keeps working.
  // Will be removed in 1.0.
  const legacy = instance as LegacyAuthInstance;
  legacy.__authOptions = state.options;
  legacy.__queueRefresh = state.queueRefresh;
};

export const hasAuth = (instance: AxiosInstance): boolean =>
  registry.has(instance);
