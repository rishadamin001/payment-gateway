import { apiError } from "@/lib/gateway";

async function proxy(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (!path.length || path.some((part) => !/^[a-zA-Z0-9_-]+$/.test(part)))
    return apiError("Invalid admin path", 400);
  const origin = request.headers.get("origin");
  if (request.method !== "GET") {
    const allowed = process.env.PAYBD_WEB_ORIGIN
      ? [process.env.PAYBD_WEB_ORIGIN]
      : ["http://localhost:3001", "http://127.0.0.1:3001"];
    try {
      if (
        !origin ||
        !allowed.includes(origin) ||
        new URL(origin).host !== request.headers.get("host") ||
        request.headers.get("sec-fetch-site") === "cross-site"
      )
        return apiError("Use the admin website to submit this request", 403);
    } catch {
      return apiError("Invalid request origin", 403);
    }
    if (
      request.headers.get("content-type")?.split(";")[0].trim() !==
      "application/json"
    )
      return apiError("JSON required", 415);
  }
  try {
    let body: string | undefined;
    if (request.method !== "GET") {
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader)
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          size += result.value.byteLength;
          if (size > 8192) {
            await reader.cancel();
            return apiError("Request too large", 413);
          }
          chunks.push(result.value);
        }
      body = Buffer.concat(chunks).toString("utf8");
      JSON.parse(body);
    }
    const cookie =
      request.headers
        .get("cookie")
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("paybd_admin_session=")) ?? "";
    const response = await fetch(
      new URL(
        `/v1/admin/${path.join("/")}${new URL(request.url).search}`,
        process.env.PAYBD_API_BASE_URL ?? "http://127.0.0.1:3000",
      ),
      {
        method: request.method,
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: origin ?? "",
        },
        body,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    const headers = new Headers({
      "Content-Type":
        response.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    });
    if (response.headers.has("set-cookie"))
      headers.set("set-cookie", response.headers.get("set-cookie")!);
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers,
    });
  } catch {
    return apiError("Admin service unavailable or invalid JSON", 503);
  }
}

export { proxy as GET, proxy as POST };
