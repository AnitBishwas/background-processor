import clientProvider from "../../../../utils/clientProvider.js";
import OrderCancellationLog from "../../../../utils/models/OrderCancellationLog.js";
import { pushStorefrontOrderCancelledEvent } from "../helpers/bigQueryEvent.js";

const MAX_REASON_LENGTH = 200;
const CANCELLATION_TAG = "cancledbycustomer";

/* -------------------------------------------------------------------------- */
/*  Eligibility rules                                                         */
/* -------------------------------------------------------------------------- */

const normaliseOrderName = (orderName) => {
  if (!orderName) return null;
  const trimmed = orderName.toString().trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
};

const isOrderFulfilled = (order) => {
  if ((order?.fulfillments || []).length > 0) return true;
  return Boolean(
    order?.displayFulfillmentStatus &&
      order.displayFulfillmentStatus !== "UNFULFILLED"
  );
};

/**
 * 1) unfulfilled -> allowed
 * 2) fulfilled    -> NOT allowed (already fulfilled)
 */
const checkCancellationEligibility = (order) => {
  if (!order) {
    return {
      allowed: false,
      code: "ORDER_NOT_FOUND",
      message: "Order not found.",
    };
  }

  if (order.cancelledAt) {
    return {
      allowed: false,
      code: "ALREADY_CANCELLED",
      message: "This order has already been cancelled.",
    };
  }

  if (isOrderFulfilled(order)) {
    return {
      allowed: false,
      code: "ORDER_ALREADY_FULFILLED",
      message:
        "Your order has already been processed/fulfilled, so it can no longer be cancelled.",
    };
  }

  return {
    allowed: true,
    code: "ELIGIBLE",
    message: "Order is eligible for cancellation.",
  };
};

/* -------------------------------------------------------------------------- */
/*  Customer ownership check                                                  */
/* -------------------------------------------------------------------------- */

const normaliseCustomerGid = (gid) =>
  gid ? String(gid).replace("gid://shopify/Customer/", "") : null;

/**
 * Shopify's App Proxy appends `logged_in_customer_id` to the query string
 * only when the storefront visitor is logged into a customer account, and
 * only after verifying the signed request (verifyProxy middleware runs
 * before this controller) - so this value can be trusted, it cannot be
 * spoofed by the client.
 */
const isOwnerByCustomerId = (order, loggedInCustomerId) => {
  if (!loggedInCustomerId) return false;
  const orderCustomerId = normaliseCustomerGid(order?.customer?.id);
  return (
    Boolean(orderCustomerId) &&
    String(orderCustomerId) === String(loggedInCustomerId)
  );
};

/**
 * The reason is customer-typed/selected free text - never trust it as-is.
 * Trim, cap the length (defensive against abuse), and fall back to a
 * sensible default if nothing was sent.
 */
const sanitiseCancellationReason = (reason) => {
  const trimmed = (reason || "").toString().trim();
  if (!trimmed) return "Not specified";
  return trimmed.slice(0, MAX_REASON_LENGTH);
};

/* -------------------------------------------------------------------------- */
/*  Shopify - fetch order                                                     */
/* -------------------------------------------------------------------------- */

const ORDER_FIELDS = `
  id
  name
  tags
  createdAt
  cancelledAt
  displayFulfillmentStatus
  displayFinancialStatus
  discountCodes
  totalDiscountsSet { presentmentMoney { amount } }
  currentTotalPriceSet { presentmentMoney { amount } }
  totalShippingPriceSet { presentmentMoney { amount } }
  customAttributes { key value }
  customer {
    id
    displayName
    defaultEmailAddress { emailAddress }
    defaultPhoneNumber { phoneNumber }
  }
  fulfillments(first: 1) { id }
  lineItems(first: 50) {
    edges {
      node {
        quantity
        variant {
          id
          sku
          barcode
          price
          compareAtPrice
          title
          inventoryQuantity
          product { id title tags }
        }
      }
    }
  }
`;

/**
 * `status:any` is required - Shopify's default order search excludes
 * cancelled/archived orders, which would otherwise make an already-cancelled
 * order look like it doesn't exist.
 */
const getOrderByName = async (orderName, shop) => {
  const name = normaliseOrderName(orderName);
  if (!name) throw new Error("order_name missing");

  const query = `
    query {
      orders(first: 1, query: "name:${name} status:any") {
        edges { node { ${ORDER_FIELDS} } }
      }
    }
  `;

  const { client } = await clientProvider.offline.graphqlClient({ shop });
  const { data } = await client.request(query);

  return data?.orders?.edges?.[0]?.node || null;
};

