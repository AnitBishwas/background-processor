import { getTrackingStatusFromClickPost } from "./clickpost.js";
import clientProvider from "../../../../utils/clientProvider.js";

const shop =
  process.env.NODE_ENV === "dev"
    ? "swiss-local-dev.myshopify.com"
    : "swiss-beauty-dev.myshopify.com";

const safeArray = (value) => (Array.isArray(value) ? value : []);

const isCodOrder = (order) => {
  const values = [
    ...safeArray(order?.paymentGatewayNames),
    ...safeArray(order?.tags),
  ];

  return values.some((el) => {
    const value = String(el || "")
      .toLowerCase()
      .replace(/[\s_-]+/g, "");

    return (
      value.includes("cod") ||
      value.includes("cashondelivery") ||
      value.includes("gokwikcod")
    );
  });
};

const normalisePhoneNumber = (phone) => {
  if (!phone) return null;

  let digits = phone.toString().replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("0")) digits = digits.substring(1);
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.substring(2);
  if (digits.length !== 10) return null;

  return `+91${digits}`;
};

const normalisePhoneForMatch = (phone) => {
  if (!phone) return null;

  let digits = phone.toString().replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("0")) digits = digits.substring(1);
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.substring(2);
  if (digits.length !== 10) return null;

  return digits;
};

const isCallerPhoneMatchedWithOrder = (order, callerPhone) => {
  const caller = normalisePhoneForMatch(callerPhone);
  if (!caller) return false;

  const orderPhones = [
    order?.phone,
    order?.customer?.phone,
    order?.customer?.defaultPhoneNumber?.phoneNumber,
    order?.shippingAddress?.phone,
    order?.billingAddress?.phone,
  ];

  return orderPhones.some((phone) => {
    const orderPhone = normalisePhoneForMatch(phone);
    return orderPhone && orderPhone === caller;
  });
};

const isWithinCancellationWindow = (order) => {
  if (!order?.createdAt) return false;

  const createdAt = new Date(order.createdAt).getTime();
  const diffMinutes = (Date.now() - createdAt) / (1000 * 60);

  return diffMinutes <= 30;
};

const orderNodeFields = `
  id
  name
  phone
  createdAt
  returnStatus
  cancelledAt
  tags
  confirmed
  paymentGatewayNames
  shippingAddress {
    phone
  }
  billingAddress {
    phone
  }
  customer {
    phone
    defaultPhoneNumber {
      phoneNumber
    }
  }
  currentTotalPriceSet {
    shopMoney {
      amount
    }
  }
  refunds(first: 50) {
    createdAt
    totalRefunded {
      amount
    }
  }
  fulfillments(first: 50) {
    trackingInfo {
      number
      company
      url
    }
  }
`;

const getCustomerIdByPhoneNumber = async (phone) => {
  try {
    phone = normalisePhoneNumber(phone);

    if (!phone) throw new Error("Invalid phone number");

    const query = `
      query($identifier: CustomerIdentifierInput!) {
        customer: customerByIdentifier(identifier: $identifier) {
          id
        }
      }
    `;

    const variables = {
      identifier: {
        phoneNumber: phone,
      },
    };

    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const { data } = await client.request(query, { variables });

    const response = data?.customer?.id || null;

    if (!response) throw new Error("No customer found");

    return response.replace("gid://shopify/Customer/", "");
  } catch (err) {
    throw new Error(
      "Failed to get customer by phone number reason --> " + err.message
    );
  }
};

const getOrderTrackingInfo = async (order) => {
  try {
    const fulfillments = safeArray(order?.fulfillments);
    if (!fulfillments.length) return null;

    const latestFulfillment = fulfillments[fulfillments.length - 1];
    const trackingInfo = latestFulfillment?.trackingInfo?.[0];

    if (!trackingInfo) return null;

    const awb = trackingInfo?.number;
    if (!awb) return null;

    return await getTrackingStatusFromClickPost({
      awb,
      shopifyOrder: order,
    });
  } catch {
    return null;
  }
};

const attachTrackingToOrder = async (order) => {
  try {
    order.tracking = await getOrderTrackingInfo(order);
  } catch {
    order.tracking = null;
  }

  return order;
};

const getOrderByCustomerId = async (customerId) => {
  try {
    const query = `
      query {
        orders(first: 1, query: "customer_id:${customerId}", reverse: true) {
          edges {
            node {
              ${orderNodeFields}
            }
          }
        }
      }
    `;

    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const { data } = await client.request(query);

    let order = data?.orders?.edges?.[0];

    if (!order) return null;

    order = order.node;

    return await attachTrackingToOrder(order);
  } catch (err) {
    throw new Error("Failed to get customer order reason --> " + err.message);
  }
};

