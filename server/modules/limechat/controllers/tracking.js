const getOrderTrackingInfo = async (order) => {
  try {
    let tracking = null;
    const isCompanyShiprocket =
      order.fulfillments.length > 0 &&
      order.fulfillments[0]?.trackingInfo[0]?.company == "SHIPROCKET"
        ? true
        : false;
    const isCompanyDelhivery =
      order.fulfillments.length > 0 &&
      order.fulfillments[0]?.trackingInfo[0]?.company == "Delhivery"
        ? true
        : false;
    let orderId = order.name.replace("#", "");
    let trackingNumber =
      order.fulfillments.length > 0 &&
      order.fulfillments[0]?.trackingInfo[0]?.number;
    if (isCompanyShiprocket) {
      tracking = await getTrackingStatusFromShipRocket(orderId);
    }
    if (isCompanyDelhivery) {
      tracking = await getTrackingStatusFromDelhivery(trackingNumber, orderId);
    }
    return tracking;
  } catch (err) {
    throw new Error("Failed to get order tracking info reason --> " + err);
  }
};
/**
 * Get tracking status from shiprocket
 * @param {string} orderId - shopify order id
 * @returns {object} - tracking object
 */
const getTrackingStatusFromShipRocket = async (orderId) => {
  try {
    if (!orderId) {
      throw new Error("Order ID is required to fetch tracking status");
    }
    const token = await generateAuthTokenForShiprocket();
    const url = `https://apiv2.shiprocket.in/v1/external/courier/track?order_id=${orderId}`;
    const request = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await request.json();
    let formattedData = {
      edd: data[0].tracking_data.shipment_track[0].edd,
      delivered: {
        ok: data[0].tracking_data.shipment_track[0].delivered_date.length > 0,
        date: data[0].tracking_data.shipment_track[0].delivered_date,
      },
      attempted_delivery: {
        ok: data[0].tracking_data.shipment_track_activities.find(
          (el) => el["activity"] == "PENDING FOR RE-ATTEMPT"
        )?.date
          ? true
          : false,
        date:
          data[0].tracking_data.shipment_track_activities.find(
            (el) => el["activity"] == "PENDING FOR RE-ATTEMPT"
          )?.date || null,
        attempt_count: data[0].tracking_data.shipment_track_activities.filter(
          (el) => el["activity"] == "PENDING FOR RE-ATTEMPT"
        ).length,
      },
      cancelled_date: {
        ok: data[0].tracking_data.shipment_track_activities.find(
          (el) => el["activity"] == "CANCELLED"
        )?.date
          ? true
          : false,
        date: data[0].tracking_data.shipment_track_activities.find(
          (el) => el["activity"] == "CANCELLED"
        )?.date,
      },
      rto_date: {
        ok: data[0].tracking_data.shipment_track_activities.find(
          (el) => el["activity"] == "Return To Origin"
        )?.date
          ? true
          : false,
        date: data[0].tracking_data.shipment_track_activities.find(
          (el) => el["activity"] == "Return To Origin"
        )?.date,
      },
    };
    return formattedData;
  } catch (err) {
    throw new Error(
      "Failed to get tracking status from shiprocket reason --> " + err.message
    );
  }
};

/**
 * Get order tracking status from delivery
 * @param {string} awb - order awb number can be retrieved from shopify admin panel
 * @param {string} orderId - shopify id
 * @returns {object} - tracking object
 */
const getTrackingStatusFromDelhivery = async (awb, orderId) => {
  try {
    const url = `https://track.delhivery.com/api/v1/packages/json/?waybill=${awb}&ref_ids=${orderId}`;
    const request = await fetch(url, {
      headers: {
        Authorization: `Token ${process.env.DELHIVERY_API}`,
      },
    });
    const data = await request.json();
    let formattedData = {
      edd: data.ShipmentData[0].Shipment.ExpectedDeliveryDate,
      delivered: {
        ok: data.ShipmentData[0].Shipment.DeliveryDate ? true : false,
        date: data.ShipmentData[0].Shipment.DeliveryDate,
      },
      attempted_delivery: {
        ok: data.ShipmentData[0].Shipment.FirstAttemptDate ? true : false,
        date: data.ShipmentData[0].Shipment.FirstAttemptDate,
        attempt_count: 1,
      },
      rto_date: {
        ok: data.ShipmentData[0].Shipment.RTOStartedDate ? true : false,
        date: data.ShipmentData[0].Shipment.RTOStartedDate,
      },
      cancelled_date: {
        ok: false,
      },
    };
    return formattedData;
  } catch (err) {
    throw new Error(
      "Failed to get tracking info from delhivery reason -->" + err.message
    );
  }
};
/**
 * Generate auth token for shiprocket
 * @returns {string} authtoken
 */
const generateAuthTokenForShiprocket = async () => {
  try {
    const url = `https://apiv2.shiprocket.in/v1/external/auth/login`;
    const request = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: process.env.SHIPROCKET_EMAIL,
        password: process.env.SHIPROCKET_PASS,
      }),
    });
    const data = await request.json();
    if (!data?.token) {
      throw new Error("Failed to get auth token from shiprocket request");
    }
    return data.token;
  } catch (err) {
    throw new Error(
      "Failed to generate shiprocket auth token reason --> " + err.message
    );
  }
};

export { getOrderTrackingInfo };
