import RtoRefund from "../../../../utils/models/RtoRefund.js";
import clientProvider from "../../../../utils/clientProvider.js";
import { addOrderTags } from "../../exotel/controllers/shopify.js";
import { handleCashbackCancellation } from "../../cashback/controllers/index.js";
import { createMoengageEvent } from "../../moe/helpers/index.js";

/**
 * ============================================================================
 *  SAFETY: this file is only ever allowed to touch the dev store.
 * ============================================================================
 */
const ALLOWED_DEV_SHOPS = ["swiss-local-dev.myshopify.com"];
const CONFIGURED_SHOP = process.env.RTO_REFUND_SHOP;

const isDryRun = () => process.env.RTO_REFUND_DRY_RUN !== "false";

const RTO_TAG = "RTO";
const RTO_REFUND_TAG = "RTO_Refunded"; // prepaid: money was refunded
const RTO_RETURN_TAG = "RTO_Returned"; // COD: processed, but no money to refund

function assertSafeShop() {
  if (!CONFIGURED_SHOP) {
    throw new Error(
      "RTO_REFUND_SHOP env var is not set - refusing to run for safety"
    );
  }
  if (!ALLOWED_DEV_SHOPS.includes(CONFIGURED_SHOP)) {
    throw new Error(
      `Refusing to process: "${CONFIGURED_SHOP}" is not in the allow-listed ` +
        `dev store list (${ALLOWED_DEV_SHOPS.join(", ")}).`
    );
  }
  return CONFIGURED_SHOP;
}

