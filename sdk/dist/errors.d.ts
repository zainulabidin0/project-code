export declare class AddressFixError extends Error {
    readonly code: string;
    readonly status: number;
    readonly retryAfter?: number | undefined;
    constructor(message: string, code: string, status: number, retryAfter?: number | undefined);
}
export declare class AddressFixAuthError extends AddressFixError {
    constructor(message: string, code: string, status: number);
}
export declare class AddressFixRateLimitError extends AddressFixError {
    constructor(message: string, retryAfter?: number);
}
export declare class AddressFixValidationError extends AddressFixError {
    constructor(message: string);
}
export declare class AddressFixServerError extends AddressFixError {
    constructor(message: string, status?: number);
}
