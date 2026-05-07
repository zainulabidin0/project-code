"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const errors_1 = require("./errors");
const DEFAULT_BASE = "https://addressfix.dev";
const DEFAULT_TIMEOUT = 10000;
const DEFAULT_RETRIES = 1;
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
class AddressFix {
    constructor(config) {
        if (!config.apiKey?.startsWith("af_live_")) {
            throw new errors_1.AddressFixValidationError("Invalid API key format");
        }
        this.apiKey = config.apiKey;
        this.baseUrl = (config.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
        this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
        this.retries = config.retries ?? DEFAULT_RETRIES;
    }
    async correct(address, options) {
        const body = {
            address,
            options: {
                regexOnly: options?.regexOnly,
                format: options?.format ?? "standard",
                includeMetadata: options?.includeMetadata ?? true,
            },
        };
        const j = await this._request("/api/v1/correct", body);
        return j.data;
    }
    async correctBatch(addresses, options) {
        if (addresses.length > 50) {
            throw new errors_1.AddressFixValidationError("Max 50 addresses per batch");
        }
        const body = {
            addresses,
            options: {
                regexOnly: options?.regexOnly,
                includeMetadata: options?.includeMetadata ?? true,
            },
        };
        const j = await this._request("/api/v1/correct/batch", body);
        return j.data.results;
    }
    async _request(path, body, attempt = 0) {
        const url = `${this.baseUrl}${path}`;
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), this.timeout);
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": this.apiKey,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            clearTimeout(t);
            const j = (await res.json());
            if (res.status === 429 && attempt < this.retries) {
                const retryAfter = (j.error?.retryAfter ?? 1) * 1000;
                await sleep(Math.min(retryAfter, 5000));
                return this._request(path, body, attempt + 1);
            }
            if (!res.ok || !j.success) {
                const code = j.error?.code ?? "INTERNAL_ERROR";
                const msg = j.error?.message ?? "Request failed";
                if (res.status === 401 || res.status === 403) {
                    throw new errors_1.AddressFixAuthError(msg, code, res.status);
                }
                if (res.status === 429) {
                    throw new errors_1.AddressFixRateLimitError(msg, j.error?.retryAfter);
                }
                if (res.status >= 400 && res.status < 500) {
                    throw new errors_1.AddressFixValidationError(msg);
                }
                throw new errors_1.AddressFixServerError(msg, res.status);
            }
            return j;
        }
        catch (e) {
            clearTimeout(t);
            if (e instanceof errors_1.AddressFixAuthError)
                throw e;
            if (attempt < this.retries) {
                await sleep(200 * (attempt + 1));
                return this._request(path, body, attempt + 1);
            }
            if (e instanceof Error && e.name === "AbortError") {
                throw new errors_1.AddressFixServerError("Request timed out", 408);
            }
            throw new errors_1.AddressFixServerError(e instanceof Error ? e.message : "Network error");
        }
    }
}
exports.default = AddressFix;
