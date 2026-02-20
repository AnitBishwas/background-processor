/**
 * map order status
 * @param {object} order - shopify order
 * @returns {string} status text
 */
const mapOrderStatus = async (order) => {
  try {
    const isOrderCancelled = order.cancelledAt;
    const fulfillments = order.fulfillments;

    // if order is RTO
    const isRto = fulfillments[0]?.displayStatus == "FAILURE" || false;
    if (isRto) {
      return `Your order was marked as returned on ${new Date(
        fulfillments[0]?.updatedAt
      ).toDateString()}.  For prepaid orders, refunds are processed in 5 – 7 business days in original mode of payment.`;
    }
    // if order is cancelled
    if (isOrderCancelled) {
      return `Your order was cancelled successfully on ${new Date(
        order.cancelledAt
      ).toDateString()}. Prepaid orders are refunded automatically in 5 to 7 working days on source account.`;
    }
    // if fulfillment not assigned
    if (fulfillments.length == 0) {
      return `Your order has been successfully confirmed and is expected to be delivered within 2–5 working days.
              Note: Once your order is packed, we’ll share the tracking details with you on both email and WhatsApp, so you can follow the delivery every step of the way.`;
    }
    // if order is delivered
    const isDelivered =
      fulfillments[0]?.displayStatus == "DELIVERED" ? true : null;
    if (isDelivered) {
      return `Your order has been delivered to you on ${new Date(
        fulfillments[0]?.updatedAt
      ).toDateString()}`;
    }
    // if order delivery attempt was made
    const attempted_delivery = fulfillments[0]?.displayStatus == 'ATTEMPTED_DELIVERY' ? true : false;
    if (attempted_delivery ) {
      return `Delivery was attempted on ${new Date(fulfillments[0]?.updatedAt).toDateString()} but was unsuccessful. Delivery will now be reattempted on the next working day`;
    };
    // if order is in transit
    const inTransit = fulfillments[0]?.displayStatus == 'IN_TRANSIT' ? true : false;
    if(inTransit){
      return `Your order is shipped. Kindly check your whatsapp or email for the tracking link.`;
    };
    // if tracking details attached to order
    const trackingAdded = fulfillments[0]?.displayStatus == 'CONFIRMED' ? true : false;
    if(trackingAdded){
      return `Your order is packed and ready to move out. Kindly check your whatsapp or email for the tracking link.`
    };
    return false; 
  } catch (err) {
    throw new Error("Failed to map order status reason -->" + err.message);
  }
};
export { mapOrderStatus };
