import nodebase64 from "nodejs-base64-converter";
import fetch from "node-fetch";

/**
 * Generate base64 encoded auth key
 * @returns {string} - auth key
 */
const generateMoenagageEncodedAuthKey = () => {
  try {
    const username = process.env.MOE_WORKSPACE_ID;
    const password = process.env.MOE_BUSINESS_API_KEY;
    if (!username || !password) {
      throw new Error("Required parameter missing");
    }
    const base64Pass = nodebase64.encode(`${username}:${password}`);
    return base64Pass;
  } catch (err) {
    throw new Error("failed to generate encoded auth key -->" + err.message);
  }
};

// this function is only needed to be fired once, we already did in dev
const createMoengageBusinessEventForBackInStock = async () => {
  try {
    const moeUrl = process.env.MOE_URL;
    const endpoint = `${moeUrl}/v1.0/business_event`;
    const payload = {
      event_name: "backInStockV2",
      event_attributes: [
        {
          attribute_name: "productId",
          attribute_data_type: "string",
        },
        {
          attribute_name: "productTitle",
          attribute_data_type: "string",
        },
        {
          attribute_name: "variantId",
          attribute_data_type: "string",
        },
        {
          attribute_name: "variantTitle",
          attribute_data_type: "string",
        },
        {
          attribute_name: "variantImage",
          attribute_data_type: "string",
        },
        {
          attribute_name: "stockFillDate",
          attribute_data_type: "date",
        },
        {
          attribute_name: "variantOption",
          attribute_data_type: "string",
        },
        {
          attribute_name: "price",
          attribute_data_type: "int",
        },
        {
          attribute_name: "compareAtPrice",
          attribute_data_type: "int",
        },
        {
          attribute_name: "inventory",
          attribute_data_type: "int",
        },
        {
          attribute_name: "sku",
          attribute_data_type: "string",
        },
      ],
      created_by: "anit.biswas@swissbeauty.ind",
    };
    const request = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${generateMoenagageEncodedAuthKey()}`,
        "X-Forwarded-For": null,
      },
      body: JSON.stringify(payload),
    });
    const response = await request.json();
    console.dir(response, { depth: null });
  } catch (err) {
    console.error(
      "Failed to create moenage business event reason -->" + err.message
    );
  }
};

const triggerBackInStockMoengageEvent = async (payload) => {
  try {
    const moeUrl = process.env.MOE_URL;
    const endpoint = `${moeUrl}/v5/business-events/triggers`;
    if (!payload) {
      throw new Error("Payload required");
    }
    const triggerPayload = {
      event_name: "backInStockV2",
      triggered_by: "anit.biswas@swissbeauty.in",
      event_attributes: {
        productId:
          payload?.product?.id.replace("gid://shopify/Product/", "") || "null",
        productTitle: payload?.product?.title || "null",
        variantId:
          process.env.NODE_ENV == "dev"
            ? "44590529380667"
            : payload?.id.replace("gid://shopify/ProductVariant/", "") ||
              "null",
        variantTitle: payload?.displayName,
        variantImage: payload.image,
        stockFillDate: new Date(Date.now()).toISOString().slice(0, 19),
        variantOption: payload.selectedOptions[0]?.value,
        price: Number(payload.price),
        compareAtPrice: Number(payload.compareAtPrice),
        inventory: payload.inventoryQuantity,
        sku: payload.sku,
      },
    };
    const request = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${generateMoenagageEncodedAuthKey()}`,
        "X-Forwarded-For": null,
      },
      body: JSON.stringify(triggerPayload),
    });
    const response = await request.json();
    if(response.data.triggered_status != 'SUCCESS'){
      throw new Error("Failed to triggere moengage back in stock business event");
    }
  } catch (err) {
    throw new Error(
      "Failed to trigger back in stock moengage business event reason -->" +
        err.message
    );
  }
};
export {
  createMoengageBusinessEventForBackInStock,
  triggerBackInStockMoengageEvent,
};
