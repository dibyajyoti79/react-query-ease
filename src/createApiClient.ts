import axios, { AxiosInstance, AxiosRequestConfig, Method } from "axios";
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createStream, StreamConfig } from "./createStream";
import { useStream, UseStreamOptions } from "./useStream";
import { splitOptions } from "./internal/splitOptions";

const normalizeKey = (key: QueryKey | string): QueryKey =>
  Array.isArray(key) ? key : [key];

// URLSearchParams hashes to `{}` in a query key, so use its string form.
const toKeyPart = (params: unknown): unknown =>
  typeof URLSearchParams !== "undefined" && params instanceof URLSearchParams
    ? params.toString()
    : params;

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

type QueryOptions<TData, TError> = Omit<
  UseQueryOptions<TData, TError, TData, QueryKey>,
  "queryKey" | "queryFn"
>;

type MutationOptions<TData, TError, TVariables> = Omit<
  UseMutationOptions<TData, TError, TVariables, unknown>,
  "mutationFn"
>;

type UseClientQueryArgs<TData, TError> = {
  key: QueryKey | string;
  /**
   * Append `params` to the query key so each set of params gets its own cache
   * entry. Overrides the client-level `paramsInKey`. Default: `true`.
   */
  paramsInKey?: boolean;
  /** Axios config merged last. Use it for keys that clash with React Query options. */
  axios?: AxiosRequestConfig;
} & AxiosRequestConfig &
  QueryOptions<TData, TError>;

type InvalidateKeys = QueryKey | string | Array<QueryKey | string>;

type UseClientMutationArgs<TData, TError, TVariables> = {
  url: string | ((variables: TVariables) => string);
  keyToInvalidate?: InvalidateKeys;
  /**
   * Build the request body from the mutation variables. When omitted, the
   * variables are sent as the body (except for GET/HEAD) unless `data` is set.
   */
  body?: (variables: TVariables) => unknown;
  /** Axios config merged last. Use it for keys that clash with React Query options. */
  axios?: AxiosRequestConfig;
} & Omit<AxiosRequestConfig, "url"> &
  MutationOptions<TData, TError, TVariables>;

const toInvalidateKeyArray = (keys?: InvalidateKeys): QueryKey[] => {
  if (!keys) {
    return [];
  }

  const list = Array.isArray(keys) ? keys : [keys];
  return list.map((key) => normalizeKey(key));
};

export type ApiClientOptions = AxiosRequestConfig & {
  configure?: (instance: AxiosInstance) => void;
  /**
   * Append `params` to query keys so each set of params gets its own cache
   * entry. Set to `false` to keep the 0.3.x behaviour. Default: `true`.
   */
  paramsInKey?: boolean;
  /**
   * Pass React Query's AbortSignal to Axios, so `cancelQueries()` and
   * unmounting abort in-flight requests. Set to `false` to keep the 0.3.x
   * behaviour. Default: `true`.
   */
  cancelable?: boolean;
};

export type SimpleApiClient = ReturnType<typeof createApiClient>;

const createRequestHelpers = (instance: AxiosInstance) => {
  const request = async <T>(config: AxiosRequestConfig): Promise<T> => {
    const response = await instance.request<T>(config);
    return response.data;
  };

  const makeMethod =
    (method: Method) =>
    <T>(url: string, config?: AxiosRequestConfig): Promise<T> =>
      request<T>({
        ...(config ?? {}),
        url,
        method,
      });

  return {
    request,
    get: makeMethod("GET"),
    post: makeMethod("POST"),
    put: makeMethod("PUT"),
    patch: makeMethod("PATCH"),
    del: makeMethod("DELETE"),
  };
};

export const createApiClient = (options: ApiClientOptions = {}) => {
  const {
    configure,
    paramsInKey: clientParamsInKey = true,
    cancelable = true,
    ...axiosConfig
  } = options;
  const instance = axios.create(axiosConfig);
  if (configure) {
    configure(instance);
  }
  const { request, get, post, put, patch, del } =
    createRequestHelpers(instance);

  const useClientQuery = <TData = unknown, TError = unknown>(
    args: UseClientQueryArgs<TData, TError>
  ) => {
    const {
      key,
      paramsInKey = clientParamsInKey,
      axios: axiosOverrides,
      ...options
    } = args;
    const { axiosConfig: requestConfig, reactQueryOptions } =
      splitOptions(options);
    const { method = "GET", ...requestRest } = requestConfig;

    const baseKey = normalizeKey(key);
    const queryKey: QueryKey =
      paramsInKey && requestConfig.params !== undefined
        ? [...baseKey, toKeyPart(requestConfig.params)]
        : baseKey;

    return useQuery<TData, TError, TData, QueryKey>({
      ...(reactQueryOptions as QueryOptions<TData, TError>),
      queryKey,
      queryFn: (context) => {
        const config: AxiosRequestConfig = {
          ...requestRest,
          method,
          ...axiosOverrides,
        };
        // Only read context.signal when cancelable: reading it is what tells
        // React Query the request can be aborted.
        if (!config.signal && cancelable && context?.signal) {
          config.signal = context.signal;
        }
        return request<TData>(config);
      },
    });
  };

  const useClientMutation = <
    TData = unknown,
    TError = unknown,
    TVariables = void,
  >(
    args: UseClientMutationArgs<TData, TError, TVariables>
  ) => {
    const queryClient = useQueryClient();
    const {
      url,
      keyToInvalidate,
      body,
      axios: axiosOverrides,
      onSuccess,
      ...options
    } = args;
    const { axiosConfig: requestConfig, reactQueryOptions } =
      splitOptions(options);
    const { method = "POST", ...requestRest } = requestConfig;
    const keysToInvalidate = toInvalidateKeyArray(keyToInvalidate);

    return useMutation<TData, TError, TVariables>({
      ...(reactQueryOptions as MutationOptions<TData, TError, TVariables>),
      mutationFn: (variables: TVariables) => {
        const finalUrl = typeof url === "function" ? url(variables) : url;
        const finalConfig: AxiosRequestConfig = {
          ...requestRest,
          url: finalUrl,
          method,
        };

        if (body) {
          finalConfig.data = body(variables);
        } else if (
          variables !== undefined &&
          finalConfig.data === undefined &&
          !BODYLESS_METHODS.has(String(method).toUpperCase())
        ) {
          // Auto-use variables as data if data wasn't provided
          finalConfig.data = variables;
        }

        return request<TData>({ ...finalConfig, ...axiosOverrides });
      },
      // Forward every callback argument as-is so this works with the
      // 3-argument (v4) and 4-argument (v5) onSuccess signatures.
      onSuccess: (async (...callbackArgs: unknown[]) => {
        if (onSuccess) {
          await (onSuccess as (...a: unknown[]) => unknown)(...callbackArgs);
        }

        if (keysToInvalidate.length > 0) {
          await Promise.all(
            keysToInvalidate.map((key) =>
              queryClient.invalidateQueries({ queryKey: key })
            )
          );
        }
      }) as MutationOptions<TData, TError, TVariables>["onSuccess"],
    });
  };

  const stream = (config: StreamConfig) => createStream(instance, config);

  return {
    instance,
    request,
    get,
    post,
    put,
    patch,
    delete: del,
    stream,
    useStream: <TVariables = unknown>(defaultConfig: UseStreamOptions) =>
      useStream<TVariables>(stream, defaultConfig),
    useQuery: useClientQuery,
    useMutation: useClientMutation,
  };
};
