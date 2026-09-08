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

const getClickPostData = (order) => order?.tracking?.tracking_data || {};

const getClickPostDescription = (order) =>
  normalize(
    getClickPostData(order)?.latest_status?.clickpost_status_description
  );

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

const getTrackingUrl = (order) => {
  const fulfillments = safeArray(order?.fulfillments);
  const latestFulfillment = fulfillments[fulfillments.length - 1];
  return latestFulfillment?.trackingInfo?.[0]?.url || null;
};

const getLatestFulfillment = (order) => {
  const fulfillments = safeArray(order?.fulfillments);
  return fulfillments[fulfillments.length - 1] || null;
};

const hasAwbAssigned = (order) => {
  const latestFulfillment = getLatestFulfillment(order);
  return Boolean(latestFulfillment?.trackingInfo?.[0]?.number);
};

/**
 * Fallback mapping using Shopify's own fulfillment displayStatus - used
 * whenever an AWB has not been assigned to the fulfillment yet, so ClickPost
 * has nothing to track against.
 * https://shopify.dev/docs/api/admin-graphql/latest/enums/FulfillmentDisplayStatus
 */
const mapShopifyDisplayStatus = (order) => {
  const latestFulfillment = getLatestFulfillment(order);
  const displayStatus = normalize(latestFulfillment?.displayStatus);
  const updatedDate = formatDate(latestFulfillment?.updatedAt);

  const packedStatuses = [
    "submitted",
    "inprogress",
    "confirmed",
    "labelprinted",
    "labelpurchased",
    "readyforpickup",
    "markedasfulfilled",
  ];
  const inTransitStatuses = ["intransit", "pickedup"];
  const failedStatuses = ["notdelivered", "attempteddelivery", "failure"];

  if (packedStatuses.includes(displayStatus)) {
    return `Your order has been packed and will be shipped shortly. Once the courier assigns tracking details, we’ll share them with you on WhatsApp and email.`;
  }

  if (inTransitStatuses.includes(displayStatus)) {
    return `Your order has been shipped and is on its way to you.\nOnce tracking details are assigned by the courier, we’ll share them with you on WhatsApp and email.`;
  }

  if (displayStatus === "outfordelivery") {
    return `Your order is out for delivery today. Please keep your phone available, as the delivery partner may contact you.`;
  }

  if (displayStatus === "delivered") {
    return updatedDate
      ? `Your order has been delivered to you on ${updatedDate}.`
      : `Your order has been delivered to you.`;
  }

  if (failedStatuses.includes(displayStatus)) {
    return `We tried delivering your order but unfortunately the delivery could not be completed. No worries-our delivery partner will attempt delivery again in the next 24-48 hours. Please ensure someone is available to receive the order.`;
  }

  if (displayStatus === "canceled") {
    return `Your order fulfillment was cancelled. Please connect with our support team for further assistance.`;
  }

  // unknown/unmapped Shopify displayStatus - safe generic default
  return `Your order has been packed and will be shipped shortly. Once the courier assigns tracking details, we’ll share them with you on WhatsApp and email.`;
};

/**
 * map order status.
 * - Uses ClickPost tracking data (order.tracking, attached beforehand via
 *   getOrderTrackingInfo) only once an AWB has actually been assigned.
 * - Falls back to Shopify's own fulfillment displayStatus when no AWB is
 *   assigned yet, or when the ClickPost call itself failed.
 * @param {object} order - shopify order (with .tracking attached)
 * @returns {string} status text
 */
