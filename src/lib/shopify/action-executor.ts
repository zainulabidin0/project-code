import { parseCheckoutAnswer } from "@/lib/shopify/checkout-collector";
import {
  buildCheckoutUrl,
  getMissingFields,
  FIELD_PROMPTS,
  type CheckoutUrlDraft,
} from "@/lib/shopify/checkout-url-builder";
import { getSavedCustomerProfile, upsertCustomerProfile } from "@/lib/shopify/customer-profile";
import { isValidEmail, normalizeEmailInput } from "@/lib/shopify/email-normalizer";
import { normalizeFullNameInput } from "@/lib/shopify/name-normalizer";
import { isConfidentMatch, pickVariant, rankProducts } from "@/lib/shopify/product-matcher";
import type { CheckoutFieldName, Plan, PlanAction } from "@/lib/shopify/planner";
import {
  addToCart,
  cartLinesRemove,
  getCartCheckoutUrl,
  getCartWithLines,
  searchProducts,
  toCartSummary,
} from "@/lib/shopify/storefront";
import type { AgentContext, PendingAdd, SearchSortKey, ShopifyProduct } from "@/lib/shopify/types";

export type ExecutionResult = {
  replyData: Record<string, unknown>;
  contextUpdates: Partial<AgentContext>;
  products?: ShopifyProduct[];
};

function mapSortKey(
  sort?: PlanAction["sort"]
): { sortKey: SearchSortKey; reverse: boolean } {
  switch (sort) {
    case "PRICE_ASC":
      return { sortKey: "PRICE", reverse: false };
    case "PRICE_DESC":
      return { sortKey: "PRICE", reverse: true };
    case "BEST_SELLING":
      return { sortKey: "BEST_SELLING", reverse: false };
    case "CREATED_AT_DESC":
      return { sortKey: "CREATED_AT", reverse: true };
    default:
      return { sortKey: "RELEVANCE", reverse: false };
  }
}

function toCheckoutUrlDraft(draft: AgentContext["checkoutDraft"]): CheckoutUrlDraft {
  return {
    fullName: draft.fullName,
    email: draft.email,
    phone: draft.phone,
    address1: draft.address1,
    address2: draft.address2,
    city: draft.city,
    province: draft.province,
    zip: draft.zip,
    country: draft.countryCode ?? "PK",
  };
}

function invalidateCheckoutUrl(): Partial<AgentContext> {
  return { checkoutReady: false, cartAction: null };
}

async function applyCheckoutFieldValue(
  field: NonNullable<PlanAction["field"]>,
  rawValue: string,
  draft: AgentContext["checkoutDraft"]
): Promise<
  | { ok: true; draft: AgentContext["checkoutDraft"] }
  | { ok: false; invalidField: string; value: string }
> {
  const nextDraft = { ...draft };

  if (field === "fullName") {
    const nameNorm = await normalizeFullNameInput(rawValue);
    if (!nameNorm.ok) return { ok: false, invalidField: "fullName", value: rawValue };
    nextDraft.fullName = nameNorm.fullName;
  } else if (field === "email") {
    const emailNorm = normalizeEmailInput(rawValue);
    if (!emailNorm.ok || !isValidEmail(emailNorm.email)) {
      return { ok: false, invalidField: "email", value: rawValue };
    }
    nextDraft.email = emailNorm.email;
  } else {
    const parsed = parseCheckoutAnswer(field, rawValue);
    if (!parsed.ok) return { ok: false, invalidField: field, value: rawValue };
    if (field === "address2") {
      nextDraft.address2 = parsed.value;
    } else {
      nextDraft[field] = parsed.value;
    }
  }

  return { ok: true, draft: nextDraft };
}

function resolvePendingAdd(context: AgentContext, action: PlanAction): PendingAdd | null {
  if (context.pendingAdd) return context.pendingAdd;

  const products = context.lastSearchProducts ?? [];
  if (!products.length) return null;

  let index = 0;
  if (action.productRef === "specific_index" && action.productIndex != null) {
    index = Math.max(0, action.productIndex - 1);
  }

  const product = products[index];
  if (!product) return null;

  const { variant, price } = pickVariant(product);
  return {
    variantId: variant.id,
    quantity: action.quantity ?? 1,
    title: product.title,
    price,
  };
}

