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

type UseClientQueryArgs<TData, TError> = {
  key: QueryKey | string;
} & AxiosRequestConfig &
  QueryOptions<TData, TError>;

type InvalidateKeys = QueryKey | string | Array<QueryKey | string>;

type UseClientMutationArgs<TData, TError, TVariables> = {
  url: string | ((variables: TVariables) => string);
  keyToInvalidate?: InvalidateKeys;
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
    const { url, method = "GET", params, data, key, ...rest } = args;
    const queryKey = normalizeKey(key);

    return useQuery<TData, TError, TData, QueryKey>({
      queryKey,
      queryFn: () => {
        return request<TData>({
          ...rest,
          url,
          method,
          params,
          data,
        });
      },
      ...rest,
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
      method = "POST",
      data,
      params,
      keyToInvalidate,
      onSuccess,
      ...rest
    } = args;
    const keysToInvalidate = toInvalidateKeyArray(keyToInvalidate);

    return useMutation<TData, TError, TVariables>({
      mutationFn: (variables: TVariables) => {
        const finalUrl = typeof url === "function" ? url(variables) : url;
        const finalConfig: AxiosRequestConfig = {
          ...rest,
          url: finalUrl,
          method,
          params,
          data,
        };

        // Auto-use variables as data if data wasn't provided
        if (variables !== undefined && finalConfig.data === undefined) {
          finalConfig.data = variables;
        }

        return request<TData>(finalConfig);
      },
      ...rest,
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
