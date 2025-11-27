## Interceptors guide

Attach Axios interceptors when creating the client. The library ships with a reusable auth interceptor utility that already handles attaching tokens, coalescing refresh calls, and retrying queued requests.

```ts
import { createApiClient, createAuthInterceptor } from "react-query-ease";
import axios from "axios";

const tokenStore = {
  access: null as string | null,
  refresh: null as string | null,
};

const authInterceptor = createAuthInterceptor({
  getAccessToken: () => tokenStore.access,
  getRefreshToken: () => tokenStore.refresh,
  refreshTokens: async ({ refreshToken }) => {
    const response = await axios.post<{
      accessToken: string;
      refreshToken: string;
    }>("https://auth.example.com/refresh", {
      refresh_token: refreshToken,
    });

    tokenStore.access = response.data.accessToken;
    tokenStore.refresh = response.data.refreshToken;

    return response.data;
  },
  onRefreshFailure: () => {
    window.location.assign("/login");
  },
});

export const secureApi = createApiClient({
  baseURL: "https://api.example.com",
  configure: authInterceptor,
});
```

Need to add rate-limit headers, tenant IDs, or logging? Chain more interceptors inside the same `configure` callback before or after `createAuthInterceptor` runs.
