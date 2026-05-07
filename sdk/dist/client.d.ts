import type { AddressFixConfig, CorrectOptions, CorrectResult } from "./types";
export default class AddressFix {
    private readonly apiKey;
    private readonly baseUrl;
    private readonly timeout;
    private readonly retries;
    constructor(config: AddressFixConfig);
    correct(address: string, options?: CorrectOptions): Promise<CorrectResult>;
    correctBatch(addresses: string[], options?: CorrectOptions): Promise<CorrectResult[]>;
    private _request;
}
