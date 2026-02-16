import cashbackModels from "../../../../utils/cashbackModelProvider.js";
import { handlePointsExpiryForEventsPurposes } from "../../events/controllers/cashbackServerEvents.js";

const getStartOfTodayIST = () => {
  const IST_TZ = "Asia/Kolkata";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  const d = parts.find((p) => p.type === "day").value;

  const utcMidnight = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
  const istStart = new Date(utcMidnight.getTime() - 330 * 60 * 1000);

  return istStart;
};

/**
 *
 * Cashback expiry
 */
const handleCashbackExpiry = async ({ batchSize = 200 } = {}) => {
  const cashbackModel = await cashbackModels();
  const session = await cashbackModel.conn.startSession();

  const Point = cashbackModel.Point;
  const Wallet = cashbackModel.Wallet;
  const Transaction = cashbackModel.Transaction;

  const cutoffIST = getStartOfTodayIST();
  let processed = 0;

  try {
    let expiredPointsList = [];
    while (true) {
      const candidates = await Point.find(
        {
          status: "ready",
          expiresOn: { $lt: cutoffIST },
        },
        { _id: 1, walletId: 1, customerId: 1, amount: 1, expiresOn: 1 }
      )
        .sort({ expiresOn: 1, _id: 1 })
        .limit(batchSize)
        .lean();

      if (!candidates.length) break;

      for (const p of candidates) {
        await session.withTransaction(async () => {
          const claimed = await Point.findOneAndUpdate(
            { _id: p._id, status: "ready" },
            { $set: { status: "expired" } },
            { new: true, session }
          ).lean();

          if (!claimed) return;
          expiredPointsList.push(claimed);
          const debitAmount = Number(claimed.amount || 0);
          if (debitAmount <= 0) return;

          const wallet = await Wallet.findById(claimed.walletId, null, {
            session,
          });
          if (!wallet) {
            throw new Error(
              `Wallet not found for walletId=${claimed.walletId}`
            );
          }

          const before = Number(wallet.balance || 0);
          const after = Math.max(0, before - debitAmount);
          wallet.balance = after;

          wallet.points = (wallet.points || []).filter(
            (x) => String(x?.id) !== String(claimed._id)
          );

          await wallet.save({ session });

          await Transaction.create(
            [
              {
                walletId: String(wallet._id),
                status: "expired",
                type: "debit",
                amount: debitAmount,
                closingBalance: after,
                note: `Cashback expired for point ${String(claimed._id)} (expiry date: ${claimed.expiresOn.toISOString()})`,
              },
            ],
            { session }
          );

          processed += 1;
        });
      }
      if (candidates.length < batchSize) break;
    }
    if (expiredPointsList.length > 0) {
      // handle points expiry server event
      handlePointsExpiryForEventsPurposes(expiredPointsList);
    }
    return { success: true, processed, cutoffIST };
  } catch (err) {
    console.log("Failed to handle cashback expiry reason -->" + err.message);
  } finally {
    await session.endSession();
  }
};

export { handleCashbackExpiry };
