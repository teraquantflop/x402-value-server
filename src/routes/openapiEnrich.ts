import type { AppConfig } from "../types.js";
import {
  buildPaidRoutes,
  type PaidRoutesMap,
} from "../x402/routeConfig.js";

type BodyJsonSchema = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[] | readonly string[];
  [key: string]: unknown;
};

type OpenApiDoc = {
  info?: {
    contact?: Record<string, unknown>;
    [key: string]: unknown;
  };
  paths?: Record<
    string,
    {
      post?: {
        requestBody?: {
          required?: boolean;
          content?: {
            "application/json"?: {
              schema?: unknown;
              example?: unknown;
            };
          };
        };
        responses?: Record<string, unknown>;
        "x-payment-info"?: unknown;
        "x-pricing"?: { price_usd?: number; currency?: string };
        [key: string]: unknown;
      };
      [key: string]: unknown;
    }
  >;
  [key: string]: unknown;
};

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function priceFromRoute(
  route: PaidRoutesMap[keyof PaidRoutesMap],
): string | undefined {
  const accepts = (route as { accepts?: Array<{ price?: string }> }).accepts;
  const p = accepts?.[0]?.price;
  return typeof p === "string" && p.length > 0 ? p : undefined;
}

/**
 * OpenAPI requestBody must stay the bare JSON body schema.
 * Stock bazaar wraps it at schema.properties.input.properties.body
 * (and info.input.body for the example).
 */
function bazaarFromRoute(route: PaidRoutesMap[keyof PaidRoutesMap]): {
  schema?: BodyJsonSchema;
  input?: Record<string, unknown>;
} {
  const ext = (route as { extensions?: { bazaar?: unknown } }).extensions
    ?.bazaar as
    | {
        schema?: {
          properties?: {
            input?: {
              properties?: {
                body?: BodyJsonSchema;
              };
            };
          };
        };
        info?: {
          input?: {
            type?: string;
            body?: Record<string, unknown>;
            [key: string]: unknown;
          };
        };
      }
    | undefined;
  if (!ext) return {};

  const bodySchema = ext.schema?.properties?.input?.properties?.body;
  const bodyExample =
    ext.info?.input?.type === "http" &&
    ext.info.input.body &&
    typeof ext.info.input.body === "object"
      ? ext.info.input.body
      : undefined;

  return {
    schema: bodySchema,
    input: bodyExample,
  };
}

/**
 * Enrich a loaded OpenAPI document for paid x402 POSTs:
 * - inline requestBody schema (no $ref) from bazaar body schema
 * - responses.402 present (keep existing)
 * - x-payment-info { protocols, pricingMode, price, currency }
 * - info.contact.email from CONTACT_EMAIL when set (never invent an address)
 */
export function enrichOpenApiDocument(
  raw: unknown,
  config: AppConfig,
  opts: { cdpEnabled?: boolean } = {},
): OpenApiDoc {
  const doc = deepClone(raw) as OpenApiDoc;
  const paid = buildPaidRoutes(config, {
    cdpEnabled: opts.cdpEnabled ?? false,
  });

  if (!doc.paths) doc.paths = {};

  for (const [key, route] of Object.entries(paid)) {
    if (!key.startsWith("POST ")) continue;
    const path = key.slice("POST ".length);
    const pathItem = doc.paths[path] ?? {};
    const post = { ...(pathItem.post ?? {}) };

    const { schema, input } = bazaarFromRoute(route);
    if (schema) {
      const content = {
        ...(post.requestBody?.content ?? {}),
        "application/json": {
          ...(post.requestBody?.content?.["application/json"] ?? {}),
          schema: deepClone(schema),
          ...(input
            ? {
                example:
                  post.requestBody?.content?.["application/json"]?.example ??
                  input,
              }
            : {}),
        },
      };
      post.requestBody = {
        required: true,
        ...post.requestBody,
        content,
      };
    }

    if (!post.responses) post.responses = {};
    if (!post.responses["402"]) {
      post.responses["402"] = {
        description:
          "Payment required (x402). Decode PAYMENT-REQUIRED header (base64 JSON) for accepts[].",
      };
    }

    const price = priceFromRoute(route);
    if (price) {
      post["x-payment-info"] = {
        protocols: ["x402"],
        pricingMode: "fixed",
        price,
        currency: "USDC",
      };
    }

    doc.paths[path] = { ...pathItem, post };
  }

  if (config.contactEmail) {
    doc.info = {
      ...(doc.info ?? {}),
      contact: {
        ...(doc.info?.contact ?? {}),
        email: config.contactEmail,
      },
    };
  } else if (doc.info?.contact && "email" in doc.info.contact) {
    // Do not hardcode — drop any stale email from the static file when unset
    const { email: _e, ...rest } = doc.info.contact;
    doc.info = { ...doc.info, contact: rest };
  }

  return doc;
}
