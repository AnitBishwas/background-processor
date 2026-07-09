/**
 * Diagnostic: prints the scopes currently granted to the stored offline
 * session for RTO_REFUND_SHOP. Use this to confirm whether re-installing
 * the app actually picked up the new read_returns/write_returns scopes.
 *
 * Usage (uses the same env loader as `npm run dev`):
 *   npx dotenvx run --env-file=.env.dev -- node scripts/checkSessionScope.js
 */
import mongoose from "mongoose";
import sessionHandler from "../utils/sessionHandler.js";
import shopify from "../utils/shopify.js";

const mongoUrl =
  process.env.MONGO_URL || "mongodb://127.0.0.1:27017/shopify-express-app";

async function main() {
  await mongoose.connect(mongoUrl);

  const shop = process.env.RTO_REFUND_SHOP || "swiss-local-dev.myshopify.com";
  const sessionId = shopify.session.getOfflineId(shop);
  const session = await sessionHandler.loadSession(sessionId);

  if (!session) {
    console.log(`No offline session found in Mongo for ${shop}.`);
  } else {
    console.log(`Shop: ${shop}`);
    console.log(`Session id: ${session.id}`);
    console.log(`Granted scopes: ${session.scope}`);
    console.log(
      `Has returns scope: ${
        (session.scope || "").includes("returns") ? "YES ✅" : "NO ❌"
      }`
    );
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to check session scope:", err);
  process.exit(1);
});
