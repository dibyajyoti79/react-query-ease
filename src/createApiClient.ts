import axios, { AxiosInstance, AxiosRequestConfig, Method } from "axios";
import {
  DefaultError,
  QueryFunction,
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createStream, StreamConfig } from "./createStream";
import { useStream, UseStreamOptions } from "./useStream";
import { looksLikeRequestBody, splitOptions } from "./internal/splitOptions";
import { devWarnOnce } from "./internal/devWarn";

const normalizeKey = (key: QueryKey | string): QueryKey =>
  Array.isArray(key) ? key : [key];

// URLSearchParams hashes to `{}` in a query key, so use its string form.
const toKeyPart = (params: unknown): unknown =>
  typeof URLSearchParams !== "undefined" && params instanceof URLSearchParams
    ? params.toString()
    : params;

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

type QueryOptions<TData, TError, TSelected = TData> = Omit<
  UseQueryOptions<TData, TError, TSelected, QueryKey>,
  "queryKey" | "queryFn"
>;

/**
 * The `{ queryKey, queryFn, ...options }` object `api.useQuery` builds. Pass it
 * to any TanStack API: `useQuery`, `useSuspenseQuery`, `useQueries`,
 * `queryClient.prefetchQuery` / `fetchQuery` / `ensureQueryData`, and use its
 * `queryKey` with `getQueryData` / `setQueryData`.
 */
export type ApiQueryOptions<TData, TError, TSelected = TData> = UseQueryOptions<
  TData,
  TError,
  TSelected,
  QueryKey
> & {
  queryKey: QueryKey;
  queryFn: QueryFunction<TData, QueryKey>;
};

type MutationOptions<TData, TError, TVariables> = Omit<
  UseMutationOptions<TData, TError, TVariables, unknown>,
  "mutationFn"
>;

export type ApiQueryArgs<TData, TError, TSelected = TData> = {
  key: QueryKey | string;
  /**
   * Append `params` to the query key so each set of params gets its own cache
   * entry. Overrides the client-level `paramsInKey`. Default: `true`.
   */
  paramsInKey?: boolean;
  /** Axios config merged last. Use it for keys that clash with React Query options. */
  axios?: AxiosRequestConfig;
} & AxiosRequestConfig &
  QueryOptions<TData, TError, TSelected>;

export type InvalidateKeys = QueryKey | string | Array<QueryKey | string>;

export type ApiMutationArgs<TData, TError, TVariables> = {
  url: string | ((variables: TVariables) => string);
  /**
   * Queries to invalidate after a successful mutation. Pass a function to
   * build the keys from the response and the variables, e.g.
   * `(todo, vars) => [["todos"], ["todos", vars.id]]`.
   */
  keyToInvalidate?:
    | InvalidateKeys
    | ((data: TData, variables: TVariables) => InvalidateKeys | undefined);
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

/** Request helper without a body: `get(url, config)`, `delete(url, config)`. */
export type RequestMethod = <T = unknown>(
  url: string,
  config?: AxiosRequestConfig
) => Promise<T>;

/**
 * Request helper with a body: `post`, `put`, `patch`. Accepts both forms:
 * - `(url, config)`: put the body in `config.data` (the 0.3.x form)
 * - `(url, data, config)`: the Axios form
 */
export type BodyRequestMethod = {
  <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>;
  <T = unknown>(
    url: string,
    data: unknown,
    config: AxiosRequestConfig | undefined
  ): Promise<T>;
};


const createRequestHelpers = (instance: AxiosInstance) => {
  const request = async <T>(config: AxiosRequestConfig): Promise<T> => {
    const response = await instance.request<T>(config);
    return response.data;
  };

  const makeMethod =
    (method: Method): RequestMethod =>
    <T>(url: string, config?: AxiosRequestConfig): Promise<T> =>
      request<T>({
        ...config,
        url,
        method,
      });

  const makeBodyMethod = (method: Method): BodyRequestMethod =>
    (<T>(url: string, ...rest: unknown[]): Promise<T> => {
      // Three arguments: the Axios form (url, data, config).
      if (rest.length >= 2) {
        const [data, config] = rest as [unknown, AxiosRequestConfig | undefined];
        return request<T>({ ...config, data, url, method });
      }

      // Two arguments: (url, config), unchanged from 0.3.x.
      const config = rest[0] as AxiosRequestConfig | undefined;
      if (looksLikeRequestBody(config)) {
        devWarnOnce(
          `body-as-config-${method}`,
          `api.${method.toLowerCase()}(url, config) takes a config object as its second argument, but it looks like a request body, so it will not be sent. Use api.${method.toLowerCase()}(url, { data }) or api.${method.toLowerCase()}(url, data, config).`
        );
      }
      return request<T>({ ...config, url, method });
    }) as BodyRequestMethod;

  return {
    request,
    get: makeMethod("GET"),
    post: makeBodyMethod("POST"),
    put: makeBodyMethod("PUT"),
    patch: makeBodyMethod("PATCH"),
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

  const queryOptions = <
    TData = unknown,
    TError = DefaultError,
    TSelected = TData,
  >(
    args: ApiQueryArgs<TData, TError, TSelected>
  ): ApiQueryOptions<TData, TError, TSelected> => {
    const {
      key,
      paramsInKey = clientParamsInKey,
      axios: axiosOverrides,
      ...rest
    } = args;
    const { axiosConfig: requestConfig, reactQueryOptions } =
      splitOptions(rest);
    const { method = "GET", ...requestRest } = requestConfig;

    const baseKey = normalizeKey(key);
    const queryKey: QueryKey =
      paramsInKey && requestConfig.params !== undefined
        ? [...baseKey, toKeyPart(requestConfig.params)]
        : baseKey;

    const queryFn: QueryFunction<TData, QueryKey> = (context) => {
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
    };

    return {
      ...(reactQueryOptions as QueryOptions<TData, TError, TSelected>),
      queryKey,
      queryFn,
    };
  };

  const useClientQuery = <
    TData = unknown,
    TError = DefaultError,
    TSelected = TData,
  >(
    args: ApiQueryArgs<TData, TError, TSelected>
  ) =>
    useQuery<TData, TError, TSelected, QueryKey>(
      queryOptions<TData, TError, TSelected>(args)
    );

  const useClientMutation = <
    TData = unknown,
    TError = DefaultError,
    TVariables = void,
  >(
    args: ApiMutationArgs<TData, TError, TVariables>
  ) => {
    const queryClient = useQueryClient();
    const {
      url,
      keyToInvalidate,
      body,
      axios: axiosOverrides,
      onSuccess,
      ...rest
    } = args;
    const { axiosConfig: requestConfig, reactQueryOptions } =
      splitOptions(rest);
    const { method = "POST", ...requestRest } = requestConfig;

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
      // Forward every callback argument as-is: the arguments after
      // (data, variables) differ between v5 minor versions.
      onSuccess: (async (...callbackArgs: unknown[]) => {
        if (onSuccess) {
          await (onSuccess as (...a: unknown[]) => unknown)(...callbackArgs);
        }

        const [data, variables] = callbackArgs as [TData, TVariables];
        const keysToInvalidate = toInvalidateKeyArray(
          typeof keyToInvalidate === "function"
            ? keyToInvalidate(data, variables)
            : keyToInvalidate
        );
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
    queryOptions,
    useQuery: useClientQuery,
    useMutation: useClientMutation,
  };
};
