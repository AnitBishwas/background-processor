import AWS from "aws-sdk";
import { sendMessageFailureToDynamoDb } from "../dynamoDb/index.js";
import {
  createCustomPurchaseEventInBiqQuery,
  createOrderCancelledEventInBigQuery,
} from "../../analytics/bigQuery.js";
import { createMoengageOrderDeliveredEvent } from "../../modules/moe/controllers/index.js";
import {
  assignCashbackPendingAssignedToCustomer,
  debitCashbackOnUtilisation,
  handleCashbackCancellation,
  handleCashbackRefund,
  markPendingCashbackToReady,
} from "../../modules/cashback/controllers/index.js";
import { handleCashbackBulkDistribution } from "../../modules/cashback/controllers/bulkDistribution.js";
import pLimit from "p-limit";

/**
 * List of topics
 * ["ORDER_CREATE","CASHBACK_PENDING_ASSIGNED","CASHBACK_UTILISED","ORDER_CANCEL","CASHBACK_CANCEL","ORDER_DELIVERED","CASHBACK_ASSIGN","ORDER_REFUND","CASHBACK_REFUND","CASHBACK_BULK_DISTRIBUTION"]
 *
 */

AWS.config.update({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_KEY,
});

const sqs = new AWS.SQS();
const DEFAULT_CONCURRENCY = 10; // other messages
const BULK_CONCURRENCY = 1; // bulk messages

const handleMessages = async (message, meta = {}) => {
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
      await assignCashbackPendingAssignedToCustomer(payload);
      console.log("processed cashback pending assign message ✅");
    } else if (topic == "CASHBACK_UTILISED") {
      await debitCashbackOnUtilisation(payload);
      console.log("processed cashback utilised message ✅");
    } else if (topic == "ORDER_CANCEL") {
      await handleCashbackCancellation(payload);
      await createOrderCancelledEventInBigQuery(payload.shop, payload);
      console.log("processed order cancel message");
    } else if (topic == "CASHBACK_CANCEL") {
      console.log("processed cashback cancel message ✅");
    } else if (topic == "ORDER_DELIVERED") {
      console.log("processed order delivered message ✅");
      await createMoengageOrderDeliveredEvent(payload.shop, payload);
    } else if (topic == "CASHBACK_ASSIGN") {
      console.log("Recieved cashback assign event in here 👀");
      await markPendingCashbackToReady(payload);
      console.log("processed cashback assign message ✅");
    } else if (topic == "ORDER_REFUND") {
      console.log("processed order refund message ✅");
    } else if (topic == "CASHBACK_REFUND") {
      await handleCashbackRefund(payload);
      console.log("processed cashback refund message ✅");
    } else if (topic == "CASHBACK_BULK_DISTRIBUTION") {
      console.log("recieved cashback bulk distribution ✅");
      await handleCashbackBulkDistribution(payload, meta);
      console.log("processed cashback bulk distribution ✅");
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
const getTopic = (message) => {
  try {
    const payload = JSON.parse(message.Body || "{}");
    return payload.topic || "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
};
const pollSQSQueue = async () => {
  const defaultLimit = pLimit(DEFAULT_CONCURRENCY);
  const bulkLimit = pLimit(BULK_CONCURRENCY);
  while (true) {
    try {
      const params = {
        QueueUrl: process.env.SQS_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
        VisibilityTimeout: 60,
      };
      const result = await sqs.receiveMessage(params).promise();
      if (!result.Messages || result.Messages.length === 0) continue;
      for (const message of result.Messages) {
        try {
          const topic = getTopic(message);
          const limiter =
            topic === "CASHBACK_BULK_DISTRIBUTION" ? bulkLimit : defaultLimit;
          limiter(async () => {
            try {
              await handleMessages(message, {
                receiptHandle: message.ReceiptHandle,
                queueUrl: process.env.SQS_URL,
              });
              await sqs
                .deleteMessage({
                  QueueUrl: process.env.SQS_URL,
                  ReceiptHandle: message.ReceiptHandle,
                })
                .promise();
            } catch (err) {
              console.error("Processing failed:", err.message);
            }
          });
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
