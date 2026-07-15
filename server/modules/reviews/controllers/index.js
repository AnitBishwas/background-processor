import reviewModels from "../../../../utils/reviewModelProvider.js";
import cashbackModels from "../../../../utils/cashbackModelProvider.js";

const handleReviewSubmission = async (review) => {
  try {
    const reviewModel = await reviewModels();
    const cashbackModel = await cashbackModels();
    const cashbackSession = await cashbackModel.conn.startSession();
    const reviewSession = await reviewModel.conn.startSession();

    try {
      cashbackSession.startTransaction();
      reviewSession.startTransaction();

      const settings = await reviewModel.ReviewSettings.findOne({
        shop: review.shopId,
      })
        .lean()
        .session(reviewSession);
      if (!settings?.cashback?.enable) {
        await reviewSession.commitTransaction();
        await cashbackSession.commitTransaction();
        return;
      }

      // idempotency guard — prevent double cashback on SQS retry
      const existing = await reviewModel.CashbackAllocation.findOne({
        reviewId: review._id.toString(),
      })
        .lean()
        .session(reviewSession);
      if (existing) {
        await reviewSession.commitTransaction();
        await cashbackSession.commitTransaction();
        return;
      }

      const hasMedia = review.hasImages || review.hasVideo;
      const cashbackAmount = hasMedia
        ? settings.cashback.withMedia.amount
        : settings.cashback.withoutMedia.amount;

      if (!cashbackAmount || cashbackAmount <= 0) {
        await reviewSession.commitTransaction();
        await cashbackSession.commitTransaction();
        return;
      }

      const expiryDays = settings.cashback.expiry || 365;
      const expiresOn = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

      const rawId = String(review.customer.customerId).replace(
        "gid://shopify/Customer/",
        ""
      );
      const customerId = Number(rawId);
      if (!customerId) throw new Error("Invalid customerId in review");

      let customerWallet = await cashbackModel.Wallet.findOne({ customerId })
        .lean()
        .session(cashbackSession);

      if (!customerWallet) {
        const nameParts = (review.customer.name || "").split(" ");
        const newCustomer = new cashbackModel.Customer({
          customerId,
          firstName: nameParts[0] || "",
          lastName: nameParts.slice(1).join(" ") || "",
          phone: review.customer.phone || "",
          email: review.customer.email || "",
        });
        await newCustomer.save({ session });

        const newWallet = new cashbackModel.Wallet({
          customerId,
          points: [],
          balance: 0,
        });
        const savedWallet = await newWallet.save({ session });
        customerWallet = savedWallet.toObject();
      }

      const newPoint = new cashbackModel.Point({
        customerId,
        orders: [],
        amount: cashbackAmount,
        status: "ready",
        walletId: customerWallet._id,
        expiresOn,
        refreshed: {
          state: true,
          date: new Date(Date.now()).toISOString(),
        },
      });
      const correspondingPoint = await newPoint.save({ cashbackSession });

      const newTransaction = new cashbackModel.Transaction({
        walletId: customerWallet._id,
        status: "completed",
        type: "credit",
        closingBalance: customerWallet.balance + cashbackAmount,
        amount: cashbackAmount,
        note: `Review cashback - ${hasMedia ? "with media" : "without media"}`,
      });
      await newTransaction.save({ cashbackSession });

      await cashbackModel.Wallet.updateOne(
        { customerId },
        {
          $inc: { balance: cashbackAmount },
          $push: { points: { id: String(correspondingPoint._id) } },
        },
        { cashbackSession }
      );

      await cashbackSession.commitTransaction();

      // CashbackAllocation lives in the reviews DB — must be written after cashback session commits
      await reviewModel.CashbackAllocation.create({
        amount: cashbackAmount,
        pointId: String(correspondingPoint._id),
        walletId: String(customerWallet._id),
        customerId: String(customerId),
        reviewId: String(review._id),
        expiresOn,
      });
      await reviewModel.CustomerReviewStats.updateOne(
        { customerId: customerId },
        {
          $inc: { cashbackEarned: cashbackAmount },
        },
        { reviewSession }
      );
      await reviewSession.commitTransaction();
      console.log(
        `Review cashback credited ✅ customerId=${customerId} amount=${cashbackAmount} hasMedia=${hasMedia}`
      );
    } catch (err) {
      await cashbackSession.abortTransaction();
      await reviewSession.abortTransaction();
      throw err;
    } finally {
      cashbackSession.endSession();
      reviewSession.endSession();
    }
  } catch (err) {
    throw new Error(
      "Failed to handle review submission reason --> " + err.message
    );
  }
};

export { handleReviewSubmission };