const mapOrderStatus = async (order) => {
  try {
    const fulfillments = safeArray(order?.fulfillments);

    // if order is cancelled
    if (order?.cancelledAt) {
      return `Your order was cancelled successfully on ${formatDate(
        order.cancelledAt
      )}. Prepaid orders are refunded automatically in 5 to 7 working days on source account.`;
    }

    // if fulfillment not assigned yet
    if (fulfillments.length === 0) {
      return `Your order has been successfully confirmed on ${formatDate(
        order.createdAt
      )} and is expected to be delivered within 2–5 working days.\nNote: Once your order is packed, we’ll share the tracking details with you on both email and WhatsApp, so you can follow the delivery every step of the way.`;
    }

    // AWB not assigned yet -> rely on Shopify's own fulfillment status,
    // ClickPost has nothing to track against
    if (!hasAwbAssigned(order)) {
      return mapShopifyDisplayStatus(order);
    }

    const tracking = order?.tracking;
    const trackingData = getClickPostData(order);
    const currentStatus = tracking?.current_status;
    const clickpostDescription = getClickPostDescription(order);

    // ClickPost tracking could not be fetched even though AWB exists
    // (API/network failure) - fall back to a generic shipped message
    if (!tracking?.success) {
      return `Your order has been shipped and will reach you soon.\nFor real-time updates, please check your WhatsApp or email.`;
    }

    // if order is packed / awaiting pickup (per ClickPost)
    if (
      currentStatus === "packed" ||
      clickpostDescription === "orderplaced" ||
      clickpostDescription === "awbregistered" ||
      clickpostDescription === "pickuppending" ||
      clickpostDescription === "pickupfailed" ||
      clickpostDescription === "outforpickup"
    ) {
      return `Your order has been successfully confirmed on ${formatDate(
        order.createdAt
      )} and is expected to be delivered within 2–5 working days.\nNote: Once your order is packed, we’ll share the tracking details with you on both email and WhatsApp, so you can follow the delivery every step of the way.`;
    }

    // if order is delivered
    if (currentStatus === "delivered") {
      const deliveredDate = formatDate(getLatestDate(trackingData));
      return deliveredDate
        ? `Your order has been delivered to you on ${deliveredDate}`
        : `Your order has been delivered to you.`;
    }

    // if order is RTO
    if (currentStatus === "rto") {
      const rtoDate = formatDate(getLatestDate(trackingData));
      return rtoDate
        ? `Your order was marked as returned on ${rtoDate}.  For prepaid orders, refunds are processed in 5 – 7 business days in original mode of payment.`
        : `Your order was marked as returned.  For prepaid orders, refunds are processed in 5 – 7 business days in original mode of payment.`;
    }

    // if order is lost
    if (currentStatus === "lost") {
      return `Your order is currently marked as lost by the courier partner. Please connect with our support team for further assistance.`;
    }

    // if order is damaged
    if (currentStatus === "damaged") {
      return `We’re sorry, but your order has been marked as damaged by the courier partner. Please connect with our support team for further assistance.`;
    }

    // if order delivery attempt was made and failed
    if (currentStatus === "failed-delivery") {
      const attemptDate = formatDate(getLatestDate(trackingData));
      return attemptDate
        ? `We tried delivering your order on ${attemptDate} but unfortunately the delivery could not be completed. No worries-our delivery partner will attempt delivery again in the next 24-48 hours. Please ensure someone is available to receive the order.`
        : `We tried delivering your order but unfortunately the delivery could not be completed. No worries-our delivery partner will attempt delivery again in the next 24-48 hours. Please ensure someone is available to receive the order.`;
    }

    // if order is out for delivery
    if (currentStatus === "out-for-delivery") {
      return `Your order is out for delivery today. Please keep your phone available, as the delivery partner may contact you.`;
    }

    // if order is in transit
    if (currentStatus === "in-transit") {
      const edd = formatDate(getEdd(trackingData));
      const trackingUrl = getTrackingUrl(order);
      const eddLine = edd ? ` and will be delivered to you by ${edd}` : "";
      return `Your order has been shipped${eddLine}.\n${
        trackingUrl ? `You can track your order here: ${trackingUrl} .\n` : ""
      }For real-time updates, please check your WhatsApp or email.`;
    }

    // fallback for any other/unmapped clickpost status
    return `Your order has been shipped and will reach you soon.\nFor real-time updates, please check your WhatsApp or email.`;
  } catch (err) {
    throw new Error("Failed to map order status reason -->" + err.message);
  }
};
export { mapOrderStatus };