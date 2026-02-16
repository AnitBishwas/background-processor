import cashbackModels from "../../../../utils/cashbackModelProvider.js";
import {
  createMoengageEvent,
  retrievePhoneNumberAgainstCustomer,
  updateMoeUserAttribute,
} from "../helpers/index.js";

/**
 * Update customers wallet properties
 * @param {String} pointId - point id
 * @param {String} shop - shopify store handle
 */
const handleCashbackUpdateForMoe = async (pointId, shop) => {
  const cashbackModel = await cashbackModels();
  try {
    if (!pointId || !shop) {
      throw new Error("Required parameters missing");
    }
    const point = await cashbackModel.Point.findById(pointId).lean();
    if (!point) {
      throw new Error("No point found for the given point id");
    }
    const customer = await cashbackModel.Customer.findOne({
      customerId: point.customerId,
    });
    const wallet = await cashbackModel.Wallet.findOne({
      customerId: point.customerId,
    });
    const customersActivePoints = await cashbackModel.Point.find({
      customerId: point.customerId,
      status: "ready",
      amount: {
        $gt: 0,
      },
    }).lean();
    if (!customer || !wallet) {
      throw new Error("No customer or wallet found against customer id");
    }
    let customerPhone = customer.phone || null;
    if (!customerPhone) {
      const customerDetails = await retrievePhoneNumberAgainstCustomer(
        point.customerId,
        shop
      );
      customerPhone =
        customerDetails.defaultAddress?.phone ||
        customerDetails.defaultPhoneNumber?.phoneNumber ||
        null;
    }
    if (!customerPhone) {
      throw new Error("No phone number found against customer");
    }
    const moePayload = {
      balance: wallet.balance,
      pointsAmount: customersActivePoints.map((el) => el.amount),
      pointsExpiry: customersActivePoints.map((el) => el.expiresOn),
    };
    await updateMoeUserAttribute(customerPhone, moePayload);
  } catch (err) {
    console.log(
      "Failed to handle cashback assgined event for moe reason -->" +
        err.message
    );
    // throw new Error(
    //   "Failed to handle cashback assigned for moe reason -->" + err.message
    // );
  }
};

const cashbackCreditedEventInMoe = async (pointId, shop) => {
  const cashbackModel = await cashbackModels();
  try {
    const point = await cashbackModel.Point.findById(pointId).lean();
    if (!point) {
      throw new Error("No point found for the given point id");
    }
    const customer = await cashbackModel.Customer.findOne({
      customerId: point.customerId,
    });
    if (!customer) {
      throw new Error("No customer or wallet found against customer id");
    }
    let customerPhone = customer.phone || null;
    if (!customerPhone) {
      const customerDetails = await retrievePhoneNumberAgainstCustomer(
        point.customerId,
        shop
      );
      customerPhone =
        customerDetails.defaultAddress?.phone ||
        customerDetails.defaultPhoneNumber?.phoneNumber ||
        null;
    }
    if (!customerPhone) {
      throw new Error("No phone number found against customer");
    }
    const moePayload = {
      name: customer.firstName + " " + customer.lastName,
      amount: point.amount,
      pointsExpiry: point.expiresOn,
    };
    await createMoengageEvent({
      eventName: 'cashback_assigned_v2',
      customerPhone: customerPhone,
      ...moePayload
    });
  } catch (err) {
    console.log(
      "Failed to create cashback credited event in MOE reason -->" + err.message
    );
  }
};
export { handleCashbackUpdateForMoe,cashbackCreditedEventInMoe };
