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
    const isRto = order.fulfillments.length > 0 && order.tracking.rto_date.ok;
    if (isRto) {
      return `Your order was marked as returned on ${new Date(
        order.tracking.rto_date
      ).toDateString()}.  For prepaid orders, refunds are processed in 5 – 7 business days in original mode of payment.`;
    }
    const attempted_delivery =
      order.fulfillments.length > 0 && order.tracking.attempted_delivery.ok;
    const attempted_delivery_count = order?.tracking?.attempted_delivery?.attempt_count;
    if (attempted_delivery && attempted_delivery_count < 3) {
      return `Delivery was attempted on ${new Date(order.tracking.attempted_delivery.date).toDateString()} but was unsuccessful. Delivery will now be reattempted on the next working day`;
    }else if(attempted_delivery && attempted_delivery_count >= 3){
      return `Delivery was attempted on ${new Date(order.tracking.attempted_delivery.date).toDateString()} but was unsuccessful. Your order will now be marked as RTO. Once updated, the refund will be initiated and credited within 5–7 working days.`
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
export {
    mapOrderStatus
}