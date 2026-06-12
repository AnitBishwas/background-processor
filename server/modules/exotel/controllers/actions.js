import {
  cancelOrder,
  getCustomerIdByPhoneNumber,
  getOrderByCustomerId,
  getOrderByOrderName,
} from "./shopify.js";

const PACKED_CANCELLATION_MESSAGE =
  "Your order cannot be cancelled as it is already packed and will be shipped in the next 24 to 48 hours. You can refuse the delivery upon arrival.";

const safeArray = (value) => (Array.isArray(value) ? value : []);

const normalize = (v) =>
  (v || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const normalizePhone = (phone) => {
  if (!phone) return null;

  let digits = phone.toString().replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }

  if (digits.length !== 10) return null;

  return digits;
};

const formatDate = (date) => {
  if (!date) return null;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toDateString();
};

const getClickPostTracking = (order) => order?.tracking || {};
const getClickPostData = (order) => order?.tracking?.tracking_data || {};

const getLatestDate = (trackingData) =>
  trackingData?.latest_status?.timestamp ||
  trackingData?.latest_status?.time ||
  trackingData?.latest_status?.status_time ||
  trackingData?.latest_status?.created_at ||
  trackingData?.latest_status?.updated_at ||
  null;

const getEdd = (trackingData) =>
  trackingData?.courier_partner_edd ||
  trackingData?.edd ||
  trackingData?.estimated_delivery_date ||
  null;

const getClickPostDescription = (order) =>
  normalize(getClickPostData(order)?.latest_status?.clickpost_status_description);

const isWithin30Minutes = (order) => {
  if (!order?.createdAt) return false;

  const diffMinutes =
    (Date.now() - new Date(order.createdAt).getTime()) / 60000;

  return diffMinutes <= 30;
};

const isCallerPhoneMatchedWithOrder = (order, callerPhone) => {
  const caller = normalizePhone(callerPhone);

  if (!caller) return false;

  const orderPhones = [
    order?.phone,
    order?.customer?.phone,
    order?.customer?.defaultPhoneNumber?.phoneNumber,
    order?.shippingAddress?.phone,
    order?.billingAddress?.phone,
  ];

  const matched = orderPhones.some((phone) => {
    const orderPhone = normalizePhone(phone);
    return orderPhone && orderPhone === caller;
  });

  return matched;
};

const isPackedCancellationStatus = (order) => {
  const currentStatus = getClickPostTracking(order)?.current_status;
  const clickpostDescription = getClickPostDescription(order);

  return (
    currentStatus === "packed" ||
    clickpostDescription === "orderplaced" ||
    clickpostDescription === "awbregistered" ||
    clickpostDescription === "pickuppending" ||
    clickpostDescription === "pickupfailed" ||
    clickpostDescription === "outforpickup"
  );
};

const isOrderCancellable = (order) => {
  const fulfillments = safeArray(order?.fulfillments);

  if (!isWithin30Minutes(order)) return false;
  if (fulfillments.length > 0) return false;
  if (isPackedCancellationStatus(order)) return false;

  return true;
};

const getOrderStatusByPhone = async (phone) => {
  try {
    const customerId = await getCustomerIdByPhoneNumber(phone);
    if (!customerId) throw new Error("No order exists for this phone number.");

    const order = await getOrderByCustomerId(customerId);
    if (!order) throw new Error("No order exists for this phone number.");

    return mapOrderStatus(order);
  } catch (err) {
    return err.message;
  }
};

const getOrderStatusByOrderId = async (orderId) => {
  try {
    const order = await getOrderByOrderName(orderId);
    if (!order) throw new Error("No order exists for this order id.");

    return mapOrderStatus(order);
  } catch (err) {
    throw new Error(err.message);
  }
};

const getOrderRefundStatusByPhone = async (phone) => {
  try {
    const customerId = await getCustomerIdByPhoneNumber(phone);
    if (!customerId) throw new Error("No order exists for this phone number.");

    const order = await getOrderByCustomerId(customerId);
    if (!order) throw new Error("No order exists for this phone number.");

    return mapOrderRefundStatus(order);
  } catch (err) {
    return err.message;
  }
};

const getOrderRefundStatusByOrderId = async (orderId) => {
  try {
    const order = await getOrderByOrderName(orderId);
    if (!order) throw new Error("No order exists for this order id.");

    return mapOrderRefundStatus(order);
  } catch (err) {
    return err.message;
  }
};

