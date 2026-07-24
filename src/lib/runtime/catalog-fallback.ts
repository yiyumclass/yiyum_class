import "server-only";

export function canUseLocalCatalogFallback(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function logProductionCatalogFallbackBlocked(area: string): void {
  if (canUseLocalCatalogFallback()) return;

  console.error(
    `${area} unavailable: local catalog fallback is disabled in production.`
  );
}
