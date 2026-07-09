import mongoose from "mongoose";

/**
 * Tracks RTO webhook events we've processed, so we never double-refund
 * the same order (Step 3 of the RTO Refund Automation Flow: "Check MongoDB
 * first to confirm whether the order has already been refunded").
 */
const rtoRefundSchema = new mongoose.Schema(
  {
    shop: { type: String, required: true, index: true },
    waybill: { type: String, required: true, index: true },
    orderId: { type: String }, // Shopify GID, once we resolve the order
    orderIdFromClickpost: { type: String }, // raw value ClickPost sent us
    orderName: { type: String },
    customerName: { type: String },
    customerPhone: { type: String },
    refundedAmount: { type: Number },
    cashbackRefundedAmount: { type: Number },
    notificationEventId: { type: Number },
    clickpostStatus: { type: String },
    status: {
      type: String,
      enum: [
        "refund_completed", // prepaid - money refunded
        "returned_completed", // COD - returned, no money to refund
        "dry_run",
        "skipped",
        "failed",
      ],
      required: true,
    },
    isCod: { type: Boolean },
    error: { type: String },
    rawPayload: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

export default mongoose.models.RtoRefund ||
  mongoose.model("RtoRefund", rtoRefundSchema);
