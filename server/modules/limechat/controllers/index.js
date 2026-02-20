import clientProvider from "../../../../utils/clientProvider.js";
import { getOrderTrackingInfo } from "./tracking.js";
import { mapOrderStatus } from "./mapping.js";

const normalizeIndianPhone = (input) => {
  if (!input) {
    throw new Error("Phone number is required");
  }
  let phone = String(input).trim();
  phone = phone.replace(/[\s\-()]/g, "");
  phone = phone.replace(/^0+/, "");
  if (phone.startsWith("91") && phone.length === 12) {
    phone = phone.slice(2);
  }
  if (!/^[6-9]\d{9}$/.test(phone)) {
    throw new Error(`Invalid Indian phone number: ${input}`);
  }

  return `+91${phone}`;
};
const getCustomersLastFiveOrders = async (phone) => {
  try {
    const shop =
      process.env.NODE_ENV == "dev"
        ? "swiss-local-dev.myshopify.com"
        : "swiss-beauty-dev.myshopify.com";
    const customerIdsList = await getShopifyCustomerIdByPhoneNumber(
      shop,
      normalizeIndianPhone(phone)
    );
    let ordersList = [];
    for (let i = 0; i < customerIdsList.length; i++) {
      let customerId = customerIdsList[i];
      const orders = await getLastFiveOrdersByCustomerId(shop, customerId);
      ordersList = [...ordersList, ...orders];
    }
    return ordersList.map((el) => el.name);
  } catch (err) {
    console.log("Failed reason -->" + err.message);
    throw new Error(
      "Failed to get customers last five orders reason -->" + err.message
    );
  }
};

const getShopifyCustomerIdByPhoneNumber = async (shop, phone) => {
  try {
    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const query = `query GetCustomerByPhone($query: String!, $first: Int = 2){
            customers(first: $first, query: $query){
                edges{
                    node{
                      id
                    }
                }
            }
        }`;
    const { data, errors, extensions } = await client.request(query, {
      variables: {
        query: `phone:"${phone}"`,
      },
    });
    if (errors && errors.length > 0) {
      throw new Error("failed to retrieve customer id");
    }
    let mappedId = data.customers.edges.map((el) =>
      el.node.id.replace("gid://shopify/Customer/", "")
    );
    return mappedId;
  } catch (err) {
    throw new Error(
      "Failed to get shopify customer id by phone number reason -->" +
        err.message
    );
  }
};

const getLastFiveOrdersByCustomerId = async (shop, customerId) => {
  try {
    const normalisedCustomerId = customerId.includes("gid")
      ? customerId
      : `gid://shopify/Customer/${customerId}`;
    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const query = `query{
            customer(id: "${normalisedCustomerId}"){
                orders(first: 5, sortKey: PROCESSED_AT, reverse: true){
                    edges{
                        node{
                            id
                            number
                        }
                    }
                }
            }
        }`;
    const { data, errors, extensions } = await client.request(query);
    if (errors && errors.length > 0) {
      throw new Error("Failed");
    }

    const orders = data.customer.orders.edges.map((el) => ({
      name: el.node.number,
    }));
    return orders;
  } catch (err) {
    throw new Error(
      "Failed to get last five orders by customer id reason -->" + err.message
    );
  }
};

const getOrderByOrderName = async (shop, orderName) => {
  try {
    const { client } = await clientProvider.offline.graphqlClient({ shop });
    if (!orderName.includes("#")) {
      orderName = `#${orderName}`;
    }
    const query = `query{
      orders(first:1, query:"name:${orderName}"){
        edges{
          node{
            id
            name
            createdAt
            returnStatus
            cancelledAt 
            tags
            cancelledAt
            returnStatus
            confirmed
            paymentGatewayNames
            customer{
              defaultPhoneNumber{
                phoneNumber
              }
            }
            currentTotalPriceSet{
              shopMoney{
                amount
              }
            }
            refunds(first:50){
              createdAt
              totalRefunded{
                amount
              }
            }
            fulfillments(first:50){
              trackingInfo(first:10){
                number
                company
              }
            }
          }
        }
      }
    }`;
    const res = await client.request(query);
    let order = res.data.orders.edges[0];
    if (!order) {
      return null;
    }
    order = order.node;
    try {
      const tracking = await getOrderTrackingInfo(order);
      order.tracking = tracking;
    } catch (err) {
      console.log("Failed to get tracking reason -->" + err.message);
      order.tracking = null;
    }
    return order;
  } catch (err) {
    throw new Error(
      "Failed to get order by order name reason --> ",
      +err.message
    );
  }
};

const getOrderDetailsFromShopifyByOrderName = async (shop, orderName) => {
  try {
    if (!shop || !orderName) {
      throw new Error("Required parameters missing");
    }
    const { client } = await clientProvider.offline.graphqlClient({ shop });
    let normalisedOrderName = (orderName + "").includes("#")
      ? orderName
      : `#${orderName}`;
    const query = `query{
      orders(first: 1, query:"name:${normalisedOrderName}"){
        edges{
          node{
            id
            name
            returnStatus
            cancelledAt
            cancelledAt
            fulfillments(first:1){
              displayStatus
              updatedAt
            }
          }
        }
      }
    }`;
    const { data, errors, extensions } = await client.request(query);
    if (errors && errors.length > 0) {
      throw new Error("Failed to get order details reason");
    }
    if (data.orders.edges.length == 0) {
      throw new Error("No order found for against order name");
    }
    return data.orders.edges[0].node;
  } catch (err) {
    throw new Error(
      "Failed to get order details from shopify by order name reason -->" +
        err.message
    );
  }
};
/**
 *
 * @param {string} shop - shopify store handle
 * @param {string} orderId - shopify order iod
 * @returns
 */
const getOrderStatusByOrderId = async (shop, orderId) => {
  try {
    const orderDetails = await getOrderDetailsFromShopifyByOrderName(
      shop,
      orderId
    );
    const orderStatus = await mapOrderStatus(orderDetails);
    return orderStatus;
  } catch (err) {
    console.log(
      "Failed to get order status by order id reason -->" + err.message
    );
  }
};
export {
  getCustomersLastFiveOrders,
  getOrderByOrderName,
  getOrderStatusByOrderId,
};
