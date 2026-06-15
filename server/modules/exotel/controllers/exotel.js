import ExotelTextModel from "../models/ExotelText.js";
import {
  cancelOrderByPhone,
  cancelOrderByOrderId,
  getOrderRefundStatusByOrderId,
  getOrderRefundStatusByPhone,
  getOrderStatusByOrderId,
  getOrderStatusByPhone,
} from "./actions.js";
import mapping from "./exotelMapping.js";

/**
 * Store exotel text response in db
 * @param {string} ssid - unique call ssid
 * @param {string} text - text to be stored
 * @returns {object} storedText
 */
const storeTextInDb = async (ssid, text) => {
  try {
    const storedText = await ExotelTextModel.findOneAndUpdate(
      { ssid },
      {
        ssid: ssid,
        text: text,
      },
      {
        upsert: true,
        new: true,
      }
    ).lean();
    return storedText;
  } catch (err) {
    throw new Error("Failed to store text in db reason -->" + err.message);
  }
};

/**
 * Get text by ssid
 * @param {string} ssid - unique call ssid
 * @returns {string} corresponding text
 */
const getTextBySsid = async (ssid) => {
  try {
    const storedText = await ExotelTextModel.findOne({ ssid }).lean();
    if (!storedText) {
      throw new Error("No text found for the ssid");
    }
    return storedText.text;
  } catch (err) {
    throw new Error("Failed to get text by ssid reason -->" + err.message);
  }
};

/**
 * Map flow id
 * @param {string} flowId
 * @returns {object} - corresponding flow action
 */
const mapFlowId = (flowId) => {
  try {
    if (!flowId) {
      throw new Error("Flow id missing");
    }
    const currentMapping = mapping;
    let correspondingAction = currentMapping.find((el) => el.key == flowId);
    if (!correspondingAction) {
      throw new Error("no action found for the given flow id");
    }
    return correspondingAction;
  } catch (err) {
    throw new Error("Failed to map flow id reason -->" + err.message);
  }
};

/**
 * Map action
 * @param {string} action - corresponding action
 * @param {string} phone - customer phone number
 * @param {digits} string - digits entered by customer
 */
const mapActions = async (action, phone, digits) => {
  try {
    let data = {
      text: null,
      whatsappLabel: null,
    };
    switch (action) {
      case "order_status_phone":
        data["text"] = await getOrderStatusByPhone(phone);
        break;
      case "order_status_id":
        data["text"] = await getOrderStatusByOrderId(digits);
        break;
      case "order_refund_status_phone":
        data["text"] = await getOrderRefundStatusByPhone(phone);
        break;
      case "order_refund_status_id":
        data["text"] = await getOrderRefundStatusByOrderId(digits);
        break;
      case "order_cancel_phone":
        data["text"] = await cancelOrderByPhone(phone);
        break;
      case "order_cancel_id":
        data["text"] = await cancelOrderByOrderId(digits, phone);
        break;
      case "store_locator":
        data["whatsappLabel"] = "store_locator";
        break;
      case "collaboration":
        data["whatsappLabel"] = "collaboration";
        break;
      case "distibutor":
        data["whatsappLabel"] = "distibutor";
        break;
      case "bulk_order":
        data["whatsappLabel"] = "bulk_order";
        break;
    }
    return data;
  } catch (err) {
    throw new Error("Failed to map actions to text reason -->" + err.message);
  }
};
export { storeTextInDb, getTextBySsid, mapFlowId, mapActions };