const cancelOrderByPhone = async (phone) => {
  try {
    const customerId = await getCustomerIdByPhoneNumber(phone);
    if (!customerId) throw new Error("No order exists for this phone number.");

    const order = await getOrderByCustomerId(customerId);
    if (!order) throw new Error("No order exists for this phone number.");

    if (!isCallerPhoneMatchedWithOrder(order, phone)) {
      return `This order cannot be cancelled as it is not linked to your registered mobile number. Please call from the registered mobile number.`;
    }

    return await mapOrderCancellation(order);
  } catch (err) {
    return err.message;
  }
};

const cancelOrderByOrderId = async (orderId, callerPhone) => {
  try {
    const order = await getOrderByOrderName(orderId);

    if (!order) {
      throw new Error("No order exists for this order id.");
    }

    if (!isCallerPhoneMatchedWithOrder(order, callerPhone)) {
      return `This order cannot be cancelled as it is not linked to your registered mobile number. Please enter the Order ID associated with this number.`;
    }

    return await mapOrderCancellation(order);
  } catch (err) {
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

    if (order?.cancelledAt) {
      return `Your order was cancelled successfully on ${formatDate(order.cancelledAt)}. Prepaid orders are refunded automatically in 5 to 7 working days on source account.`;
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
      return deliveredDate
        ? `Your order has been delivered to you on ${deliveredDate}.`
        : `Your order has been delivered to you.`;
    }

    if (currentStatus === "rto") {
      const rtoDate = formatDate(getLatestDate(trackingData));
      return rtoDate
        ? `Your order was marked as returned on ${rtoDate}. For prepaid orders, refunds are processed in 2 to 7 business days in original mode of payment.`
        : `Your order was marked as returned. For prepaid orders, refunds are processed in 2 to 7 business days in original mode of payment.`;
    }

    if (currentStatus === "lost") {
      return `Your order is currently marked as lost by the courier partner. After this message, we will help you connect with one of our executives for further assistance.`;
    }

    if (currentStatus === "damaged") {
      return `We’re sorry, but your order has been marked as damaged by the courier partner. Please select an option to connect with our support team for further assistance.`;
    }

    if (currentStatus === "failed-delivery") {
      const attemptDate = formatDate(getLatestDate(trackingData));
      return attemptDate
        ? `Delivery was attempted on ${attemptDate} but was unsuccessful. Delivery will now be reattempted on the next working day.`
        : `Delivery was attempted but was unsuccessful. Delivery will now be reattempted on the next working day.`;
    }

    if (currentStatus === "out-for-delivery") {
      return `Your order is out for delivery today. Please keep your phone available, as the delivery partner may contact you.`;
    }

    if (currentStatus === "in-transit") {
      const edd = formatDate(getEdd(trackingData));
      return edd
        ? `Your order is shipped and will be delivered to you by ${edd}. Kindly check your WhatsApp or email for the tracking link.`
        : `Your order is currently in transit and will be delivered to you soon. Kindly check your WhatsApp or email for the tracking link.`;
    }

    return `Your order is currently in transit and will be delivered to you soon. Kindly check your WhatsApp or email for the tracking link.`;
  } catch (err) {
    throw new Error("Failed to map order status reason -->" + err.message);
  }
};

const getRefundAmount = (order) => {
  const refunds = safeArray(order?.refunds);

  if (refunds.length > 0) {
    return refunds
      .map((el) => Number(el?.totalRefunded?.amount || 0))
      .reduce((total, amount) => total + amount, 0);
  }

  return order?.currentTotalPriceSet?.shopMoney?.amount || "";
};

const isCodOrder = (order) => {
  const paymentGatewayNames = safeArray(order?.paymentGatewayNames);

  return paymentGatewayNames.some((el) => {
    const value = normalize(el);

    return (
      value.includes("cod") ||
      value.includes("cashondelivery")
    );
  });
};

const getTags = (order) => {
  if (Array.isArray(order?.tags)) {
    return order.tags;
  }

  if (typeof order?.tags === "string") {
    return order.tags.split(",").map((tag) => tag.trim());
  }

  return [];
};

const hasTag = (order, tagName) => {
  const tags = getTags(order);
  return tags.some((tag) => normalize(tag) === normalize(tagName));
};

const hasAnyTag = (order, tagNames) => {
  return tagNames.some((tagName) => hasTag(order, tagName));
};

const isRefundInitiated = (order) => {
  return hasAnyTag(order, [
    "Refund_initiated",
    "refund initiated",
    "Refund Initiated",
    "PARTIAL_REFUND_INITIATED",
    "Partial Refund Initiated",
  ]);
};

const isPartialRefund = (order) => {
  return hasAnyTag(order, [
    "partial_refund",
    "Partial Refund",
    "partially_refunded",
    "Partially Refunded",
    "PARTIAL_REFUND_INITIATED",
    "Partial Refund Initiated",
  ]);
};

