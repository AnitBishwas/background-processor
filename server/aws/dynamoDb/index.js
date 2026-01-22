import AWS from "aws-sdk";

AWS.config.update({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_KEY,
});
/**
 *
 * @typedef {object} payload
 * @param {string} orderId - shopify order id
 * @param {object} result - error object
 */
const sendMessageFailureToDynamoDb = async ({ orderId, topic, result }) => {
  try {
    const dynamo = new AWS.DynamoDB();

    await dynamo
      .putItem({
        TableName: "webhook_failures",
        Item: {
          ORDER: { S: `${orderId}` },
          TASK: { S: topic },
          error: {
            S: JSON.stringify({
              message: result.reason?.message,
              code: result.reason?.code,
              retryable: result.reason?.retryable,
            }),
          },
          retryCount: { N: "0" },
          status: { S: "FAILED" },
          createdAt: { S: new Date().toISOString() },
        },
        ConditionExpression: "attribute_not_exists(PK)",
      })
      .promise();
  } catch (err) {
    console.error("DYNAMODB_WEBHOOK_FAILURE_WRITE_FAILED", {
      orderId,
      topic,
      error: err.message,
    });
  }
};
export { sendMessageFailureToDynamoDb };
