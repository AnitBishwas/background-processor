import {
  cancelOrder,
  getCustomerIdByPhoneNumber,
  getOrderByCustomerId,
  getOrderByOrderName,
} from "./shopify.js";

/**
 * Get order status by customer phone nuber
 * @param {string} phone - customer phone number
 * @return {string} status_text
 */
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
    const statusText = mapOrderStatus(order) || null;
    return statusText;
  } catch (err) {
    console.log("Failed to get order status by phone reason -->" + err.message);
    return err.message;
  }
};

/**
 * get order status by order id/order name in shopify
 * @param {string} orderId
 * @returns {string} status text for the order
 */
const getOrderStatusByOrderId = async (orderId) => {
  try {
    const order = await getOrderByOrderName(orderId);
    if (!order) {
      throw new Error("No order exists for this order id.");
    }
    console.dir({order,message: 'here is our order after fetch 👽'});
    const statusText = mapOrderStatus(order);
    return statusText;
  } catch (err) {
    console.log(
      "Failed to get order status by order id reason -->" + err.message
    );
    throw new Error(err.message);
  }
};

/**
 * Get order refund status by phone
 * @param {string} phone
 * @returns {string} refund status text for the order
 */
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
    const statusText = mapOrderRefundStatus(order);
    return statusText;
  } catch (err) {
    console.log(
      "Failed to get refund status by phone reason -->" + err.message
    );
    return err.message;
  }
};

/**
 * Get order refund status by order id
 * @param {string} orderId - shopify order name
 * @returns {string} order status string text
 */
const getOrderRefundStatusByOrderId = async (orderId) => {
  try {
    const order = await getOrderByOrderName(orderId);
    if (!order) {
      throw new Error("No order exists for this order id.");
    }
    const statusText = mapOrderRefundStatus(order);
    return statusText;
  } catch (err) {
    console.log(
      "Failed to get refund status by order id reason --->" + err.message
    );
    return err.message;
  }
};

/**
 *
 * @param {string} phone - customer phone number
 * @returns {string} - order status text
 */
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
    const statusText = await mapOrderCancellation(order);
    return statusText;
  } catch (err) {
    console.log("Failed to cancel order by phone reason -->" + err.message);
    return err.message;
  }
};

/**
 *
 * @param {string} orderId - shopify order name
 * @returns {string} - cancellation status text
 */
const cancelOrderByOrderId = async (orderId) => {
  try {
    const order = await getOrderByOrderName(orderId);
    if (!order) {
      throw new Error("No order exists for this order id.");
    }
    const statusText = await mapOrderCancellation(order);
    return statusText;
  } catch (err) {
    return err.message;
  }
};
/**
 * map order status
 * @param {object} order - shopify order
 * @returns {string} status text
 */
const mapOrderStatus = (order) => {
  try {
    const isOrderCancelled = order.cancelledAt ? true : false;
    if (isOrderCancelled) {
      return `Your order was cancelled successfully on ${new Date(
        order.cancelledAt
      ).toDateString()}. Prepaid orders are refunded automatically in 5 to 7 working days on source account.`;
    }
    if (order.fulfillments.length == 0) {
      return `Your order has been successfully confirmed and is expected to be delivered within 2–5 working days.
              Note: Once your order is packed, we’ll share the tracking details with you on both email and WhatsApp, so you can follow the delivery every step of the way.`;
    }
    const isDelivered = order.tracking.delivered?.ok
      ? order.tracking.delivered.date
      : null;
    if (isDelivered) {
      return `Your order has been delivered to you on ${new Date(
        order.tracking.delivered.date
      ).toDateString()}`;
    }
    const isRto = order.fulfillments.length > 0 && order.tracking.rto_date?.ok;
    if (isRto) {
      return `Your order was marked as returned on ${new Date(
        order.tracking.rto_date
      ).toDateString()}.  For prepaid orders, refunds are processed in 5 – 7 business days in original mode of payment.`;
    }
    const attempted_delivery =
      order.fulfillments.length > 0 && order.tracking.attempted_delivery?.ok;
    const attempted_delivery_count =
      order?.tracking?.attempted_delivery?.attempt_count;
    if (attempted_delivery && attempted_delivery_count < 3) {
      return `Delivery was attempted on ${new Date(order.tracking.attempted_delivery.date).toDateString()} but was unsuccessful. Delivery will now be reattempted on the next working day`;
    } else if (attempted_delivery && attempted_delivery_count >= 3) {
      return `Delivery was attempted on ${new Date(order.tracking.attempted_delivery.date).toDateString()} but was unsuccessful. Your order will now be marked as RTO. Once updated, the refund will be initiated and credited within 5–7 working days.`;
    }
    const isShipped =
      order.fulfillments.length > 0 && order.tracking.edd
        ? order.tracking.edd
        : null;
    if (isShipped) {
      return `Your order is shipped and will be delivered to you by ${new Date(
        order.tracking.edd
      ).toDateString()}. Kindly check your whatsapp or email for the tracking link.`;
    }
    return `Your order has been successfully confirmed and is expected to be delivered within 2–5 working days.
            Note: Once your order is packed, we’ll share the tracking details with you on both email and WhatsApp, so you can follow the delivery every step of the way.`;
  } catch (err) {
    throw new Error("Failed to map order status reason -->" + err.message);
  }
};

