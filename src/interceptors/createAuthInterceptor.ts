import {
  AxiosError,
  AxiosHeaders,
  AxiosInstance,
  InternalAxiosRequestConfig,
} from "axios";
import { registerAuth, hasAuth } from "../internal/authRegistry";
import { devWarnOnce } from "../internal/devWarn";

declare module "axios" {
  interface AxiosRequestConfig {
    /**
     * Skip the auth interceptor for this request: no token is attached and a
     * 401 will not trigger a refresh. Use it for the refresh call itself.
     */
    skipAuth?: boolean;
  }
}

type MaybePromise<T> = T | Promise<T>;

const defaultShouldRefresh = (error: AxiosError) =>
  error.response?.status === 401;

const ensureHeaders = (
  config: InternalAxiosRequestConfig,
  headerName: string,
  value: string
) => {
  if (!config.headers) {
    config.headers = new AxiosHeaders();
  }

  const headers = config.headers as AxiosHeaders & {
    [key: string]: unknown;
  };

  if (typeof headers.set === "function") {
    headers.set(headerName, value);
    return;
  }

  (config.headers as Record<string, unknown>)[headerName] = value;
};

const resolveMaybePromise = async <T>(value: MaybePromise<T>) => value;

export type RefreshContext = {
  accessToken?: string | null;
  refreshToken?: string | null;
  error: AxiosError;
};

export type RefreshResult = {
  accessToken: string;
  refreshToken?: string | null;
  [key: string]: unknown;
};

type AuthRequestConfig = InternalAxiosRequestConfig & {
  __isRetryRequest?: boolean;
  /** The access token this request was sent with (null if none). */
  __sentAccessToken?: string | null;
};

export type AuthInterceptorOptions<
  TResult extends RefreshResult = RefreshResult,
> = {
  getAccessToken: () => MaybePromise<string | null | undefined>;
  getRefreshToken?: () => MaybePromise<string | null | undefined>;
  refreshTokens: (context: RefreshContext) => Promise<TResult>;
  setTokens?: (tokens: TResult) => MaybePromise<void>;
  headerName?: string;
  formatToken?: (token: string) => string;
  shouldSkipAuth?: (config: InternalAxiosRequestConfig) => boolean;
  shouldRefresh?: (error: AxiosError) => boolean;
  onRefreshSuccess?: (tokens: TResult) => MaybePromise<void>;
  onRefreshFailure?: (error: unknown) => MaybePromise<void>;
  /**
   * Reject a pending refresh after this many milliseconds, so requests
   * waiting on it fail instead of hanging. Set to `0` to disable.
   * Default: `30000`.
   */
  refreshTimeoutMs?: number;
};

const DEFAULT_REFRESH_TIMEOUT_MS = 30_000;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  if (!(ms > 0)) return promise;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`Auth interceptor: token refresh timed out after ${ms}ms`)
      );
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
};

export const createAuthInterceptor =
  <TResult extends RefreshResult = RefreshResult>(
    options: AuthInterceptorOptions<TResult>
  ) =>
  (instance: AxiosInstance) => {
    if (hasAuth(instance)) {
      devWarnOnce(
        "auth-registered-twice",
        "createAuthInterceptor was applied to the same Axios instance more than once. The extra registration is ignored."
      );
      return;
    }

    const {
      getAccessToken,
      getRefreshToken,
      refreshTokens,
      setTokens,
      headerName = "Authorization",
      formatToken = (token: string) => `Bearer ${token}`,
      shouldSkipAuth,
      shouldRefresh = defaultShouldRefresh,
      onRefreshSuccess,
      onRefreshFailure,
      refreshTimeoutMs = DEFAULT_REFRESH_TIMEOUT_MS,
    } = options;

    const isAuthSkipped = (config: InternalAxiosRequestConfig) =>
      config.skipAuth === true || !!shouldSkipAuth?.(config);

    let refreshPromise: Promise<TResult> | null = null;

    const attachAccessToken = async (
      config: InternalAxiosRequestConfig
    ): Promise<InternalAxiosRequestConfig> => {
      if (isAuthSkipped(config)) {
        return config;
      }

      const token = await resolveMaybePromise(getAccessToken());
      (config as AuthRequestConfig).__sentAccessToken = token || null;
      if (!token) {
        return config;
      }

      ensureHeaders(config, headerName, formatToken(token));
      return config;
    };

    const queueRefresh = async (error: AxiosError) => {
      if (!refreshPromise) {
        refreshPromise = (async () => {
          const [accessToken, refreshToken] = await Promise.all([
            resolveMaybePromise(getAccessToken()),
            getRefreshToken ? resolveMaybePromise(getRefreshToken()) : null,
          ]);
          const context: RefreshContext = {
            accessToken: accessToken ?? null,
            refreshToken: refreshToken ?? null,
            error,
          };
          const result = await withTimeout(
            refreshTokens(context),
            refreshTimeoutMs
          );
          if (!result?.accessToken) {
            throw new Error(
              "Auth interceptor: refreshTokens resolved without an access token"
            );
          }

          await setTokens?.(result);
          await onRefreshSuccess?.(result);
          return result;
        })()
          .catch(async (refreshError) => {
            await onRefreshFailure?.(refreshError);
            throw refreshError;
          })
          .finally(() => {
            refreshPromise = null;
          });
      }

      return refreshPromise;
    };

    instance.interceptors.request.use(attachAccessToken);

    registerAuth(instance, { options, queueRefresh });

    instance.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const config = error.config as AuthRequestConfig | undefined;

        if (
          !config ||
          config.__isRetryRequest ||
          isAuthSkipped(config) ||
          !shouldRefresh(error)
        ) {
          throw error;
        }

        config.__isRetryRequest = true;

        // Stale 401: the request went out with a token that has since been
        // replaced (another request's refresh finished first). Retry with the
        // current token instead of refreshing again, which would needlessly
        // spend a rotating refresh token.
        if (!refreshPromise) {
          const currentToken = await resolveMaybePromise(getAccessToken());
          if (currentToken && currentToken !== config.__sentAccessToken) {
            return instance.request(config);
          }
        }

        const tokens = await queueRefresh(error);
        ensureHeaders(config, headerName, formatToken(tokens.accessToken));
        return instance.request(config);
      }
    );
  };
