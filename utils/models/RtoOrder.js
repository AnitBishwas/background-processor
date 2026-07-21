import mongoose from "mongoose";

const RtoOrderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: true,
    },
    orderDate: {
      type: Date,
      required: true,
    },
    orderName: {
      type: String,
      required: true,
    },
    clickPostPayload: {
      type: String,
    },
    isCod: Boolean,
    isPrepaid: Boolean,
    cashbackUtilised: {
      type: Number,
    },
    customer: {
      firstName: String,
      lastName: String,
      phone: String,
      email: String,
    },
    refund: {
      total: {
        type: Number,
        default: 0,
      },
      cashback: {
        type: Number,
        default: 0,
      },
    },
  },
  {
    timestamps: true,
  }
);
RtoOrderSchema.index({ createdAt: 1 });
export default mongoose.models.RtoOrder ||
  mongoose.model("RtoOrder", RtoOrderSchema);
