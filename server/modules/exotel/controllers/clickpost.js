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
  } catch (err) {
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

        if (trackingNumber && trackingNumber.toString() === awb.toString()) {
          const cpId = extractCpIdFromUrl(trackingUrl);
          if (cpId) cpIds.add(cpId);
        }
      }
    }

    return [...cpIds];
  } catch (err) {
    return [];
  }
};

const mapClickPostStatus = (shipment) => {
  const latest = shipment?.latest_status || {};

  const latestStatus = normalize(
    [
      latest?.clickpost_status_description,
      latest?.clickpost_status_bucket_description,
      latest?.status,
      latest?.remark,
    ].join(" ")
  );

  const statusCode = Number(latest?.clickpost_status_code);
  const statusBucket = Number(latest?.clickpost_status_bucket);

  console.log("CLICKPOST STATUS CODE =>", statusCode);
  console.log("CLICKPOST STATUS BUCKET =>", statusBucket);
  console.log("CLICKPOST NORMALIZED STATUS =>", latestStatus);

  if (
    statusCode === 14 ||
    statusBucket === 7 ||
    latestStatus.includes("rto") ||
    latestStatus.includes("returned")
  ) {
    return "rto";
  }

  if (latestStatus.includes("lost")) {
    return "lost";
  }

  if (latestStatus.includes("damaged")) {
    return "damaged";
  }

  if (statusCode === 8 || latestStatus.includes("delivered")) {
    return "delivered";
  }

  if (
    statusCode === 6 ||
    latestStatus.includes("outfordelivery") ||
    latestStatus.includes("dispatched") ||
    latestStatus.includes("ofd")
  ) {
    return "out-for-delivery";
  }

  if (
    statusCode === 1 ||
    statusBucket === 1 ||
    latestStatus.includes("orderplaced") ||
    latestStatus.includes("awbregistered") ||
    latestStatus.includes("pickuppending") ||
    latestStatus.includes("pickupfailed") ||
    latestStatus.includes("outforpickup") ||
    latestStatus.includes("placed") ||
    latestStatus.includes("new") ||
    latestStatus.includes("manifested")
  ) {
    return "packed";
  }

  if (
    latestStatus.includes("faileddelivery") ||
    latestStatus.includes("failed") ||
    latestStatus.includes("ndr") ||
    latestStatus.includes("undelivered") ||
    latestStatus.includes("attempted")
  ) {
    return "failed-delivery";
  }

  if (
    statusCode === 5 ||
    statusBucket === 3 ||
    latestStatus.includes("pickedup") ||
    latestStatus.includes("intransit") ||
    latestStatus.includes("destinationhubin") ||
    latestStatus.includes("shipmentdelayed") ||
    latestStatus.includes("contactcustomercare") ||
    latestStatus.includes("transit") ||
    latestStatus.includes("shipped")
  ) {
    return "in-transit";
  }

  return "in-transit";
};

export const getTrackingStatusFromClickPost = async ({ awb, shopifyOrder }) => {
  try {
    if (!awb) {
      throw new Error("AWB missing");
    }

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
          headers: {
            "Content-Type": "application/json",
          },
        });

        const data = await response.json();

        console.log("CLICKPOST RESPONSE =>", JSON.stringify(data, null, 2));

        const result = data?.result || {};
        const shipment = result?.[awb] || {};

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