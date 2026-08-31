import clientProvider from "../../../../utils/clientProvider.js";

const retrieveLineItemsDetailsAgainstFulfillment = async (
  client,
  fulfillmentId
) => {
  try {
    let lineItems = [];
    let next = false;
    do {
      const query = `query FulfillmentLineItems($id:ID!,$after: String){
        fulfillment(id: $id){
          fulfillmentLineItems(first: 2, after:$after){
            edges{
              node{
                id
                quantity
                lineItem{
                  duties{
                    id
                    price{
                      presentmentMoney{
                        amount
                      }
                    }
                  }
                }
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
        id: fulfillmentId,
      };
      if (next) {
        variables["after"] = next;
      }
      const { data, extensions, errors } = await client.request(query, {
        variables,
      });
      if (errors && errors.length > 0) {
        throw new Error("Failed to retrieve line items against fulfillment");
      }
      lineItems = [
        ...lineItems,
        ...data.fulfillment.fulfillmentLineItems.edges.map((el) => el.node),
      ];
      if (data.fulfillment.fulfillmentLineItems.pageInfo.hasNextPage) {
        next = data.fulfillment.fulfillmentLineItems.pageInfo.endCursor;
      } else {
        next = false;
      }
    } while (next);
    return lineItems;
  } catch (err) {
    throw new Error(
      "Failed to retrieve line items details againsft fulfillment reason -->" +
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
      let itemsList = data.order.lineItems.edges.map((el) => el.node);
      lineItems = [...lineItems, ...itemsList];
      if (pageInfo.hasNextPage) {
        next = pageInfo.endCursor;
      } else {
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
const retrieveOrderByOrderName = async (client, orderName) => {
  try {
    const query = `query RetrieveOrderId($first: Int, $query:String){
            orders(first: $first,query: $query){
                edges{
                    node{
                        id
                        name
                        fulfillments(first: 2){
                              id 
                        }
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
    const retrievedFullfillments = correspondingOrder.fulfillments;

    let lineItems = [];
    for (let i = 0; i < retrievedFullfillments.length; i++) {
      const fulFillmentId = retrievedFullfillments[i].id;
      let lineItemsDetails = await retrieveLineItemsDetailsAgainstFulfillment(
        client,
        fulFillmentId
      );
      lineItems = [...lineItems, ...lineItemsDetails];
    }
    return {
      id: correspondingOrder.id,
      lineItems: lineItems,
    };
  } catch (err) {
    throw new Error(
      "Failed to retrieve order id by order name reason -->" + err.message
    );
  }
};

const retrieveReturnOrderLineItems = async (client, returnId) => {
  try {
    let lineItems = [];
    let next = false;
    do {
      const query = `query RetrieveReturnLineItems($id: ID!,$after: String){
        return(id: $id){ 
          returnLineItems(first:5,after:$after){
            edges{
              node{
                id
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
        id: returnId,
      };
      if (next) {
        variables["after"] = next;
      }
      const { data, extensions, errors } = await client.request(query, {
        variables,
      });
      if (errors && errors.length > 0) {
        throw new Error(
          "Failed to retrieve return order line items reason -->" +
            errors.join(",")
        );
      }
      lineItems = [
        ...lineItems,
        ...data.return.returnLineItems.edges.map((el) => ({
          lineItemId: el.node.id,
          quantity: el.node.quantity,
          // duties: el.node.lineItem.duties.map((el) => ({
          //   id: el.id,
          //   amount: el.price.presentmentMoney.amount,
          // })),
        })),
      ];
      if (data.return.returnLineItems.pageInfo.hasNextPage) {
        next = data.return.returnLineItems.pageInfo.endCursor;
      } else {
        next = false;
      }
    } while (next);
    return lineItems;
  } catch (err) {
    throw new Error(
      "Failed to retrieve return order line items reason -->" + err.message
    );
  }
};

const markOrderReturn = async (client, orderDetails) => {
  try {
    const returnOpen = await markOrderReturnOpen(client, orderDetails); // mark order return
    const refundOrder = await refundReturnedOrder(client, returnOpen);
    const returnClose = await markReturnClose(client, returnOpen.id);
    const lineItems = await retrieveLineItemsDetailsForOrder(
      client,
      returnClose.id
    );
    return {
      ...returnClose,
      lineItems,
    };
  } catch (err) {
    throw new Error("Failed to mark order return reason -->" + err.message);
  }
};

const markOrderReturnOpen = async (client, orderDetails) => {
  try {
    const query = `mutation ReturnCreate($returnInput: ReturnInput!){
      returnCreate(returnInput: $returnInput){
        userErrors{
          field
          message
        }
        return{
          id
          order{
            transactions(first:10){
              id
              amountSet{
                presentmentMoney{
                  amount
                } 
              } 
            }
          }
        }
      }
    }`;
    const variables = {
      returnInput: {
        orderId: orderDetails.id,
        returnLineItems: orderDetails.lineItems.map((el) => ({
          fulfillmentLineItemId: el.id,
          quantity: el.quantity,
          returnReason: "OTHER",
          returnReasonNote: "Clickpost rto trigger line item",
        })),
      },
    };
    const { data, errors, extensions } = await client.request(query, {
      variables,
    });
    if (errors && errors.length > 0) {
      throw new Error(
        "Failed to mark order return open reason -->" + errors.join(",")
      );
    }
    if (data.returnCreate.userErrors.length > 0) {
      throw new Error("Failed to mark order return open");
    }
    const lineItems = await retrieveReturnOrderLineItems(
      client,
      data.returnCreate.return.id
    );
    return {
      id: data.returnCreate.return.id,
      orderTransactions: data.returnCreate.return.order.transactions.map(
        (el) => ({
          parentId: el.id,
          transactionAmount: {
            amount: el.amountSet.presentmentMoney.amount,
            currencyCode: "INR",
          },
        })
      ),
      lineItems,
    };
    return data;
  } catch (err) {
    throw new Error("Failed to mark return open -->" + err.message);
  }
};
const refundReturnedOrder = async (client, returnDetails) => {
  try {
    const query = `mutation ReturnRefund($returnRefundInput: ReturnRefundInput!){
      returnRefund(returnRefundInput: $returnRefundInput){
        userErrors{
          field
          message   
        } 
      } 
    }`;
    const variables = {
      returnRefundInput: {
        returnId: returnDetails.id,
        refundDuties: [],
        orderTransactions: returnDetails.orderTransactions,
        returnRefundLineItems: returnDetails.lineItems.map((el) => ({
          returnLineItemId: el.lineItemId,
          quantity: el.quantity,
        })),
        notifyCustomer: true,
      },
    };
    const { data, extensions, errors } = await client.request(query, {
      variables,
    });
    if (errors && errors.length > 0) {
      throw new Error(
        "Failed to refund return order reason -->" + errors.join(",")
      );
    }
    if (data.returnRefund.userErrors.length > 0) {
      throw new Error(
        "Failed to refund retuned order reason -->" +
          data.returnRefund.userErrors.join(",")
      );
    }
    return true;
  } catch (err) {
    throw new Error("Failed to refund returned order reason -->" + err.message);
  }
};
const markReturnClose = async (client, returnId) => {
  try {
    const query = `mutation ReturnOpen($id: ID!){
      returnClose(id: $id){
          return{
            order{
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
          } 
          userErrors{
            field
            message 
          }
      }
    }`;
    const variables = {
      id: returnId,
    };
    const { data, extensions, errors } = await client.request(query, {
      variables,
    });
    if (errors && errors.length > 0) {
      throw new Error(
        "Failed to mark return close reason -->" + errors.join(",")
      );
    }
    if (data.returnClose.userErrors.length > 0) {
      throw new Error(
        "Failed to mark return close reason -->" +
          data.returnClose.userErrors.join(",")
      );
    }
    return data.returnClose.return.order;
  } catch (err) {
    throw new Error("Failed to mark return close reason -->" + err.message);
  }
};
export { retrieveOrderByOrderName, markOrderReturn };
