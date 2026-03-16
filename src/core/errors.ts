/** Errors safe to show to the user. Everything else → "Internal error" in production. */
export class DisplayableError extends Error {
  constructor(message: string, public status: number = 400) {
    super(message);
  }
}

export class NotFoundError extends DisplayableError {
  constructor(message = 'Not found') { super(message, 404); }
}

export class ForbiddenError extends DisplayableError {
  constructor(message = 'Forbidden') { super(message, 403); }
}
