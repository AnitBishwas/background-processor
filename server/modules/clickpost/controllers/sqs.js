import { sendToSQS } from "../../../aws/sqs/index.js";

const passEventToSqs = async (shop, payload) => {
  try {
    return await sendToSQS({
      topic: "CLICKPOST_RTO_ORDER",
      shop,
      ...payload,
    });
  } catch (err) {
    throw new Error("Failed to pass evebt to sqs reason -->" + err.message);
  }
};

export { passEventToSqs };