/* -------------------------------------------------------------------------- */
/*  Shopify - cancel order                                                    */
/* -------------------------------------------------------------------------- */

const CANCEL_ORDER_MUTATION = `
  mutation OrderCancel(
    $orderId: ID!,
    $notifyCustomer: Boolean,
    $refundMethod: OrderCancelRefundMethodInput,
    $restock: Boolean!,
    $reason: OrderCancelReason!,
    $staffNote: String
  ) {
    orderCancel(
      orderId: $orderId,
      notifyCustomer: $notifyCustomer,
      refundMethod: $refundMethod,
      restock: $restock,
      reason: $reason,
      staffNote: $staffNote
    ) {
      job { id done }
      orderCancelUserErrors { field message code }
      userErrors { field message }
    }
  }
`;

const TAGS_ADD_MUTATION = `
  mutation TagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors { field message }
    }
  }
`;

const ORDER_UPDATE_NOTE_MUTATION = `
  mutation OrderUpdateNote($input: OrderInput!) {
    orderUpdate(input: $input) {
      userErrors { field message }
    }
  }
`;

/**
 * Best-effort - tagging the order must never fail the overall cancellation,
 * the order is already cancelled in Shopify by the time this runs.
 */
const addCancellationTag = async (order, shop) => {
  try {
    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const { errors, data } = await client.request(TAGS_ADD_MUTATION, {
      variables: { id: order.id, tags: [CANCELLATION_TAG] },
    });

    const userErrors = data?.tagsAdd?.userErrors || [];
    if (errors?.length || userErrors.length) {
      console.error(
        "Failed to add cancellation tag -->",
        errors?.map((e) => e.message).join(", ") ||
          userErrors.map((e) => e.message).join(", ")
      );
    }
  } catch (err) {
    console.error("Failed to add cancellation tag -->", err.message);
  }
};

/**
 * Writes the customer's cancellation reason into the order's "Notes" field
 * (the field shown in the Shopify admin order sidebar) - separate from
 * staffNote, which only appears in the order's activity timeline.
 */
const addCancellationNote = async (order, shop, cancellationReason) => {
  try {
    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const { errors, data } = await client.request(ORDER_UPDATE_NOTE_MUTATION, {
      variables: {
        input: {
          id: order.id,
          note: `Cancelled by customer. Reason: ${cancellationReason}`,
        },
      },
    });

    const userErrors = data?.orderUpdate?.userErrors || [];
    if (errors?.length || userErrors.length) {
      console.error(
        "Failed to add cancellation note -->",
        errors?.map((e) => e.message).join(", ") ||
          userErrors.map((e) => e.message).join(", ")
      );
    }
  } catch (err) {
    console.error("Failed to add cancellation note -->", err.message);
  }
};

/**
 * Cancels the order in Shopify with a full refund + restock, records the
 * customer's reason in the order's staff note, and tags the order. Cashback
 * is reversed automatically by Shopify's own order-cancelled flow.
 */
const cancelOrderInShopify = async (order, shop, cancellationReason) => {
  const variables = {
    orderId: order.id,
    notifyCustomer: true,
    restock: true,
    reason: "CUSTOMER",
    staffNote: `Order cancelled by customer via storefront cancel button. Reason: ${cancellationReason}`,
    refundMethod: { originalPaymentMethodsRefund: true },
  };

  const { client } = await clientProvider.offline.graphqlClient({ shop });
  const { data, errors } = await client.request(CANCEL_ORDER_MUTATION, {
    variables,
  });

  const userErrors = [
    ...(data?.orderCancel?.orderCancelUserErrors || []),
    ...(data?.orderCancel?.userErrors || []),
  ];

  if (errors?.length) {
    return { success: false, error: errors.map((e) => e.message).join(", ") };
  }
  if (userErrors.length) {
    return {
      success: false,
      error: userErrors.map((e) => `${e.code || ""} ${e.message}`).join(", "),
    };
  }

  const refundInitiated = [
    "PAID",
    "PARTIALLY_PAID",
    "PARTIALLY_REFUNDED",
  ].includes(order?.displayFinancialStatus);

  // Fire-and-log, never blocks the response.
  await addCancellationTag(order, shop);
  await addCancellationNote(order, shop, cancellationReason);

  return {
    success: true,
    job: data?.orderCancel?.job || null,
    refundInitiated,
  };
};

/* -------------------------------------------------------------------------- */
/*  MongoDB status logging                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Records every attempt (blocked, failed, or cancelled) so there's always
 * an audit trail. Never throws - a logging failure must not break the
 * actual cancel/check flow.
 */
