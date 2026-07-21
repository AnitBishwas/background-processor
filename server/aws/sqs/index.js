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
  handleCashbackManualDistribution,
  handleCashbackRefund,
  handleManualCashbackDistribution,
  markPendingCashbackToReady,
} from "../../modules/cashback/controllers/index.js";
import { handleCashbackBulkDistribution } from "../../modules/cashback/controllers/bulkDistribution.js";
import pLimit from "p-limit";
import { handleReviewMediaUpload } from "../../modules/reviews/controllers/media.js";
import { handleReviewUploadJob } from "../../modules/reviews/controllers/uploadCsv.js";
import { handleReviewSubmission } from "../../modules/reviews/controllers/index.js";
import { handleClickpostRtoOrder } from "../../modules/clickpost/controllers/index.js";

// ["ORDER_CREATE","CASHBACK_PENDING_ASSIGNED","CASHBACK_UTILISED","ORDER_CANCEL","CASHBACK_CANCEL","ORDER_DELIVERED","CASHBACK_ASSIGN","ORDER_REFUND","CASHBACK_REFUND","CASHBACK_BULK_DISTRIBUTION","CASHBACK_Manual_DISTRIBUTION"]
const sqs = new AWS.SQS();
const DEFAULT_CONCURRENCY = 5;
const BULK_CONCURRENCY = 2;
const MAX_RECEIVE_COUNT = 3; // move to DLQ after 3 failures
const BULK_VISIBILITY_HEARTBEAT_INTERVAL_MS = 60_000; // 60s heartbeat for bulk jobs

