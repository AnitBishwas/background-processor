import AWS from "aws-sdk";
import { sendMessageFailureToDynamoDb } from "../dynamoDb/index.js";
import {
  createCustomPurchaseEventInBiqQuery,
  createOrderCancelledEventInBigQuery,
} from "../../analytics/bigQuery.js";
import { createMoengageOrderDeliveredEvent } from "../../modules/moe/controllers/index.js";

/**
 * List of topics
 * ["ORDER_CREATE","CASHBACK_PENDING_ASSIGNED","CASHBACK_UTILISED","ORDER_CANCEL","CASHBACK_CANCEL","ORDER_DELIVERED","CASHBACK_ASSIGN"]
 *
 */

AWS.config.update({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_KEY,
});

const sqs = new AWS.SQS();

const handleMessages = async (message) => {
  const payload = JSON.parse(message.Body);
  const topic = payload.topic;
  try {
    if (!topic) {
      throw new Error("No topic provided for message handler");
    }
    if (topic == "ORDER_CREATE") {
      await createCustomPurchaseEventInBiqQuery(payload.shop, payload);
      console.log("processed order creation message ✅");
    } else if (topic == "CASHBACK_PENDING_ASSIGNED") {
      console.log("processed cashback pending assign message ✅");
    } else if (topic == "CASHBACK_UTILISED") {
      console.log("processed cashback utilised message ✅");
    } else if (topic == "ORDER_CANCEL") {
      await createOrderCancelledEventInBigQuery(payload.shop, payload);
      console.log("processed order cancel message");
    } else if (topic == "CASHBACK_CANCEL") {
      console.log("processed cashback cancel message ✅");
    } else if (topic == "ORDER_DELIVERED") {
      console.log("processed order delivered message ✅");
      await createMoengageOrderDeliveredEvent(payload.shop, payload);
    } else if (topic == "CASHBACK_ASSIGN") {
      console.log("processed cashback assign message ✅");
    }
  } catch (err) {
    console.log("Failed to handle messages reason -->" + err.message);
    sendMessageFailureToDynamoDb({
      orderId: payload.id,
      topic: payload.topic + "_PROCESSING",
      result: err,
    });
  }
};

const pollSQSQueue = async () => {
  while (true) {
    try {
      const params = {
        QueueUrl: process.env.SQS_URL,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20,
      };
      const result = await sqs.receiveMessage(params).promise();
      if (!result.Messages) return;
      for (const message of result.Messages) {
        try {
          await handleMessages(message);
          await sqs
            .deleteMessage({
              QueueUrl: process.env.SQS_URL,
              ReceiptHandle: message.ReceiptHandle,
            })
            .promise();
        } catch (err) {
          console.error("Processing failed:", err);
        }
      }
    } catch (err) {
      console.log("Failed to poll sqs queue reason -->" + err.message);
    }
  }
};

export { pollSQSQueue };
