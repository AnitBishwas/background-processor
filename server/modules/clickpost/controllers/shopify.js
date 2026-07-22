import clientProvider from "../../../../utils/clientProvider.js";

const retrieveCancellOrderDetails = async (client, orderId) => {
  try {
    const query = `query CancelledOrderDetails($orderId: ID!){
        order(id: $orderId){
            id
            name
            createdAt
            discountCode
            tags
            currentTotalPriceSet{
              presentmentMoney{
                amount
              } 
            }
            transactions(first:10){
                gateway
                amountSet{
                    presentmentMoney{
                        amount   
                    }
                }
            }
            totalRefundedSet{
                presentmentMoney{
                    amount
                }
            }
            totalDiscountsSet{
              presentmentMoney{
                amount
              } 
            }
            totalShippingPriceSet{
              presentmentMoney{
                amount
              }
            }
            customAttributes{
              key
              value
            }
            customer{
                firstName,
                lastName,
                defaultEmailAddress{
                   emailAddress 
                }
                defaultPhoneNumber{
                   phoneNumber 
                }
                defaultAddress{
                    phone
                }
            }
        }
    }`;
    const { data, extensions, errors } = await client.request(query, {
      variables: {
        orderId: orderId,
      },
    });
    if (errors && errors.length > 0) {
      throw new Error("Some error occured while fetching the data");
    }
    if (!data.order) {
      throw new Error("No order found against the provided order name");
    }
    const lineItems = await retrieveLineItemsDetailsForOrder(client, orderId);
    data.order.lineItems = lineItems;
    return data.order;
  } catch (err) {
    throw new Error(
      "Failed to retrieve order details from shopify by order id reason -->" +
        err.message
    );
  }
};

const retrieveLineItemsDetailsForOrder = async (client, orderId) => {
  try {
    let lineItems = [];
    let next = null;
    do {
      const query = `query OrderLineItems($first: Int!, $after: String, $orderId: ID!){
        order(id: $orderId){
          id
          lineItems(first: $first,after: $after){
            edges{
              node{
                variant{
                    sku
                    barcode
                    displayName
                    id
                    price
                    compareAtPrice
                    title
                    product{
                        id
                        title
                        tags
                    }
                }
                quantity 
              }
            }
            pageInfo{
              hasNextPage
              endCursor
            }
          }
        }
      }`;
      const variables = {
        first: 4,
        orderId: orderId,
      };
      next ? (variables["after"] = next) : null;
      const { data, errors, extensions } = await client.request(query, {
        variables,
      });
      if (errors && errors.length > 0) {
        throw new Error(
          "Failed to retrieve line items details reason -->" + errors.join(",")
        );
      }
      const pageInfo = data.order.lineItems.pageInfo;
      let itemsList = data.order.lineItems.edges.map(el => el.node);
      lineItems = [...lineItems,...itemsList];
      if(pageInfo.hasNextPage){
        next = pageInfo.endCursor;
      }else{
        next = false;
      }
    } while (next);
    return lineItems;
  } catch (err) {
    throw new Error(
      "Failed tto retrieve line items details for order reason -->" +
        err.message
    );
  }
};
const retrieveOrderIdByOrderName = async (client, orderName) => {
  try {
    const query = `query RetrieveOrderId($first: Int, $query:String){
            orders(first: $first,query: $query){
                edges{
                    node{
                        id
                        name
                    }
                }
            }
        }`;
    const variables = {
      first: 1,
      query: `name:"${orderName}"`,
    };
    const { data, extensions, errors } = await client.request(query, {
      variables,
    });
    if (errors && errors.length > 0) {
      throw new Error("Failed to retrieve order");
    }
    const correspondingOrder =
      data.orders.edges.find((el) => el.node.name.replace("#", "") == orderName)
        ?.node || null;
    if (!correspondingOrder) {
      throw new Error("No order found against the given order name");
    }
    return correspondingOrder.id;
  } catch (err) {
    throw new Error(
      "Failed to retrieve order id by order name reason -->" + err.message
    );
  }
};
const markOrderCancelled = async (client, orderId) => {
  try {
    const query = `mutation OrderCancel($orderId: ID!, $notifyCustomer: Boolean, $refundMethod: OrderCancelRefundMethodInput!, $restock: Boolean!, $reason: OrderCancelReason!, $staffNote: String){
            orderCancel(orderId: $orderId, notifyCustomer: $notifyCustomer, refundMethod: $refundMethod, restock: $restock, reason: $reason, staffNote: $staffNote){
                job{
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
      orderId: orderId,
      notifyCustomer: true,
      refundMethod: {
        originalPaymentMethodsRefund: true,
      },
      restock: true,
      reason: "OTHER",
      staffNote: "Clickpost triggered rto order",
    };
    const { data, errors, extensions } = await client.request(query, {
      variables: variables,
    });
    if (errors && errors.length > 0) {
      throw new Error("Failed to cancel order");
    }
    if (
      data.orderCancel?.orderCancelUserErrors.length > 0 ||
      data.orderCancel?.userErrors.length > 0
    ) {
      throw new Error("Failed to cancel order");
    }
    const cancellationDone = await pollCancellationJob(
      client,
      data.orderCancel.job.id
    );
    return cancellationDone;
  } catch (err) {
    throw new Error("Failed to mark order cancelled reason -->" + err.message);
  }
};
const pollCancellationJob = async (client, jobId) => {
  try {
    let done = false;
    do {
      const query = `query JobStatus($jobId: ID!) {
                job(id: $jobId) {
                    id
                    done
                }
            }`;
      const variables = {
        jobId: jobId,
      };
      const { data, extensions, errors } = await client.request(query, {
        variables,
      });
      done = data.job.done;
      if (!done) {
        await new Promise((res, rej) => {
          setTimeout(() => {
            res(true);
          }, 600);
        });
      }
    } while (!done);
    return done;
  } catch (err) {
    throw new Error("Failed to poll cancellation job reason -->" + err.message);
  }
};
const getOrderRefundData = async (shop, orderId) => {
  try {
  } catch (err) {
    throw new Error("failed");
  }
};
export {
  retrieveCancellOrderDetails,
  markOrderCancelled,
  retrieveOrderIdByOrderName,
};