const normalize = (v) =>
  (v || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const legacyId = (gid) => (gid ? String(gid).split("/").pop() : null);

/**
 * RTO status includes plain "RTO" as well as "RTO in-transit" - both
 * should trigger this flow. Anything with "rto" in the description/bucket
 * matches both.
 */
export const mapWebhookStatusToInternal = (payload) => {
  const description = normalize(payload?.clickpost_status_description);
  const bucket = normalize(payload?.clickpost_status_bucket_description);

  if (
    description.includes("rto") ||
    bucket.includes("rto") ||
    bucket.includes("returned")
  ) {
    return "rto";
  }
  if (description === "delivered" || bucket.includes("delivered")) {
    return "delivered";
  }
  if (description === "outfordelivery" || bucket.includes("outfordelivery")) {
    return "out-for-delivery";
  }
  if (
    ["intransit", "pickedup", "destinationhubin", "shipmentdelayed"].includes(
      description
    ) ||
    bucket.includes("transit")
  ) {
    return "in-transit";
  }
  return "other";
};

// NOTE: no `returns` field here - refundCreate doesn't need it, and
// querying it requires the read_returns scope, which we're avoiding.
const ORDER_FIELDS = `
  id
  name
  tags
  cancelledAt
  paymentGatewayNames
  customer {
    id
    firstName
    lastName
    email
    phone
    defaultPhoneNumber { phoneNumber }
  }
  fulfillments(first: 10) {
    fulfillmentLineItems(first: 50) {
      edges {
        node {
          id
          quantity
          lineItem { id }
        }
      }
    }
  }
`;

async function getShopifyOrder({ shop, orderIdFromClickpost }) {
  if (!orderIdFromClickpost) return null;
  const { client } = await clientProvider.offline.graphqlClient({ shop });

  if (/^\d+$/.test(String(orderIdFromClickpost))) {
    const gid = `gid://shopify/Order/${orderIdFromClickpost}`;
    const query = `
      query($id: ID!) {
        order: node(id: $id) {
          ... on Order { ${ORDER_FIELDS} }
        }
      }
    `;
    const { data } = await client.request(query, { variables: { id: gid } });
    if (data?.order) return data.order;
  }

  let orderName = String(orderIdFromClickpost);
  if (!orderName.includes("#")) orderName = `#${orderName}`;
  const query = `
    query {
      orders(first: 1, query: "name:${orderName}") {
        edges { node { ${ORDER_FIELDS} } }
      }
    }
  `;
  const { data } = await client.request(query);
  return data?.orders?.edges?.[0]?.node || null;
}

function buildRefundLineItems(order) {
  const items = [];
  for (const fulfillment of order?.fulfillments || []) {
    for (const edge of fulfillment?.fulfillmentLineItems?.edges || []) {
      const node = edge?.node;
      if (node?.lineItem?.id && node?.quantity > 0) {
        items.push({ lineItemId: node.lineItem.id, quantity: node.quantity });
      }
    }
  }
  return items;
}

/**
 * Process the money refund directly - refundCreate works on fulfilled
 * orders without needing a Return object or the returns scope.
 *
 * IMPORTANT: passing `transactions: []` to refundCreate does NOT refund
 * real money - it only marks line items as refunded with a $0 financial
 * transaction. To actually move money, we must first ask Shopify what
 * the correct refund transaction(s) should be (suggestedRefund ->
 * suggestedTransactions), then pass those explicitly.
 */
async function refundOriginalPayment({ shop, order, refundLineItems }) {
  if (!refundLineItems.length) {
    return { success: false, error: "No fulfilled line items to refund" };
  }

  const { client } = await clientProvider.offline.graphqlClient({ shop });

  // Step 1: ask Shopify what the real refund transactions should be.
  const suggestQuery = `
    query SuggestedRefund($id: ID!, $refundLineItems: [RefundLineItemInput!]) {
      order(id: $id) {
        suggestedRefund(refundLineItems: $refundLineItems) {
          amountSet { shopMoney { amount } }
          suggestedTransactions {
            parentTransaction { id }
            gateway
            kind
            amountSet { shopMoney { amount } }
          }
        }
      }
    }
  `;
  const { data: suggestData, errors: suggestErrors } = await client.request(
    suggestQuery,
    { variables: { id: order.id, refundLineItems } }
  );

  if (suggestErrors?.length) {
    return {
      success: false,
      error: `suggestedRefund query failed: ${suggestErrors
        .map((e) => e.message)
        .join(", ")}`,
    };
  }

  const suggested = suggestData?.order?.suggestedRefund;
  const suggestedTxns = suggested?.suggestedTransactions || [];

  if (!suggestedTxns.length) {
    // Nothing Shopify considers refundable (e.g. order was never actually
    // paid) - don't silently "succeed" with $0 moved, surface it instead.
    return {
      success: false,
      error: `No suggested refund transactions from Shopify (suggested amount: ${
        suggested?.amountSet?.shopMoney?.amount ?? "unknown"
      }) - order may not have a real payment to refund.`,
    };
  }

  const query = `
    mutation RefundCreate($input: RefundInput!) {
      refundCreate(input: $input) {
        refund {
          id
          totalRefundedSet { presentmentMoney { amount currencyCode } }
        }
        userErrors { field message }
      }
    }
  `;
  const variables = {
    input: {
      orderId: order.id,
      notify: true,
      refundLineItems,
      transactions: suggestedTxns.map((t) => ({
        orderId: order.id,
        parentId: t.parentTransaction?.id,
        gateway: t.gateway,
        kind: "REFUND",
        amount: t.amountSet?.shopMoney?.amount,
      })),
    },
  };

  const { data, errors } = await client.request(query, { variables });
  const userErrors = data?.refundCreate?.userErrors || [];

  if (errors?.length) {
    return { success: false, error: errors.map((e) => e.message).join(", ") };
  }
  if (userErrors.length) {
    return {
      success: false,
      error: userErrors.map((e) => e.message).join(", "),
    };
  }

  const refundedAmount =
    data?.refundCreate?.refund?.totalRefundedSet?.presentmentMoney?.amount;
  console.log(
    `[rto-refund] refundCreate succeeded for ${order.name}: refunded ${refundedAmount}`
  );

  return { success: true, refundedAmount };
}

/**
 * Best-effort cashback wallet reversal - runs for BOTH COD and prepaid,
 * since cashback usage is tracked independently of the payment gateway.
 * Never throws - a cashback issue should not block the rest of the flow.
 *
 * Returns the amount actually credited back to the wallet (0 if the
 * order never used cashback, or if reversal failed).
 */
async function reverseCashbackIfUsed(order) {
  try {
    const result = await handleCashbackCancellation({
      id: Number(legacyId(order.id)),
      order_number: (order.name || "").replace("#", ""),
      customer: {
        id: order.customer?.id ? Number(legacyId(order.customer.id)) : null,
        first_name: order.customer?.firstName,
        last_name: order.customer?.lastName,
        phone: order.customer?.phone,
        email: order.customer?.email,
      },
    });
    return Number(result?.refundableCreditedToWallet || 0);
  } catch (err) {
    console.log(
      `[rto-refund] Cashback reversal failed for order ${order.name}: ${err.message}`
    );
    return 0;
  }
}

export const processRtoWebhookEvent = async (payload) => {
  const waybill = payload?.waybill;
  const orderIdFromClickpost = payload?.additional?.order_id;
  const notificationEventId = payload?.additional?.notification_event_id;
  const clickpostStatus = payload?.clickpost_status_description;

  const internalStatus = mapWebhookStatusToInternal(payload);

  if (internalStatus !== "rto") {
    return {
      handled: false,
      reason: `status "${clickpostStatus}" is not RTO, ignoring`,
    };
  }
  if (!waybill) {
    return { handled: false, reason: "waybill missing in payload" };
  }

  const shop = assertSafeShop();

  // Step 3: Mongo idempotency check.
  const existing = await RtoRefund.findOne({ waybill, shop }).sort({
    createdAt: -1,
  });
  if (
    existing &&
    ["refund_completed", "returned_completed", "dry_run"].includes(
      existing.status
    )
  ) {
    return {
      handled: false,
      reason: `waybill ${waybill} already processed (status: ${existing.status})`,
    };
  }

  const order = await getShopifyOrder({ shop, orderIdFromClickpost });

  if (!order) {
    await RtoRefund.create({
      shop,
      waybill,
      orderIdFromClickpost,
      notificationEventId,
      status: "failed",
      clickpostStatus,
      error: "Shopify order not found",
      rawPayload: payload,
    });
    return {
      handled: false,
      reason: `Shopify order not found for order_id "${orderIdFromClickpost}"`,
    };
  }

  const alreadyTagged =
    (order.tags || [])
      .map((t) => t.toLowerCase())
      .includes(RTO_REFUND_TAG.toLowerCase()) ||
    (order.tags || [])
      .map((t) => t.toLowerCase())
      .includes(RTO_RETURN_TAG.toLowerCase());

  if (alreadyTagged) {
    await RtoRefund.create({
      shop,
      waybill,
      orderId: order.id,
      orderName: order.name,
      notificationEventId,
      status: "skipped",
      clickpostStatus,
      error: "Order already RTO-processed",
      rawPayload: payload,
    });
    return {
      handled: false,
      reason: `Order ${order.name} already RTO-processed, skipping`,
    };
  }

  const paymentGatewayNames = (order?.paymentGatewayNames || []).map((el) =>
    String(el || "").toLowerCase()
  );
  const isCod = paymentGatewayNames.some(
    (el) =>
      el.includes("cash_on_delivery") ||
      el.includes("cod") ||
      el.includes("gokwik")
  );

  const refundLineItems = buildRefundLineItems(order);

  if (isDryRun()) {
    console.log(
      `[rto-refund][DRY RUN] Would process order ${order.name} ` +
        `(waybill ${waybill}, ${
          isCod ? "COD - no money refund" : "PREPAID - will refund"
        }), then reverse any cashback used, on ${shop}.`
    );
    await RtoRefund.create({
      shop,
      waybill,
      orderId: order.id,
      orderName: order.name,
      notificationEventId,
      status: "dry_run",
      clickpostStatus,
      isCod,
      rawPayload: payload,
    });
    return { handled: true, dryRun: true, order: order.name, isCod };
  }

  // Step 4a: for prepaid orders only, issue the real money refund.
  let refundResult = { success: true };
  if (!isCod) {
    refundResult = await refundOriginalPayment({
      shop,
      order,
      refundLineItems,
    });

    if (!refundResult.success) {
      await RtoRefund.create({
        shop,
        waybill,
        orderId: order.id,
        orderName: order.name,
        notificationEventId,
        status: "failed",
        clickpostStatus,
        isCod,
        error: `Refund failed: ${refundResult.error}`,
        rawPayload: payload,
      });
      return {
        handled: false,
        reason: `Refund failed: ${refundResult.error}`,
      };
    }
  }

  // Step 4b: cashback wallet reversal - runs regardless of COD/prepaid.
  const cashbackRefundedAmount = await reverseCashbackIfUsed(order);

  // Step 4c: tags.
  const tags = isCod ? [RTO_TAG, RTO_RETURN_TAG] : [RTO_TAG, RTO_REFUND_TAG];
  await addOrderTags(order.id, tags);

  const customerName = [order.customer?.firstName, order.customer?.lastName]
    .filter(Boolean)
    .join(" ");
  const customerPhone =
    order?.customer?.defaultPhoneNumber?.phoneNumber || order?.customer?.phone;

  await RtoRefund.create({
    shop,
    waybill,
    orderId: order.id,
    orderName: order.name,
    notificationEventId,
    status: isCod ? "returned_completed" : "refund_completed",
    clickpostStatus,
    isCod,
    customerName,
    customerPhone,
    refundedAmount: isCod ? 0 : Number(refundResult.refundedAmount || 0),
    cashbackRefundedAmount,
    rawPayload: payload,
  });

  // Step 5: MoEngage push.
  const phone =
    order?.customer?.defaultPhoneNumber?.phoneNumber || order?.customer?.phone;
  if (phone) {
    await createMoengageEvent({
      eventName: "rto_refund_processed",
      customerPhone: phone,
      params: { order_name: order.name, waybill, is_cod: isCod },
    });
  } else {
    console.log(
      `[rto-refund] No customer phone on order ${order.name}, skipping MoEngage push`
    );
  }

  return { handled: true, order: order.name, isCod };
};
