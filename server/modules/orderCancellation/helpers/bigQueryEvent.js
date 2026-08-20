import { insertBigqueryEvent } from "../../../analytics/helpers/index.js";

function convertValue(value) {
  if (typeof value === "string") return { string_value: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { int_value: value }
      : { float_value: value };
  }
  if (typeof value === "boolean") return { string_value: value.toString() };
  return { string_value: JSON.stringify(value) };
}

const stripGid = (gid, prefix) =>
  gid ? String(gid).replace(prefix, "") : null;

/**
 * Pushes a "storefront_order_cancelled" event into BigQuery whenever a
 * customer successfully cancels their own order.
 */
const pushStorefrontOrderCancelledEvent = async (
  order,
  { shop, reasonCode, cancellationReason, refundInitiated }
) => {
  try {
    const tags = (order?.tags || []).map((t) => t.trim().toLowerCase());
    const customAttributes = order?.customAttributes || [];

    const lineItems = (order?.lineItems?.edges || []).map(({ node }) => ({
      id: stripGid(node?.variant?.id, "gid://shopify/ProductVariant/"),
      productId: stripGid(node?.variant?.product?.id, "gid://shopify/Product/"),
      quantity: node?.quantity || 0,
      ean: node?.variant?.barcode || null,
      mrp: Number(node?.variant?.compareAtPrice || 0),
      price: Number(node?.variant?.price || 0),
      sku: node?.variant?.sku || "",
      title: node?.variant?.product?.title || "",
      variant: node?.variant?.title || "",
      currentInventory: node?.variant?.inventoryQuantity || 0,
    }));

    const structuredData = {
      orderId: order?.name,
      shopifyOrderId: stripGid(order?.id, "gid://shopify/Order/"),
      shop: shop || "",
      tags: (order?.tags || []).join(","),
      createdAt: order?.createdAt,
      cancelledAt: new Date().toISOString(),
      couponCode: order?.discountCodes?.[0] || "",
      couponValue: Number(
        order?.totalDiscountsSet?.presentmentMoney?.amount || 0
      ),
      totalPrice: Number(
        order?.currentTotalPriceSet?.presentmentMoney?.amount || 0
      ),
      shippingPrice: Number(
        order?.totalShippingPriceSet?.presentmentMoney?.amount || 0
      ),
      isSwissCashUtilised: tags.includes("swiss cash"),
      cod: tags.includes("cod"),
      utmSource:
        customAttributes.find((el) => el.key === "utm_source")?.value || "",
      utmMedium:
        customAttributes.find((el) => el.key === "utm_medium")?.value || "",
      utmCampaign:
        customAttributes.find((el) => el.key === "utm_campaign")?.value || "",
      landingPage:
        customAttributes.find((el) => el.key === "full_url")?.value || "",
      customerName: order?.customer?.displayName || null,
      customerPhone: order?.customer?.defaultPhoneNumber?.phoneNumber || null,
      customerEmail: order?.customer?.defaultEmailAddress?.emailAddress || null,
      reasonCode: reasonCode || "ELIGIBLE",
      cancellationReason: cancellationReason || "Not specified",
      refundInitiated: Boolean(refundInitiated),
      source: "storefront_cancel_button",
    };

    const eventParams = Object.entries(structuredData).map(([key, value]) => ({
      key,
      value: convertValue(value),
    }));

    const eventPayload = {
      event_name: "storefront_order_cancelled",
      event_params: eventParams,
      items: lineItems.map((el) => ({
        variantId: el.id,
        productId: el.productId,
        quantity: el.quantity,
        ean: el.ean,
        mrp: el.mrp,
        price: el.price,
        sku: el.sku,
        title: el.title,
        variant: el.variant,
        currentInventory: el.currentInventory,
      })),
      event_date: new Date().toISOString(),
      timestamp: Date.now(),
    };

    await insertBigqueryEvent(eventPayload);
    return true;
  } catch (err) {
    // Never let a BigQuery failure block the cancellation response.
    console.error(
      "Failed to push storefront_order_cancelled event to BigQuery -->",
      err.message
    );
    return false;
  }
};

export { pushStorefrontOrderCancelledEvent };
