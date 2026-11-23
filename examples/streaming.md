# React Streaming Guide (`api.useStream`)

The `react-query-ease` package provides a first-class, custom React hook `api.useStream` designed for consuming real-time chunked endpoints (such as OpenAI/Anthropic SSE responses, LLM streams, or server-sent events) with zero boilerplate, full TypeScript safety, and automated state management.

---

## Why `api.useStream`?

*   **Declarative States**: Exposes standard React state variables (`data`, `isLoading`, `isStreaming`, `error`) that synchronize with your render cycle.
*   **Safe Cleanup**: Cancels the connection and releases the stream reader on unmount, even while the request is still connecting.
*   **Predictable Contract**: The returned `start()` function is strongly typed to return `Promise<StreamController>` or reject with an error, ensuring type safety.
*   **Zero-Config OAuth integration**: Automatically attaches authorization headers, triggers token refreshes on 401s, coalesces concurrent refreshes, and retries requests under the hood.

---

## API Definition

### Hook Signature

```typescript
const {
  data,
  isLoading,
  isStreaming,
  error,
  start,
  abort
} = api.useStream<TVariables = void>(config: UseStreamOptions);
```

### Options (`UseStreamOptions`)

Pass the config to the hook. It can be an inline object: `start` stays the same function across renders and uses the latest config each time it runs.

| Option | Type | Description |
| :--- | :--- | :--- |
| `url` | `string` (Required) | The endpoint path (e.g., `"/chat"`). Resolves against your client's `baseURL`. |
| `method` | `Method` | HTTP request method. Defaults to `GET`. |
| `headers` | `Record<string, string>` | Custom headers to append to the fetch request. |
| `credentials` | `RequestCredentials` | CORS credentials setting (`omit`, `same-origin`, or `include`). |
| `data` | `unknown` | Default request body. A value passed to `start(variables)` replaces it. |
| `signal` | `AbortSignal` | Your own abort signal. Aborting it stops the stream, like calling `abort()`. |
| `skipAuth` | `boolean` | Skip the auth interceptor: no token is attached and a 401 doesn't trigger a refresh. |
| `onChunk` | `(chunk: string) => void` | Event listener fired whenever a text fragment is received. |
| `onComplete` | `() => void` | Event listener fired when the stream terminates successfully. |
| `onError` | `(error: unknown) => void` | Event listener fired when a network error or connection failure occurs. |

### Return Value

*   `data`: The accumulated stream text response (string).
*   `isStreaming`: `true` from `start()` until the stream completes, fails or is aborted.
*   `isLoading`: Currently always the same as `isStreaming`. To show a "connecting" state, use `isStreaming && !data`.
*   `error`: Stored error state (if connection fails). *Note: User-initiated abort calls do not pollute the error state.*
*   `start(variables?: TVariables)`: Launches the stream. `variables` become the request body. Calling `start()` while a stream is running aborts that stream first. Its late chunks and callbacks are ignored, so they can't affect the new one. If the stream is aborted while still connecting, the returned promise rejects with an `AbortError`.
*   `abort()`: Aborts the stream, including one that is still connecting, and resets the flags. It doesn't set `error`.

---

## Production-Ready Example

Below is a complete, production-ready AI Assistant chat interface utilizing `api.useStream`:

```tsx
import React, { useState } from "react";
import { api } from "./apiClient";

interface ChatPayload {
  prompt: string;
  temperature?: number;
}

export function AIAssistant() {
  const [prompt, setPrompt] = useState("");

  const {
    data,         // Aggregated text content
    isLoading,    // Same as isStreaming
    isStreaming,  // Active streaming in progress
    error,        // Stream error (ignores abort cancellations)
    start,        // Triggers the request
    abort,        // Cancels active stream connection
  } = api.useStream<ChatPayload>({
    url: "/chat",
    method: "POST",
    onComplete() {
      console.log("Response fully generated!");
    },
    onError(err) {
      console.error("Failed to generate response:", err);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isStreaming) return;

    try {
      // Pass the payload variables directly, matching standard useMutation syntax!
      await start({
        prompt: prompt.trim(),
        temperature: 0.7,
      });
      setPrompt("");
    } catch (err) {
      // Errors (including AbortErrors) are thrown out to keep type contracts clean
      console.warn("Stream invocation stopped:", err);
    }
  };

  return (
    <div className="chat-container" style={{ padding: "20px", maxWidth: "600px" }}>
      <h3>AI Chat Assistant</h3>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
        <input
          type="text"
          value={prompt}
          placeholder="Ask me anything..."
          onChange={(e) => setPrompt(e.target.value)}
          disabled={isLoading || isStreaming}
          style={{ flexGrow: 1, padding: "8px" }}
        />
        <button type="submit" disabled={isLoading || isStreaming || !prompt.trim()}>
          Send
        </button>
        {(isLoading || isStreaming) && (
          <button type="button" onClick={abort} style={{ color: "red" }}>
            Stop Generating
          </button>
        )}
      </form>

      {/* State Indicators */}
      {isStreaming && !data && <p style={{ color: "#666" }}>Connecting to stream...</p>}
      {error && <p style={{ color: "red" }}>Error: {String(error)}</p>}

      {/* Accumulated Stream Content */}
      <div
        className="response-box"
        style={{
          border: "1px solid #ddd",
          padding: "15px",
          borderRadius: "4px",
          minHeight: "100px",
          whiteSpace: "pre-wrap",
          backgroundColor: "#f9f9f9"
        }}
      >
        {data}
      </div>
    </div>
  );
}
```

---

## Core Implementations Details

### 1. Unified Authentication Shared Concurrency
If your client uses `createAuthInterceptor`, the stream request participates in the exact same lifecycle:
*   Before calling the fetch endpoint, the hook resolves and appends the access token header.
*   If the stream receives a `401 Unauthorized`, it invokes the client's token refresh queue.
*   If multiple concurrent REST or stream requests trigger a refresh, they **coalesce** into a single refresh network request.
*   Once tokens are renewed, the stream automatically retries once and continues cleanly.

### 2. Lifespan Protection
If a user navigates away or the component unmounts mid-stream, even before the server has answered:
1. The request is aborted immediately, whether it is still connecting or already streaming.
2. The internal `ReadableStream` reader is cancelled and released.
3. Later callbacks are ignored, so no state updates happen after unmount.

The same protection applies when `start()` is called again: the previous stream is aborted, and anything it still delivers is ignored.
