import cashbackModels from "../../../../utils/cashbackModelProvider.js";
import clientProvider from "../../../../utils/clientProvider.js";
import { PassThrough } from "stream";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { sendSubscribedEmailCashbackReport } from "./mail.js";
import { sendToSQS } from "../../../aws/sqs/index.js";

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

const CSV_HEADERS =
  "orderId,orderName,cancelled,discount,totalPrice,refund,return,delivered,paymentStatus,discountCode,cashbackAmount\n";

const SHOPIFY_TOKEN_RESERVE = 1000;

const escapeCSV = (value) => {
  if (value === null || value === undefined) return "";
  const str = String(value);
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"`
    : str;
};

const toRow = (order) =>
  [
    order.id,
    order.name,
    order.cancelled,
    order.discount,
    order.totalPrice,
    order.refund,
    order.return,
    order.delivered,
    order.paymentStatus,
    order.discountCode,
    order.cashbackAmount,
  ]
    .map(escapeCSV)
    .join(",") + "\n";

const handleCashbackReport = async (payload) => {
  console.log("handling cashback report");
  const cashbackModel = await cashbackModels();
  const reportModel = cashbackModel.Report;
  let s3Url = null;
  try {
    await updateReportStatus(reportModel, payload._id, "progress");
    if (payload.type === "utilisation") {
      s3Url = await streamUtilisedCashbackReportToS3({
        start: payload.dateRange.start,
        end: payload.dateRange.end,
        reportId: String(payload._id),
      });
    }
  } catch (err) {
    await updateReportStatus(
      reportModel,
      payload._id,
      "failed",
      err.message
    ).catch(() => {});
    throw new Error(
      "Failed to handle cashback report reason -->" + err.message
    );
  }
  // Kept outside the try-catch above so a DB failure here does not
  // accidentally mark the report as failed when S3 upload already succeeded.
  await updateReportStatus(reportModel, payload._id, "success", null, s3Url);
};

const streamUtilisedCashbackReportToS3 = async ({ start, end, reportId }) => {
  const shop =
    process.env.NODE_ENV === "dev"
      ? "swiss-local-dev.myshopify.com"
      : "swiss-beauty-dev.myshopify.com";

  const { client } = await clientProvider.offline.graphqlClient({ shop });

  const startDate = new Date(start).toISOString().slice(0, 10);
  const endDate = new Date(end).toISOString().slice(0, 10);
  const s3Key = `reports/utilisation/${reportId}/${startDate}-${endDate}.csv`;

  const passThrough = new PassThrough();

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: process.env.CASHBACK_REPORT_AWS_BUCKET,
      Key: s3Key,
      Body: passThrough,
      ContentType: "text/csv",
      ContentDisposition: `attachment; filename="${startDate}-${endDate}.csv"`,
    },
  });

  const query = `query GetOrders($first: Int!, $query: String!, $after: String) {
    orders(first: $first, query: $query, after: $after) {
      edges {
        node {
          id
          name
          cancelledAt
          transactions(first: 3) {
            amountSet { presentmentMoney { amount } }
            gateway
          }
          totalDiscountsSet { presentmentMoney { amount } }
          totalPriceSet { presentmentMoney { amount } }
          totalRefundedSet { presentmentMoney { amount } }
          returnStatus
          fulfillments(first: 1) { displayStatus }
          displayFinancialStatus
          discountCode
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

  const driveStream = async () => {
    try {
      passThrough.write(CSV_HEADERS);

      let next = null;
      do {
        const variables = {
          first: 10,
          query: `created_at:>=${start} created_at:<=${end} AND gateway:'Cashback'`,
          ...(next ? { after: next } : {}),
        };

        const { data, extensions, errors } = await client.request(query, {
          variables,
        });

        if (errors && errors.length > 0) {
          throw new Error("Shopify GraphQL error: " + errors[0].message);
        }

        for (const { node } of data.orders.edges) {
          const order = {
            id: node.id.replace("gid://shopify/Order/", ""),
            name: node.name,
            cancelled: node.cancelledAt ? true : false,
            discount: node.totalDiscountsSet?.presentmentMoney?.amount || 0,
            totalPrice: node.totalPriceSet?.presentmentMoney?.amount || 0,
            refund: node.totalRefundedSet?.presentmentMoney?.amount || 0,
            return: node.returnStatus !== "NO_RETURN",
            delivered: node.fulfillments.some(
              (f) => f.displayStatus === "DELIVERED"
            ),
            paymentStatus: node.displayFinancialStatus,
            discountCode: node.discountCode || "",
            cashbackAmount:
              node.transactions.find((t) => t.gateway === "Cashback")?.amountSet
                ?.presentmentMoney?.amount || 0,
          };
          passThrough.write(toRow(order));
        }

        next = data.orders.pageInfo.hasNextPage
          ? data.orders.pageInfo.endCursor
          : null;

        // Always keep SHOPIFY_TOKEN_RESERVE tokens available for other processes.
        // Calculate exact wait time from restoreRate rather than using a fixed sleep.
        const throttle = extensions?.cost?.throttleStatus;
        if (throttle && throttle.currentlyAvailable < SHOPIFY_TOKEN_RESERVE) {
          const tokensNeeded =
            SHOPIFY_TOKEN_RESERVE - throttle.currentlyAvailable;
          const waitMs = Math.ceil(
            (tokensNeeded / throttle.restoreRate) * 1000
          );
          console.log(
            `Shopify token reserve low (${throttle.currentlyAvailable}), waiting ${waitMs}ms`
          );
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      } while (next);

      passThrough.end();
    } catch (err) {
      passThrough.destroy(err);
      throw err;
    }
  };

  await Promise.all([driveStream(), upload.done()]);

  return `https://${process.env.CASHBACK_REPORT_AWS_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
};

const updateReportStatus = async (
  reportModel,
  reportId,
  status,
  error,
  cdn
) => {
  try {
    const rp = await reportModel.findById(reportId);
    let update = {
      status,
    };
    if (cdn) {
      update["cdn"] = cdn;
    }
    if (error) {
      update["error"] = {
        message: error,
      };
    }
    const updates = await reportModel
      .findByIdAndUpdate(reportId, { $set: update })
      .lean();
    if (status == "success") {
      const shop =
        process.env.NODE_ENV == "dev"
          ? "swiss-local-dev.myshopify.com"
          : "swiss-beauty-dev.myshopify.com";
      const payload = {
        shop: shop,
        topic: "CASHBACK_REPORT_GENERATED",
        ...updates,
      };
      await sendToSQS(payload);
    }
    return updates;
  } catch (err) {
    console.log("Failed to update report status reason -->" + err.message);
    throw new Error("Failed to update report status reason -->" + err.message);
  }
};

const handleCashbackReportGenerated = async (payload) => {
  try {
    const cashbackModel = await cashbackModels();
    const reportModel = cashbackModel.Report;
    const report = await reportModel.findById(payload._id).lean();
    await sendSubscribedEmailCashbackReport(report);
  } catch (err) {
    console.log(
      "Failed to handle cashback report generated reason -->" + err.message
    );
    throw new Error(
      "Failed to handle cashback report generated reason -->" + err.message
    );
  }
};
export { handleCashbackReport, handleCashbackReportGenerated };
