import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import pLimit from "p-limit";
import AWS from "aws-sdk";
import csvParser from "csv-parser";
import { handleManualCashbackDistribution } from "./index.js";

const sqs = new AWS.SQS();

const startVisibilityHeartbeat = ({
  receiptHandle,
  queueUrl,
  timeoutSeconds = 300,
}) => {
  let stopped = false;

  const loop = async () => {
    while (!stopped) {
      try {
        await sqs
          .changeMessageVisibility({
            QueueUrl: queueUrl,
            ReceiptHandle: receiptHandle,
            VisibilityTimeout: timeoutSeconds,
          })
          .promise();
      } catch (e) {
        console.log("visibility extend failed:", e.message);
      }
      await new Promise((r) => setTimeout(r, 30_000)); // every 30s
    }
  };

  loop();
  return () => {
    stopped = true;
  };
};

const handleCashbackBulkDistribution = async (payload, meta) => {
  const summary = {
    jobId: payload.jobId,
    totalRows: 0,
    processedRows: 0,
    successRows: 0,
    failedRows: 0,
    failedSamples: [],
    startedAt: new Date(),
    user: payload.user,
  };

  const stop = meta?.receiptHandle
    ? startVisibilityHeartbeat({
        receiptHandle: meta.receiptHandle,
        queueUrl: meta.queueUrl,
        timeoutSeconds: 300,
      })
    : null;

  try {
    await processBulkDistributionCsvFromS3({
      jobId: payload.jobId,
      bucket: payload.bucket,
      key: payload.key,
      batchSize: 500,
      concurrency: 5,

      processBatchRows: async ({ jobId, rows }) => {
        const rowLimiter = pLimit(15);

        const tasks = rows.map((row) =>
          rowLimiter(async () => {
            try {
              console.log("processing row", row.rowIndex);
              const sourceRef =
                row.rowIndex != null
                  ? `${payload.jobId}:${row.rowIndex}`
                  : `${payload.jobId}:${row.phone || row.Phone || "unknown"}`;
              await handleManualCashbackDistribution({
                ...row,
                sourceRef,
                note: "Bulk cashback distribution",
              });

              summary.successRows += 1;
            } catch (err) {
              summary.failedRows += 1;

              if (summary.failedSamples.length < 50) {
                summary.failedSamples.push({
                  rowIndex: row.rowIndex,
                  phone: row.phone,
                  error: err.message,
                });
              }
            } finally {
              summary.processedRows += 1;
            }
          })
        );

        await Promise.all(tasks);
      },
      onRowError: async ({ jobId, rowIndex, row, error }) => {
        summary.failedRows += 1;
        summary.processedRows += 1;

        if (summary.failedSamples.length < 50) {
          summary.failedSamples.push({
            rowIndex,
            phone: row.phone || row.Phone,
            error: error.message,
          });
        }
      },

      onProgress: async ({ totalRows }) => {
        summary.totalRows = totalRows;
      },
    });

    summary.completedAt = new Date();
    summary.status = "completed";
  } catch (err) {
    summary.status = "failed";
    summary.error = err.message;
    throw err;
  } finally {
    stop?.();
    console.log(summary);
    try {
      await Promise.race([
        sendBulkDistributionEmailSummary(summary),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("Email timeout")), 8000)
        ),
      ]);
    } catch (e) {
      console.log("Email send skipped/failed:", e.message);
    }
  }
};

const IST_OFFSET_MIN = 330; // 5h30m

const yieldToEventLoop = () => new Promise((r) => setImmediate(r));

const toEndOfDayIST = (dateStr) => {
  const s = String(dateStr || "").trim();

  let y, m, d;

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    [y, m, d] = s.split("-").map(Number);
  }
  // DD-MM-YYYY
  else if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [dd, mm, yy] = s.split("-").map(Number);
    y = yy;
    m = mm;
    d = dd;
  } else {
    throw new Error(`Invalid expiry date format: "${s}"`);
  }
  const utcMs =
    Date.UTC(y, m - 1, d, 23, 59, 59, 999) - IST_OFFSET_MIN * 60 * 1000;

  return new Date(utcMs);
};

const normalizeToE164India = (phoneRaw) => {
  const p = String(phoneRaw || "").trim();

  if (/^\+91\d{10}$/.test(p)) return p;
  if (/^\d{10}$/.test(p)) return `+91${p}`;

  if (/^91\d{10}$/.test(p)) return `+${p}`;

  throw new Error(
    `Invalid phone: "${p}" (expected +91XXXXXXXXXX or 10 digits)`
  );
};

