import { insertBigqueryEvent } from "./helpers/index.js";
import { getProductVariantDataFromShopify } from "./helpers/shopify.js";

/**
 * Insert custom purchase event in bigquery
 * @param {string} shop - shopify store handle Ex: swiss-local-dev.myshopify.com
 * @param {object} payload
 */
const createCustomPurchaseEventInBiqQuery = async (shop, payload) => {
  try {
    console.log("Creating analytics entry 👉");
    let lineItemDetails = [];
    for (let i = 0; i < payload.line_items.length; i++) {
      let variant = payload.line_items[i];
      let variantId = variant.variant_id;
      let variantAdditionalData = await getProductVariantDataFromShopify(
        shop,
        variantId
      );
      let structurredVariantData = {
        id: variantId,
        quantity: variant.quantity,
        ean: variantAdditionalData.barcode,
        mrp: variantAdditionalData.compareAtPrice
          ? Number(variantAdditionalData.compareAtPrice)
          : 0,
        price: Number(variantAdditionalData.price),
        sku: variantAdditionalData.sku,
        title: variantAdditionalData.product.title,
        variant: variant.variant_title,
        productId: variant.product_id,
        currentInventory: variantAdditionalData.inventoryQuantity,
      };
      lineItemDetails.push(structurredVariantData);
    }
    let structuredData = {
      orderId: payload.name,
      shopifyOrderId: payload.id,
      createdAt: payload.created_at,
      couponCode: payload.discount_codes[0]?.code || "",
      couponValue: payload.discount_codes[0]?.amount
        ? Number(payload.discount_codes[0]?.amount)
        : 0,
      totalPrice: payload?.total_price ? Number(payload.total_price) : 0,
      shippingPrice: payload?.total_shipping_price_set?.shop_money?.amount
        ? Number(payload?.total_shipping_price_set?.shop_money?.amount)
        : 0,
      subTotalPrice: payload.total_line_items_price
        ? Number(payload.total_line_items_price)
        : 0,
      partiallyPaidAmount:
        Number(payload.total_outstanding) < Number(payload.total_price)
          ? Number(payload.total_price) - Number(payload.total_outstanding)
          : 0,
      isSwissCashUtilised: payload.tags
        .toLowerCase()
        .split(",")
        .map((el) => el.trim())
        .find((el) => el == "swiss cash")
        ? true
        : false,
      utmSource:
        payload.note_attributes.find((el) => el.name == "utm_source")?.value ||
        "",
      utmMedium:
        payload.note_attributes.find((el) => el.name == "utm_medium")?.value ||
        "",
      utmCampaign:
        payload.note_attributes.find((el) => el.name == "utm_campaign")
          ?.value || "",
      landingPage:
        payload.note_attributes.find((el) => el.name == "full_url")?.value ||
        "",
      cod: payload.tags
        .toLowerCase()
        .split(",")
        .map((el) => el.trim())
        .find((el) => el == "cod")
        ? true
        : false,
      customerName: payload.customer
        ? payload.customer.first_name + " " + payload.customer.last_name
        : null,
      customerPhone: payload.customer ? payload.customer.phone : null,
      customerEmail: payload.customer ? payload.customer.email : null,
      lineItems: lineItemDetails,
    };
    let excludeKeys = new Set(["lineItems"]);
    let eventParams = Object.entries(structuredData)
      .filter(([key]) => !excludeKeys.has(key))
      .map(([key, value]) => ({
        key,
        value: convertValue(value),
      }));
    let eventPayload = {
      event_name: "purchase_custom_v2",
      event_params: eventParams,
      items: structuredData.lineItems.map((el) => ({
        variantId: el.id + "",
        quantity: el.quantity,
        ean: el.ean,
        mrp: el.mrp,
        price: el.price,
        sku: el.sku,
        title: el.title,
        productId: el.productId,
        variant: el.variant,
        currentInventory: el.currentInventory,
      })),
      event_date: new Date().toISOString(),
      timestamp: Date.now(),
    };
    const insertion = await insertBigqueryEvent(eventPayload);
  } catch (err) {
    throw new Error(
      "Failed to create custom purchase event in bigquery reason -->" +
        err.message
    );
  }
};

/**
 * Insert custom order cancel event in bigquery
 * @param {string} shop - shopify store handle Ex: swiss-local-dev.myshopify.com
 * @param {object} payload
 */
