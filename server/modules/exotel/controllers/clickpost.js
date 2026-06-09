import fetch from "node-fetch";

const normalize = (v) =>
  (v || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const extractCpIdFromUrl = (url) => {
  try {
    if (!url) return null;
    const parsed = new URL(url);
    const cpId = parsed.searchParams.get("cp_id");
    return cpId ? Number(cpId) : null;
  } catch {
    return null;
  }
};

const extractCpIdsFromShopifyOrder = (shopifyOrder, awb) => {
  try {
    const order = shopifyOrder?.order || shopifyOrder;
    const fulfillments = order?.fulfillments || [];
    const cpIds = new Set();

    for (const fulfillment of fulfillments) {
      const trackingInfo = fulfillment?.trackingInfo || [];

      for (const tracking of trackingInfo) {
        const trackingNumber = tracking?.number;
        const trackingUrl = tracking?.url;

        if (trackingNumber?.toString() === awb?.toString()) {
          const cpId = extractCpIdFromUrl(trackingUrl);
          if (cpId) cpIds.add(cpId);
        }
      }
    }

    return [...cpIds];
  } catch {
    return [];
  }
};

const mapClickPostStatus = (shipment) => {
  const latest = shipment?.latest_status || {};

  const description = normalize(latest?.clickpost_status_description);
  const bucketDescription = normalize(
    latest?.clickpost_status_bucket_description
  );

  console.log("CLICKPOST DESCRIPTION =>", description);
  console.log("CLICKPOST BUCKET DESCRIPTION =>", bucketDescription);

  if (description.includes("rto")) return "rto";
  if (description === "delivered") return "delivered";
  if (description === "outfordelivery") return "out-for-delivery";

  if (
    description === "orderplaced" ||
    description === "awbregistered" ||
    description === "pickuppending" ||
    description === "pickupfailed" ||
    description === "outforpickup"
  ) {
    return "packed";
  }

  if (
    description === "intransit" ||
    description === "pickedup" ||
    description === "destinationhubin" ||
    description === "shipmentdelayed" ||
    description === "contactcustomercare"
  ) {
    return "in-transit";
  }

  if (description === "faileddelivery") return "failed-delivery";
  if (description === "lost") return "lost";
  if (description === "damaged") return "damaged";

  if (bucketDescription.includes("rto")) return "rto";
  if (bucketDescription.includes("returned")) return "rto";
  if (bucketDescription.includes("delivered")) return "delivered";
  if (bucketDescription.includes("outfordelivery")) return "out-for-delivery";
  if (bucketDescription.includes("order")) return "packed";
  if (bucketDescription.includes("intransit")) return "in-transit";
  if (bucketDescription.includes("transit")) return "in-transit";
  if (bucketDescription.includes("failed")) return "failed-delivery";

  return "in-transit";
};

export const getTrackingStatusFromClickPost = async ({ awb, shopifyOrder }) => {
  try {
    if (!awb) throw new Error("AWB missing");

    const dynamicCpIds = extractCpIdsFromShopifyOrder(shopifyOrder, awb);
    console.log("DYNAMIC CP_IDS =>", dynamicCpIds);

    if (!dynamicCpIds.length) {
      throw new Error("CP_ID not found in Shopify tracking URL");
    }

    for (const cpId of dynamicCpIds) {
      try {
        const url = `https://api.clickpost.in/api/v2/track-order/?username=${process.env.CLICKPOST_USERNAME}&key=${process.env.CLICKPOST_API_KEY}&waybill=${awb}&cp_id=${cpId}`;

        console.log("CLICKPOST URL =>", url);

        const response = await fetch(url, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        const data = await response.json();
        console.log("CLICKPOST RESPONSE =>", JSON.stringify(data, null, 2));

        const shipment = data?.result?.[awb] || {};
        console.log("CLICKPOST FINAL =>", JSON.stringify(shipment, null, 2));

        if (!shipment?.latest_status) {
          throw new Error("No latest_status found in ClickPost response");
        }

        const currentStatus = mapClickPostStatus(shipment);
        console.log("CLICKPOST FINAL STATUS =>", currentStatus);

        return {
          success: true,
          current_status: currentStatus,
          tracking_data: shipment,
        };
      } catch (err) {
        console.log("CP_ID FAILED =>", cpId);
        console.log(err);
      }
    }

    return {
      success: false,
      error: "Unable to fetch ClickPost tracking",
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
};