const getTopic = (message) => {
  try {
    const payload = JSON.parse(message.Body || "{}");
    return payload.topic || "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
};

const getReceiveCount = (message) => {
  return parseInt(message.Attributes?.ApproximateReceiveCount || "1", 10);
};

const startVisibilityHeartbeat = (message, extensionSeconds = 120) => {
  const interval = setInterval(async () => {
    try {
      await sqs
        .changeMessageVisibility({
          QueueUrl: process.env.SQS_URL,
          ReceiptHandle: message.ReceiptHandle,
          VisibilityTimeout: extensionSeconds,
        })
        .promise();
      console.log(
        `[Heartbeat] Extended visibility for message ${message.MessageId}`
      );
    } catch (err) {
      console.error(`[Heartbeat] Failed to extend visibility: ${err.message}`);
    }
  }, BULK_VISIBILITY_HEARTBEAT_INTERVAL_MS);

  return () => clearInterval(interval);
};

const sendToDLQ = async (message, reason) => {
  try {
    await sqs
      .sendMessage({
        QueueUrl: process.env.DLQ_URL,
        MessageBody: message.Body,
        MessageAttributes: {
          FailureReason: {
            DataType: "String",
            StringValue: String(reason).slice(0, 256),
          },
          OriginalMessageId: {
            DataType: "String",
            StringValue: message.MessageId || "unknown",
          },
          FailedAt: {
            DataType: "String",
            StringValue: new Date().toISOString(),
          },
        },
      })
      .promise();
    console.warn(
      `[DLQ] Message ${message.MessageId} sent to DLQ. Reason: ${reason}`
    );
  } catch (err) {
    console.error(`[DLQ] CRITICAL - failed to send to DLQ: ${err.message}`);
  }
};

const logFailureToDynamoDB = async ({
  messageId,
  topic,
  orderId,
  reason,
  receiveCount,
}) => {
  try {
    await sendMessageFailureToDynamoDb({
      messageId,
      orderId,
      topic: topic + "_PROCESSING_FAILED",
      result: reason,
      receiveCount,
      failedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(
      `[DynamoDB] CRITICAL - failed to log failure for messageId=${messageId}, topic=${topic}, reason=${reason}. DynamoDB error: ${err.message}`
    );
  }
};

const handleS3Records = async (records) => {
  if (!Array.isArray(records) || records.length === 0) return;

  console.log(`[S3] Processing ${records.length} record(s)`);

  const failures = [];

  for (const record of records) {
    const eventName = record?.s3?.configurationId;
    const bucket = record?.s3?.bucket?.name;
    const key = record?.s3?.object?.key;

    try {
      if (eventName === "MEDIA_UPLOAD") {
        if (bucket == "aws-swiss-reviews-media-bucket") {
          await handleReviewMediaUpload({
            bucket: record?.s3?.bucket?.name,
            key: record?.s3?.object?.key,
          });
        }
      } else {
        console.warn(
          `[S3] Unrecognised S3 event: "${eventName}" for key: ${key}`
        );
      }
    } catch (err) {
      console.error(
        `[S3] Failed record (event: ${eventName}, key: ${key}): ${err.message}`
      );
      failures.push({ key, eventName, error: err.message });
    }
  }
  if (failures.length > 0) {
    console.error(
      `[S3] ${failures.length}/${records.length} record(s) failed:`,
      failures
    );
    throw new Error(
      `S3 batch had ${failures.length} failure(s): ${failures.map((f) => f.key).join(", ")}`
    );
  }
};

const handleTopicMessage = async (topic, payload, meta = {}) => {
  switch (topic) {
    case "ORDER_CREATE":
      await createCustomPurchaseEventInBiqQuery(payload.shop, payload);
      console.log("processed order creation message ✅");
      break;

    case "CASHBACK_PENDING_ASSIGNED":
      await assignCashbackPendingAssignedToCustomer(payload);
      console.log("processed cashback pending assign message ✅");
      break;

    case "CASHBACK_UTILISED":
      await debitCashbackOnUtilisation(payload);
      console.log("processed cashback utilised message ✅");
      break;

    case "ORDER_CANCEL":
      await handleCashbackCancellation(payload);
      await createOrderCancelledEventInBigQuery(payload.shop, payload);
      console.log("processed order cancel message ✅");
      break;

    case "CASHBACK_CANCEL":
      console.log("processed cashback cancel message ✅");
      break;

    case "ORDER_DELIVERED":
      await createMoengageOrderDeliveredEvent(payload.shop, payload);
      console.log("processed order delivered message ✅");
      break;

    case "CASHBACK_ASSIGN":
      await markPendingCashbackToReady(payload);
      console.log("processed cashback assign message ✅");
      break;

    case "ORDER_REFUND":
      console.log("processed order refund message ✅");
      break;

    case "CASHBACK_REFUND":
      await handleCashbackRefund(payload);
      console.log("processed cashback refund message ✅");
      break;

    case "CASHBACK_BULK_DISTRIBUTION":
      await handleCashbackBulkDistribution(payload, meta);
      console.log("processed cashback bulk distribution ✅");
      break;

    case "CASHBACK_Manual_DISTRIBUTION":
      await handleCashbackManualDistribution(payload);
      console.log("processed cashback manual distribution ✅");
      break;

    case "REVIEW_UPLOAD":
      await handleReviewUploadJob(payload.job);
      console.log("processed review upload job ✅");
      break;
    case "REVIEW_SUBMITTED":
      await handleReviewSubmission(payload.job);
      break;
    case "CLICKPOST_RTO_ORDER":
      await handleClickpostRtoOrder(payload);
      console.log("processed clickpost rto order ✅");
      break;
    default:
      const err = new Error(`Unrecognised topic: "${topic}"`);
      console.warn(
        `[Topic] ${err.message} — payload: ${JSON.stringify(payload).slice(0, 200)}`
      );
      throw err;
  }
};

const handleMessages = async (message, meta = {}) => {
  let payload;

  try {
    payload = JSON.parse(message.Body);
  } catch (parseErr) {
    console.error(`[Parse] Failed to parse message body: ${parseErr.message}`);
    await logFailureToDynamoDB({
      messageId: message.MessageId,
      topic: "PARSE_ERROR",
      orderId: null,
      reason: parseErr.message,
      receiveCount: getReceiveCount(message),
    });
    await sendToDLQ(message, `Parse error: ${parseErr.message}`);
    return { dlq: true };
  }
  const topic = payload.topic || null;
  const hasS3Records =
    Array.isArray(payload.Records) && payload.Records.length > 0;
  const receiveCount = getReceiveCount(message);

  if (receiveCount > MAX_RECEIVE_COUNT) {
    console.warn(
      `[RetryGuard] Message ${message.MessageId} exceeded max retries (${receiveCount}). Sending to DLQ.`
    );
    await logFailureToDynamoDB({
      messageId: message.MessageId,
      topic: topic || "UNKNOWN",
      orderId: payload.id,
      reason: `Exceeded max receive count (${receiveCount})`,
      receiveCount,
    });
    await sendToDLQ(message, `Exceeded max receive count (${receiveCount})`);
    return { dlq: true };
  }

  let stopHeartbeat = null;
  if (topic === "CASHBACK_BULK_DISTRIBUTION" || topic === "REVIEW_UPLOAD") {
    stopHeartbeat = startVisibilityHeartbeat(message, 120);
  }

  try {
    if (hasS3Records) {
      await handleS3Records(payload.Records);
    }

    if (topic) {
      await handleTopicMessage(topic, payload, meta);
    }
    if (!topic && !hasS3Records) {
      const reason = "Message has no topic and no S3 Records — unknown shape";
      console.warn(`[Handler] ${reason}. MessageId: ${message.MessageId}`);
      await logFailureToDynamoDB({
        messageId: message.MessageId,
        topic: "UNKNOWN_SHAPE",
        orderId: payload.id || null,
        reason,
        receiveCount,
      });
      await sendToDLQ(message, reason);
      return { dlq: true };
    }

    return { success: true };
  } catch (err) {
    console.error(
      `[Handler] Failed for topic="${topic}", messageId=${message.MessageId}: ${err.message}`
    );
    await logFailureToDynamoDB({
      messageId: message.MessageId,
      topic: topic || "UNKNOWN",
      orderId: payload.id || null,
      reason: err.message,
      receiveCount,
    });
    throw err;
  } finally {
    if (stopHeartbeat) stopHeartbeat();
  }
};

// ─────────────────────────────────────────────
// SQS Poller
// ─────────────────────────────────────────────

const pollSQSQueue = async () => {
  const defaultLimit = pLimit(DEFAULT_CONCURRENCY);
  const bulkLimit = pLimit(BULK_CONCURRENCY);

  while (true) {
    try {
      const params = {
        QueueUrl: process.env.SQS_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
        VisibilityTimeout: 120,
        AttributeNames: ["ApproximateReceiveCount"], // needed for retry guard
      };

      const result = await sqs.receiveMessage(params).promise();
      if (!result.Messages || result.Messages.length === 0) continue;

      // Await all messages in this batch before polling again
      await Promise.allSettled(
        result.Messages.map((message) => {
          const topic = getTopic(message);
          const limiter =
            topic === "CASHBACK_BULK_DISTRIBUTION" ? bulkLimit : defaultLimit;

          return limiter(async () => {
            let shouldDelete = false;

            try {
              const result = await handleMessages(message, {
                receiptHandle: message.ReceiptHandle,
                queueUrl: process.env.SQS_URL,
              });

              shouldDelete = result?.success || result?.dlq;
            } catch (err) {
              console.error(
                `[Poller] Message ${message.MessageId} failed after handler: ${err.message}. Will NOT delete — SQS will redeliver.`
              );
              shouldDelete = false;
            }

            if (shouldDelete) {
              try {
                await sqs
                  .deleteMessage({
                    QueueUrl: process.env.SQS_URL,
                    ReceiptHandle: message.ReceiptHandle,
                  })
                  .promise();
              } catch (deleteErr) {
                console.error(
                  `[Poller] Failed to delete message ${message.MessageId}: ${deleteErr.message}`
                );
              }
            }
          });
        })
      );
    } catch (err) {
      console.error(`[Poller] Failed to poll SQS: ${err.message}`);
      await new Promise((res) => setTimeout(res, 5_000));
    }
  }
};
const sendToSQS = async (payload) => {
  try {
    const params = {
      QueueUrl: process.env.SQS_URL,
      MessageBody: JSON.stringify(payload),
    };
    return sqs.sendMessage(params).promise();
  } catch (err) {
    throw new Error("Failed to send message to SQS reason -->" + err.message);
  }
};
export { pollSQSQueue, sendToSQS };
