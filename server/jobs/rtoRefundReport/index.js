import AWS from "aws-sdk";
import { CronJob } from "cron";
import { PassThrough } from "stream";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import RtoRefund from "../../../utils/models/RtoRefund.js";

const ses = new AWS.SES({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

/**
 * Only orders that were actually processed (money refunded, or a COD
 * order returned) show up in the daily report - not failed/skipped/dry-run
 * ones (those stay visible in Mongo/logs for ops debugging).
 */
const REPORT_STATUSES = ["refund_completed", "returned_completed"];

const CSV_HEADERS = [
  "date",
  "orderName",
  "customerName",
  "customerPhone",
  "waybill",
  "type",
  "refundAmount",
  "cashbackRefundAmount",
  "clickpostStatus",
];

// IST (UTC+5:30) start-of-day boundary, since the job runs at night IST.
function getTodayIstRange() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const nowUtcMs = Date.now();
  const nowIst = new Date(nowUtcMs + IST_OFFSET_MS);

  const startOfDayIst = new Date(
    Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate())
  );
  const startOfDayUtc = new Date(startOfDayIst.getTime() - IST_OFFSET_MS);

  return { start: startOfDayUtc, end: new Date(nowUtcMs) };
}

const csvEscape = (val) => {
  const s = val === undefined || val === null ? "" : String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const escapeHtml = (val) =>
  (val === undefined || val === null ? "" : String(val))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * Streams RtoRefund records straight from a Mongo cursor into an S3
 * multipart upload, one row at a time. At no point does this hold the
 * full dataset in memory - only the current row and a few running totals
 * (count, total refunded amount).
 */
async function streamReportToS3({ shop, start, end, dateLabel }) {
  const bucket = process.env.RTO_REFUND_REPORT_S3_BUCKET;
  if (!bucket) {
    throw new Error("RTO_REFUND_REPORT_S3_BUCKET env var is not set");
  }

  const prefix =
    process.env.RTO_REFUND_REPORT_S3_PREFIX || "rto-refund-reports";
  const key = `${prefix}/${shop}/${dateLabel}.csv`;

  const passthrough = new PassThrough();
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: passthrough,
      ContentType: "text/csv",
    },
  });

  // Surface upload errors instead of letting them hang silently.
  const uploadDone = upload.done();

  passthrough.write(CSV_HEADERS.join(",") + "\n");

  let totalCount = 0;
  let totalRefunded = 0;
  let totalCashbackRefunded = 0;
  let codCount = 0;
  let prepaidCount = 0;

  // .cursor() streams documents one at a time from MongoDB instead of
  // loading the whole result set into an array.
  const cursor = RtoRefund.find({
    shop,
    status: { $in: REPORT_STATUSES },
    createdAt: { $gte: start, $lte: end },
  })
    .sort({ createdAt: 1 })
    .lean()
    .cursor();

  try {
    for await (const r of cursor) {
      totalCount += 1;
      const amount = r.isCod ? 0 : Number(r.refundedAmount || 0);
      const cashbackAmount = Number(r.cashbackRefundedAmount || 0);
      totalRefunded += amount;
      totalCashbackRefunded += cashbackAmount;
      if (r.isCod) codCount += 1;
      else prepaidCount += 1;

      const row = [
        r.createdAt?.toISOString?.() || "",
        r.orderName,
        r.customerName,
        r.customerPhone,
        r.waybill,
        r.isCod ? "COD (Returned)" : "Prepaid (Refunded)",
        r.isCod ? "" : amount.toFixed(2),
        cashbackAmount ? cashbackAmount.toFixed(2) : "",
        r.clickpostStatus,
      ]
        .map(csvEscape)
        .join(",");

      // Backpressure: wait for the stream to drain if the S3 upload
      // can't keep up, instead of buffering everything in memory.
      if (!passthrough.write(row + "\n")) {
        await new Promise((resolve) => passthrough.once("drain", resolve));
      }
    }
  } finally {
    passthrough.end();
  }

  await uploadDone;

  return {
    bucket,
    key,
    totalCount,
    totalRefunded,
    totalCashbackRefunded,
    codCount,
    prepaidCount,
  };
}

async function getDownloadUrl({ bucket, key }) {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  // Link expires in 7 days - the file itself stays in S3, only the
  // shareable link expires (avoids an indefinitely public CSV of PII).
  return getSignedUrl(s3, command, { expiresIn: 60 * 60 * 24 * 7 });
}

