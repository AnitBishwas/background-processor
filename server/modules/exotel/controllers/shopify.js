import { getTrackingStatusFromClickPost } from "./clickpost.js";
import clientProvider from "../../../../utils/clientProvider.js";

const shop =
  process.env.NODE_ENV == "dev"
    ? "swiss-local-dev.myshopify.com"
    : "swiss-beauty-dev.myshopify.com";

const getOrderStatusByPhoneNumber = async (phone) => {
  try {
    if (!phone) {
      throw new Error("Phone number not provided");
    }
    const customer = await getCustomerIdByPhoneNumber(phone);
    if (customer == null)
      return {
        status: "no_order_against_phone",
      };
    let customer_id = customer.id.replace("gid://shopify/Customer/", "");
    const order = await getOrderByCustomerId(customer_id);
    if (!order) {
      return {
        status: "no_order_against_phone",
      };
    }
    const orderStatus = mapOrderStatus(order);
    return {
      status: orderStatus,
      order,
    };
  } catch (err) {
    throw new Error("Failed to get order status by phone number" + err.message);
  }
};
const getOrderStatusByName = async (orderName) => {
  try {
    if (!orderName) {
      throw new Error("Order Id not provided");
    }
    const order = await getOrderByOrderName(orderName);
    if (!order) {
      return {
        status: "no_order_against_orderId",
      };
    }
    const orderStatus = mapOrderStatus(order);
    return {
      status: orderStatus,
      order,
    };
  } catch (err) {
    throw new Error(
      "Failed to get order status by order name reason --> " + err.message
    );
  }
};

/**
 * normalise phone numbers with +91 formats
 * @param {string} phone
 * @returns {string}
 */
const normalisePhoneNumber = (phone) => {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.substring(1);
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.substring(2);
  }
  if (digits.length !== 10) {
    return null;
  }

  return `+91${digits}`;
};

/**
 * @param {string} phone
 * @returns {string} customerId
 */
const getCustomerIdByPhoneNumber = async (phone) => {
  try {
    phone = normalisePhoneNumber(phone);
    const query = `query($identifier: CustomerIdentifierInput!){
      customer: customerByIdentifier(identifier: $identifier){
        id
      }
    }`;
    const variables = {
      identifier: {
        phoneNumber: phone,
      },
    };

    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const { data, extensions, errors } = await client.request(query, {
      variables,
    });
    const response = data.customer ? data.customer.id : null;
    if (!response) {
      throw new Error("No customer found");
    }
    return response.replace("gid://shopify/Customer/", "");
  } catch (err) {
    throw new Error(
      "Failed to get customer by phone number reason --> " + err.message + phone
    );
  }
};

/**
 * Get customer order
 * @param {string} customerId
 * @returns {object} shopify order object
 */
const getOrderByCustomerId = async (customerId) => {
  try {
    const query = `query{
      orders(first:1,query:"customer_id:${customerId}",reverse: true){
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
              trackingInfo{
                number
                company
                url
              }
            }
          }
        }
      }
    }`;
    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const { data, extensions, errors } = await client.request(query);
    let order = data.orders.edges[0];
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
    throw new Error("Failed to get customer order reason --> " + err.message);
  }
};
/**
 *
 * @param {string} orderName
 * @returns {object} shgopify order object
 */
