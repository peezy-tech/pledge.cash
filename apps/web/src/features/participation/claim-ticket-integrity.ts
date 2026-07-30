export type ClaimTicketVerificationSource = {
  account: `0x${string}` | undefined;
  airdrop: `0x${string}` | undefined;
  chainId: number;
  expectedFacetSetHash: `0x${string}` | undefined;
  merkleRoot: `0x${string}` | undefined;
  rawTicket: string;
};

export type ClaimTicketVerificationRequest = {
  generation: number;
  sourceIdentity: string;
};

export type BoundClaimTicketVerificationRequest = ClaimTicketVerificationRequest & {
  loadedIdentity: string;
};

export function claimTicketVerificationSourceIdentity(input: ClaimTicketVerificationSource): string {
  return JSON.stringify([
    input.rawTicket,
    input.chainId,
    input.account?.toLowerCase() ?? "wallet-disconnected",
    input.airdrop?.toLowerCase() ?? "airdrop-unavailable",
    input.expectedFacetSetHash?.toLowerCase() ?? "release-unavailable",
    input.merkleRoot?.toLowerCase() ?? "root-unavailable",
  ]);
}

/**
 * Coordinates asynchronous claim-ticket verification and its loaded form.
 *
 * Each request receives a monotonically increasing generation so an older
 * request cannot become current again. A completed verification remains valid
 * only for the exact source context and exact allocation/grant fields it loaded.
 */
export class ClaimTicketVerificationGuard {
  #generation = 0;
  #sourceIdentity: string;
  #verified: BoundClaimTicketVerificationRequest | undefined;

  constructor(sourceIdentity: string) {
    this.#sourceIdentity = sourceIdentity;
  }

  begin(): ClaimTicketVerificationRequest {
    this.#generation += 1;
    this.#verified = undefined;
    return { generation: this.#generation, sourceIdentity: this.#sourceIdentity };
  }

  bind(
    request: ClaimTicketVerificationRequest,
    loadedIdentity: string,
  ): BoundClaimTicketVerificationRequest | undefined {
    return this.isCurrent(request) ? { ...request, loadedIdentity } : undefined;
  }

  complete(request: BoundClaimTicketVerificationRequest): boolean {
    if (!this.isCurrent(request)) return false;
    this.#verified = request;
    return true;
  }

  invalidate(): void {
    this.#generation += 1;
    this.#verified = undefined;
  }

  isCurrent(request: ClaimTicketVerificationRequest): boolean {
    return request.generation === this.#generation
      && request.sourceIdentity === this.#sourceIdentity;
  }

  isVerified(sourceIdentity: string, loadedIdentity: string): boolean {
    return Boolean(
      this.#verified
      && this.#verified.generation === this.#generation
      && this.#verified.sourceIdentity === sourceIdentity
      && this.#verified.loadedIdentity === loadedIdentity,
    );
  }

  syncSource(sourceIdentity: string): void {
    if (sourceIdentity === this.#sourceIdentity) return;
    this.#sourceIdentity = sourceIdentity;
    this.invalidate();
  }
}
