export type ParticipationActionTicket = {
  generation: number;
  identity: string;
};

/**
 * Tracks the full lifetime of one mounted participation flow.
 *
 * Comparing only the current identity is insufficient because A -> B -> A
 * would make an old request look current again. The generation never moves
 * backwards, and deactivation permanently invalidates tickets owned by an
 * unmounted component instance.
 */
export class ParticipationActionGuard {
  #active = true;
  #generation = 0;
  #identity: string;

  constructor(identity: string) {
    this.#identity = identity;
  }

  activate(): void {
    if (this.#active) return;
    this.#active = true;
    this.#generation += 1;
  }

  capture(): ParticipationActionTicket {
    return { generation: this.#generation, identity: this.#identity };
  }

  deactivate(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#generation += 1;
  }

  isCurrent(ticket: ParticipationActionTicket): boolean {
    return this.#active
      && ticket.generation === this.#generation
      && ticket.identity === this.#identity;
  }

  sync(identity: string): void {
    if (identity === this.#identity) return;
    this.#identity = identity;
    this.#generation += 1;
  }
}