const isCancelledLostDamaged = (order) => {
  const currentStatus = getClickPostTracking(order)?.current_status;

  return (
    order?.cancelledAt ||
    currentStatus === "lost" ||
    currentStatus === "damaged" ||
    hasAnyTag(order, ["lost", "damaged", "cancelled", "canceled"])
  );
};

const getDeliveredDate = (order) => {
  const trackingData = getClickPostData(order);
  return formatDate(getLatestDate(trackingData));
};


const mapOrderRefundStatus = (order) => {
  try {
    const tracking = getClickPostTracking(order);
    const currentStatus = tracking?.current_status;
    const refunds = safeArray(order?.refunds);

    const refundAmount = getRefundAmount(order);
    const isCod = isCodOrder(order);
    const deliveredDate = getDeliveredDate(order);

    const hasRefund = refunds.length > 0;
    const refundInitiated = isRefundInitiated(order);
    const partialRefund = isPartialRefund(order);
    const cancelledLostDamaged = isCancelledLostDamaged(order);

    if (
      !hasRefund &&
      !refundInitiated &&
      !cancelledLostDamaged &&
      (
        !currentStatus ||
        currentStatus === "packed" ||
        currentStatus === "in-transit" ||
        currentStatus === "out-for-delivery" ||
        currentStatus === "placed" ||
        currentStatus === "confirmed"
      )
    ) {
      return `Refund is not eligible for this order as the current status of the order is ${currentStatus || "tracking added"}`;
    }

    if (currentStatus === "delivered" && hasRefund && partialRefund) {
      return `Partial Refund for your order of amount ${refundAmount} is successfully credited in your account. Please check your bank statement for more details.`;
    }

    if (currentStatus === "delivered" && hasRefund && !partialRefund) {
      return `Refund for your order of amount ${refundAmount} is successfully credited in your account. Please check your bank statement for more details.`;
    }

    if (currentStatus === "delivered" && refundInitiated && partialRefund) {
      return `Partial Refund for your order of amount ${refundAmount} is initiated successfully and will be credited within 2 to 7 working days in your account. Any cashback used eligible for refund will be refunded within 24 hours`;
    }

    if (currentStatus === "delivered" && refundInitiated && !partialRefund) {
      return `Refund for your order of amount ${refundAmount} is initiated successfully and will be credited within 2 to 7 working days in your account. Any cashback used will be refunded within 24 hours`;
    }

    if (currentStatus === "delivered" && !hasRefund && !refundInitiated) {
      if (deliveredDate) {
        return `No Refund has been initiated for this order as this was marked delivered on ${deliveredDate}`;
      }

      return `No Refund has been initiated for this order as this order was marked delivered.`;
    }

    if (
      currentStatus === "failed-delivery" ||
      currentStatus === "undelivered"
    ) {
      return `No refund has been initiated yet for this order, as the order is marked Undelivered. Please wait for it to be marked Returned (RTO). Once updated, the refund will be initiated within 24 to 48 hours.`;
    }

    /*
      IMPORTANT:
      COD + RTO me hamesha COD not eligible message aayega,
      chahe hasRefund true ho ya refundInitiated true.
    */
    if (currentStatus === "rto" && isCod) {
      return `The order has been marked as Returned but is not eligible for a refund as it is a Cash On Delivery order. If you have used cashback and it has not been credited back yet, please select an option to connect with our support team for assistance.`;
    }

    if (currentStatus === "rto" && hasRefund && !isCod) {
      return `Refund for your order of amount ${refundAmount} is successfully credited in your account. Please check your bank statement for more details.`;
    }

    if (currentStatus === "rto" && refundInitiated && !isCod) {
      return `Refund for your order of amount ${refundAmount} is initiated successfully and will be credited within 2 to 7 working days in your account. Any cashback used will be refunded within 24 hours`;
    }

    if (currentStatus === "rto" && !hasRefund && !refundInitiated && !isCod) {
      return `No refund has been initiated for this order yet. The order has been marked as Returned and is now eligible for a refund. You may connect with our support team for assistance with the refund`;
    }

    /*
      IMPORTANT:
      COD + Cancelled/Lost/Damaged me hamesha COD not eligible message aayega,
      chahe hasRefund true ho ya refundInitiated true.
    */
    if (cancelledLostDamaged && isCod) {
      return `The order has been marked as ${currentStatus || "cancelled"} but is not eligible for a refund as it is a Cash On Delivery order. If you have used cashback and it has not been credited back yet, please select an option to connect with our support team for assistance.`;
    }

    if (cancelledLostDamaged && hasRefund && !isCod) {
      return `Refund for your order of amount ${refundAmount} is successfully credited in your account. Please check your bank statement for more details.`;
    }

    if (cancelledLostDamaged && refundInitiated && !isCod) {
      return `Refund for your order of amount ${refundAmount} is initiated successfully and will be credited within 2 to 7 working days in your account. Any cashback used will be refunded within 24 hours`;
    }

    if (cancelledLostDamaged && !hasRefund && !refundInitiated && !isCod) {
      return `No refund has been initiated for this order yet. The order has been marked as ${currentStatus || "cancelled"} and is eligible for a refund. You may connect with our support team for assistance with the refund`;
    }

    return `Please note, for prepaid orders, it usually takes 5-7 working days for the refund to be credited in your source account`;
  } catch (err) {
    throw new Error("Failed to map order refund status reason -->" + err.message);
  }
};

