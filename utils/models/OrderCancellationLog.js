import mongoose from "mongoose";

const OrderCancellationLogSchema = new mongoose.Schema(
  {
    shop: { type: String, required: true, index: true },
    orderId: { type: String, required: true, index: true }, // Shopify GID
    orderName: { type: String, required: true, index: true }, // e.g. #1001
    email: { type: String },
    customerId: { type: String },

    // "cancelled"  -> order was actually cancelled in Shopify
    // "blocked"    -> eligibility check failed, order was NOT cancelled
    // "failed"     -> eligibility passed but the Shopify mutation itself failed
    status: {
      type: String,
      enum: ["cancelled", "blocked", "failed"],
      required: true,
      index: true,
    },

    // ELIGIBLE | ALREADY_CANCELLED | CANCELLATION_WINDOW_EXPIRED |
    // ORDER_ALREADY_FULFILLED | SHOPIFY_ERROR
    reasonCode: { type: String },
    reasonMessage: { type: String },

    orderCreatedAt: { type: Date },
    cancelledAt: { type: Date },

    refundInitiated: { type: Boolean, default: false },

    source: { type: String, default: "storefront" },
    bigQueryEventSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

OrderCancellationLogSchema.index({ orderId: 1, createdAt: -1 });

export default mongoose.models.OrderCancellationLog ||
  mongoose.model("OrderCancellationLog", OrderCancellationLogSchema);
