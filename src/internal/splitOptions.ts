import type { AxiosRequestConfig } from "axios";

/**
 * Option names that belong to React Query v5 and must never be sent
 * to Axios. Anything not listed here is forwarded to Axios, which keeps
 * unknown/custom Axios keys working exactly as before.
 */
const REACT_QUERY_KEYS = new Set<string>([
  // queries
  "queryKey",
  "queryFn",
  "queryHash",
  "queryKeyHashFn",
  "enabled",
  "staleTime",
  "gcTime",
  "retry",
  "retryDelay",
  "retryOnMount",
  "select",
  "placeholderData",
  "initialData",
  "initialDataUpdatedAt",
  "refetchInterval",
  "refetchIntervalInBackground",
  "refetchOnWindowFocus",
  "refetchOnReconnect",
  "refetchOnMount",
  "networkMode",
  "meta",
  "structuralSharing",
  "throwOnError",
  "notifyOnChangeProps",
  "behavior",
  "persister",
  "subscribed",
  "maxPages",
  "experimental_prefetchInRender",
  "_defaulted",
  "_optimisticResults",
  // mutations
  "mutationKey",
  "mutationFn",
  "onMutate",
  "onSuccess",
  "onError",
  "onSettled",
  "scope",
]);

/**
 * Option names that belong to Axios and must never be sent to React Query.
 * Unknown keys are sent to both sides, as in 0.3.x.
 */
const AXIOS_KEYS = new Set<string>([
  "url",
  "method",
  "baseURL",
  "allowAbsoluteUrls",
  "params",
  "paramsSerializer",
  "data",
  "headers",
  "timeout",
  "timeoutErrorMessage",
  "withCredentials",
  "withXSRFToken",
  "xsrfCookieName",
  "xsrfHeaderName",
  "auth",
  "adapter",
  "responseType",
  "responseEncoding",
  "transformRequest",
  "transformResponse",
  "validateStatus",
  "onUploadProgress",
  "onDownloadProgress",
  "maxContentLength",
  "maxBodyLength",
  "maxRedirects",
  "maxRate",
  "beforeRedirect",
  "socketPath",
  "transport",
  "httpAgent",
  "httpsAgent",
  "proxy",
  "cancelToken",
  "signal",
  "decompress",
  "transitional",
  "env",
  "formSerializer",
  "family",
  "lookup",
  "insecureHTTPParser",
  "fetchOptions",
  "skipAuth",
]);

/**
 * True when `value` looks like a request body rather than an Axios config:
 * a non-plain object (FormData, Blob, array, …), a primitive, or a plain
 * object with none of Axios's option names.
 */
export const looksLikeRequestBody = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  if (typeof value !== "object") return true;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return true;
  const names = Object.keys(value);
  return names.length > 0 && !names.some((name) => AXIOS_KEYS.has(name));
};

export const splitOptions = (options: Record<string, unknown>) => {
  const axiosConfig: Record<string, unknown> = {};
  const reactQueryOptions: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(options)) {
    if (!REACT_QUERY_KEYS.has(name)) axiosConfig[name] = value;
    if (!AXIOS_KEYS.has(name)) reactQueryOptions[name] = value;
  }

  return {
    axiosConfig: axiosConfig as AxiosRequestConfig,
    reactQueryOptions,
  };
};
