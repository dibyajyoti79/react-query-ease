# Reusable Authentication & Custom Interceptors

This guide details how to configure production-grade request/response interceptors using `react-query-ease`, including the built-in auth token attachment, token refreshing with concurrency coalescing, and combining custom interceptors.

---

## 1. Production Auth Interceptor Setup

The package ships with a built-in `createAuthInterceptor` utility that handles:
1. Attaching authorization headers to outgoing Axios and native Fetch streaming requests.
2. Intercepting `401 Unauthorized` errors.
3. Coalescing concurrent 401s into a single token refresh promise (preventing multiple duplicate token refreshes).
4. Retrying all queued pending requests once the token is successfully refreshed.

Here is a complete, production-ready setup:

```typescript
import { createApiClient, createAuthInterceptor } from "react-query-ease";
import axios from "axios";

// Standard production token store interface
interface TokenStore {
  accessToken: string | null;
  refreshToken: string | null;
}

const tokens: TokenStore = {
  accessToken: localStorage.getItem("accessToken"),
  refreshToken: localStorage.getItem("refreshToken"),
};

// Update local state and disk storage
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

// Create the unified auth interceptor
const authInterceptor = createAuthInterceptor({
  // 1. Return the current access token
  getAccessToken: () => tokens.accessToken,
  
  // 2. Return the current refresh token
  getRefreshToken: () => tokens.refreshToken,
  
  // 3. Define the async token refresh routine
  refreshTokens: async ({ refreshToken, error }) => {
    try {
      // Use raw Axios or Fetch to avoid recursion through the main client
      const response = await axios.post<{
        accessToken: string;
        refreshToken: string;
      }>("https://auth.example.com/oauth/refresh", {
        refresh_token: refreshToken,
      });

      const data = response.data;
      saveTokens(data.accessToken, data.refreshToken);

      return data; // Must return { accessToken, refreshToken }
    } catch (refreshError) {
      // Propagation of error to the failure callback
      throw refreshError;
    }
  },

  // 4. Token header details
  headerName: "Authorization",
  formatToken: (token: string) => `Bearer ${token}`,

  // 5. Skip authentication for auth endpoints (e.g. login, sign-up)
  shouldSkipAuth: (config) => {
    return !!config.url && ["/login", "/register", "/oauth/token"].some((path) => config.url!.includes(path));
  },

  // 6. Define check to see if an error should trigger token refresh
  shouldRefresh: (error) => {
    return error.response?.status === 401;
  },

  // 7. Hooks for refresh outcomes
  onRefreshSuccess: (result) => {
    console.log("Tokens successfully refreshed!");
  },

  onRefreshFailure: (error) => {
    console.error("Token refresh failed. Redirecting to login...", error);
    clearTokens();
    
    // Redirect to login page in browser environments
    if (typeof window !== "undefined") {
      window.location.assign("/login?session_expired=true");
    }
  },
});

// Configure the client
export const secureApi = createApiClient({
  baseURL: "https://api.example.com/v1",
  configure: authInterceptor,
});
```

---

## 2. Chaining Multiple Custom Interceptors

In production, you often need to perform tasks like:
*   Adding correlation/request IDs (tracing).
*   Appending custom headers (e.g., API keys, user session identifiers).
*   Logging requests/responses for metrics.

You can chain interceptors inside the `configure` callback function:

```typescript
import { createApiClient } from "react-query-ease";

// Interceptor 1: Appends tracing and tenant headers
const headerInterceptor = (instance: any) => {
  instance.interceptors.request.use((config: any) => {
    config.headers["X-Correlation-ID"] = crypto.randomUUID();
    config.headers["X-Tenant-ID"] = "tenant_12345";
    return config;
  });
};

// Interceptor 2: Debug log logger
const loggingInterceptor = (instance: any) => {
  instance.interceptors.request.use((config: any) => {
    console.log(`[API Request] [${config.method?.toUpperCase()}] ${config.url}`);
    return config;
  }, (error: any) => Promise.reject(error));

  instance.interceptors.response.use((response: any) => {
    console.log(`[API Response] Success [${response.status}] from ${response.config.url}`);
    return response;
  }, (error: any) => {
    console.error(`[API Error] [${error.response?.status || "Network Error"}] on ${error.config?.url}`);
    return Promise.reject(error);
  });
};

// Chain both along with the auth interceptor
export const client = createApiClient({
  baseURL: "https://api.example.com",
  configure: (instance) => {
    // 1. Apply tracing headers
    headerInterceptor(instance);

    // 2. Apply logging
    loggingInterceptor(instance);

    // 3. Apply authorization interceptor
    authInterceptor(instance);
  },
});
```
