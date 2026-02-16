import clientProvider from "../../../../utils/clientProvider.js";
import { createMoengageEvent } from "../helpers/index.js";

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
      phone:
        orderDetails.customer.defaultPhoneNumber?.phoneNumber ||
        orderDetails.customer.defaultAddress?.phone ||
        null,
      email: orderDetails.customer.defaultEmailAddress?.emailAddress,
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
                        defaultAddress{
                          phone
                        }
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

export { createMoengageOrderDeliveredEvent };
