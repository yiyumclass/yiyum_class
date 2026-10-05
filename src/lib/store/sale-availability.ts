export function getSaleAvailability(status: string | null | undefined) {
  switch (status) {
    case "active":
      return { status, label: "판매 중", canPurchase: true };
    case "sold_out":
      return { status, label: "품절", canPurchase: false };
    case "draft":
      return { status, label: "작성 중", canPurchase: false };
    case "paused":
      return { status, label: "판매 중지", canPurchase: false };
    case "archived":
      return { status, label: "보관", canPurchase: false };
    default:
      return { status: "missing", label: "판매 준비 중", canPurchase: false };
  }
}

export function getSaleAvailabilitySummary(statuses: readonly (string | null | undefined)[]) {
  if (statuses.length > 0 && statuses.every((status) => status === "sold_out")) {
    return "all_sold_out";
  }
  const purchasableCount = statuses.filter((status) => getSaleAvailability(status).canPurchase).length;
  if (purchasableCount === 0) return "unavailable";
  return purchasableCount === statuses.length ? "available" : "mixed";
}
