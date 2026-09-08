import { getTrackingStatusFromClickPost } from "./clickpost.js";

const safeArray = (value) => (Array.isArray(value) ? value : []);

/**
 * Get order tracking info via ClickPost
 * @param {object} order - shopify order (expects fulfillments[].trackingInfo[].number/url)
 * @returns {object|null} - clickpost tracking response, e.g. { success, current_status, tracking_data }
 */
const getOrderTrackingInfo = async (order) => {
  try {
    const fulfillments = safeArray(order?.fulfillments);

    if (!fulfillments.length) return null;

    // most recent fulfillment
    const latestFulfillment = fulfillments[fulfillments.length - 1];
    const trackingInfo = latestFulfillment?.trackingInfo?.[0];
    const awb = trackingInfo?.number;

    if (!awb) return null;

    const tracking = await getTrackingStatusFromClickPost({
      awb,
      shopifyOrder: order,
    });

    console.dir(
      { tracking, message: "here is the tracking info for you" },
      {
        depth: null,
      }
    );

    return tracking;
  } catch (err) {
    throw new Error("Failed to get order tracking info reason --> " + err.message);
  }
};

export { getOrderTrackingInfo };