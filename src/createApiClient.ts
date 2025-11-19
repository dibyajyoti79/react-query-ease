import axios, { AxiosInstance, AxiosRequestConfig, Method } from "axios";
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

const normalizeKey = (key: QueryKey | string): QueryKey =>
  Array.isArray(key) ? key : [key];

type QueryOptions<TData, TError> = Omit<
  UseQueryOptions<TData, TError, TData, QueryKey>,
  "queryKey" | "queryFn"
>;

type MutationOptions<TData, TError, TVariables> = Omit<
  UseMutationOptions<TData, TError, TVariables, unknown>,
  "mutationFn"
>;

type QueryConfigFactory =
  | AxiosRequestConfig
  | (() => AxiosRequestConfig)
  | undefined;

type MutationConfigFactory<TVariables> =
  | AxiosRequestConfig
  | ((variables: TVariables) => AxiosRequestConfig)
  | undefined;

type UseClientQueryArgs<TData, TError> = {
  endpoint: string;
  method?: Method;
  key: QueryKey | string;
  config?: QueryConfigFactory;
  options?: QueryOptions<TData, TError>;
};

type InvalidateKeys = QueryKey | string | Array<QueryKey | string>;

type UseClientMutationArgs<TData, TError, TVariables> = {
  endpoint: string;
  method?: Method;
  config?: MutationConfigFactory<TVariables>;
  options?: MutationOptions<TData, TError, TVariables>;
  invalidateKeys?: InvalidateKeys;
};

const resolveQueryConfig = (config?: QueryConfigFactory) => {
  if (typeof config === "function") {
    return config();
  }
  return config;
};

const resolveMutationConfig = <TVariables>(
  config: MutationConfigFactory<TVariables>,
  variables: TVariables
) => {
  if (typeof config === "function") {
    return config(variables);
  }
  return config;
};

const toInvalidateKeyArray = (keys?: InvalidateKeys): QueryKey[] => {
  if (!keys) {
    return [];
  }

  const list = Array.isArray(keys) ? keys : [keys];
  return list.map((key) => normalizeKey(key));
};

export type ApiClientOptions = AxiosRequestConfig & {
  configure?: (instance: AxiosInstance) => void;
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
  const { configure, ...axiosConfig } = options;
  const instance = axios.create(axiosConfig);
  if (configure) {
    configure(instance);
  }
  const { request, get, post, put, patch, del } =
    createRequestHelpers(instance);

  const useClientQuery = <TData = unknown, TError = unknown>(
    args: UseClientQueryArgs<TData, TError>
  ) => {
    const { endpoint, method = "GET", key, config, options } = args;
    const queryKey = normalizeKey(key);

    return useQuery<TData, TError, TData, QueryKey>({
      queryKey,
      queryFn: () => {
        const resolved = resolveQueryConfig(config) ?? {};
        return request<TData>({
          ...resolved,
          url: resolved.url ?? endpoint,
          method: (resolved.method as Method | undefined) ?? method,
        });
      },
      ...(options ?? {}),
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
    const { endpoint, method = "POST", config, options, invalidateKeys } = args;
    const keysToInvalidate = toInvalidateKeyArray(invalidateKeys);
    const { onSuccess, ...restOptions } = options ?? {};

    return useMutation<TData, TError, TVariables>({
      mutationFn: (variables: TVariables) => {
        const resolved = resolveMutationConfig(config, variables) ?? {};
        const finalConfig: AxiosRequestConfig = {
          ...resolved,
          url: resolved.url ?? endpoint,
          method: (resolved.method as Method | undefined) ?? method,
        };

        if (variables !== undefined && finalConfig.data === undefined) {
          finalConfig.data = variables;
        }

        return request<TData>(finalConfig);
      },
      ...restOptions,
      onSuccess: async (data, variables, context, mutation) => {
        if (onSuccess) {
          await onSuccess(data, variables, context, mutation);
        }

        if (keysToInvalidate.length > 0) {
          await Promise.all(
            keysToInvalidate.map((key) =>
              queryClient.invalidateQueries({ queryKey: key })
            )
          );
        }
      },
    });
  };

  return {
    instance,
    request,
    get,
    post,
    put,
    patch,
    delete: del,
    useQuery: useClientQuery,
    useMutation: useClientMutation,
  };
};
