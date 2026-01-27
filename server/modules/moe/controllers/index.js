
/**
 * Create moengage order delivered event
 * @param {string} shop - shopify store handle
 * @param {object} payload - order payload 
 */
const createMoengageOrderDeliveredEvent = async (shop, payload) => {
  try {
    console.log("creating morenage order delivered event");
    let orderId = payload.order_id;
    const orderDetails = await getShopifyOrderDetails(shop, orderId);
    const mappedOrderData = {
      id: orderDetails.name,
      customerName: orderDetails.customer.displayName,
      phone: orderDetails.customer.defaultPhoneNumber?.phoneNumber,
      email: orderDetails.customer.defaultEmailAddressA?.emailAddress,
      price: Number(orderDetails.totalPriceSet.presentmentMoney.amount),
    };
    if (!mappedOrderData.phone) {
      throw new Error(
        "Phone number can't be blank in order to create moengage event"
      );
    }
    await createMoengageEvent({
      eventName: "custom_order_delivered_v2",
      customerPhone: mappedOrderData.phone,
      ...mappedOrderData,
    });
  } catch (err) {
    console.log(
      "Failed to create moengage order delivered event reason -->" + err.message
    );
  }
};


/**
 * Generate base64 encoded auth key
 * @returns {string} - auth key
 */
const generateMoenagageEncodedAuthKey = () => {
  try {
    const username = process.env.MOE_WORKSPACE_ID;
    const password = process.env.MOE_API_KEY;
    if (!username || !password) {
      throw new Error("Required parameter missing");
    }
    const base64Pass = nodebase64.encode(`${username}:${password}`);
    return base64Pass;
  } catch (err) {
    throw new Error("failed to generate encoded auth key -->" + err.message);
  }
};

/**
 *
 * @param {string} shop - shopify store handle Ex - swiss-local-dev.myshopify.com
 * @param {string} orderId - shopify order id
 */
const getShopifyOrderDetails = async (shop, orderId) => {
  try {
    let maxRetries = 3;
    let retry = true;
    let returnData = null;
    while (retry && maxRetries > 0) {
      const ownerId = (orderId + "").includes("gid")
        ? orderId
        : `gid://shopify/Order/${orderId}`;
      const query = `query getOrderData($ownerId : ID!){
                order(id : $ownerId){
                    name
                    customer{
                        defaultPhoneNumber{
                            phoneNumber
                        }
                        defaultEmailAddress{
                            emailAddress
                        }
                        displayName 
                    }
                    totalPriceSet{
                      presentmentMoney{
                        amount
                      }
                    }
                }
            }`;
      const { client } = await clientProvider.offline.graphqlClient({ shop });
      const { data, extensions, errors } = await client.request(query, {
        variables: {
          ownerId: ownerId,
        },
      });
      if (errors && errors.length > 0) {
        await new Promise((res, rej) => {
          setTimeout(() => {
            res(true);
            maxRetries--;
          }, 600);
        });
      }
      if (extensions.cost.throttleStatus.currentlyAvailable < 400) {
        await new Promise((res, rej) => {
          setTimeout(() => {
            res(true);
          }, 600);
        });
      }
      returnData = data.order;
      retry = false;
    }
    return returnData;
  } catch (err) {
    throw new Error(
      "Failed to get shopify order details reason -->" + err.message
    );
  }
};

/**
 * create moengage events
 * @typedef {object} payload
 * @property {string} eventName - event name
 * @property {string} customerPhone - customer phone number
 * @property {object} params - data parameters
 */
const createMoengageEvent = async ({ eventName, customerPhone, params }) => {
  try {
    console.log("trying to create moengage event : ", eventName, customerPhone);
    if (!customerPhone) {
      throw new Error("Phone number missing");
    }
    const moeUrl = process.env.MOE_URL;
    const username = process.env.MOE_WORKSPACE_ID;
    const endpoint = `${moeUrl}/v1/event/${username}`;
    const payload = {
      type: "event",
      customer_id: customerPhone,
      actions: [
        {
          action: eventName,
          attributes: { ...params },
        },
      ],
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
    console.log("Create moengage event --> " + eventName);
  } catch (err) {
    console.log("Failed to cretae moengage event reason -->" + err.message);
  }
};


export {
    createMoengageOrderDeliveredEvent
}
