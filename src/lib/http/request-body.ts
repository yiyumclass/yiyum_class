export type LimitedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 | 415; code: "INVALID_JSON" | "BODY_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE" };

export async function readLimitedJson(
  request: Request,
  options: { limitBytes: number; requireJsonContentType?: boolean }
): Promise<LimitedJsonResult> {
  if (options.requireJsonContentType !== false && !isJsonContentType(request.headers.get("content-type"))) {
    return { ok: false, status: 415, code: "UNSUPPORTED_MEDIA_TYPE" };
  }

  const body = request.body;
  if (!body) {
    return { ok: false, status: 400, code: "INVALID_JSON" };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytesRead += value.byteLength;
      if (bytesRead > options.limitBytes) {
        await reader.cancel();
        return { ok: false, status: 413, code: "BODY_TOO_LARGE" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, code: "INVALID_JSON" };
  }

  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, status: 400, code: "INVALID_JSON" };
  }
}

export function isJsonContentType(contentType: string | null) {
  if (!contentType) return false;
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json");
}
