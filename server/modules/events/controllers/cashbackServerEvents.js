import cashbackModels from "../../../../utils/cashbackModelProvider.js";
import { getOrderDetailsFromShopify } from "../helpers/index.js";
import { createServerEvent } from "./index.js";

/**
 List of server event
    [cashback_pending_assigned_v2,cashback_assigned_v2,cashback_utilised_v2,cashback_expired_v2] 
 */

const createCashbackPendingAssignedEvent = async (pointId, orderDetails) => {
  const cashbackModel = await cashbackModels();
  const session = await cashbackModel.conn.startSession();
  try {
    session.startTransaction();
    if (!pointId) {
      console.log("No point id provided");
    }
    const correspondingPoint =
      await cashbackModel.Point.findById(pointId).lean();
    console
      .log(correspondingPoint, pointId, "here we log are loggin point")
      .session(session);
    if (!correspondingPoint) {
      console.log("No point found with the following id " + pointId);
    }
    const customerDetails = await cashbackModel.Customer.findOne({
      customerId: correspondingPoint.customerId,
    })
      .lean()
      .session(session);
    const walletDetails = await cashbackModel.Wallet.findOne({
      customerId: correspondingPoint.customerId,
    })
      .lean()
      .session(session);
    let structuredPayload = {
      date: correspondingPoint.createdAt,
      pointId: correspondingPoint._id.toString(),
      cashback_to_be_credited: correspondingPoint.amount,
      order_name: orderDetails.order_number,
      order_subtotal: orderDetails.total_line_items_price,
      order_grand_total: orderDetails.current_total_price,
      user_phone: customerDetails.phone,
      user_email: customerDetails.email,
      timestamp: Date.parse(correspondingPoint.createdAt),
      coupon_code: orderDetails.discount_codes[0]?.code || "", // based on the assumption there's going to be only one coupon per order,
      source:
        orderDetails?.note_attributes.find((el) => el.name == "utm_source")
          ?.value || "",
      medium:
        orderDetails?.note_attributes.find((el) => el.name == "utm_medium")
          ?.value || "",
      campaign:
        orderDetails?.note_attributes.find((el) => el.name == "utm_campaign")
          ?.value || "",
      manual_flag: false,
      wallet_balance: walletDetails.balance,
    };
    let lineItems = (orderDetails?.line_items || []).map((el) => ({
      id: el.variant_id,
      productId: el.product_id,
      title: el.name,
      variantTitle: el.variant_title,
      quantity: el.quantity,
      price: Number(el.price),
    }));
    structuredPayload["items"] = lineItems;
    await createServerEvent({
      eventName: "cashback_pending_assigned_v2",
      params: { ...structuredPayload },
    });
    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    console.log(
      "Failed to create cashback pending assigned event reason -->" +
        err.message
    );
  } finally {
    session.endSession();
  }
};
const createCashbackAssignedEvent = async (pointId, orderId, shop) => {
  const cashbackModel = await cashbackModels();
  const session = await cashbackModel.conn.startSession();
  try {
    session.startTransaction();
    if (!pointId || !orderId || !shop) {
      console.log("Required parameters missing");
    }
    const correspondingPoint = await cashbackModel.Point.findById(pointId)
      .lean()
      .session(session);
    if (!correspondingPoint) {
      console.log("No point found with the following id " + pointId);
    }
    const customerDetails = await cashbackModel.Customer.findOne({
      customerId: correspondingPoint.customerId,
    })
      .lean()
      .session(session);
    const walletDetails = await cashbackModel.Wallet.findOne({
      customerId: correspondingPoint.customerId,
    })
      .lean()
      .session(session);
    const orderDetails = await getOrderDetailsFromShopify(orderId, shop);

    let structuredPayload = {
      date: correspondingPoint.updatedAt,
      pointId: correspondingPoint._id.toString(),
      expires_on: correspondingPoint.expiresOn,
      cashback_to_be_credited: correspondingPoint.amount,
      order_name: orderDetails?.name || "",
      order_subtotal: orderDetails?.subTotalPrice || 0,
      order_grand_total: orderDetails?.totalPrice || 0,
      user_phone: customerDetails.phone,
      user_email: customerDetails.email,
      timestamp: Date.parse(correspondingPoint.updatedAt),
      coupon_code: orderDetails.discountCodes[0] || "", // based on the assumption there's going to be only one coupon per order,
      source:
        orderDetails?.note_attributes.find((el) => el.name == "utm_source")
          ?.value || "",
      medium:
        orderDetails?.note_attributes.find((el) => el.name == "utm_medium")
          ?.value || "",
      campaign:
        orderDetails?.note_attributes.find((el) => el.name == "utm_campaign")
          ?.value || "",
      manual_flag: false,
      wallet_balance: walletDetails.balance,
    };
    let lineItems = (orderDetails?.line_items || []).map((el) => ({
      id: el.variant_id,
      productId: el.product_id,
      title: el.name,
      variantTitle: el.variant_title,
      quantity: el.quantity,
      price: Number(el.price),
    }));
    structuredPayload["items"] = lineItems;
    await createServerEvent({
      eventName: "cashback_assigned_v2",
      params: { ...structuredPayload },
    });
  } catch (err) {
    console.log(
      "Failed to create cashback assigned event reason -->" + err.message
    );
  }
};
const createCashbackUtilisedEvent = async (points, amount, orderDetails) => {
  const cashbackModel = await cashbackModels();
  const session = await cashbackModel.conn.startSession();

  try {
    session.startTransaction();
    if (points.length == 0 || !orderDetails) {
      throw new Error("Required parameters missing");
    }
    const pointZeroId = points[0].pointId.toString();
    const pointDetails = await cashbackModel.Point.findById(pointZeroId)
      .lean()
      .session(session);
    const customerDetails = await cashbackModel.Customer.findOne({
      customerId: pointDetails.customerId,
    })
      .lean()
      .session(session);
    const walletDetails = await cashbackModel.Wallet.findOne({
      customerId: pointDetails.customerId,
    })
      .lean()
      .session(session);
    let structuredData = {
      date: pointDetails.updatedAt,
      timestamp: Date.parse(pointDetails.updatedAt),
      cashback_utilised: amount,
      order_name: orderDetails.order_number,
      order_subtotal: orderDetails.total_line_items_price,
      order_grand_total: orderDetails.current_total_price,
      user_phone: customerDetails.phone,
      user_email: customerDetails.email,
      coupon_code: orderDetails.discount_codes[0]?.code || "", // based on the assumption there's going to be only one coupon per order,
      source:
        orderDetails?.note_attributes.find((el) => el.name == "utm_source")
          ?.value || "",
      medium:
        orderDetails?.note_attributes.find((el) => el.name == "utm_medium")
          ?.value || "",
      campaign:
        orderDetails?.note_attributes.find((el) => el.name == "utm_campaign")
          ?.value || "",
      manual_flag: false,
      wallet_balance: walletDetails.balance,
    };
    let lineItems = (orderDetails?.line_items || []).map((el) => ({
      id: el.variant_id,
      productId: el.product_id,
      title: el.name,
      variantTitle: el.variant_title,
      quantity: el.quantity,
      price: Number(el.price),
    }));
    structuredData["items"] = lineItems;
    for (let i = 0; i < points.length; i++) {
      let point = points[i];
      structuredData[`point[${i}].id`] = point.pointId.toString();
      structuredData[`point[${i}].expiresOn`] = point.expiresOn;
      structuredData[`point[${i}].amount`] = point.deducted;
    }
    await createServerEvent({
      eventName: "cashback_utilised_v2",
      params: { ...structuredData },
    });
  } catch (err) {
    console.log(
      "Failed to create cashback utilised event reason -->" + err.message
    );
  }
};

