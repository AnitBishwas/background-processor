import {
  getOrderRefundStatusByPhone,
  getOrderStatusByName,
  getOrderStatusByPhoneNumber,
  getOrderRefundStatusByOrderName,
  cancelOrderByPhone,
  cancelOrderByOrderName,
} from "./shopify.js";

const mapExotelRequests = async (req, res) => {
  try {
    const appId = req.query.flow_id?.replace(
      /[`~!@#$%^&*()_|+\-=?;:'",.<>{}[\]\\\/]/gi,
      ""
    );

    const customerPhone = req.query.From;

    const digitsInserted = req.query.digits
      ? req.query.digits.replace(
          /[`~!@#$%^&*()_|+\-=?;:'",.<>{}[\]\\\/]/gi,
          ""
        )
      : null;

    if (!appId) {
      throw new Error("No App Id provided");
    }

    const currentMapping = [
      { key: "1", value: "order_status_phone" },
      { key: "28617", value: "order_status_id" },
      { key: "3", value: "order_refund_status_phone" },
      { key: "4", value: "order_refund_status_id" },
      { key: "5", value: "order_cancel_phone" },
      { key: "6", value: "order_cancel_id" },
      { key: "28647", value: "website_offer" },
      { key: "8", value: "store_locator" },
      { key: "9", value: "collaboration" },
      { key: "10", value: "distibutor" },
      { key: "11", value: "bulk_order" },
    ];

    const currentCase = currentMapping.find(({ key }) => key == appId);

    if (!currentCase) {
      throw new Error("No corresponding case found for the key");
    }

    let data = null;

    switch (currentCase.value) {
      case "order_status_phone":
        data = await getOrderStatusByPhoneNumber(customerPhone);
        break;

      case "order_status_id":
        data = await getOrderStatusByName(digitsInserted);
        break;

      case "order_refund_status_phone":
        data = await getOrderRefundStatusByPhone(customerPhone);
        break;

      case "order_refund_status_id":
        data = await getOrderRefundStatusByOrderName(digitsInserted);
        break;

      case "order_cancel_phone":
        data = await cancelOrderByPhone(customerPhone);
        break;

      case "order_cancel_id":
        data = await cancelOrderByOrderName(digitsInserted, customerPhone);
        break;

      case "website_offer":
      case "store_locator":
      case "collaboration":
      case "distibutor":
      case "bulk_order":
        data = {
          status: currentCase.value,
          order: {
            customer: {
              defaultPhoneNumber: {
                phoneNumber: customerPhone,
              },
            },
          },
        };
        break;

      default:
        data = null;
    }

    const status = data?.status;

    if (!status) {
      return {
        text: "No matching handler found for the given case",
      };
    }

    const { text, whatsapp } = mapRequestToPlainText(
      status,
      data.order,
      data.statusText
    );

    return {
      text,
      whatsapp,
      order: data.order,
    };
  } catch (err) {
    throw new Error(err.message);
  }
};

const mapRequestToPlainText = (status, order, statusText) => {
  let whatsapp = null;
  let text = null;

  switch (status) {
    case "no_order_against_phone":
      text = "No order exists for this phone number";
      break;

    case "no_order_against_orderId":
      text = "No order exists for this order id";
      break;

    case "order_phone_mismatch":
      text =
        "This order cannot be cancelled as it is not linked with your registered mobile number. Please call from the registered mobile number or enter the correct order id.";
      break;

    case "refund_successfull":
      text = `Refund for your latest order of amount ${
        order?.refunds?.[0]?.totalRefunded?.amount || ""
      } was successfully credited in your original mode of payment. Please check your bank account for more details.`;
      break;

    case "refund_initiated":
      text = `Refund for your latest order of amount ${
        order?.refunds?.[0]?.totalRefunded?.amount || ""
      } was initiated successfully and will be credited within 5-7 working days in your original mode of payment from the date of initiation.`;
      break;

    case "cancelled":
      text = `Your order was cancelled successfully on ${new Date(
        order.cancelledAt
      ).toDateString()}. Prepaid orders are refunded automatically in 5 to 7 working days on source account.`;
      break;

    case "returned":
      text = "Your order was marked returned.";
      break;

    case "delivered":
      text = "Your order has been delivered to you.";
      break;

    case "attempted_delivery":
      text = "Your order was marked as undelivered.";
      break;

    case "in-transit":
      text =
        "Your order is in transit and will be delivered to you shortly. Kindly check your WhatsApp or email for the tracking link.";
      break;

    case "packed":
      text =
        "Your latest order is packed safely and will be delivered to you in 2 to 5 working days.";
      break;

    case "placed":
      text =
        "Your latest order is successfully confirmed and will be delivered to you in 2 to 5 working days.";
      break;

    case "order_cod_refund_not_eligible":
      text =
        "Refund for your latest order is not eligible as you placed a cash on delivery order. To know about our refund policy, you can check the message on WhatsApp that will be sent to you shortly.";
      whatsapp = "order_cod_refund_not_eligible";
      break;

    case "order_status_refund_not_eligible":
      text = `Refund for your latest order of amount ${order?.currentTotalPriceSet?.shopMoney?.amount} is not eligible as the current status of your order is ${statusText}. To know about our refund policy, you can check the message on WhatsApp that will be sent to you shortly.`;
      whatsapp = "order_status_refund_not_eligible";
      break;

    case "order_already_cancelled":
      text =
        order?.paymentGatewayNames?.indexOf("cash_on_delivery") !== -1
          ? `Your order is already cancelled on ${new Date(
              order.cancelledAt
            ).toDateString()}.`
          : `Your order placed on ${new Date(
              order.createdAt
            ).toDateString()} is already cancelled.`;
      break;

    case "order_in_process":
      if (statusText === "more_than_30_minutes") {
        text =
          "Your order cannot be cancelled as cancellation is allowed only within 30 minutes of placing the order.";
      } else {
        text = `Your current order status is ${statusText}. Hence, it cannot be cancelled as we allow cancellation only before your order gets packed.`;
      }
      break;

    case "order_cancel_failed":
      text = `Failed to cancel your order. Reason: ${
        statusText || "Please connect with our executives."
      }`;
      break;

    case "order_cancelled":
      text =
        order?.paymentGatewayNames?.indexOf("cash_on_delivery") !== -1
          ? `Your cash on delivery order placed on ${new Date(
              order.createdAt
            ).toDateString()} is cancelled successfully.`
          : `Your order placed on ${new Date(
              order.createdAt
            ).toDateString()} is cancelled successfully. Your refund will be credited within 5-7 working days.`;
      break;

    case "website_offer":
    case "store_locator":
    case "collaboration":
    case "distibutor":
    case "bulk_order":
      text = null;
      whatsapp = status;
      break;
  }

  return { text, whatsapp };
};

export default mapExotelRequests;