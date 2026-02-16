import nodebase64 from "nodejs-base64-converter";

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

/**
 * Get customer phone number
 * @param {string} shop
 * @param {string} customerId
 * @returns
 */
const retrievePhoneNumberAgainstCustomer = async (shop, customerId) => {
  try {
    let maxRetries = 3;
    let retry = true;
    let customerData = null;
    if (!shop || !customerId) {
      throw new Error("Shop and customer id are required parameters");
    }
    while (retry && maxRetries > 0) {
      let ownerId = (customerId + "").includes("gid")
        ? customerId
        : `gid://shopify/Customer/${customerId}`;
      const { client } = await clientProvider.offline.graphqlClient({ shop });
      const query = `query($identifier: CustomerIdentifierInput!){
        customer: customerByIdentifier(identifier: $identifier){
          defaultAddress{
            phone
          }
          defaultPhoneNumber{
            phoneNumber
          }
        }
      }`;

      const { data, errors, extensions } = await client.request(query, {
        variables: {
          identifier: {
            id: ownerId,
          },
        },
      });
      if (errors && errors.length > 0) {
        console.log(
          "Failed to get variant data from shopify retrying query again"
        );
        maxRetries--;
      }
      if (extensions.cost.throttleStatus.currentlyAvailable < 400) {
        await new Promise((res, rej) => {
          setTimeout(() => {
            console.log(
              "🕚 Max query size was reached so we waited one second"
            );
            res(true);
          }, 1000);
        });
      }
      retry = false;
      customerData = data?.customer;
    }
    return customerData;
  } catch (err) {
    throw new Error(
      "Failed to retrieve phone number for customer reason -->" + err.message
    );
  }
};

const updateMoeUserAttribute = async (phoneNumber, attributes) => {
  try {
    const moeUrl = process.env.MOE_URL;
    const username = process.env.MOE_WORKSPACE_ID;
    const endpoint = `${moeUrl}/v1/customer/${username}`;
    const payload = {
      type: "customer",
      customer_id: phoneNumber,
      attributes,
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
    console.log("Update user attribute in moe triggered", response);
  } catch (err) {
    throw new Error("Failed to update moe user attribute");
  }
};
export {
  createMoengageEvent,
  retrievePhoneNumberAgainstCustomer,
  updateMoeUserAttribute,
};
