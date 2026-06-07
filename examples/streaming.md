# Native Streaming Guide (`api.stream`)

The `react-query-ease` package provides a first-class, native `fetch`-based streaming API (`api.stream`) designed for consuming high-performance, real-time chunked endpoints (such as OpenAI/Anthropic SSE responses, LLM tokens, or live event streams).

---

## Why Native Fetch?

While `react-query-ease` uses Axios for standard REST requests, Axios' support for streaming in the browser environment is limited and heavy. Native `fetch` coupled with the `ReadableStream` reader and `TextDecoder` APIs provides a lightweight, memory-safe, and highly performant implementation for client-side streaming.

---

## API Definition

### `StreamConfig`

```typescript
export type StreamConfig = {
  url: string;
  method?: Method;
  headers?: Record<string, string>;
  data?: unknown;
  signal?: AbortSignal;
  credentials?: RequestCredentials;

  onChunk?: (chunk: string) => void;
  onComplete?: () => void;
  onError?: (error: unknown) => void;
};
```

### `StreamController`

The returned stream controller allows you to control the stream and async iterate over the incoming chunks.

```typescript
export type StreamController = {
  abort: () => void;
  readonly signal: AbortSignal;

  [Symbol.asyncIterator](): AsyncIterator<string>;
};
```

---

## Examples of Usage

### 1. Callback-Based API (Simple AI Chat Response)

This is the easiest way to consume a stream by binding callbacks.

```tsx
import React, { useState } from "react";
import { api } from "./apiClient";

function ChatComponent() {
  const [input, setInput] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setResponse("");
    setLoading(true);

    try {
      const stream = await api.stream({
        url: "/chat",
        method: "POST",
        data: { message: input },
        onChunk(chunk) {
          setResponse((prev) => prev + chunk);
        },
        onComplete() {
          setLoading(false);
          console.log("Stream completed successfully!");
        },
        onError(error) {
          setLoading(false);
          console.error("Stream failed:", error);
        },
      });
    } catch (error) {
      setLoading(false);
      console.error("Connection failed:", error);
    }
  };

  return (
    <div>
      <textarea value={input} onChange={(e) => setInput(e.target.value)} />
      <button onClick={handleSubmit} disabled={loading}>Send</button>
      <p>{response}</p>
    </div>
  );
}
```

---

### 2. Async Iteration (Senior Level)

You can consume chunks using `for await` which allows writing cleaner, procedural streaming code.

```typescript
const stream = await api.stream({
  url: "/chat",
  method: "POST",
  data: { prompt: "Explain React Query in depth" }
});

try {
  for await (const chunk of stream) {
    console.log("Chunk received:", chunk);
  }
  console.log("Stream successfully completed!");
} catch (error) {
  console.error("Stream encountered an error:", error);
}
```

---

### 3. Aborting the Stream (Early Exit)

To cancel the stream (e.g. if the user clicks "Stop Generating"), call `stream.abort()`.

```typescript
const stream = await api.stream({
  url: "/long-running-stream",
});

// Cancel the stream after 2 seconds
setTimeout(() => {
  console.log("Aborting stream...");
  stream.abort();
}, 2000);
```

> [!NOTE]
> When `stream.abort()` is called, it cancels the internal `ReadableStream` reader, releases locks, cleans up all listeners, and completes the async iterator cleanly without triggering the `onError` hook.

---

### 4. Shared Authentication Integration

If you have configured `createAuthInterceptor` when setting up `createApiClient`, `api.stream` will automatically detect it:
* It will attach the access token to the Authorization header before executing the fetch.
* If the server returns a `401 Unauthorized` status, it will trigger the token refresh promise.
* If a token refresh is already in progress from another Axios or streaming request, `api.stream` coalesces and awaits the exact same promise to avoid duplicate network calls.
* Once the token is successfully refreshed, it retries the stream request once and continues.

All of this happens under the hood with zero configuration!
