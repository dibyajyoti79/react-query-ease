import {
  AxiosError,
  AxiosHeaders,
  AxiosInstance,
  InternalAxiosRequestConfig,
} from "axios";

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
};

export const createAuthInterceptor =
  <TResult extends RefreshResult = RefreshResult>(
    options: AuthInterceptorOptions<TResult>
  ) =>
  (instance: AxiosInstance) => {
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
    } = options;

    let refreshPromise: Promise<TResult> | null = null;

    const attachAccessToken = async (
      config: InternalAxiosRequestConfig
    ): Promise<InternalAxiosRequestConfig> => {
      if (shouldSkipAuth?.(config)) {
        return config;
      }

      const token = await resolveMaybePromise(getAccessToken());
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
          const result = await refreshTokens(context);
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

    instance.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const config = error.config as AuthRequestConfig | undefined;

        if (
          !config ||
          config.__isRetryRequest ||
          shouldSkipAuth?.(config) ||
          !shouldRefresh(error)
        ) {
          throw error;
        }

        config.__isRetryRequest = true;

        const tokens = await queueRefresh(error);
        ensureHeaders(config, headerName, formatToken(tokens.accessToken));
        return instance.request(config);
      }
    );
  };