const getOrderByOrderName = async (orderName) => {
  try {
    if (!orderName.includes("#")) {
      orderName = `#${orderName}`;
    }
    console.log("order status by order id here ---->", orderName);
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
              trackingInfo{
                number
                company
                url
              }
            }
          }
        }
      }
    }`;
    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const { data, extensions, errors } = await client.request(query);

    let order = data.orders.edges[0];
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
    console.log("ORDER FETCH ERROR =>", err);

    throw new Error(
      "Failed to get order by order name reason --> " + err.message
    );
  }
};
/**
 *
 * @param {object} order - shopify order
 * @returns
 */
const cancelOrder = async (order) => {
  try {
    const query = `mutation OrderCancel($orderId: ID!, $notifyCustomer: Boolean, $refund: Boolean!, $restock: Boolean!, $reason: OrderCancelReason!, $staffNote: String){
      orderCancel(orderId: $orderId, notifyCustomer: $notifyCustomer, refund: $refund, restock: $restock, reason: $reason, staffNote: $staffNote){
        job {
          id
          done
        }
        orderCancelUserErrors{
          field
          message
          code
        }
        userErrors{
          field
          message
        }
      }
    }`;
    const variables = {
      orderId: order.id,
      notifyCustomer: true,
      restock: true,
      refund: order.paymentGatewayNames.indexOf("cash_on_delivery") == -1,
      reason: "CUSTOMER",
      staffNote: "Order cancelled via IVR",
    };
    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const { data, extensions, errors } = await client.request(query, {
      variables,
    });
    if (
      data.orderCancel?.orderCancelUserErrors.length == 0 &&
      data.orderCancel?.userErrors.length == 0
    ) {
      return true;
    }
    return false;
  } catch (err) {
    throw new Error("Failed to cancel order reason --> " + err.message);
  }
};
const mapOrderStatus = async (order) => {
  try {
    /*
    order status mapped on variuos scenarios 
    Based on order status
    Based on order tag
    - Refund Successfull : Picked from order tags
    - Refund initiateed : Picked from order tags
    - Cancelled : Picked from order status
    - Returned : Picked from order tags
    - Delivered: Picked from order tags
    - Attempted Delivery: Picked from order tags
    - In Transit: Picked from order tags
    - Packed : Picked from tracking number/fulfillment object
    - Placed : Order confirmed property
    */
    let order_tags = order.tags.map((el) => el.toLowerCase());
    try {
      const tracking = await getOrderTrackingInfo(order);
      order.tracking = tracking;
    } catch (err) {
      console.log("Failed to get tracking reason -->" + err.message);
      order.tracking = null;
    }
    if (order_tags.indexOf("refund_credited") != -1) {
      return "refund_successfull";
    }
    if (order_tags.indexOf("refund_initiated") != -1) {
      return "refund_initiated";
    }
    if (order.cancelledAt) {
      return "cancelled";
    }
    if (
      order_tags.indexOf("rto") != -1 ||
      order_tags.indexOf("returned") != -1
    ) {
      return "returned";
    } else if (order_tags.indexOf("delivered") != -1) {
      return "delivered";
    } else if (order_tags.indexOf("undelivered") != -1) {
      return "attempted_delivery";
    } else if (order_tags.indexOf("in-transit") != -1) {
      return "in-transit";
    } else if (order.fulfillments.length > 0) {
      return "packed";
    } else if (order.confirmed) {
      return "placed";
    }
    return null;
  } catch (err) {
    throw new Error("Failed to map order status reason --> ", err.message);
  }
};
const getOrderRefundStatusByOrderName = async (orderName) => {
  try {
    const order = await getOrderByOrderName(orderName);
    if (!order) {
      return {
        status: "no_order_found_orderId",
      };
    }
    const currentOrderStatus = mapOrderStatus(order);
    if (currentOrderStatus == "refund_initiated") {
      return {
        status: "refund_initiated",
        order,
      };
    } else if (currentOrderStatus == "refund_successfull") {
      return {
        status: "refund_successfull",
        order,
      };
    }
    if (order.paymentGatewayNames.indexOf("cash_on_delivery") != -1) {
      return {
        status: "order_cod_refund_not_eligible",
        order,
        statusText: "Cash On Delivery",
      };
    }
    if (
      currentOrderStatus == "packed" ||
      currentOrderStatus == "in-transit" ||
      currentOrderStatus == "attempted_delivery"
    ) {
      return {
        status: "order_status_refund_not_eligible",
        order,
        statusText: currentOrderStatus,
      };
    }
    return {
      status: null,
    };
  } catch (err) {
    throw new Error(
      "Failed to get order refund status by order name reason --> " +
        err.message
    );
  }
};
const getOrderRefundStatusByPhone = async (phone) => {
  try {
    if (!phone) {
      throw new Error("Phone number not provided");
    }
    const customer = await getCustomerIdByPhoneNumber(phone);
    if (customer == null) return "no_customer_found_phone";
    let customer_id = customer.id.replace("gid://shopify/Customer/", "");
    const order = await getOrderByCustomerId(customer_id);
    if (!order) {
      return {
        status: "no_order_found_orderId",
      };
    }
    const currentOrderStatus = mapOrderStatus(order);
    if (currentOrderStatus == "refund_initiated") {
      return {
        status: "refund_initiated",
        order,
      };
    } else if (currentOrderStatus == "refund_successfull") {
      return {
        status: "refund_successfull",
        order,
      };
    }
    if (order.paymentGatewayNames.indexOf("cash_on_delivery") != -1) {
      return {
        status: "order_cod_refund_not_eligible",
        order,
        statusText: "Cash On Delivery",
      };
    }
    if (
      currentOrderStatus == "packed" ||
      currentOrderStatus == "in-transit" ||
      currentOrderStatus == "attempted_delivery"
    ) {
      return {
        status: "order_status_refund_not_eligible",
        order,
        statusText: currentOrderStatus,
      };
    }
    return {
      status: null,
    };
  } catch (err) {
    throw new Error(
      "Failed to get order refund status by phone reason --> " + err.message
    );
  }
};
const cancelOrderByPhone = async (phone) => {
  try {
    if (!phone) {
      throw new Error("Phone number not provided");
    }
    const customer = await getCustomerIdByPhoneNumber(phone);
    if (customer == null) return "no_customer_found_phone";
    let customer_id = customer.id.replace("gid://shopify/Customer/", "");
    const order = await getOrderByCustomerId(customer_id);
    if (!order) {
      return {
        status: "no_order_against_phone",
      };
    }
    const currentOrderStatus = mapOrderStatus(order);
    if (currentOrderStatus == "cancelled") {
      return {
        status: "order_already_cancelled",
        order,
        statusText: currentOrderStatus,
      };
    }
    const orderCancellationEligibility =
      checkOrderCancellationEligibility(order);
    if (orderCancellationEligibility) {
      const orderCancellation = await cancelOrder(order);
      if (orderCancellation) {
        return {
          status: "order_cancelled",
          order,
          statusText: "order_cancellation_successfull",
        };
      }
    } else {
      return {
        status: "order_in_process",
        order,
        statusText: currentOrderStatus,
      };
    }
  } catch (err) {
    throw new Error(
      "Failed to cancel order by phone reason --> " + err.messsage
    );
  }
};
const cancelOrderByOrderName = async (orderName) => {
  try {
    if (!orderName) {
      throw new Error("Order id not provided");
    }
    const order = await getOrderByOrderName(orderName);
    if (!order) {
      return {
        status: "no_order_against_orderId",
      };
    }
    const currentOrderStatus = mapOrderStatus(order);
    if (currentOrderStatus == "cancelled") {
      return {
        status: "order_already_cancelled",
        order,
        statusText: currentOrderStatus,
      };
    }
    const orderCancellationEligibility =
      checkOrderCancellationEligibility(order);
    if (orderCancellationEligibility) {
      const orderCancellation = await cancelOrder(order);
      if (orderCancellation) {
        return {
          status: "order_cancelled",
          order,
          statusText: "order_cancellation_successfull",
        };
      }
    } else {
      return {
        status: "order_in_process",
        order,
        statusText: currentOrderStatus,
      };
    }
  } catch (err) {
    throw new Error(
      "Failed to cancel order by order name reason -->" + err.message
    );
  }
};
const checkOrderCancellationEligibility = (order) => {
  try {
    const currentStatusOfOrder = mapOrderStatus(order);
    if (
      currentStatusOfOrder == "cancelled" ||
      currentStatusOfOrder == "in-transit" ||
      currentStatusOfOrder == "packed" ||
      currentStatusOfOrder == "delivered" ||
      currentStatusOfOrder == "returned"
    ) {
      return false;
    } else {
      return true;
    }
  } catch (err) {
    throw new Error(
      "Failed to check order cancellation eligibility reason -->" + err.message
    );
  }
};

const getOrderTrackingInfo = async (order) => {
  try {
    const fulfillments = order?.fulfillments || [];

    if (!fulfillments.length) {
      return null;
    }

    const latestFulfillment = fulfillments[fulfillments.length - 1];

    const trackingInfo = latestFulfillment?.trackingInfo?.[0];

    if (!trackingInfo) {
      return null;
    }

    const awb = trackingInfo?.number;

    if (!awb) {
      return null;
    }

    /**
     * CLICKPOST
     */
    const clickpostResponse = await getTrackingStatusFromClickPost({
      awb,
      shopifyOrder: order,
    });

    console.log("CLICKPOST FINAL =>", clickpostResponse);

    return clickpostResponse;
  } catch (err) {
    console.log(err);

    return null;
  }
};

/**
 * Get the last five orders by customer id
 * @param {string} customerId - shopify customer id
 * @returns {array} orders - List of orders
 */
const getLastFiverOrdersByCustomerId = async (customerId) => {
  try {
    const query = `query{
      orders(first:5,query:"customer_id:${customerId}",reverse: true){
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
            trackingInfo{
              number
              company
              url
            }
          }
          }
        }
      }
    }`;
    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const { data, extensions, errors } = await client.request(query);
    let orders = data.orders.edges;
    if (orders.length == 0) {
      return [];
    }
    orders = orders.map((el) => el.node.name);
    return orders;
  } catch (err) {
    throw new Error("Failed to get customer order reason --> " + err.message);
  }
};

const getOrderTrackingController = async (req, res) => {
  try {
    const { order_name } = req.body;

    if (!order_name) {
      return res.status(400).send({
        success: false,
        error: "order_name missing",
      });
    }

    const order = await getOrderByOrderName(order_name);

    if (!order) {
      return res.status(404).send({
        success: false,
        error: "Order not found",
      });
    }

    return res.send({
      success: true,
      data: order?.tracking || null,
    });
  } catch (err) {
    console.log(err);

    return res.status(500).send({
      success: false,
      error: err.message,
    });
  }
};

export {
  getOrderStatusByPhoneNumber,
  getOrderStatusByName,
  getOrderRefundStatusByPhone,
  getOrderRefundStatusByOrderName,
  cancelOrderByPhone,
  cancelOrderByOrderName,
  getCustomerIdByPhoneNumber,
  getOrderByCustomerId,
  getOrderByOrderName,
  cancelOrder,
  getLastFiverOrdersByCustomerId,
  getOrderTrackingController,
};
