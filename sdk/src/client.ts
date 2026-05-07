import {
  AddressFixAuthError,
  AddressFixRateLimitError,
  AddressFixServerError,
  AddressFixValidationError,
} from "./errors";
import type { AddressFixConfig, CorrectOptions, CorrectResult } from "./types";

const DEFAULT_BASE = "https://addressfix.dev";
const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_RETRIES = 1;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export default class AddressFix {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly retries: number;

  constructor(config: AddressFixConfig) {
    if (!config.apiKey?.startsWith("af_live_")) {
      throw new AddressFixValidationError("Invalid API key format");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.retries = config.retries ?? DEFAULT_RETRIES;
  }

  async correct(
    address: string,
    options?: CorrectOptions
  ): Promise<CorrectResult> {
    const body = {
      address,
      options: {
        regexOnly: options?.regexOnly,
        format: options?.format ?? "standard",
        includeMetadata: options?.includeMetadata ?? true,
      },
    };
    const j = await this._request("/api/v1/correct", body);
    return j.data as CorrectResult;
  }

  async correctBatch(
    addresses: string[],
    options?: CorrectOptions
  ): Promise<CorrectResult[]> {
    if (addresses.length > 50) {
      throw new AddressFixValidationError("Max 50 addresses per batch");
    }
    const body = {
      addresses,
      options: {
        regexOnly: options?.regexOnly,
        includeMetadata: options?.includeMetadata ?? true,
      },
    };
    const j = await this._request("/api/v1/correct/batch", body);
    return (j.data as { results: CorrectResult[] }).results;
  }

  private async _request(
    path: string,
    body: unknown,
    attempt = 0
  ): Promise<{ success: boolean; data?: unknown; error?: { code: string; message: string; retryAfter?: number } }> {
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
      const j = (await res.json()) as {
        success: boolean;
        data?: unknown;
        error?: { code: string; message: string; retryAfter?: number };
      };

      if (res.status === 429 && attempt < this.retries) {
        const retryAfter = (j.error?.retryAfter ?? 1) * 1000;
        await sleep(Math.min(retryAfter, 5000));
        return this._request(path, body, attempt + 1);
      }

      if (!res.ok || !j.success) {
        const code = j.error?.code ?? "INTERNAL_ERROR";
        const msg = j.error?.message ?? "Request failed";
        if (res.status === 401 || res.status === 403) {
          throw new AddressFixAuthError(msg, code, res.status);
        }
        if (res.status === 429) {
          throw new AddressFixRateLimitError(msg, j.error?.retryAfter);
        }
        if (res.status >= 400 && res.status < 500) {
          throw new AddressFixValidationError(msg);
        }
        throw new AddressFixServerError(msg, res.status);
      }
      return j;
    } catch (e) {
      clearTimeout(t);
      if (e instanceof AddressFixAuthError) throw e;
      if (attempt < this.retries) {
        await sleep(200 * (attempt + 1));
        return this._request(path, body, attempt + 1);
      }
      if (e instanceof Error && e.name === "AbortError") {
        throw new AddressFixServerError("Request timed out", 408);
      }
      throw new AddressFixServerError(
        e instanceof Error ? e.message : "Network error"
      );
    }
  }
}