export async function executePlan(plan: Plan, context: AgentContext): Promise<ExecutionResult> {
  if (plan.replyTemplate === "checkout_details_summary") {
    return {
      replyData: { checkoutSummary: context.checkoutDraft ?? {} },
      contextUpdates: {},
    };
  }

  let result: ExecutionResult = { replyData: {}, contextUpdates: {} };
  let workingContext = { ...context };

  for (const action of plan.actions) {
    const actionResult = await executeAction(action, workingContext, plan);
    result = mergeResults(result, actionResult);
    workingContext = { ...workingContext, ...actionResult.contextUpdates };
  }

  if (plan.userIntent === "checkout" && plan.replyTemplate === "ask_checkout_field") {
    const checkoutResult = plan.checkoutField
      ? handleCheckoutFieldReask(plan.checkoutField)
      : handleCheckoutProgress(workingContext);
    result = mergeResults(result, checkoutResult);
    workingContext = { ...workingContext, ...checkoutResult.contextUpdates };
  }

  if (result.replyData.allFieldsCollected && plan.replyTemplate !== "checkout_field_update") {
    const urlResult = await executeAction(
      { type: "build_checkout_url" },
      workingContext,
      { ...plan, replyTemplate: "checkout_url_ready" }
    );
    result = mergeResults(result, urlResult);
  } else if (
    plan.actions.some((a) => a.type === "build_checkout_url") &&
    plan.replyTemplate === "checkout_url_ready"
  ) {
    const urlResult = await executeAction(
      { type: "build_checkout_url" },
      workingContext,
      plan
    );
    result = mergeResults(result, urlResult);
  }

  return result;
}

