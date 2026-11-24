# useStream — Full Reference

`api.useStream` is a React hook for consuming chunked/streaming endpoints (LLMs, SSE, OpenAI-style responses). It handles state management, auth token attachment + refresh, and safe cleanup on unmount.

## Hook Signature

```typescript
const result = api.useStream<TVariables = void>(config: UseStreamOptions);
```

## Options (`UseStreamOptions`)

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `url` | `string` | Yes | Endpoint path; resolved against client `baseURL` |
| `method` | `string` | No | HTTP method (default: `"GET"`) |
| `headers` | `Record<string, string>` | No | Custom headers for the fetch request |
| `credentials` | `RequestCredentials` | No | CORS credentials (`omit`, `same-origin`, `include`) |
| `data` | `unknown` | No | Default request body; a value passed to `start(variables)` replaces it |
| `signal` | `AbortSignal` | No | Your own abort signal; aborting it stops the stream |
| `skipAuth` | `boolean` | No | Skip the auth interceptor (no token, no refresh on 401) |
| `onChunk` | `(chunk: string) => void` | No | Called for each received text fragment |
| `onComplete` | `() => void` | No | Called when stream terminates successfully |
| `onError` | `(error: unknown) => void` | No | Called on connection/network error |

## Return Values

| Value | Type | Description |
|-------|------|-------------|
| `data` | `string` | Accumulated text from all chunks received so far |
| `isStreaming` | `boolean` | `true` from `start()` until the stream completes, fails or is aborted |
| `isLoading` | `boolean` | Currently always equal to `isStreaming`. For a "connecting" state use `isStreaming && !data` |
| `error` | `unknown \| null` | Connection error state — **not set on user-initiated abort** |
| `start` | `(variables?: TVariables) => Promise<StreamController>` | Launch the stream; `variables` become the body. Same function on every render, and it reads the latest config. Calling it again aborts the running stream, whose late callbacks are ignored. Rejects with `AbortError` if aborted while connecting |
| `abort` | `() => void` | Cancel the stream (also while still connecting) and reset flags; never sets `error` |

## Production Example — AI Chat

```tsx
import { useState } from "react";
import { api } from "./config/apiClients";

interface ChatPayload {
  prompt: string;
  temperature?: number;
}

export function AIAssistant() {
  const [prompt, setPrompt] = useState("");

  const { data, isLoading, isStreaming, error, start, abort } =
    api.useStream<ChatPayload>({
      url: "/chat",
      method: "POST",
      onComplete: () => console.log("Done generating"),
      onError: (err) => console.error("Stream error:", err),
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isStreaming) return;
    try {
      await start({ prompt: prompt.trim(), temperature: 0.7 });
      setPrompt("");
    } catch (err) {
      console.warn("Stream stopped:", err);
    }
  };

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={isLoading || isStreaming}
          placeholder="Ask anything..."
        />
        <button type="submit" disabled={isLoading || isStreaming || !prompt.trim()}>
          Send
        </button>
        {(isLoading || isStreaming) && (
          <button type="button" onClick={abort}>Stop</button>
        )}
      </form>

      {isStreaming && !data && <p>Connecting...</p>}
      {error && <p style={{ color: "red" }}>{String(error)}</p>}
      <pre style={{ whiteSpace: "pre-wrap" }}>{data}</pre>
    </div>
  );
}
```

## Lower-Level: `api.stream` (async iterator)

For non-React code or manual control:

```typescript
const controller = await api.stream({
  url: "/chat",
  method: "POST",
  data: { prompt: "Hello" },
});

// Async iteration
for await (const chunk of controller) {
  process.stdout.write(chunk);
}

// Or manual abort
setTimeout(() => controller.abort(), 5000);
```

`StreamController` interface:
- `abort(): void` — cancel the stream
- `signal: AbortSignal` — standard Web API abort signal
- `[Symbol.asyncIterator]()` — iterate chunks as strings

## Auth Integration

If the client uses `createAuthInterceptor`, `useStream` participates in the same refresh lifecycle:

1. Before fetch, the hook resolves and attaches the access token header
2. If the stream endpoint returns 401, the auth interceptor's refresh queue is invoked
3. Concurrent refresh requests from other queries coalesce — one network call refreshes all
4. Stream retries once with the new token automatically

## Safe Cleanup

On component unmount, whether still connecting or mid-stream:
1. The fetch is aborted via `AbortController`
2. The `ReadableStream` reader is cancelled and released
3. Later callbacks are ignored, so no state updates happen after unmount

Calling `start()` again gets the same treatment: the previous stream is aborted and its leftovers are ignored.
