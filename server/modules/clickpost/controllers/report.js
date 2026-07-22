import RtoOrder from "../../../../utils/models/RtoOrder.js";
import { Transform, PassThrough } from "stream";
import { pipeline } from "stream/promises";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { sendSubscribedEmailRtoReport } from "./mail.js";

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

const getPreviousDayBoundsIST = () => {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(Date.now() + IST_OFFSET_MS);

  const yesterday = new Date(istNow);
  yesterday.setUTCDate(
    yesterday.getUTCDate() - (process.env.NODE_ENV == "dev" ? 0 : 1)
  );
  const dateStr = yesterday.toISOString().slice(0, 10);

  return {
    start: new Date(`${dateStr}T00:00:00.000+05:30`),
    end: new Date(`${dateStr}T23:59:59.999+05:30`),
    dateStr,
  };
};

const generateRtoReport = async () => {
  try {
    const { start, end, dateStr } = getPreviousDayBoundsIST();
    const cursor = RtoOrder.find({
      createdAt: { $gte: start, $lte: end },
    }).cursor();

    const { s3Key, summary } = await streamCsvFileToS3(cursor, dateStr);

    const s3Url = `https://${process.env.RTO_REPORT_AWS_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
    await sendSubscribedEmailRtoReport({ dateStr, s3Url, summary });
  } catch (err) {
    throw new Error("failed to generate rto report reason -->" + err.message);
  }
};

const streamCsvFileToS3 = async (cursor, dateStr) => {
  try {
    const s3Key = `reports/${dateStr}.csv`;
    const CSV_HEADERS =
      "orderId,createdAt,customerName,phone,email,refundAmount,isCod,isPrepaid,cashbackUsed\n";
    const passThrough = new PassThrough();

    const upload = new Upload({
      client: s3,
      params: {
        Bucket: process.env.RTO_REPORT_AWS_BUCKET,
        Key: s3Key,
        Body: passThrough,
        ContentType: "text/csv",
        ContentDisposition: `attachment; filename="${dateStr}.csv"`,
      },
    });

    passThrough.write(CSV_HEADERS);

    const summary = { totalOrders: 0, totalRefundAmount: 0, totalCashback: 0 };

    const csvTransform = new Transform({
      objectMode: true,
      transform(order, _enc, cb) {
        summary.totalOrders++;
        summary.totalRefundAmount += order.refund?.total ?? 0;
        summary.totalCashback += order.cashbackUtilised ?? 0;
        cb(null, toRow(order));
      },
    });

    await Promise.all([
      pipeline(cursor, csvTransform, passThrough),
      upload.done(),
    ]);

    return { s3Key, summary };
  } catch (err) {
    throw new Error("Failed to stream csv file to s3 reason -->" + err.message);
  }
};

const escapeCSV = (value) => {
  if (value === null || value === undefined) return "";
  const str = String(value);
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"`
    : str;
};

const toRow = (order) => {
  const c = order.customer || {};
  const customerName = [c.firstName, c.lastName].filter(Boolean).join(" ");

  return (
    [
      order.orderName,
      order.orderDate ? new Date(order.orderDate).toISOString() : "",
      customerName,
      c.phone || "",
      c.email || "",
      order.refund?.total ?? "",
      order.isCod,
      order.isPrepaid,
      order.cashbackUtilised ?? 0,
    ]
      .map(escapeCSV)
      .join(",") + "\n"
  );
};

export { generateRtoReport };
