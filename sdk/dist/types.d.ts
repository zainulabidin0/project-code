export interface AddressFixConfig {
    apiKey: string;
    baseUrl?: string;
    timeout?: number;
    retries?: number;
}
export interface CorrectOptions {
    regexOnly?: boolean;
    format?: "standard";
    includeMetadata?: boolean;
}
export interface CorrectResult {
    original: string;
    corrected: string;
    confidence?: number;
    correctionType: string;
    changes?: string[];
    processingMs: number;
}
