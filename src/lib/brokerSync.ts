/**
 * Future read-only brokerage adapter. Bookkeeping remains manual in this version.
 * An adapter may read confirmed fills; it must never place orders or transfer funds.
 */
export interface ConfirmedInstitutionFill {
  provider: string;
  externalAccountId: string;
  externalExecutionId: string;
  batchId: string;
  roundId: string;
  clientId?: string;
  symbol: string;
  currency: "USD";
  side: "BUY";
  amount: number;
  shares: number;
  price: number;
  fees: number;
  executedAt: string;
}

export interface BrokerReadOnlyAdapter {
  readonly provider: string;
  fetchConfirmedInstitutionFills(input: {
    externalAccountId: string;
    cursor?: string;
    signal?: AbortSignal;
  }): Promise<{ fills: ConfirmedInstitutionFill[]; nextCursor?: string }>;
}

export function institutionFillIdentity(fill: ConfirmedInstitutionFill): string {
  if (![fill.provider, fill.externalAccountId, fill.externalExecutionId].every((v) => v.trim())) {
    throw new Error("券商成交身份信息不完整。");
  }
  return JSON.stringify([fill.provider, fill.externalAccountId, fill.externalExecutionId]);
}

// No adapter is registered or invoked by the current product.
export const BROKER_SYNC_ENABLED = false;
