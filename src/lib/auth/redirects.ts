export function readFirstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeInternalNext(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }

  const pathname = value.split(/[?#]/, 1)[0]?.replace(/\/+$/, "") || "/";
  if (pathname === "/login" || pathname === "/signup" || pathname === "/auth/callback") {
    return "/";
  }

  return value;
}
