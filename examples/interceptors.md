## Interceptors guide

Attach Axios interceptors when creating the client. Here’s a simple access/refresh token pattern you can adapt.

```ts
import axios, { AxiosInstance } from "axios";
import { createApiClient } from "react-query-ease";

type Tokens = {
  access: string | null;
  refresh: string | null;
};

const tokenStore: Tokens = {
  access: null,
  refresh: null,
};

const refreshTokens = async () => {
  const response = await axios.post<{
    access: string;
    refresh: string;
  }>("https://auth.example.com/refresh", {
    refresh_token: tokenStore.refresh,
  });

  tokenStore.access = response.data.access;
  tokenStore.refresh = response.data.refresh;
};

const withAuthInterceptors = (instance: AxiosInstance) => {
  instance.interceptors.request.use((config) => {
    if (tokenStore.access) {
      config.headers.set("Authorization", `Bearer ${tokenStore.access}`);
    }
    return config;
  });

  instance.interceptors.response.use(
    (res) => res,
    async (error) => {
      if (error.response?.status === 401) {
        await refreshTokens();
        return instance.request(error.config);
      }
      throw error;
    }
  );
};

export const secureApi = createApiClient({
  baseURL: "https://api.example.com",
  configure: withAuthInterceptors,
});
```

You can share `withAuthInterceptors` across multiple services or extend it per service (e.g., add tenant headers, logging). The key idea: `configure(instance)` runs once per client and gives you full control over Axios interceptors.
