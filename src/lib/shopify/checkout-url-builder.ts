export interface CheckoutUrlDraft {
  fullName?: string;
  email?: string;
  phone?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  zip?: string;
  country?: string;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("92") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `+92${digits.slice(1)}`;
  if (digits.length === 10) return `+92${digits}`;
  return `+${digits}`;
}

const CITY_TO_PROVINCE: Record<string, string> = {
  karachi: "SD",
  hyderabad: "SD",
  sukkur: "SD",
  lahore: "PB",
  faisalabad: "PB",
  rawalpindi: "PB",
  multan: "PB",
  gujranwala: "PB",
  sialkot: "PB",
  islamabad: "IS",
  peshawar: "KP",
  mardan: "KP",
  quetta: "BA",
  abbottabad: "KP",
  murree: "PB",
};

function inferProvince(city: string, explicitProvince?: string): string {
  if (explicitProvince?.trim()) {
    const key = explicitProvince.trim().toLowerCase();
    if (CITY_TO_PROVINCE[key]) return CITY_TO_PROVINCE[key];
    if (/^(pb|sd|kp|ba|is|gb|jk)$/i.test(explicitProvince.trim())) {
      return explicitProvince.trim().toUpperCase();
    }
    return explicitProvince.trim();
  }
  return CITY_TO_PROVINCE[city.toLowerCase()] ?? "";
}

export function buildCheckoutUrl(baseUrl: string, draft: CheckoutUrlDraft): string {
  if (!baseUrl) throw new Error("No checkout URL available — cart may be empty");

  const { firstName, lastName } = splitName(draft.fullName ?? "");
  const phone = draft.phone ? normalizePhone(draft.phone) : "";
  const province = inferProvince(draft.city ?? "", draft.province);
  const country = draft.country ?? "PK";

  const params = new URLSearchParams();

  if (draft.email) params.set("checkout[email]", draft.email);
  if (firstName) params.set("checkout[shipping_address][first_name]", firstName);
  if (lastName) params.set("checkout[shipping_address][last_name]", lastName);
  if (phone) params.set("checkout[shipping_address][phone]", phone);
  if (draft.address1) params.set("checkout[shipping_address][address1]", draft.address1);
  if (draft.address2) params.set("checkout[shipping_address][address2]", draft.address2);
  if (draft.city) params.set("checkout[shipping_address][city]", draft.city);
  if (province) params.set("checkout[shipping_address][province]", province);
  if (draft.zip) params.set("checkout[shipping_address][zip]", draft.zip);
  params.set("checkout[shipping_address][country]", country);

  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}${params.toString()}`;
}

export function getMissingFields(draft: CheckoutUrlDraft): string[] {
  const required: (keyof CheckoutUrlDraft)[] = [
    "fullName",
    "email",
    "phone",
    "address1",
    "city",
    "zip",
  ];
  return required.filter((field) => !draft[field]?.trim());
}

export const FIELD_PROMPTS: Record<string, string> = {
  fullName: "What's your full name?",
  email: "What's your email address?",
  phone: "What's your phone number?",
  address1: "What's your street address?",
  address2: "Apartment/floor number? (or say 'skip')",
  city: "Which city?",
  zip: "What's your postal/zip code?",
};
