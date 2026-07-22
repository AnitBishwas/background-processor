import clientProvider from "../../../../utils/clientProvider.js";
import RtoOrder from "../../../../utils/models/RtoOrder.js";
import { createMoengageEvent } from "../../moe/helpers/index.js";
import {
  markOrderCancelled,
  retrieveCancellOrderDetails,
  retrieveOrderIdByOrderName,
} from "./shopify.js";

const handleClickpostRtoOrder = async (payload) => {
  try {
    const shop = payload.shop;
    if (!shop) {
      throw new Error("no shop provided in the payload");
    }
    const validStatusCodes = [12, 13, 14, 15, 21, 26, 27];
    const isClickpostStatusValidForRefund = validStatusCodes.includes(
      payload.clickpost_status_code
    );
    if (!isClickpostStatusValidForRefund) {
      return;
    }
    const orderName = payload?.additional.order_id;
    if (!orderName || orderName.trim().length == 0) {
      return;
    }
    const refundAlreadyProcessed = await RtoOrder.findOne({
      orderName: orderName,
    }).lean();
    if (refundAlreadyProcessed) {
      return;
    }
    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const orderId = await retrieveOrderIdByOrderName(client, orderName);
    const cancellOrder = await markOrderCancelled(client, orderId);
    const orderDetails = await retrieveCancellOrderDetails(client, orderId);
    const punchedData = await punchCancelOrderIntoDb(orderDetails, payload);
    const moengageEvent = await createMoengageRtoEvent(punchedData);
  } catch (err) {
    throw new Error(
      "Failed to handle clickpost Rto order reason -->" + err.message
    );
  }
};
const createMoengageRtoEvent = async (data) => {
  try {
    const moePayload = {
      eventName: "rto-order-refund",
      customerPhone: data.customer.phone,
      params: {
        orderId: data.orderName,
        refundAmount: data.refund.total,
        isCod: data.isCod,
        isPrepaid: data.isPrepaid,
        cashback: data.cashbackUtilised,
      },
    };
    await createMoengageEvent(moePayload);
  } catch (err) {
    console.log("Failed to create moengage rto event reason -->" + err.message);
  }
};
const punchCancelOrderIntoDb = async (order, payload) => {
  try {
    const mappedData = {
      orderId: order.id.replace("gid://shopify/Order/", ""),
      orderDate: order.createdAt,
      orderName: order.name.replace("#", ""),
      clickPostPayload: JSON.stringify(payload),
      isCod: order.transactions.find(
        (el) =>
          el.gateway == "cash_on_delivery" ||
          el.gateway == "Cash on Delivery (COD)"
      )
        ? true
        : false,
      isPrepaid: !order.transactions.find(
        (el) =>
          el.gateway == "cash_on_delivery" ||
          el.gateway == "Cash on Delivery (COD)"
      )
        ? true
        : false,
      cashbackUtilised: Number(
        order.transactions.find((el) => el.gateway == "Cashback")?.amountSet
          .presentmentMoney.amount || 0
      ),
      customer: {
        firstName: order.customer?.firstName,
        lastName: order.customer?.lastName,
        phone:
          order.customer?.defaultPhoneNumber?.phoneNumber ||
          order.customer?.defaultAddress?.phone ||
          null,
        email: order.customer?.defaultEmailAddress?.emailAddress || null,
      },
      refund: {
        total: Number(order.totalRefundedSet?.presentmentMoney.amount || 0),
        cashback: Number(
          order.transactions.find((el) => el.gateway == "Cashback")?.amountSet
            .presentmentMoney.amount || 0
        ),
      },
    };
    const punchedData = await RtoOrder.create(mappedData);
    return mappedData;
  } catch (err) {
    throw new Error(
      "Failed to punch cancel order into db reason -->" + err.message
    );
  }
};
export { handleClickpostRtoOrder };
