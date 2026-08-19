import { insertBigqueryEvent } from "../../../analytics/helpers/index.js";

const convertValue = (value) => {
  if (typeof value === "string") return { string_value: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { int_value: value }
      : { float_value: value };
  }
  if (typeof value === "boolean") return { string_value: value.toString() };
  return { string_value: JSON.stringify(value) };
};

/**
 * Pushes a "storefront_order_cancelled" event into BigQuery whenever a
 * customer successfully cancels their own order.
 */
const pushStorefrontOrderCancelledEvent = async (
  order,
  { shop, reasonCode, cancellationReason, refundInitiated }
) => {
  try {
    const structuredData = {
      orderId: order?.name,
      shopifyOrderId: String(order?.id || "").replace(
        "gid://shopify/Order/",
        ""
      ),
      shop: shop || "",
      customerId: order?.customer?.id
        ? String(order.customer.id).replace("gid://shopify/Customer/", "")
        : null,
      orderCreatedAt: order?.createdAt,
      cancelledAt: new Date().toISOString(),
      reasonCode: reasonCode || "ELIGIBLE",
      cancellationReason: cancellationReason || "Not specified",
      refundInitiated: Boolean(refundInitiated),
      source: "storefront_cancel_button",
    };

    const eventParams = Object.entries(structuredData).map(([key, value]) => ({
      key,
      value: convertValue(value),
    }));

    await insertBigqueryEvent({
      event_name: "storefront_order_cancelled",
      event_params: eventParams,
      event_date: new Date().toISOString(),
      timestamp: Date.now(),
    });

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
