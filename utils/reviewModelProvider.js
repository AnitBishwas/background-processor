import mongoose, { Schema } from "mongoose";

import ProductReviewStatsSchema from "@swiss-beauty/reviews-schema/src/schemas/ProductReviewStats.js";
import CustomerReviewStatsSchema from "@swiss-beauty/reviews-schema/src/schemas/CustomerReviewStats.js";
import ReviewSchema from "@swiss-beauty/reviews-schema/src/schemas/Review.js";
import ReviewSettingsSchema from "@swiss-beauty/reviews-schema/src/schemas/ReviewSettings.js";
import ReviewMediaSchema from "@swiss-beauty/reviews-schema/src/schemas/ReviewMedia.js";
import ReviewModerationLogSchema from "@swiss-beauty/reviews-schema/src/schemas/ReviewModerationLog.js";
import ReviewVerificationLogSchema from "@swiss-beauty/reviews-schema/src/schemas/ReviewVerificationLog.js";
import CashbackAllocationSchema from "@swiss-beauty/reviews-schema/src/schemas/CashbackAllocation.js";

import { REVIEWS_COLLECTIONS } from "@swiss-beauty/reviews-schema/src/collectionsMaps.js";

const UploadJobSchema = new Schema(
  {
    shopId: { type: String, required: true, index: true },
    file: {
      name: String,
      url: String,
      key: String,
      size: Number,
      mimeType: String,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
      index: true,
    },
    totalCount: { type: Number, default: 0 },
    processedCount: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    errors: [{ row: Number, reason: String }],
    message: String,
  },
  { timestamps: true, versionKey: false }
);

let cachedConn = null;

const getReviewConn = async () => {
  if (cachedConn) return cachedConn;

  const reviewDBUri = process.env.REVIEW_PROD_DB;
  if (!reviewDBUri) throw new Error("Cashback db connection URI not provided");

  cachedConn = await mongoose
    .createConnection(reviewDBUri, { maxPoolSize: 20 })
    .asPromise();
  return cachedConn;
};

const reviewModels = async () => {
  const conn = await getReviewConn();

  const ProductReviewStats =
    conn.models.product_reviews_stats ||
    conn.model(
      "product_reviews_stats",
      ProductReviewStatsSchema,
      REVIEWS_COLLECTIONS.Product_Reviews_Stats
    );
  const CustomerReviewStats =
    conn.models.customer_reviews_stats ||
    conn.model(
      "customer_reviews_stats",
      CustomerReviewStatsSchema,
      REVIEWS_COLLECTIONS.Customer_Reviews_Stats
    );
  const Reviews =
    conn.models.reviews ||
    conn.model("reviews", ReviewSchema, REVIEWS_COLLECTIONS.Reviews);
  const ReviewSettings =
    conn.models.review_settings ||
    conn.model(
      "review_settings",
      ReviewSettingsSchema,
      REVIEWS_COLLECTIONS.ReviewSettings
    );
  const ReviewMedia =
    conn.models.review_media ||
    conn.model(
      "review_media",
      ReviewMediaSchema,
      REVIEWS_COLLECTIONS.Review_Media
    );

  const ReviewModerationLog =
    conn.models.review_moderation_logs ||
    conn.model(
      "review_moderation_logs",
      ReviewModerationLogSchema,
      REVIEWS_COLLECTIONS.Review_Moderation_Log
    );

  const ReviewVerificationLog =
    conn.models.review_verification_logs ||
    conn.model(
      "review_verification_logs",
      ReviewVerificationLogSchema,
      REVIEWS_COLLECTIONS.Review_Verification_log
    );
  const CashbackAllocation =
    conn.models.cashback_allocations ||
    conn.model(
      "cashback_allocations",
      CashbackAllocationSchema,
      REVIEWS_COLLECTIONS.Cashback_Allocations
    );

  const UploadJob =
    conn.models.upload_jobs ||
    conn.model("upload_jobs", UploadJobSchema, "upload_jobs");

  return {
    conn,
    ProductReviewStats,
    CustomerReviewStats,
    Reviews,
    ReviewSettings,
    ReviewMedia,
    ReviewModerationLog,
    ReviewVerificationLog,
    CashbackAllocation,
    UploadJob,
  };
};

export default reviewModels;