const getCancellationStatusMessage = (order) => {
  const fulfillments = safeArray(order?.fulfillments);
  const tracking = getClickPostTracking(order);
  const currentStatus = tracking?.current_status;

  if (!isWithin30Minutes(order) && fulfillments.length === 0) {
    return PACKED_CANCELLATION_MESSAGE;
  }

  if (isPackedCancellationStatus(order)) {
    return PACKED_CANCELLATION_MESSAGE;
  }

  if (currentStatus === "delivered") {
    return `Your current order status is delivered. Hence, it cannot be cancelled as we allow cancellation only before your order gets packed.`;
  }

  if (currentStatus === "rto") {
    return `Your current order status is returned. Hence, it cannot be cancelled as we allow cancellation only before your order gets packed.`;
  }

  if (currentStatus === "lost") {
    return `Your current order status is lost. Hence, it cannot be cancelled as we allow cancellation only before your order gets packed.`;
  }

  if (currentStatus === "damaged") {
    return `Your current order status is damaged. Hence, it cannot be cancelled as we allow cancellation only before your order gets packed.`;
  }

  if (currentStatus === "failed-delivery") {
    return `Your current order status is undelivered due to failed delivery. Hence, it cannot be cancelled as we allow cancellation only before your order gets packed.`;
  }

  if (currentStatus === "out-for-delivery") {
    return `Your current order status is out for delivery. Hence, it cannot be cancelled as we allow cancellation only before your order gets packed.`;
  }

  if (currentStatus === "in-transit") {
    return `Your current order status is in transit. Hence, it cannot be cancelled as we allow cancellation only before your order gets packed.`;
  }

  if (fulfillments.length > 0 || !tracking?.success) {
    return `Your current order status is shipped. Hence, it cannot be cancelled as we allow cancellation only before your order gets packed.`;
  }

  return `Your order cannot be cancelled as we are unable to fetch your order details at the moment. You can choose to connect with our support team for futher assistance.`;
};

const mapOrderCancellation = async (order) => {
  try {
    const paymentGatewayNames = safeArray(order?.paymentGatewayNames);
    const isOrderCancelled = order?.cancelledAt;
    const fulfillments = safeArray(order?.fulfillments);

    const isCod = paymentGatewayNames.find(
      (el) => el === "cash_on_delivery" || el === "Gokwik PPCOD"
    );

    const orderDate = formatDate(order?.createdAt);
    const refundAmount =
      order?.currentTotalPriceSet?.shopMoney?.amount || null;

    if (isOrderCancelled && isCod) {
      return `Your cash on delivery order placed on ${orderDate} is already cancelled.`;
    }

    if (isOrderCancelled && !isCod) {
      return `Your order placed on ${orderDate} is already cancelled. Your refund of amount ${refundAmount} is initiated and will be credited in your source account in 5 to 7 working days from the date of cancellation.`;
    }

    if (!isWithin30Minutes(order) && fulfillments.length === 0) {
      return PACKED_CANCELLATION_MESSAGE;
    }

    if (!isOrderCancellable(order)) {
      return getCancellationStatusMessage(order);
    }

    const makeCancelRequest = await cancelOrder(order);


    if (!makeCancelRequest || makeCancelRequest?.success === false) {
      return `Failed to cancel your order. Reason: ${
        makeCancelRequest?.error || "Shopify cancellation failed"
      }`;
    }

    if (isCod) {
      return `Your cash on delivery order placed on ${orderDate} is cancelled successfully.`;
    }

    return `Your order placed on ${orderDate} is cancelled successfully. Your refund of amount ${refundAmount} is initiated and will be credited within 5-7 working days in your account from which the transaction was made.`;
  } catch (err) {
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
  mapOrderCancellation,
};