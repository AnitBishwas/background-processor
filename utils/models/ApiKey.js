import mongoose from "mongoose";

const ApiKeySchema = new mongoose.Schema(
  {
    shop: { type: String, index: true },
    createdByUserId: { type: String },
    clientId: { type: String, required: true, index: true },
    name: { type: String, default: "" },
    allowedPrefixes: [{ type: String, required: true }],
    keyPrefix: { type: String, required: true, index: true },
    keyHash: { type: String, required: true },

    status: {
      type: String,
      enum: ["active", "revoked"],
      default: "active",
      index: true,
    },
    lastUsedAt: { type: Date },
    lastUsedIp: { type: String },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ApiKeySchema.index({ keyPrefix: 1, status: 1 });

export default mongoose.models.ApiKey || mongoose.model("ApiKey", ApiKeySchema);