const logCancellationStatusInMongo = async ({
  shop,
  order,
  status, // "cancelled" | "blocked" | "failed"
  reasonCode,
  reasonMessage,
  cancellationReason,
  refundInitiated = false,
  bigQueryEventSent = false,
}) => {
  try {
    return await OrderCancellationLog.create({
      shop,
      orderId: order.id,
      orderName: order.name,
      customerId: order?.customer?.id || null,
      cancellationReason,
      status,
      reasonCode,
      reasonMessage,
      orderCreatedAt: order.createdAt,
      cancelledAt:
        status === "cancelled" ? new Date() : order.cancelledAt || null,
      refundInitiated,
      bigQueryEventSent,
    });
  } catch (err) {
    console.error(
      "Failed to log order cancellation status in Mongo -->",
      err.message
    );
    return null;
  }
};

/* -------------------------------------------------------------------------- */
/*  Express controllers                                                       */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/proxy_route/order-cancel/check
 * Query (added by Shopify): logged_in_customer_id, shop, signature
 * Body: { order_name }
 */
const checkOrderCancellationEligibilityController = async (req, res) => {
  try {
    const loggedInCustomerId = req.query.logged_in_customer_id;
    const { order_name } = req.body || {};
    const shop = res.locals.user_shop;

    if (!loggedInCustomerId) {
      return res
        .status(401)
        .json({
          success: false,
          error: "You must be logged in to check this order.",
        });
    }
    if (!order_name) {
      return res
        .status(400)
        .json({ success: false, error: "order_name is required" });
    }

    const order = await getOrderByName(order_name, shop);

    if (!order || !isOwnerByCustomerId(order, loggedInCustomerId)) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    const eligibility = checkCancellationEligibility(order);

    return res.status(200).json({
      success: true,
      allowed: eligibility.allowed,
      code: eligibility.code,
      message: eligibility.message,
      order: {
        name: order.name,
        createdAt: order.createdAt,
        cancelledAt: order.cancelledAt,
        displayFulfillmentStatus: order.displayFulfillmentStatus,
      },
    });
  } catch (err) {
    console.error("checkOrderCancellationEligibilityController -->", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/proxy_route/order-cancel/cancel
 * Query (added by Shopify): logged_in_customer_id, shop, signature
 * Body: { order_name, reason }
 */
const cancelOrderController = async (req, res) => {
  try {
    const loggedInCustomerId = req.query.logged_in_customer_id;
    const { order_name, reason } = req.body || {};
    const shop = res.locals.user_shop;
    const cancellationReason = sanitiseCancellationReason(reason);

    if (!loggedInCustomerId) {
      return res
        .status(401)
        .json({
          success: false,
          error: "You must be logged in to cancel this order.",
        });
    }
    if (!order_name) {
      return res
        .status(400)
        .json({ success: false, error: "order_name is required" });
    }

    const order = await getOrderByName(order_name, shop);

    if (!order || !isOwnerByCustomerId(order, loggedInCustomerId)) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    // Always re-check eligibility server-side, never trust the earlier /check call.
    const eligibility = checkCancellationEligibility(order);

    if (!eligibility.allowed) {
      await logCancellationStatusInMongo({
        shop,
        order,
        status: "blocked",
        reasonCode: eligibility.code,
        reasonMessage: eligibility.message,
        cancellationReason,
      });
      return res.status(409).json({
        success: false,
        allowed: false,
        code: eligibility.code,
        error: eligibility.message,
      });
    }

    const result = await cancelOrderInShopify(order, shop, cancellationReason);

    if (!result.success) {
      await logCancellationStatusInMongo({
        shop,
        order,
        status: "failed",
        reasonCode: "SHOPIFY_ERROR",
        reasonMessage: result.error,
        cancellationReason,
      });
      return res.status(502).json({ success: false, error: result.error });
    }

    await logCancellationStatusInMongo({
      shop,
      order,
      status: "cancelled",
      reasonCode: eligibility.code,
      reasonMessage: eligibility.message,
      cancellationReason,
      refundInitiated: result.refundInitiated,
      bigQueryEventSent: true,
    });

    await pushStorefrontOrderCancelledEvent(order, {
      shop,
      reasonCode: eligibility.code,
      cancellationReason,
      refundInitiated: result.refundInitiated,
    });

    return res.status(200).json({
      success: true,
      message: "Order cancelled successfully.",
      order: { name: order.name },
      refundInitiated: result.refundInitiated,
    });
  } catch (err) {
    console.error("cancelOrderController -->", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

export { checkOrderCancellationEligibilityController, cancelOrderController };