function buildSummaryHtml({
  shop,
  dateLabel,
  totalCount,
  totalRefunded,
  totalCashbackRefunded,
  codCount,
  prepaidCount,
  downloadUrl,
}) {
  const grandTotal = totalRefunded + totalCashbackRefunded;
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;background:#fff;">
      <div style="background:#f7f7f7;padding:24px;">
        <h2 style="margin:0 0 8px 0;color:#1a1a1a;">RTO Refunds Summary</h2>
        <p style="margin:0;color:#444;">
          Summary of RTO orders processed on ${escapeHtml(
            dateLabel
          )} for <strong>${escapeHtml(shop)}</strong>.
        </p>

        <table style="width:100%;border-collapse:collapse;margin-top:20px;background:#fff;">
          <tbody>
            <tr>
              <td style="padding:10px;border-bottom:1px solid #e5e5e5;">Total orders</td>
              <td style="padding:10px;border-bottom:1px solid #e5e5e5;text-align:right;"><strong>${totalCount}</strong></td>
            </tr>
            <tr>
              <td style="padding:10px;border-bottom:1px solid #e5e5e5;">Prepaid (refunded)</td>
              <td style="padding:10px;border-bottom:1px solid #e5e5e5;text-align:right;">${prepaidCount}</td>
            </tr>
            <tr>
              <td style="padding:10px;border-bottom:1px solid #e5e5e5;">COD (returned)</td>
              <td style="padding:10px;border-bottom:1px solid #e5e5e5;text-align:right;">${codCount}</td>
            </tr>
            <tr>
              <td style="padding:10px;border-bottom:1px solid #e5e5e5;">Prepaid Refund Amount (Shopify)</td>
              <td style="padding:10px;border-bottom:1px solid #e5e5e5;text-align:right;">₹${totalRefunded.toFixed(
                2
              )}</td>
            </tr>
            <tr>
              <td style="padding:10px;border-bottom:1px solid #e5e5e5;">Cashback Refund Amount (Wallet)</td>
              <td style="padding:10px;border-bottom:1px solid #e5e5e5;text-align:right;">₹${totalCashbackRefunded.toFixed(
                2
              )}</td>
            </tr>
            <tr>
              <td style="padding:10px;">Total Refund Amount</td>
              <td style="padding:10px;text-align:right;"><strong>₹${grandTotal.toFixed(
                2
              )}</strong></td>
            </tr>
          </tbody>
        </table>

        <p style="margin-top:24px;">
          <a href="${downloadUrl}" style="background:#1a1a1a;color:#fff;padding:12px 20px;
            border-radius:6px;text-decoration:none;display:inline-block;">
            Download full CSV report
          </a>
        </p>
        <p style="color:#888;font-size:12px;">
          (Link expires in 7 days)
        </p>

        <p style="margin-top:24px;color:#888;font-size:12px;">
          This is an automated email. Please do not reply.
        </p>
      </div>
    </div>
  `;
}

async function sendReportEmail({ subject, html }) {
  const to = (process.env.RTO_REFUND_REPORT_EMAILS || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  if (!to.length) {
    console.log(
      "[rto-refund-report] RTO_REFUND_REPORT_EMAILS not set, skipping email."
    );
    return;
  }

  const params = {
    Source:
      process.env.RTO_REFUND_REPORT_FROM_EMAIL || "anit.biswas@swissbeauty.in",
    Destination: { ToAddresses: to },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: { Html: { Data: html, Charset: "UTF-8" } },
    },
  };

  await ses.sendEmail(params).promise();
}

export const generateAndSendRtoRefundReport = async () => {
  try {
    const shop = process.env.RTO_REFUND_SHOP;
    if (!shop) {
      console.log("[rto-refund-report] RTO_REFUND_SHOP not set, skipping");
      return;
    }

    const { start, end } = getTodayIstRange();
    const dateLabel = new Date().toISOString().slice(0, 10);

    // Cheap existence check before we bother opening an S3 upload stream.
    const anyRecord = await RtoRefund.exists({
      shop,
      status: { $in: REPORT_STATUSES },
      createdAt: { $gte: start, $lte: end },
    });

    if (!anyRecord) {
      console.log(
        `[rto-refund-report] No RTO refunds for ${shop} on ${dateLabel}, skipping report`
      );
      return;
    }

    const {
      bucket,
      key,
      totalCount,
      totalRefunded,
      totalCashbackRefunded,
      codCount,
      prepaidCount,
    } = await streamReportToS3({ shop, start, end, dateLabel });

    const downloadUrl = await getDownloadUrl({ bucket, key });

    const html = buildSummaryHtml({
      shop,
      dateLabel,
      totalCount,
      totalRefunded,
      totalCashbackRefunded,
      codCount,
      prepaidCount,
      downloadUrl,
    });

    await sendReportEmail({
      subject: `RTO Refunds Summary - ${shop} - ${dateLabel} (${totalCount} orders)`,
      html,
    });

    console.log(
      `[rto-refund-report] Sent report for ${shop} on ${dateLabel} - ` +
        `${totalCount} orders, ₹${totalRefunded.toFixed(2)} refunded + ` +
        `₹${totalCashbackRefunded.toFixed(2)} cashback reversed, ` +
        `uploaded to s3://${bucket}/${key}`
    );
  } catch (err) {
    console.error("[rto-refund-report] Failed to generate/send report:", err);
  }
};

// Step 6: runs once daily (schedule from RTO_REFUND_REPORT_CRON), only
// when explicitly enabled via RTO_REFUND_REPORT_JOB_ENABLED=true.
// Step 9: this is a separate cron job, never triggered from the webhook.
if (process.env.RTO_REFUND_REPORT_JOB_ENABLED === "true") {
  const schedule = process.env.RTO_REFUND_REPORT_CRON || "0 30 23 * * *";
  new CronJob(
    schedule,
    generateAndSendRtoRefundReport,
    null,
    true,
    "Asia/Kolkata"
  );
  console.log(`[rto-refund-report] Scheduled with cron "${schedule}" (IST)`);
} else {
  console.log(
    "[rto-refund-report] Job disabled (RTO_REFUND_REPORT_JOB_ENABLED != true)"
  );
}
