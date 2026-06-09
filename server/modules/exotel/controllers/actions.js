import {
  cancelOrder,
  getCustomerIdByPhoneNumber,
  getOrderByCustomerId,
  getOrderByOrderName,
} from "./shopify.js";

const safeArray = (value) => (Array.isArray(value) ? value : []);

const normalize = (v) =>
  (v || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const formatDate = (date) => {
  if (!date) return null;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toDateString();
};

const getClickPostTracking = (order) => {
  return order?.tracking || {};
};

const getClickPostData = (order) => {
  return order?.tracking?.tracking_data || {};
};

const getLatestDate = (trackingData) => {
  return (
    trackingData?.latest_status?.timestamp ||
    trackingData?.latest_status?.time ||
    trackingData?.latest_status?.status_time ||
    trackingData?.latest_status?.created_at ||
    trackingData?.latest_status?.updated_at ||
    null
  );
};

const getEdd = (trackingData) => {
  return (
    trackingData?.courier_partner_edd ||
    trackingData?.edd ||
    trackingData?.estimated_delivery_date ||
    null
  );
};

const getClickPostDescription = (order) => {
  const trackingData = getClickPostData(order);

  return normalize(
    trackingData?.latest_status?.clickpost_status_description
  );
};

const isOrderCancellable = (order) => {
  const fulfillments = safeArray(order?.fulfillments);
  const tracking = getClickPostTracking(order);
  const currentStatus = tracking?.current_status;
  const clickpostDescription = getClickPostDescription(order);

  const cancellableClickPostDescriptions = [
    "orderplaced",
    "awbregistered",
    "pickuppending",
    "pickupfailed",
    "outforpickup",
  ];

  const nonCancellableStatuses = [
    "in-transit",
    "out-for-delivery",
    "delivered",
    "rto",
    "failed-delivery",
    "lost",
    "damaged",
  ];

  if (nonCancellableStatuses.includes(currentStatus)) {
    return false;
  }

  if (fulfillments.length === 0) {
    return true;
  }

  if (currentStatus === "packed") {
    return true;
  }

  if (cancellableClickPostDescriptions.includes(clickpostDescription)) {
    return true;
  }

  return false;
};

const getOrderStatusByPhone = async (phone) => {
  try {
    const customerId = await getCustomerIdByPhoneNumber(phone);

    if (!customerId) {
      throw new Error("No order exists for this phone number.");
    }

    const order = await getOrderByCustomerId(customerId);

    if (!order) {
      throw new Error("No order exists for this phone number.");
    }

    return mapOrderStatus(order);
  } catch (err) {
    console.log("Failed to get order status by phone reason -->" + err.message);
    return err.message;
  }
};

const getOrderStatusByOrderId = async (orderId) => {
  try {
    const order = await getOrderByOrderName(orderId);

    if (!order) {
      throw new Error("No order exists for this order id.");
    }

    return mapOrderStatus(order);
  } catch (err) {
    console.log(
      "Failed to get order status by order id reason -->" + err.message
    );
    throw new Error(err.message);
  }
};

const getOrderRefundStatusByPhone = async (phone) => {
  try {
    const customerId = await getCustomerIdByPhoneNumber(phone);

    if (!customerId) {
      throw new Error("No order exists for this phone number.");
    }

    const order = await getOrderByCustomerId(customerId);

    if (!order) {
      throw new Error("No order exists for this phone number");
    }

    return mapOrderRefundStatus(order);
  } catch (err) {
    console.log(
      "Failed to get refund status by phone reason -->" + err.message
    );
    return err.message;
  }
};

const getOrderRefundStatusByOrderId = async (orderId) => {
  try {
    const order = await getOrderByOrderName(orderId);

    if (!order) {
      throw new Error("No order exists for this order id.");
    }

    return mapOrderRefundStatus(order);
  } catch (err) {
    console.log(
      "Failed to get refund status by order id reason --->" + err.message
    );
    return err.message;
  }
};

const cancelOrderByPhone = async (phone) => {
  try {
    const customerId = await getCustomerIdByPhoneNumber(phone);

    if (!customerId) {
      throw new Error("No order exists for this phone number.");
    }

    const order = await getOrderByCustomerId(customerId);

    if (!order) {
      throw new Error("No order exists for this phone number.");
    }

    return await mapOrderCancellation(order);
  } catch (err) {
    console.log("Failed to cancel order by phone reason -->" + err.message);
    return err.message;
  }
};

const cancelOrderByOrderId = async (orderId) => {
  try {
    const order = await getOrderByOrderName(orderId);

    if (!order) {
      throw new Error("No order exists for this order id.");
    }

    return await mapOrderCancellation(order);
  } catch (err) {
    console.log("Failed to cancel order by order id reason -->" + err.message);
    return err.message;
  }
};

const mapOrderStatus = (order) => {
  try {
    const fulfillments = safeArray(order?.fulfillments);
    const tracking = getClickPostTracking(order);
    const trackingData = getClickPostData(order);

    const currentStatus = tracking?.current_status;
    const clickpostDescription = getClickPostDescription(order);

    console.log("STATUS AGAINST ORDER =>", currentStatus, tracking);
    console.log("CLICKPOST DESCRIPTION IN ACTIONS =>", clickpostDescription);

    if (order?.cancelledAt) {
      return `Your order was cancelled successfully on ${formatDate(
        order.cancelledAt
      )}. Prepaid orders are refunded automatically in 5 to 7 working days on source account.`;
    }

    if (fulfillments.length === 0) {
      return `Your order has been successfully confirmed and is expected to be delivered within 2 to 5 working days.
Note: Once your order is packed, we will share the tracking details with you on both email and WhatsApp, so you can follow the delivery every step of the way.`;
    }

    if (
      currentStatus === "packed" ||
      clickpostDescription === "orderplaced" ||
      clickpostDescription === "awbregistered" ||
      clickpostDescription === "pickuppending" ||
      clickpostDescription === "pickupfailed" ||
      clickpostDescription === "outforpickup"
    ) {
      return `Your order is packed and will be shipped in the next 24 to 48 hours. Once shipped, tracking details will be shared with you on WhatsApp and email.`;
    }

    if (!tracking?.success) {
      return `Your order is shipped. Tracking details are currently being updated. Kindly check your WhatsApp or email for the tracking link.`;
    }

    if (currentStatus === "delivered") {
      const deliveredDate = formatDate(getLatestDate(trackingData));

      if (deliveredDate) {
        return `Your order has been delivered to you on ${deliveredDate}.`;
      }

      return `Your order has been delivered to you.`;
    }

    if (currentStatus === "rto") {
      const rtoDate = formatDate(getLatestDate(trackingData));

      if (rtoDate) {
        return `Your order was marked as returned on ${rtoDate}. For prepaid orders, refunds are processed in 2 to 7 business days in original mode of payment.`;
      }

      return `Your order was marked as returned. For prepaid orders, refunds are processed in 2 to 7 business days in original mode of payment.`;
    }

    if (currentStatus === "lost") {
      return `Your order is currently marked as lost by the courier partner. After this message, we will help you connect with one of our executives for further assistance.`;
    }

    if (currentStatus === "damaged") {
      return `We’re sorry, but your order has been marked as damaged by the courier partner. Please select an option to connect with our support team for further assistance.`;
    }

    if (currentStatus === "failed-delivery") {
      const attemptDate = formatDate(getLatestDate(trackingData));

      if (attemptDate) {
        return `Delivery was attempted on ${attemptDate} but was unsuccessful. Delivery will now be reattempted on the next working day.`;
      }

      return `Delivery was attempted but was unsuccessful. Delivery will now be reattempted on the next working day.`;
    }

    if (currentStatus === "out-for-delivery") {
      return `Your order is out for delivery today. Please keep your phone available, as the delivery partner may contact you.`;
    }

    if (currentStatus === "in-transit") {
      const edd = formatDate(getEdd(trackingData));

      if (edd) {
        return `Your order is shipped and will be delivered to you by ${edd}. Kindly check your WhatsApp or email for the tracking link.`;
      }

      return `Your order is currently in transit and will be delivered to you soon. Kindly check your WhatsApp or email for the tracking link.`;
    }

    return `Your order is currently in transit and will be delivered to you soon. Kindly check your WhatsApp or email for the tracking link.`;
  } catch (err) {
    throw new Error("Failed to map order status reason -->" + err.message);
  }
};

const mapOrderRefundStatus = (order) => {
  try {
    const paymentGatewayNames = safeArray(order?.paymentGatewayNames);
    const tags = safeArray(order?.tags);

    const tracking = getClickPostTracking(order);
    const currentStatus = tracking?.current_status;

    const refundAmount = order?.currentTotalPriceSet?.shopMoney?.amount || null;

    const isCod = paymentGatewayNames.find(
      (el) => el === "cash_on_delivery" || el === "Gokwik PPCOD"
    );

    if (isCod) {
      return `Refund for your latest order is not eligible as you placed a cash on delivery order. To know about our refund policy, you can refer it on www.swissbeauty.in.`;
    }

    const refunds = safeArray(order?.refunds);

    if (refunds.length > 0) {
      const totalRefundedAmount = refunds
        .map((el) => Number(el?.totalRefunded?.amount || 0))
        .reduce((total, el) => total + el, 0);

      return `Refund for your latest order of amount ${totalRefundedAmount} was successfully credited in your original mode of payment and will reflect in your account in 2 to 5 working days. Please check your bank account for more details.`;
    }

    if (tags.includes("Refund_initiated")) {
      return `Refund for your latest order of amount ${refundAmount} was initiated successfully and will be credited within 2 to 7 working days in your original mode of payment from the date of initiation.`;
    }

    if (
      tags.includes("RTO") ||
      tags.includes("Returned") ||
      currentStatus === "rto"
    ) {
      return `Refund has not yet been initiated for your latest order of amount ${refundAmount}. After this message, we will help you connect with one of our executives who will assist you with your refund request.`;
    }

    if (currentStatus === "delivered") {
      return `Refund for your latest order of amount ${refundAmount} is not eligible as the current status of your order is delivered. To know about our refund policy, you can refer it on www.swissbeauty.in.`;
    }

    if (
      currentStatus === "in-transit" ||
      currentStatus === "out-for-delivery" ||
      currentStatus === "failed-delivery"
    ) {
      return `Refund for your latest order of amount ${refundAmount} is not eligible as the current status of your order is in transit. To know about our refund policy, you can refer it on www.swissbeauty.in.`;
    }

    return `Please note, for prepaid orders, it usually takes 2 to 7 working days for the refund to be credited in your source account.`;
  } catch (err) {
    throw new Error(
      "Failed to map order refund status reason -->" + err.message
    );
  }
};

const mapOrderCancellation = async (order) => {
  try {
    const paymentGatewayNames = safeArray(order?.paymentGatewayNames);
    const tracking = getClickPostTracking(order);
    const currentStatus = tracking?.current_status;
    const clickpostDescription = getClickPostDescription(order);

    const isOrderCancelled = order?.cancelledAt;

    const isCod = paymentGatewayNames.find(
      (el) => el === "cash_on_delivery" || el === "Gokwik PPCOD"
    );

    console.log("CANCEL CURRENT STATUS =>", currentStatus);
    console.log("CANCEL CLICKPOST DESCRIPTION =>", clickpostDescription);

    if (isOrderCancelled && isCod) {
      return `Your cash on delivery order placed on ${formatDate(
        isOrderCancelled
      )} is already cancelled.`;
    }

    if (isOrderCancelled && !isCod) {
      const refundAmount =
        order?.currentTotalPriceSet?.shopMoney?.amount || null;

      return `Your order placed on ${formatDate(
        isOrderCancelled
      )} is already cancelled. Your refund of amount ${refundAmount} is initiated and will be credited in your source account in 2 to 7 working days from the date of cancellation.`;
    }

    if (!isOrderCancellable(order)) {
      const readableStatus =
        currentStatus || clickpostDescription || "in transit";

      return `Your current order status is ${readableStatus}. Hence, it cannot be cancelled as we allow cancellation only before your order gets packed.`;
    }

    const makeCancelRequest = await cancelOrder(order);

    if (!makeCancelRequest) {
      return `Failed to cancel your order. Please connect with our executives.`;
    }

    if (makeCancelRequest?.success === false) {
      console.log("CANCEL ORDER ERROR =>", makeCancelRequest?.error);

      return `Failed to cancel your order. Please connect with our executives.`;
    }

    if (isCod) {
      return `Your cash on delivery order placed on ${formatDate(
        order?.createdAt
      )} is cancelled.`;
    }

    const refundAmount =
      order?.currentTotalPriceSet?.shopMoney?.amount || null;

    return `Your order placed on ${formatDate(
      order?.createdAt
    )} is cancelled. Your refund of amount ${refundAmount} is initiated and will be credited in your source account in 2 to 7 working days from the date of cancellation.`;
  } catch (err) {
    console.log("MAP ORDER CANCELLATION ERROR =>", err.message);

    return `Failed to cancel your order. Please connect with our executives.`;
  }
};

export {
  getOrderStatusByPhone,
  getOrderStatusByOrderId,
  getOrderRefundStatusByPhone,
  getOrderRefundStatusByOrderId,
  cancelOrderByPhone,
  cancelOrderByOrderId,
  mapOrderStatus,
};