const createOrderCancelledEventInBigQuery = async (shop, payload) => {
  try {
    console.log("Creating analytics entry for order cancelled👉");
    let lineItemDetails = [];
    for (let i = 0; i < payload.line_items.length; i++) {
      let variant = payload.line_items[i];
      let variantId = variant.variant_id;
      let variantAdditionalData = await getProductVariantDataFromShopify(
        shop,
        variantId
      );
      let structurredVariantData = {
        id: variantId,
        quantity: variant.quantity,
        ean: variantAdditionalData.barcode,
        mrp: variantAdditionalData.compareAtPrice
          ? Number(variantAdditionalData.compareAtPrice)
          : 0,
        price: Number(variantAdditionalData.price),
        sku: variantAdditionalData.sku,
        title: variantAdditionalData.product.title,
        variant: variant.variant_title,
        productId: variant.product_id,
        currentInventory: variantAdditionalData.inventoryQuantity,
      };
      lineItemDetails.push(structurredVariantData);
    }
    let structuredData = {
      orderId: payload.name,
      shopifyOrderId: payload.id,
      createdAt: payload.created_at,
      couponCode: payload.discount_codes[0]?.code || "",
      couponValue: payload.discount_codes[0]?.amount
        ? Number(payload.discount_codes[0]?.amount)
        : 0,
      totalPrice: payload.total_price ? Number(payload.total_price) : 0,
      shippingPrice: payload?.total_shipping_price_set?.shop_money?.amount
        ? Number(payload?.total_shipping_price_set?.shop_money?.amount)
        : 0,
      subTotalPrice: payload?.subtotal_price
        ? Number(payload.subtotal_price)
        : 0,
      partiallyPaidAmount:
        Number(payload.total_outstanding) < Number(payload.total_price)
          ? Number(payload.total_price) - Number(payload.total_outstanding)
          : 0,
      isSwissCashUtilised: payload.tags
        .toLowerCase()
        .split(",")
        .map((el) => el.trim())
        .find((el) => el == "swiss cash")
        ? true
        : false,
      utmSource:
        payload.note_attributes.find((el) => el.name == "utm_source")?.value ||
        "",
      utmMedium:
        payload.note_attributes.find((el) => el.name == "utm_medium")?.value ||
        "",
      utmCampaign:
        payload.note_attributes.find((el) => el.name == "utm_campaign")
          ?.value || "",
      landingPage:
        payload.note_attributes.find((el) => el.name == "full_url")?.value ||
        "",
      cod: payload.tags
        .toLowerCase()
        .split(",")
        .map((el) => el.trim())
        .find((el) => el == "cod")
        ? true
        : false,
      customerName: payload.customer
        ? payload.customer.first_name + " " + payload.customer.last_name
        : null,
      customerPhone: payload.customer ? payload.customer.phone : null,
      customerEmail: payload.customer ? payload.customer.email : null,
      lineItems: lineItemDetails,
    };
    let excludeKeys = new Set(["lineItems"]);
    let eventParams = Object.entries(structuredData)
      .filter(([key]) => !excludeKeys.has(key))
      .map(([key, value]) => ({
        key,
        value: convertValue(value),
      }));
    let eventPayload = {
      event_name: "order_cancelled_v2",
      event_params: eventParams,
      items: structuredData.lineItems.map((el) => ({
        variantId: el.id + "",
        quantity: el.quantity,
        ean: el.ean,
        mrp: el.mrp,
        price: el.price,
        sku: el.sku,
        title: el.title,
        productId: el.productId,
        variant: el.variant,
        currentInventory: el.currentInventory,
      })),
      event_date: new Date().toISOString(),
      timestamp: Date.now(),
    };
    const insertion = await insertBigqueryEvent(eventPayload);
  } catch (err) {
    throw new Error(
      "Failed to create custom order cancel in bigquery reason -->" +
        err.message
    );
  }
};
function convertValue(value) {
  if (typeof value === "string") {
    return { string_value: value };
  } else if (typeof value === "number") {
    // Distinguish float vs int
    return Number.isInteger(value)
      ? { int_value: value }
      : { float_value: value };
  } else if (typeof value === "boolean") {
    return { string_value: value.toString() }; // Store as string
  } else {
    return { string_value: JSON.stringify(value) }; // Store nested/complex objects as JSON
  }
}
export {
  createCustomPurchaseEventInBiqQuery,
  createOrderCancelledEventInBigQuery,
};