/**
 * map order refund status
 * @param {object} order - shopify order
 * @returns {string} status text
 */
const mapOrderRefundStatus = (order) => {
  try {
    const isCod = order.paymentGatewayNames.find(
      (el) => el == "cash_on_delivery" || el == "Gokwik PPCOD"
    );
    if (isCod) {
      return `Refund for your latest order is not eligible as you placed a cash on delivery order.To know about our refund policy, you can check the message on whatsapp that will be sent to you shortly.`;
    }
    const isRefundSuccessFull = order.refunds.length > 0 && true;
    if (isRefundSuccessFull) {
      let totalRefundedAmount = order.refunds
        .map((el) => Number(el.totalRefunded.amount))
        .reduce((total, el) => (total += el));
      return `Refund for your latest order of amount ${totalRefundedAmount} was successfully credited in your original mode of payment. Please check your bank account for more details.`;
    }
    const isRefundInitiated = order.tags.indexOf("Refund_initiated") != -1;
    if (isRefundInitiated) {
      let refundAmount = order?.currentTotalPriceSet?.shopMoney?.amount || null;
      return `Refund for your latest order of amount ${refundAmount} was initiated successfully and will be credited within 5-7 working days in your original mode of payment from the date of initiation.`;
    }
    const refundEligibleButNotInitiated =
      order.tags.indexOf("RTO") != -1 || order.tags.indexOf("Returned") != -1;
    if (refundEligibleButNotInitiated) {
      let refundAmount = order?.currentTotalPriceSet?.shopMoney?.amount || null;
      return `Refund has not yet been initiated for your latest order of amount ${refundAmount}. After this message, we will help you connect you with one of our executives who will assist you with your refund request.`;
    }
    const isOrderDelivered =
      order.tags.indexOf("RTO") == -1 &&
      order.tags.indexOf("Returned") == -1 &&
      order.tracking?.delivered?.ok;
    if (isOrderDelivered) {
      let refundAmount = order?.currentTotalPriceSet?.shopMoney?.amount || null;
      return `Refund for your latest order of amount ${refundAmount} is not eligible as the current status of your order is delivered on ${new Date(
        order.tracking.delivered
      ).toDateString()}.
              To know about our refund policy, you can check the message on whatsapp that will be sent to you shortly.`;
    }
    const refundNotEligibleAsInTransit =
      order.tags.indexOf("RTO") == -1 &&
      order.tags.indexOf("Returned") == -1 &&
      order.tracking?.edd;
    if (refundNotEligibleAsInTransit) {
      return `Refund for your latest order of amount ${refundAmount} is not eligible as the current status of your order is in transit.
              To know about our refund policy, you can check the message on whatsapp that will be sent to you shortly.`;
    }
    return `Please note, for prepaid orders, It usually takes 5-7 working days for the refund to be credited in your source account`;
  } catch (err) {
    throw new Error(
      "Failed to map order refund status reason -->" + err.message
    );
  }
};

/**
 * cancel Order
 * @param {object} order - shopify order
 * @returns {string} - status text
 */
const mapOrderCancellation = async (order) => {
  try {
    console.log(order);
    const isOrderCancelled = order.cancelledAt;
    const isCod = order.paymentGatewayNames.find(
      (el) => el == "cash_on_delivery" || el == "Gokwik PPCOD"
    );
    if (isOrderCancelled && isCod) {
      return `Your cash on delivery order placed on ${new Date(isOrderCancelled).toDateString()} is already cancelled.`;
    }
    if (isOrderCancelled && !isCod) {
      let refundAmount = order?.currentTotalPriceSet?.shopMoney?.amount || null;
      return `Your order placed on ${new Date(isOrderCancelled).toDateString()} is already cancelled. Your refund of amount ${refundAmount} is initiated and will be credited in your source account in 5 to 7 working days from the date of cancellation.`;
    }

    const isOrderCancellable = order.fulfillments.length == 0;
    if (isOrderCancellable) {
      const makeCancelRequest = await cancelOrder(order);

      if (!makeCancelRequest) {
        return `Failed to cancel your order please connect with our executives`;
      }
      if (makeCancelRequest && isCod) {
        return `Your cash on delivery order placed on ${new Date(order.createdAt).toDateString()} is cancelled. `;
      }
      if (makeCancelRequest && !isCod) {
        let refundAmount =
          order?.currentTotalPriceSet?.shopMoney?.amount || null;
        return `Your order placed on ${new Date(order.createdAt).toDateString()} is cancelled. Your refund of amount ${refundAmount} is initiated and will be credited in your source account in 5 to 7 working days from the date of cancellation.`;
      }
    } else {
      return `Your current order status is in transit. Hence, it cannot be cancelled as we allow cancellation only before your order gets packed.`;
    }
  } catch (err) {
    throw new Error("Failed to cancel order");
  }
};

export {
  getOrderStatusByPhone,
  getOrderStatusByOrderId,
  getOrderRefundStatusByPhone,
  getOrderRefundStatusByOrderId,
  cancelOrderByPhone,
  cancelOrderByOrderId,
};