const handlePointsExpiryForEventsPurposes = async (pointsList) => {
  const cashbackModel = await cashbackModels();
  try {
    for (let i = 0; i < pointsList.length; i++) {
      const point = pointsList[i];
      try {
        const customerWallet = await cashbackModel.Wallet.findOne({
          customerId: point.customerId,
        }).lean();
        const customerDetails = await cashbackModel.Customer.findOne({
          customerId: point.customerId,
        }).lean();
        if (!customerWallet || !customerDetails) {
          throw new Error(
            "Customer wallet or customer details not found against customer id"
          );
        }
        const structuredPayload = {
          date: new Date().toISOString(),
          timestamp: Date.parse(new Date().toISOString()),
          pointId: point._id.toString(),
          cashback_expired: point.amount,
          user_phone: customerDetails.phone,
          user_email: customerDetails.email,
          wallet_balance: customerWallet.balance,
          expiresOn: point.expiresOn,
        };
        await createServerEvent({
          eventName: "cashback_expired_v2",
          params: { ...structuredPayload },
        });
      } catch (err) {
        console.log(
          "Failed to create point expiry event for point" + point._id
        );
      }
    }
  } catch (err) {
    console.log(
      "Failed to handle points expiry for event purposes reason -->" +
        err.message
    );
  }
};

export {
  createCashbackAssignedEvent,
  createCashbackPendingAssignedEvent,
  createCashbackUtilisedEvent,
  handlePointsExpiryForEventsPurposes,
};