const parseAmount = (amountRaw) => {
  const s = String(amountRaw ?? "").trim();
  const n = Number(s);

  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid amount: "${amountRaw}"`);
  }
  return n;
};

const pickField = (row, keys) => {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== "") return row[k];
  }
  return undefined;
};
const processBulkDistributionCsvFromS3 = async ({
  jobId,
  bucket,
  key,
  batchSize = 500,
  concurrency = 5,
  processBatchRows,
  onRowError,
  onProgress,
}) => {
  try {
    if (!jobId) throw new Error("jobId is required");
    if (!bucket) throw new Error("bucket is required");
    if (!key) throw new Error("key is required");
    if (typeof processBatchRows !== "function") {
      throw new Error("processBatchRows(jobId, rows) function is required");
    }
    const s3 = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_KEY,
      },
    });
    const limiter = pLimit(Math.max(1, Number(concurrency) || 1));
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    const resp = await s3.send(cmd);
    if (!resp?.Body) throw new Error("S3 GetObject returned empty Body stream");
    let rowIndex = 0;
    let processedRows = 0;
    let batch = [];
    let pendingBatchPromises = [];

    const flushBatch = async () => {
      if (batch.length === 0) return;
      const rowsToProcess = batch;
      batch = [];

      const p = limiter(async () => {
        await processBatchRows({ jobId, rows: rowsToProcess });
        processedRows += rowsToProcess.length;

        if (onProgress) {
          await onProgress({
            jobId,
            totalRows: rowIndex,
            processedRows,
          });
        }
      });

      pendingBatchPromises.push(p);

      if (pendingBatchPromises.length >= concurrency * 3) {
        await Promise.all(pendingBatchPromises);
        pendingBatchPromises = [];
        await yieldToEventLoop();
      }
    };
    await new Promise((resolve, reject) => {
      const stream = resp.Body;

      stream
        .pipe(csvParser())
        .on("data", async (row) => {
          rowIndex += 1;

          stream.pause();

          try {
            const phoneRaw = pickField(row, [
              "phone",
              "Phone",
              "mobile",
              "Mobile",
            ]);
            const amountRaw = pickField(row, [
              "amount",
              "Amount",
              "cashback",
              "cashbackAmount",
            ]);
            const expiryRaw = pickField(row, [
              "expiry",
              "expiryDate",
              "expiresOn",
              "ExpiresOn",
              "Expiry",
            ]);

            const phone = normalizeToE164India(phoneRaw);
            const amount = parseAmount(amountRaw);
            const expiresOn = toEndOfDayIST(expiryRaw);
            batch.push({ rowIndex, phone, amount, expiresOn });
            if (batch.length >= batchSize) {
              await flushBatch();
              await yieldToEventLoop();
            }
          } catch (e) {
            // per-row error: log + continue
            if (onRowError) {
              try {
                await onRowError({ jobId, rowIndex, row, error: e });
              } catch (ignored) {}
            } else {
              console.error(
                `[bulk job=${jobId}] row=${rowIndex} skipped:`,
                e.message
              );
            }
          } finally {
            stream.resume();
          }
        })
        .on("error", reject)
        .on("end", resolve);
    });
    await flushBatch();
  } catch (err) {
    console.log("Failed ", err.message);
  }
};

const sendBulkDistributionEmailSummary = async (payload) => {
  try {
    const summary = payload;

    const subject =
      summary.status === "completed"
        ? "Cashback Bulk Distribution Completed"
        : "Cashback Bulk Distribution Failed";

    const body = `Hi,
          Your bulk cashback distribution job has completed.
          Job ID: ${summary.jobId}
          Total Rows: ${summary.totalRows}
          Successful: ${summary.successRows}
          Failed: ${summary.failedRows}

          Started At: ${summary.startedAt}
          Completed At: ${summary.completedAt}

          Sample Errors:
          ${summary.failedSamples.map((e) => `Row ${e.rowIndex}: ${e.error}`).join("\n")}

          Thanks`;

    await sendEmail({
      to: payload.user.email,
      subject: `Cashback bulk distribution summary`,
      body: body,
    });
  } catch (err) {
    console.log(
      "Failed to send bulk distribution email summary reason -->" + err.message
    );
  }
};

const ses = new AWS.SES({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

const sendEmail = async ({
  to,
  subject,
  body,
  htmlBody,
  from = "anit.biswas@swissbeauty.in",
}) => {
  if (!to) throw new Error("Recipient email is required");
  if (!subject) throw new Error("Email subject is required");
  if (!body && !htmlBody) {
    throw new Error("Either body or htmlBody is required");
  }

  const params = {
    Source: from,
    Destination: {
      ToAddresses: Array.isArray(to) ? to : [to],
    },
    Message: {
      Subject: {
        Data: subject,
        Charset: "UTF-8",
      },
      Body: htmlBody
        ? {
            Html: {
              Data: htmlBody,
              Charset: "UTF-8",
            },
          }
        : {
            Text: {
              Data: body,
              Charset: "UTF-8",
            },
          },
    },
  };

  try {
    await ses.sendEmail(params).promise();
    return { ok: true };
  } catch (err) {
    console.error("SES sendEmail failed:", err.message);
    throw err;
  }
};
export { handleCashbackBulkDistribution };