const getOrderByOrderName = async (orderName) => {
  try {
    if (!orderName.includes("#")) orderName = `#${orderName}`;

    const query = `
      query {
        orders(first: 1, query: "name:${orderName}") {
          edges {
            node {
              ${orderNodeFields}
            }
          }
        }
      }
    `;

    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const { data } = await client.request(query);

    let order = data?.orders?.edges?.[0];

    if (!order) return null;

    order = order.node;

    return await attachTrackingToOrder(order);
  } catch (err) {
    throw new Error(
      "Failed to get order by order name reason --> " + err.message
    );
  }
};

const getOrderTags = (order) =>
  Array.isArray(order?.tags)
    ? order.tags.map((el) => String(el || "").toLowerCase())
    : String(order?.tags || "")
        .split(",")
        .map((el) => el.trim().toLowerCase());

const hasRefundAmount = (order) => {
  const refunds = safeArray(order?.refunds);

  return refunds.some(
    (refund) => Number(refund?.totalRefunded?.amount || 0) > 0
  );
};

const mapOrderStatus = async (order) => {
  try {
    const orderTags = getOrderTags(order);
    const isCod = isCodOrder(order);

    if (hasRefundAmount(order) || orderTags.includes("refund_credited")) {
      return "refund_successfull";
    }

    if (order?.cancelledAt) {
      return "cancelled";
    }

    if (!isCod && orderTags.includes("refund_initiated")) {
      return "refund_initiated";
    }

    const tracking = order?.tracking || null;

    if (tracking?.success && tracking?.current_status) {
      return tracking.current_status;
    }

    if (orderTags.includes("rto") || orderTags.includes("returned")) {
      return "returned";
    }

    if (orderTags.includes("delivered")) return "delivered";
    if (orderTags.includes("undelivered")) return "attempted_delivery";
    if (orderTags.includes("in-transit")) return "in-transit";

    if (safeArray(order?.fulfillments).length > 0) return "packed";

    if (order?.confirmed) return "placed";

    return null;
  } catch (err) {
    throw new Error("Failed to map order status reason --> " + err.message);
  }
};

const checkOrderCancellationEligibility = async (order) => {
  try {
    const currentStatus = await mapOrderStatus(order);
    const fulfillments = safeArray(order?.fulfillments);

    if (order?.cancelledAt || currentStatus === "cancelled") {
      return {
        allowed: false,
        reason: "already_cancelled",
        status: currentStatus,
      };
    }

    if (!isWithinCancellationWindow(order)) {
      return {
        allowed: false,
        reason: "more_than_30_minutes",
        status: currentStatus,
      };
    }

    if (fulfillments.length === 0) {
      return {
        allowed: true,
        reason: "unfulfilled_order",
        status: currentStatus,
      };
    }

    if (currentStatus === "packed" || currentStatus === "placed") {
      return {
        allowed: true,
        reason: "pre_shipped_order",
        status: currentStatus,
      };
    }

    return {
      allowed: false,
      reason: "already_fulfilled_or_shipped",
      status: currentStatus || "in-transit",
    };
  } catch (err) {
    throw new Error(
      "Failed to check order cancellation eligibility reason --> " + err.message
    );
  }
};