async function executeAction(
  action: PlanAction,
  context: AgentContext,
  plan: Plan
): Promise<ExecutionResult> {
  switch (action.type) {
    case "search": {
      const { sortKey, reverse } = mapSortKey(action.sort);
      const products = await searchProducts(context.storefrontStore, {
        query: action.query ?? "",
        sortKey,
        reverse,
        first: 5,
      });

      if (products.length === 0) {
        const noMatch: Record<string, unknown> = {
          found: false,
          query: action.query,
        };
        if (plan.userIntent === "buy") {
          noMatch.buyIntentNoMatch = true;
        }
        return { replyData: noMatch, contextUpdates: {} };
      }

      if (plan.userIntent === "buy") {
        const ranked = rankProducts(products, action.query ?? "");
        if (isConfidentMatch(ranked)) {
          const best = ranked[0].product;
          const { variant, price, needsClarification } = pickVariant(best);

          if (needsClarification) {
            return {
              replyData: {
                needsVariantChoice: true,
                product: best,
                variants: best.variants,
              },
              contextUpdates: { lastSearchProducts: [best] },
            };
          }

          const quantity = action.quantity ?? 1;
          const unitPrice = price;
          const totalPrice = (parseFloat(unitPrice) * quantity).toFixed(2);

          return {
            replyData: {
              singleMatch: true,
              product: best,
              variant,
              quantity,
              unitPrice,
              totalPrice,
            },
            contextUpdates: {
              lastSearchProducts: [best],
              pendingAdd: {
                variantId: variant.id,
                quantity,
                title: best.title,
                price: unitPrice,
              },
            },
          };
        }
      }

      return {
        replyData: { found: true, products, query: action.query },
        contextUpdates: { lastSearchProducts: products },
        products,
      };
    }

    case "add_to_cart": {
      const pending = resolvePendingAdd(context, action);
      if (!pending) {
        return {
          replyData: { error: "no_pending_product" },
          contextUpdates: {},
        };
      }

      const quantity = action.quantity ?? pending.quantity;
      const cartResult = await addToCart({
        store: context.storefrontStore,
        cartId: context.cartId,
        variantId: pending.variantId,
        quantity,
      });

      const cartWithLines = context.cartId
        ? await getCartWithLines({
            store: context.storefrontStore,
            cartId: cartResult.cartId,
          })
        : null;

      return {
        replyData: {
          added: true,
          title: pending.title,
          quantity,
          price: pending.price,
        },
        contextUpdates: {
          cartId: cartResult.cartId,
          pendingAdd: null,
          lastAddedProduct: { title: pending.title, price: pending.price, quantity },
          cartSummary: cartWithLines ? toCartSummary(cartWithLines) : context.cartSummary,
          cartAction: {
            checkoutUrl: cartResult.checkoutUrl,
            totalPrice: cartResult.totalPrice,
            cartId: cartResult.cartId,
          },
        },
      };
    }

    case "get_cart": {
      if (!context.cartId) {
        return { replyData: { cart: null }, contextUpdates: {} };
      }
      const cart = await getCartWithLines({
        store: context.storefrontStore,
        cartId: context.cartId,
      });
      const summary = cart ? toCartSummary(cart) : null;
      return {
        replyData: { cart: summary },
        contextUpdates: { cartSummary: summary },
      };
    }

    case "clear_cart": {
      if (context.cartId) {
        const cart = await getCartWithLines({
          store: context.storefrontStore,
          cartId: context.cartId,
        });
        if (cart?.lines?.length) {
          await cartLinesRemove({
            store: context.storefrontStore,
            cartId: context.cartId,
            lineIds: cart.lines.map((line) => line.id),
          });
        }
      }
      return {
        replyData: { cleared: true },
        contextUpdates: {
          checkoutReady: false,
          checkoutDraft: {},
          cartSummary: null,
          pendingAdd: null,
          cartAction: null,
          lastSearchProducts: [],
        },
      };
    }

    case "remove_from_cart": {
      if (!context.cartId) {
        return { replyData: { removed: false }, contextUpdates: {} };
      }
      const cart = await getCartWithLines({
        store: context.storefrontStore,
        cartId: context.cartId,
      });
      const targetLine = cart?.lines?.[0];
      if (targetLine) {
        await cartLinesRemove({
          store: context.storefrontStore,
          cartId: context.cartId,
          lineIds: [targetLine.id],
        });
      }
      return {
        replyData: { removed: true, title: targetLine?.title },
        contextUpdates: {},
      };
    }

    case "save_checkout_field": {
      const field = action.field;
      const rawValue = action.value ?? "";
      if (!field) return { replyData: {}, contextUpdates: {} };

      const applied = await applyCheckoutFieldValue(field, rawValue, context.checkoutDraft ?? {});
      if (!applied.ok) {
        return {
          replyData: { invalidField: applied.invalidField, value: applied.value },
          contextUpdates: {},
        };
      }

      const draft = applied.draft;
      const updates: Partial<AgentContext> = { checkoutDraft: draft };

      if (field === "email" && draft.email) {
        const profile = await getSavedCustomerProfile({
          storeId: context.storeId,
          identifier: draft.email,
        });
        if (profile) {
          return {
            replyData: { savedProfileFound: true, profile },
            contextUpdates: updates,
          };
        }
      }

      const missing = getMissingFields(toCheckoutUrlDraft(draft));
      if (missing.length === 0) {
        return { replyData: { fieldSaved: field, allFieldsCollected: true }, contextUpdates: updates };
      }

      return { replyData: { fieldSaved: field }, contextUpdates: updates };
    }

    case "update_checkout_field": {
      const field = action.field;
      if (!field) return { replyData: {}, contextUpdates: {} };

      const draft = { ...(context.checkoutDraft ?? {}) };

      if (!action.value?.trim()) {
        return {
          replyData: {
            awaitingNewValue: field,
            currentValue: draft[field as keyof typeof draft],
          },
          contextUpdates: {},
        };
      }

      const applied = await applyCheckoutFieldValue(field, action.value, draft);
      if (!applied.ok) {
        return {
          replyData: { invalidField: applied.invalidField, value: applied.value },
          contextUpdates: {},
        };
      }

      return {
        replyData: {
          fieldUpdated: field,
          newValue: applied.draft[field as keyof typeof applied.draft],
        },
        contextUpdates: {
          checkoutDraft: applied.draft,
          ...invalidateCheckoutUrl(),
        },
      };
    }

    case "build_checkout_url": {
      const draft = context.checkoutDraft ?? {};
      const missing = getMissingFields(toCheckoutUrlDraft(draft));
      if (missing.length > 0) {
        return { replyData: { missingFields: missing }, contextUpdates: {} };
      }

      if (!context.cartId) {
        return { replyData: { error: "empty_cart" }, contextUpdates: {} };
      }

      const cart = await getCartCheckoutUrl({
        store: context.storefrontStore,
        cartId: context.cartId,
      });
      if (!cart?.checkoutUrl) {
        return { replyData: { error: "no_checkout_url" }, contextUpdates: {} };
      }

      const url = buildCheckoutUrl(cart.checkoutUrl, toCheckoutUrlDraft(draft));

      if (draft.email) {
        upsertCustomerProfile({
          storeId: context.storeId,
          identifier: draft.email,
          identifierType: "email",
          draft,
        }).catch(() => {});
      }

      return {
        replyData: { checkoutUrl: url, totalPrice: cart.totalPrice },
        contextUpdates: {
          checkoutReady: true,
          cartAction: {
            checkoutUrl: url,
            totalPrice: cart.totalPrice,
            cartId: context.cartId,
          },
        },
      };
    }

    default:
      return { replyData: {}, contextUpdates: {} };
  }
}

function handleCheckoutFieldReask(field: CheckoutFieldName): ExecutionResult {
  const prompt = FIELD_PROMPTS[field];
  if (!prompt) {
    return { replyData: {}, contextUpdates: {} };
  }
  return {
    replyData: {
      nextField: field,
      prompt,
      reaskField: field,
    },
    contextUpdates: {},
  };
}

function handleCheckoutProgress(context: AgentContext): ExecutionResult {
  const draft = context.checkoutDraft ?? {};
  const order: Array<keyof CheckoutUrlDraft> = [
    "fullName",
    "email",
    "phone",
    "address1",
    "city",
    "zip",
  ];

  const nextField = order.find((field) => !String(draft[field as keyof typeof draft] ?? "").trim());

  if (!nextField) {
    return { replyData: { allFieldsCollected: true }, contextUpdates: {} };
  }

  return {
    replyData: {
      nextField,
      prompt: FIELD_PROMPTS[nextField],
    },
    contextUpdates: {},
  };
}

function mergeResults(a: ExecutionResult, b: ExecutionResult): ExecutionResult {
  return {
    replyData: { ...a.replyData, ...b.replyData },
    contextUpdates: { ...a.contextUpdates, ...b.contextUpdates },
    products: b.products ?? a.products,
  };
}
