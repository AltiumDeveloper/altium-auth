/**
 * Minimal POST helpers over the global `fetch`.
 *
 * `fetch` is available in every supported runtime (Node ≥18, browsers, Bun,
 * Deno, bundlers), so no fallback transport is needed. The response body is
 * read once and buffered so callers can inspect it as both text and JSON —
 * useful for error paths that fall back from `json()` to the raw body.
 */

interface HttpResponse {
  status: number;
  text(): string;
  json<T = unknown>(): T;
}

async function post(
  endpoint: string,
  contentType: string,
  body: string,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
): Promise<HttpResponse> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": contentType, ...extraHeaders },
    body,
    signal,
  });

  const text = await res.text();
  return {
    status: res.status,
    text: () => text,
    json: <T = unknown>(): T => (text ? JSON.parse(text) : null) as T,
  };
}

/** POST a JSON body. */
export function postJson(
  endpoint: string,
  bodyObj: unknown,
  signal?: AbortSignal,
): Promise<HttpResponse> {
  return post(endpoint, "application/json", JSON.stringify(bodyObj), signal);
}

/** POST a form-encoded body, with optional extra request headers. */
export function postForm(
  endpoint: string,
  formBody: Record<string, string>,
  signal?: AbortSignal,
  headers?: Record<string, string>,
): Promise<HttpResponse> {
  return post(
    endpoint,
    "application/x-www-form-urlencoded",
    new URLSearchParams(formBody).toString(),
    signal,
    headers,
  );
}
