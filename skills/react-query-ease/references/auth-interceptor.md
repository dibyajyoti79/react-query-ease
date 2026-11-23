# createAuthInterceptor — Full Reference

Built-in utility that wires up Bearer token auth on every request, coalesces concurrent 401s into one refresh, retries queued requests with the fresh token, and handles logout on failure.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `getAccessToken` | `() => string \| null \| Promise<string \| null>` | Yes | Returns current access token |
| `getRefreshToken` | `() => string \| null \| Promise<string \| null>` | No | Returns current refresh token |
| `refreshTokens` | `(ctx: { refreshToken, error }) => Promise<{ accessToken, refreshToken? }>` | Yes | Async refresh routine; **must return `{ accessToken }`** |
| `setTokens` | `(tokens) => void \| Promise<void>` | No | Persist tokens after refresh |
| `headerName` | `string` | No | Auth header name (default: `"Authorization"`) |
| `formatToken` | `(token: string) => string` | No | Token formatter (default: `t => "Bearer " + t`) |
| `shouldSkipAuth` | `(config) => boolean` | No | Skip auth for matched endpoints |
| `shouldRefresh` | `(error) => boolean` | No | Trigger refresh on this error (default: 401) |
| `onRefreshSuccess` | `(tokens) => void \| Promise<void>` | No | Hook after successful refresh |
| `onRefreshFailure` | `(error) => void \| Promise<void>` | No | Hook after failed refresh (use for logout) |
| `refreshTimeoutMs` | `number` | No | Reject a refresh that takes longer than this (default: `30000`; `0` disables) |

**Per request:** pass `skipAuth: true` in any request config, including `api.stream()` and `useStream`, to send it without the token and without refresh-on-401.

## Production Setup

```typescript
import { createApiClient, createAuthInterceptor } from "react-query-ease";
import axios from "axios";

interface TokenStore {
  accessToken: string | null;
  refreshToken: string | null;
}

const tokens: TokenStore = {
  accessToken: localStorage.getItem("accessToken"),
  refreshToken: localStorage.getItem("refreshToken"),
};

const saveTokens = (accessToken: string, refreshToken?: string | null) => {
  tokens.accessToken = accessToken;
  localStorage.setItem("accessToken", accessToken);
  if (refreshToken) {
    tokens.refreshToken = refreshToken;
    localStorage.setItem("refreshToken", refreshToken);
  }
};

const clearTokens = () => {
  tokens.accessToken = null;
  tokens.refreshToken = null;
  localStorage.removeItem("accessToken");
  localStorage.removeItem("refreshToken");
};

const authInterceptor = createAuthInterceptor({
  getAccessToken: () => tokens.accessToken,
  getRefreshToken: () => tokens.refreshToken,

  refreshTokens: async ({ refreshToken }) => {
    // Separate axios call. To use the api client, add { skipAuth: true }
    // (see "Refreshing through the same client" below)
    const response = await axios.post<{
      accessToken: string;
      refreshToken: string;
    }>("https://auth.example.com/oauth/refresh", {
      refresh_token: refreshToken,
    });
    saveTokens(response.data.accessToken, response.data.refreshToken);
    return response.data;
  },

  headerName: "Authorization",
  formatToken: (token) => `Bearer ${token}`,

  shouldSkipAuth: (config) =>
    !!config.url &&
    ["/login", "/register", "/oauth/token"].some((p) => config.url!.includes(p)),

  shouldRefresh: (error) => error.response?.status === 401,

  onRefreshSuccess: (result) => {
    console.log("Tokens refreshed");
  },

  onRefreshFailure: (error) => {
    console.error("Refresh failed, logging out", error);
    clearTokens();
    if (typeof window !== "undefined") {
      window.location.assign("/login?session_expired=true");
    }
  },
});

export const api = createApiClient({
  baseURL: "https://api.example.com/v1",
  configure: authInterceptor,
});
```

## Refreshing through the same client

Mark the refresh request with `skipAuth: true`. Without it, a 401 from the refresh endpoint waits on the refresh already in progress (until `refreshTimeoutMs`).

```typescript
let api: ReturnType<typeof createApiClient>;

api = createApiClient({
  baseURL: "https://api.example.com/v1",
  configure: createAuthInterceptor({
    getAccessToken: () => tokens.accessToken,
    getRefreshToken: () => tokens.refreshToken,
    refreshTokens: ({ refreshToken }) =>
      api.post<{ accessToken: string; refreshToken: string }>(
        "/oauth/refresh",
        { refresh_token: refreshToken },
        { skipAuth: true }
      ),
    setTokens: ({ accessToken, refreshToken }) => saveTokens(accessToken, refreshToken),
  }),
});
```

## Chaining Multiple Interceptors

Use the `configure` callback to apply multiple interceptors in order:

```typescript
import type { AxiosInstance } from "axios";
import { createApiClient, createAuthInterceptor } from "react-query-ease";

const headerInterceptor = (instance: AxiosInstance) => {
  instance.interceptors.request.use((config) => {
    config.headers["X-Correlation-ID"] = crypto.randomUUID();
    config.headers["X-Tenant-ID"] = "tenant_12345";
    return config;
  });
};

const loggingInterceptor = (instance: AxiosInstance) => {
  instance.interceptors.request.use((config) => {
    console.log(`[REQ] ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  });
  instance.interceptors.response.use(
    (res) => {
      console.log(`[RES] ${res.status} ${res.config.url}`);
      return res;
    },
    (err) => {
      console.error(`[ERR] ${err.response?.status} ${err.config?.url}`);
      return Promise.reject(err);
    }
  );
};

export const api = createApiClient({
  baseURL: "https://api.example.com",
  configure: (instance) => {
    headerInterceptor(instance);  // 1. trace headers
    loggingInterceptor(instance); // 2. logging
    authInterceptor(instance);    // 3. auth last
  },
});
```

Apply `createAuthInterceptor` once per instance. A second registration is ignored, with a dev-mode warning.

## How Concurrency Coalescing Works

When multiple requests get a 401 simultaneously:

1. First 401 triggers a refresh; sets an in-flight promise
2. All subsequent 401s queue behind that same promise (no duplicate refresh calls)
3. Once refresh resolves, all queued requests retry with the new token
4. If refresh fails, or doesn't settle within `refreshTimeoutMs`, all queued requests reject and `onRefreshFailure` fires once

This works for both Axios requests (`useQuery`/`useMutation`) and native Fetch streaming (`useStream`).
