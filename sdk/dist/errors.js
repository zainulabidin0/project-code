"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddressFixServerError = exports.AddressFixValidationError = exports.AddressFixRateLimitError = exports.AddressFixAuthError = exports.AddressFixError = void 0;
class AddressFixError extends Error {
    constructor(message, code, status, retryAfter) {
        super(message);
        this.code = code;
        this.status = status;
        this.retryAfter = retryAfter;
        this.name = "AddressFixError";
    }
}
exports.AddressFixError = AddressFixError;
class AddressFixAuthError extends AddressFixError {
    constructor(message, code, status) {
        super(message, code, status);
        this.name = "AddressFixAuthError";
    }
}
exports.AddressFixAuthError = AddressFixAuthError;
class AddressFixRateLimitError extends AddressFixError {
    constructor(message, retryAfter) {
        super(message, "RATE_LIMIT_EXCEEDED", 429, retryAfter);
        this.name = "AddressFixRateLimitError";
    }
}
exports.AddressFixRateLimitError = AddressFixRateLimitError;
class AddressFixValidationError extends AddressFixError {
    constructor(message) {
        super(message, "INVALID_INPUT", 400);
        this.name = "AddressFixValidationError";
    }
}
exports.AddressFixValidationError = AddressFixValidationError;
class AddressFixServerError extends AddressFixError {
    constructor(message, status = 500) {
        super(message, "INTERNAL_ERROR", status);
        this.name = "AddressFixServerError";
    }
}
exports.AddressFixServerError = AddressFixServerError;
