export class AddressFixError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly retryAfter?: number
  ) {
    super(message);
    this.name = "AddressFixError";
  }
}

export class AddressFixAuthError extends AddressFixError {
  constructor(message: string, code: string, status: number) {
    super(message, code, status);
    this.name = "AddressFixAuthError";
  }
}

export class AddressFixRateLimitError extends AddressFixError {
  constructor(message: string, retryAfter?: number) {
    super(message, "RATE_LIMIT_EXCEEDED", 429, retryAfter);
    this.name = "AddressFixRateLimitError";
  }
}

export class AddressFixValidationError extends AddressFixError {
  constructor(message: string) {
    super(message, "INVALID_INPUT", 400);
    this.name = "AddressFixValidationError";
  }
}

export class AddressFixServerError extends AddressFixError {
  constructor(message: string, status = 500) {
    super(message, "INTERNAL_ERROR", status);
    this.name = "AddressFixServerError";
  }
}
