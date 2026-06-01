import CryptoJS from "crypto-js";

function getKey(): string {
  const key = process.env.ENCRYPTION_KEY?.trim();
  console.log("key", key);
  if (!key) {
    throw new Error("ENCRYPTION_KEY is required for Shopify token storage");
  }
  return key;
}

export function encrypt(text: string): string {
  return CryptoJS.AES.encrypt(text, getKey()).toString();
}

export function decrypt(ciphertext: string): string {
  const bytes = CryptoJS.AES.decrypt(ciphertext, getKey());
  const plain = bytes.toString(CryptoJS.enc.Utf8);
  if (!plain) {
    throw new Error("Failed to decrypt value — wrong ENCRYPTION_KEY or corrupted data");
  }
  return plain;
}
