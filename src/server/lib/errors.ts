/** Domain-level errors thrown by services, mapped to HTTP by the route layer. */
export class NotFoundError extends Error {
  constructor(
    readonly resource: string,
    readonly id: string,
  ) {
    super(`${resource} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

/** The caller is known but not allowed to do this right now (e.g. not their turn). */
export class ForbiddenError extends Error {
  constructor(readonly reason: string) {
    super(`forbidden: ${reason}`);
    this.name = 'ForbiddenError';
  }
}