const addOrderTags = async (orderId, tags = []) => {
  try {
    if (!orderId || !tags.length) {
      return {
        success: false,
        error: "Order id or tags missing",
      };
    }

    const query = `
      mutation TagsAdd($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          node {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      id: orderId,
      tags,
    };

    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const { data, errors } = await client.request(query, { variables });

    const userErrors = data?.tagsAdd?.userErrors || [];

    if (errors?.length) {
      return {
        success: false,
        error: errors.map((e) => e.message).join(", "),
      };
    }

    if (userErrors.length) {
      return {
        success: false,
        error: userErrors.map((e) => e.message).join(", "),
      };
    }

    return {
      success: true,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
};

const cancelOrder = async (order) => {
  try {
    const query = `
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
          job {
            id
            done
          }
          orderCancelUserErrors {
            field
            message
            code
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const isCod = isCodOrder(order);

    const variables = {
      orderId: order.id,
      notifyCustomer: true,
      restock: true,
      reason: "CUSTOMER",
      staffNote: "Order cancelled via IVR",
      refundMethod: isCod
        ? null
        : {
            originalPaymentMethodsRefund: true,
          },
    };

    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const { data, errors } = await client.request(query, { variables });

    const userErrors = [
      ...(data?.orderCancel?.orderCancelUserErrors || []),
      ...(data?.orderCancel?.userErrors || []),
    ];

    if (errors?.length) {
      return {
        success: false,
        error: errors.map((e) => e.message).join(", "),
      };
    }

    if (userErrors.length) {
      return {
        success: false,
        error: userErrors.map((e) => `${e.code || ""} ${e.message}`).join(", "),
      };
    }

    const tagResponse = await addOrderTags(order.id, ["Ivr_cancel"]);

    return {
      success: true,
      job: data?.orderCancel?.job || null,
      tagResponse,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
};

const getOrderStatusByPhoneNumber = async (phone) => {
  try {
    if (!phone) throw new Error("Phone number not provided");

    const customerId = await getCustomerIdByPhoneNumber(phone);

    if (!customerId) {
      return {
        status: "no_order_against_phone",
      };
    }

    const order = await getOrderByCustomerId(customerId);

    if (!order) {
      return {
        status: "no_order_against_phone",
      };
    }

    const orderStatus = await mapOrderStatus(order);

    return {
      status: orderStatus,
      order,
    };
  } catch (err) {
    throw new Error(
      "Failed to get order status by phone number reason --> " + err.message
    );
  }
};

const getOrderStatusByName = async (orderName) => {
  try {
    if (!orderName) throw new Error("Order Id not provided");

    const order = await getOrderByOrderName(orderName);

    if (!order) {
      return {
        status: "no_order_against_orderId",
      };
    }

    const orderStatus = await mapOrderStatus(order);

    return {
      status: orderStatus,
      order,
    };
  } catch (err) {
    throw new Error(
      "Failed to get order status by order name reason --> " + err.message
    );
  }
};

const getOrderRefundStatusByOrderName = async (orderName) => {
  try {
    const order = await getOrderByOrderName(orderName);

    if (!order) {
      return {
        status: "no_order_found_orderId",
      };
    }

    const currentOrderStatus = await mapOrderStatus(order);
    const isCod = isCodOrder(order);

    const isCancelledLostDamaged =
      order?.cancelledAt ||
      currentOrderStatus === "cancelled" ||
      currentOrderStatus === "lost" ||
      currentOrderStatus === "damaged";

    if (currentOrderStatus === "refund_successfull") {
      return {
        status: "refund_successfull",
        order,
      };
    }

    if (isCod && isCancelledLostDamaged) {
      return {
        status: "order_cod_refund_not_eligible",
        order,
        statusText: currentOrderStatus || "cancelled",
      };
    }

    if (currentOrderStatus === "refund_initiated") {
      return {
        status: "refund_initiated",
        order,
      };
    }

    if (isCod) {
      return {
        status: "order_cod_refund_not_eligible",
        order,
        statusText: "Cash On Delivery",
      };
    }

    if (
      currentOrderStatus === "packed" ||
      currentOrderStatus === "in-transit" ||
      currentOrderStatus === "attempted_delivery" ||
      currentOrderStatus === "placed"
    ) {
      return {
        status: "order_status_refund_not_eligible",
        order,
        statusText: currentOrderStatus,
      };
    }

    return {
      status: "refund_status_unknown",
      order,
    };
  } catch (err) {
    throw new Error(
      "Failed to get order refund status by order name reason --> " +
        err.message
    );
  }
};

const getOrderRefundStatusByPhone = async (phone) => {
  try {
    if (!phone) throw new Error("Phone number not provided");

    const customerId = await getCustomerIdByPhoneNumber(phone);

    if (!customerId) {
      return {
        status: "no_customer_found_phone",
      };
    }

    const order = await getOrderByCustomerId(customerId);

    if (!order) {
      return {
        status: "no_order_found_orderId",
      };
    }

    const currentOrderStatus = await mapOrderStatus(order);
    const isCod = isCodOrder(order);

    const isCancelledLostDamaged =
      order?.cancelledAt ||
      currentOrderStatus === "cancelled" ||
      currentOrderStatus === "lost" ||
      currentOrderStatus === "damaged";

    if (currentOrderStatus === "refund_successfull") {
      return {
        status: "refund_successfull",
        order,
      };
    }

    if (isCod && isCancelledLostDamaged) {
      return {
        status: "order_cod_refund_not_eligible",
        order,
        statusText: currentOrderStatus || "cancelled",
      };
    }

    if (currentOrderStatus === "refund_initiated") {
      return {
        status: "refund_initiated",
        order,
      };
    }

    if (isCod) {
      return {
        status: "order_cod_refund_not_eligible",
        order,
        statusText: "Cash On Delivery",
      };
    }

    if (
      currentOrderStatus === "packed" ||
      currentOrderStatus === "in-transit" ||
      currentOrderStatus === "attempted_delivery" ||
      currentOrderStatus === "placed"
    ) {
      return {
        status: "order_status_refund_not_eligible",
        order,
        statusText: currentOrderStatus,
      };
    }

    return {
      status: "refund_status_unknown",
      order,
    };
  } catch (err) {
    throw new Error(
      "Failed to get order refund status by phone reason --> " + err.message
    );
  }
};

const cancelOrderByPhone = async (phone) => {
  try {
    if (!phone) throw new Error("Phone number not provided");

    const customerId = await getCustomerIdByPhoneNumber(phone);

    if (!customerId) {
      return { status: "no_customer_found_phone" };
    }

    const order = await getOrderByCustomerId(customerId);

    if (!order) {
      return { status: "no_order_against_phone" };
    }

    if (!isCallerPhoneMatchedWithOrder(order, phone)) {
      return {
        status: "order_phone_mismatch",
        order,
        statusText: "phone_mismatch",
      };
    }

    const eligibility = await checkOrderCancellationEligibility(order);

    if (eligibility.reason === "already_cancelled") {
      return {
        status: "order_already_cancelled",
        order,
        statusText: "cancelled",
      };
    }

    if (!eligibility.allowed) {
      return {
        status: "order_in_process",
        order,
        statusText: eligibility.status,
        reason: eligibility.reason,
      };
    }

    const orderCancellation = await cancelOrder(order);

    if (orderCancellation?.success) {
      return {
        status: "order_cancelled",
        order,
        statusText: "order_cancellation_successfull",
      };
    }

    return {
      status: "order_cancel_failed",
      order,
      statusText: orderCancellation?.error || "Shopify cancellation failed",
    };
  } catch (err) {
    throw new Error(
      "Failed to cancel order by phone reason --> " + err.message
    );
  }
};

const cancelOrderByOrderName = async (orderName, callerPhone) => {
  try {
    if (!orderName) throw new Error("Order id not provided");

    if (!callerPhone) {
      return {
        status: "order_phone_mismatch",
        statusText: "caller_phone_missing",
      };
    }

    const order = await getOrderByOrderName(orderName);

    if (!order) {
      return { status: "no_order_against_orderId" };
    }

    if (!isCallerPhoneMatchedWithOrder(order, callerPhone)) {
      return {
        status: "order_phone_mismatch",
        order,
        statusText: "phone_mismatch",
      };
    }

    const eligibility = await checkOrderCancellationEligibility(order);

    if (eligibility.reason === "already_cancelled") {
      return {
        status: "order_already_cancelled",
        order,
        statusText: "cancelled",
      };
    }

    if (!eligibility.allowed) {
      return {
        status: "order_in_process",
        order,
        statusText:
          eligibility.reason === "more_than_30_minutes"
            ? "more_than_30_minutes"
            : eligibility.status,
        reason: eligibility.reason,
      };
    }

    const orderCancellation = await cancelOrder(order);

    if (orderCancellation?.success) {
      return {
        status: "order_cancelled",
        order,
        statusText: "order_cancellation_successfull",
      };
    }

    return {
      status: "order_cancel_failed",
      order,
      statusText: orderCancellation?.error || "Shopify cancellation failed",
    };
  } catch (err) {
    throw new Error(
      "Failed to cancel order by order name reason --> " + err.message
    );
  }
};

const getLastFiverOrdersByCustomerId = async (customerId) => {
  try {
    const query = `
      query {
        orders(first: 5, query: "customer_id:${customerId}", reverse: true) {
          edges {
            node {
              name
            }
          }
        }
      }
    `;

    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const { data } = await client.request(query);

    const orders = data?.orders?.edges || [];

    return orders.map((el) => el.node.name);
  } catch (err) {
    throw new Error("Failed to get customer order reason --> " + err.message);
  }
};

const getOrderTrackingController = async (req, res) => {
  try {
    const { order_name } = req.body;

    if (!order_name) {
      return res.status(400).send({
        success: false,
        error: "order_name missing",
      });
    }

    const order = await getOrderByOrderName(order_name);

    if (!order) {
      return res.status(404).send({
        success: false,
        error: "Order not found",
      });
    }

    return res.send({
      success: true,
      data: order?.tracking || null,
    });
  } catch (err) {
    return res.status(500).send({
      success: false,
      error: err.message,
    });
  }
};

export {
  getOrderStatusByPhoneNumber,
  getOrderStatusByName,
  getOrderRefundStatusByPhone,
  getOrderRefundStatusByOrderName,
  cancelOrderByPhone,
  cancelOrderByOrderName,
  getCustomerIdByPhoneNumber,
  getOrderByCustomerId,
  getOrderByOrderName,
  cancelOrder,
  addOrderTags,
  getLastFiverOrdersByCustomerId,
  getOrderTrackingController,
};