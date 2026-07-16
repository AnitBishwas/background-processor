/**
 * Manually trigger the RTO refund daily report right now, instead of
 * waiting for the cron schedule. Useful for testing the SES email flow.
 *
 * Usage:
 *   npx dotenvx run --env-file=.env.dev -- node scripts/testRtoRefundReport.js
 */
import mongoose from "mongoose";
import { generateAndSendRtoRefundReport } from "../server/jobs/rtoRefundReport/index.js";

const mongoUrl =
  process.env.MONGO_URL || "mongodb://127.0.0.1:27017/shopify-express-app";

async function main() {
  await mongoose.connect(mongoUrl);
  console.log("Connected to Mongo, generating report now...");
  await generateAndSendRtoRefundReport();
  console.log("Done.");
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to run report:", err);
  process.exit(1);
});
