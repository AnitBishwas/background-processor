import fetch from "node-fetch";

/**
 * Normalize helper
 */
const normalize = (v) =>
  (v || "")
    .toString()
    .trim()
    .toLowerCase();

/**
 * Extract cp_id from tracking URL
 */
const extractCpIdFromUrl = (
  url
) => {
  try {
    if (!url) return null;

    const parsed = new URL(url);

    const cpId =
      parsed.searchParams.get(
        "cp_id"
      );

    return cpId
      ? Number(cpId)
      : null;
  } catch (err) {
    return null;
  }
};

/**
 * Extract CP IDs from Shopify order
 */
const extractCpIdsFromShopifyOrder =
  (
    shopifyOrder,
    awb
  ) => {
    try {
      const order =
        shopifyOrder?.order ||
        shopifyOrder;

      const fulfillments =
        order?.fulfillments ||
        [];

      const cpIds =
        new Set();

      for (const fulfillment of fulfillments) {
        const trackingInfo =
          fulfillment?.trackingInfo ||
          [];

        for (const tracking of trackingInfo) {
          const trackingNumber =
            tracking?.number;

          const trackingUrl =
            tracking?.url;

          /**
           * Match same AWB
           */
          if (
            trackingNumber &&
            trackingNumber.toString() ===
              awb.toString()
          ) {
            const cpId =
              extractCpIdFromUrl(
                trackingUrl
              );

            if (cpId) {
              cpIds.add(cpId);
            }
          }
        }
      }

      return [...cpIds];
    } catch (err) {
      return [];
    }
  };

/**
 * Fetch tracking from ClickPost
 */
export const getTrackingStatusFromClickPost =
  async ({
    awb,
    shopifyOrder,
  }) => {
    try {
      if (!awb) {
        throw new Error(
          "AWB missing"
        );
      }

      /**
       * Dynamic CP IDs
       */
      const dynamicCpIds =
        extractCpIdsFromShopifyOrder(
          shopifyOrder,
          awb
        );

      console.log(
        "DYNAMIC CP_IDS =>",
        dynamicCpIds
      );

      if (
        !dynamicCpIds.length
      ) {
        throw new Error(
          "CP_ID not found in Shopify tracking URL"
        );
      }

      /**
       * Try all cp_ids
       */
      for (const cpId of dynamicCpIds) {
        try {
          const url = `https://api.clickpost.in/api/v2/track-order/?username=${process.env.CLICKPOST_USERNAME}&key=${process.env.CLICKPOST_API_KEY}&waybill=${awb}&cp_id=${cpId}`;

          console.log(
            "CLICKPOST URL =>",
            url
          );

          const response =
            await fetch(url, {
              method: "GET",
              headers: {
                "Content-Type":
                  "application/json",
              },
            });

          const data =
            await response.json();

          console.log(
            "CLICKPOST RESPONSE =>",
            JSON.stringify(
              data,
              null,
              2
            )
          );

          const result =
            data?.result || {};

          const shipment =
            result?.[awb] || {};

          console.log(
            "CLICKPOST FINAL =>",
            JSON.stringify(
              shipment,
              null,
              2
            )
          );

          /**
           * Latest status
           */
          const latestStatus =
            normalize(
              shipment
                ?.latest_status
                ?.clickpost_status_description ||
                shipment
                  ?.latest_status
                  ?.status
            );

          console.log(
            "LATEST STATUS =>",
            latestStatus
          );

          /**
           * DELIVERED
           */
          if (
            latestStatus.includes(
              "delivered"
            )
          ) {
            return {
              success: true,
              current_status:
                "delivered",
              tracking_data:
                shipment,
            };
          }

          /**
           * RTO
           */
          if (
            latestStatus.includes(
              "rto"
            )
          ) {
            return {
              success: true,
              current_status:
                "rto",
              tracking_data:
                shipment,
            };
          }

          /**
           * FAILED DELIVERY / NDR
           */
          if (
            latestStatus.includes(
              "failed"
            ) ||
            latestStatus.includes(
              "ndr"
            ) ||
            latestStatus.includes(
              "undelivered"
            )
          ) {
            return {
              success: true,
              current_status:
                "failed-delivery",
              tracking_data:
                shipment,
            };
          }

          /**
           * OUT FOR DELIVERY
           */
          if (
            latestStatus.includes(
              "out for delivery"
            ) ||
            latestStatus.includes(
              "ofd"
            )
          ) {
            return {
              success: true,
              current_status:
                "out-for-delivery",
              tracking_data:
                shipment,
            };
          }

          /**
           * DEFAULT
           */
          return {
            success: true,
            current_status:
              "in-transit",
            tracking_data:
              shipment,
          };
        } catch (err) {
          console.log(
            "CP_ID FAILED =>",
            cpId
          );

          console.log(err);
        }
      }

      return {
        success: false,
        error:
          "Unable to fetch ClickPost tracking",
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  };