import clientProvider from "../../../../utils/clientProvider.js";
import cashbackModels from "../../../../utils/cashbackModelProvider.js";
import {
  createCashbackAssignedEvent,
  createCashbackPendingAssignedEvent,
  createCashbackUtilisedEvent,
} from "../../events/controllers/cashbackServerEvents.js";
import { normalizeIndianPhone } from "../helpers/index.js";
import {
  cashbackCreditedEventInMoe,
  handleCashbackUpdateForMoe,
} from "../../moe/controllers/cashback.js";

const getListOfCustomersWherePhoneIsBlank = async () => {
  try {
    const cashbackModel = await cashbackModels();
    const customersList = await cashbackModel.Customer.find({
      phone: { $in: [null, ""] },
    });
    return customersList;
  } catch (err) {
    throw new Error(
      "Failed to get list of customers where phone is blank reason -->" +
        err.message
    );
  }
};

/**
 * Get customer phone number
 * @param {string} shop
 * @param {string} customerId
 * @returns
 */
const retrievePhoneNumberAgainstCustomer = async (shop, customerId) => {
  try {
    let maxRetries = 3;
    let retry = true;
    let customerData = null;
    if (!shop || !customerId) {
      throw new Error("Shop and customer id are required parameters");
    }
    while (retry && maxRetries > 0) {
      let ownerId = (customerId + "").includes("gid")
        ? customerId
        : `gid://shopify/Customer/${customerId}`;
      const { client } = await clientProvider.offline.graphqlClient({ shop });
      const query = `query($identifier: CustomerIdentifierInput!){
        customer: customerByIdentifier(identifier: $identifier){
          defaultAddress{
            phone
          }
          defaultPhoneNumber{
            phoneNumber
          }
        }
      }`;

      const { data, errors, extensions } = await client.request(query, {
        variables: {
          identifier: {
            id: ownerId,
          },
        },
      });
      if (errors && errors.length > 0) {
        console.log(
          "Failed to get variant data from shopify retrying query again"
        );
        maxRetries--;
      }
      if (extensions.cost.throttleStatus.currentlyAvailable < 400) {
        await new Promise((res, rej) => {
          setTimeout(() => {
            console.log(
              "🕚 Max query size was reached so we waited one second"
            );
            res(true);
          }, 1000);
        });
      }
      retry = false;
      customerData = data?.customer;
    }
    return customerData;
  } catch (err) {
    throw new Error(
      "Failed to retrieve phone number for customer reason -->" + err.message
    );
  }
};

const updateCustomerWithEmptyPhoneField = async () => {
  try {
    const cashbackModel = await cashbackModels();
    const customersList = await getListOfCustomersWherePhoneIsBlank();
    console.log(
      "updating customer numbers current count is 👉" + customersList.length
    );
    const shop =
      process.env.NODE_ENV == "dev"
        ? "swiss-local-dev.myshopify.com"
        : "swiss-beauty-dev.myshopify.com";
    for (let i = 0; i < customersList.length; i++) {
      let customer = customersList[i];
      try {
        const customerDetails = await retrievePhoneNumberAgainstCustomer(
          shop,
          customer.customerId
        );
        let phoneNumber =
          customerDetails.defaultAddress?.phone ||
          customerDetails.defaultPhoneNumber?.phoneNumber ||
          null;

        if (phoneNumber) {
          let normalisedPhoneNumber = phoneNumber.includes("+91")
            ? phoneNumber
            : `+91${phoneNumber}`;
          await cashbackModel.Customer.findOneAndUpdate(
            { customerId: customer.customerId },
            {
              phone: normalisedPhoneNumber,
            }
          );
        }
      } catch (err) {
        console.log(
          "Failed to update customer phone number reason -->",
          err.message
        );
      }
    }
  } catch (err) {
    console.log(
      "Failed to update customer with empty phone field reason -->" +
        err.message
    );
  }
};

/**
 * @param {object} payload - order object
 */
const assignCashbackPendingAssignedToCustomer = async (payload) => {
  const cashbackModel = await cashbackModels();
  const session = await cashbackModel.conn.startSession();
  try {
    session.startTransaction();
    if (!payload) {
      throw new Error("Payload can't be balnk");
    }
    const customer = payload.customer;
    let allocatedPoint = null;
    const customerId = customer.id;
    let cashbackConfig = await cashbackModel.Settings.findOne({})
      .lean()
      .session(session);
    let orderAllocationType = cashbackConfig.order_allocation.type;
    let orderAllocationValue = cashbackConfig.order_allocation.value;
    let customerWallet = await cashbackModel.Wallet.findOne({
      customerId: customerId,
    })
      .lean()
      .session(session);
    // checking if order already processed for cashback
    const checkExistingTransaction = await cashbackModel.Transaction.findOne({
      orderId: payload.id,
      type: "credit",
    })
      .lean()
      .session(session);
    if (checkExistingTransaction || !customerId) {
      throw new Error("Multiple cashback allocation for same order detected");
    }
    // if customer wallet not found register customer
    if (!customerWallet) {
      let newCustomer = new cashbackModel.Customer({
        customerId: customer.id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        phone: customer.phone,
        email: customer.email,
      });
      await newCustomer.save({ session });
      let newWallet = new cashbackModel.Wallet({
        customerId: customer.id,
        points: [],
        balance: 0,
      });
      let savedWallet = await newWallet.save({ session });
      customerWallet = savedWallet.toObject();
    }
    // check if any cb discount was utilised for order
    let orderDiscountCodes = (payload.discount_codes || [])
      .map((el) => el.code)
      .filter(Boolean);
    const escapeRegex = (str = "") =>
      String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = orderDiscountCodes.map(
      (c) => new RegExp(`^${escapeRegex(c)}$`, "i")
    );
    let cbDiscount = await cashbackModel.CashbackDiscount.findOne({
      status: "active",
      title: { $in: patterns },
    })
      .session(session)
      .lean();
    let toAssignCashbackAmount = 0;
    if (cbDiscount) {
      let cashbackAssignAmount = 0;
      const discountType = cbDiscount.type;
      if (discountType == "fixed") {
        cashbackAssignAmount = cbDiscount.value;
      } else {
        cashbackAssignAmount =
          (Number(payload.subtotal_price) * cbDiscount.value) / 100;
      }
      // in case discount code allows order above application we'll add up the amount
      if (cbDiscount.orderAboveApplication) {
        if (orderAllocationType == "fixed") {
          cashbackAssignAmount += Number(orderAllocationValue);
        } else {
          cashbackAssignAmount +=
            (Number(payload.subtotal_price) * orderAllocationValue) / 100;
        }
      }
      toAssignCashbackAmount = cashbackAssignAmount;
    } else {
      if (orderAllocationType == "fixed") {
        toAssignCashbackAmount += Number(orderAllocationValue);
      } else {
        toAssignCashbackAmount +=
          (Number(payload.subtotal_price) * orderAllocationValue) / 100;
      }
    }

    // check if after assigning cashback amount wallet balance breaches the max allocation
    if (
      customerWallet.balance + toAssignCashbackAmount >=
      cashbackConfig.max_cashback
    ) {
      toAssignCashbackAmount =
        Number(cashbackConfig.max_cashback || 0) -
        Number(customerWallet.balance || 0);
    }
    toAssignCashbackAmount = Math.round(toAssignCashbackAmount);

    // if customer's wallet amount exceeds the cashback limit don't credit just create a transaction
    if (customerWallet.balance >= cashbackConfig.max_cashback) {
      // creating corresponding transaction
      const newTransaction = new cashbackModel.Transaction({
        walletId: customerWallet._id,
        status: "cancelled",
        type: "credit",
        orderId: payload.id,
        orderName: payload.order_number,
        closingBalance: customerWallet.balance,
        amount: toAssignCashbackAmount,
        note: `Wallet amount reached max cashback value ${cashbackConfig.max_cashback}`,
      });
      const correspondingTransaction = await newTransaction.save({ session });
    } else {
      //creating corresponding point
      const newPoint = new cashbackModel.Point({
        customerId: customer.id,
        orders: [
          {
            id: payload.id,
            type: "credit",
            amount: toAssignCashbackAmount,
          },
        ],
        amount: toAssignCashbackAmount,
        walletId: customerWallet._id,
        status: "pending",
        expiresOn: new Date(
          Date.now() + cashbackConfig.expiry_period * 24 * 60 * 60 * 1000
        ),
      });
      const correspondingPoint = await newPoint.save({ session });

      // creating corresponding transaction
      const newTransaction = new cashbackModel.Transaction({
        walletId: customerWallet._id,
        status: "pending",
        type: "credit",
        orderId: payload.id,
        orderName: payload.order_number,
        closingBalance: customerWallet.balance,
        amount: toAssignCashbackAmount,
        note: `Cashback credit on order ${payload.order_number}`,
      });
      const correspondingTransaction = await newTransaction.save({ session });
      allocatedPoint = correspondingPoint;
    }
    await session.commitTransaction();
    if (allocatedPoint) {
      // server event for cashback pending assigned
      createCashbackPendingAssignedEvent(
        allocatedPoint._id.toString(),
        payload
      );
    }
  } catch (err) {
    await session.abortTransaction();
    throw new Error(
      "Failled to assign cashback pending assigned reason -->" + err.message
    );
  } finally {
    session.endSession();
  }
};

/**
 *
 * @param {string} shop - shopify store handle
 * @param {string} orderId - shopify order id
 */
const customerDetailsViaOrderId = async (shop, orderId) => {
  try {
    if (!orderId || !shop) {
      throw new Error("Required parameters missing");
    }
    let maxRetries = 3;
    let customerData = null;
    while (maxRetries > 0) {
      const normalisedOrderId = (orderId + "").includes("gid")
        ? orderId
        : `gid://shopify/Order/${orderId}`;
      const { client } = await clientProvider.offline.graphqlClient({ shop });
      const query = `query GetCustomerByOrderId($orderId: ID!){
        orderByIdentifier(identifier: {id: $orderId}){
          id
          customer{
            id
          }
        }
      }`;
      const { data, errors, extensions } = await client.request(query, {
        variables: {
          orderId: normalisedOrderId,
        },
      });
      if (errors && errors.length > 0) {
        await new Promise((res, rej) => {
          setTimeout(() => {
            console.log("making another attempt");
            res(true);
          }, 600);
        });
        maxRetries--;
      }
      customerData = data.orderByIdentifier.customer;
      maxRetries = 0;
    }
    return customerData;
  } catch (err) {
    throw new Error(
      "Failed to get customer details via order id reason -->" + err.message
    );
  }
};

const markPendingCashbackToReady = async (payload) => {
  const cashbackModel = await cashbackModels();
  console.log("marking cashback pending assign to ready 👀");
  const session = await cashbackModel.conn.startSession();
  try {
    session.startTransaction();

    if (!payload?.order_id) {
      throw new Error("Order id not provided");
    }

    const customer = await customerDetailsViaOrderId(
      payload.shop,
      payload.order_id
    );
    if (!customer?.id) {
      throw new Error("Failed to retrieve customer id");
    }

    const removeGidCustomerId = customer.id.replace(
      "gid://shopify/Customer/",
      ""
    );

    let cashbackConfig = await cashbackModel.Settings.findOne({})
      .lean()
      .session(session);
    // Point update pending -> ready
    const pointUpdate = await cashbackModel.Point.findOneAndUpdate(
      {
        status: "pending",
        orders: { $size: 1 },
        "orders.0.id": Number(payload.order_id),
      },
      {
        status: "ready",
        expiresOn: new Date(
          Date.now() + cashbackConfig.expiry_period * 24 * 60 * 60 * 1000
        ),
      },
      {
        session: session,
        new: true,
      }
    ).lean();
    console.log(pointUpdate, "here this is the point update");
    if (!pointUpdate) {
      await session.commitTransaction();
      return;
    }
    // wallet update with point balance and insertion
    const walletUpdate = await cashbackModel.Wallet.updateOne(
      { customerId: Number(removeGidCustomerId) },
      {
        $inc: { balance: pointUpdate.amount },
        $push: { points: { id: String(pointUpdate._id) } },
      },
      {
        session: session,
      }
    );
    const updatedWallet = await cashbackModel.Wallet.findOne(
      { customerId: Number(removeGidCustomerId) },
      null,
      { session }
    );

    // marking transaction as complete
    const transactionUpdate = await cashbackModel.Transaction.updateOne(
      {
        orderId: payload.order_id,
        type: "credit",
      },
      {
        status: "completed",
        closingBalance: updatedWallet.balance,
      },
      { session: session }
    ).lean();
    await session.commitTransaction();
    createCashbackAssignedEvent(
      pointUpdate._id,
      payload.order_id,
      payload.shop
    );
    cashbackCreditedEventInMoe(pointUpdate._id, payload.shop);
    handleCashbackUpdateForMoe(pointUpdate._id, payload.shop);
    console.log("Cashback assigned to user ✅");
  } catch (err) {
    console.log(
      "Failed to mark pending cashback to ready reason -->" + err.message
    );
    await session.abortTransaction();
    throw new Error(
      "Failed to mark pending cashback to ready reason -->" + err.message
    );
  } finally {
    session.endSession();
  }
};
/**
 *
 * @param {object} payload
 */
const debitCashbackOnUtilisation = async (payload) => {
  const cashbackModel = await cashbackModels();
  const session = await cashbackModel.conn.startSession();
  try {
    session.startTransaction();
    const orderId = payload.id;
    if (!payload || !orderId) {
      throw new Error("Required parameters missing");
    }
    const orderTransactions = await getCashbackUsedInOrderViaOrderTransaction(
      payload.shop,
      orderId
    );
    const isCashbackUtilised = orderTransactions.find(
      (el) => el.gateway == "Cashback"
    );
    if (!isCashbackUtilised) {
      return;
    }
    const utilisedAmount = Number(isCashbackUtilised?.amount || 0);
    if (utilisedAmount <= 0) {
      return;
    }
    const debit = await debitCashbackUtilisedNearestExpiry(
      payload,
      isCashbackUtilised.amount
    );
    createCashbackUtilisedEvent(debit.breakdown, debit.debited, payload);
    handleCashbackUpdateForMoe(debit.breakdown[0].pointId, payload.shop);
  } catch (err) {
    throw new Error(
      "Failed to debit cashback on utilisation reason -->" + err.message
    );
  }
};

const debitCashbackUtilisedNearestExpiry = async (payload, usedAmount) => {
  const cashbackModel = await cashbackModels();
  const session = await cashbackModel.conn.startSession();

  try {
    session.startTransaction();

    if (!payload) throw new Error("Payload can't be blank");
    if (!usedAmount || Number(usedAmount) <= 0)
      throw new Error("Invalid usedAmount");

    const customer = payload.customer;
    const customerId = customer?.id;
    if (!customerId) throw new Error("Customer id missing");

    const existingDebit = await cashbackModel.Transaction.findOne({
      orderId: payload.id,
      type: "debit",
    })
      .lean()
      .session(session);

    if (existingDebit) {
      throw new Error("Multiple cashback debit for same order detected");
    }
    const cashbackConfig = await cashbackModel.Settings.findOne({})
      .lean()
      .session(session);
    let customerWallet = await cashbackModel.Wallet.findOne({
      customerId,
    }).session(session);

    if (!customerWallet) {
      // Create customer
      const newCustomer = new cashbackModel.Customer({
        customerId: customer.id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        phone: customer.phone,
        email: customer.email,
      });
      await newCustomer.save({ session });
      const newWallet = new cashbackModel.Wallet({
        customerId: customer.id,
        points: [],
        balance: 0,
      });
      customerWallet = await newWallet.save({ session });
    }

    const debitAmount = Math.round(Number(usedAmount));
    if (Number(customerWallet.balance || 0) < debitAmount) {
      throw new Error(
        `Insufficient wallet balance. Have ${customerWallet.balance}, need ${debitAmount}`
      );
    }
    const now = new Date();
    const points = await cashbackModel.Point.find({
      customerId,
      walletId: customerWallet._id,
      status: "ready",
      amount: { $gt: 0 },
      expiresOn: { $gt: now },
    })
      .sort({ expiresOn: 1, _id: 1 })
      .session(session);

    let remaining = debitAmount;
    const breakdown = [];

    // 2) Deduct across points
    for (const p of points) {
      if (remaining <= 0) break;

      const deduct = Math.min(Number(p.amount || 0), remaining);
      if (deduct <= 0) continue;
      const upd = await cashbackModel.Point.updateOne(
        { _id: p._id, amount: { $gte: deduct } },
        {
          $inc: { amount: -deduct },
          $push: {
            orders: {
              id: payload.id,
              type: "debit",
              amount: deduct,
            },
          },
        },
        { session }
      );

      if (upd.matchedCount !== 1) {
        throw new Error(
          "Point balance changed concurrently. Retry transaction."
        );
      }

      breakdown.push({
        pointId: p._id,
        expiresOn: p.expiresOn,
        deducted: deduct,
      });

      remaining -= deduct;
    }

    if (remaining > 0) {
      // Not enough eligible points (even if wallet says balance, keep it safe)
      throw new Error(
        `Insufficient eligible points to debit. Short by ${remaining}`
      );
    }

    // Decrement wallet balance
    const closingBalanceBeforeDebit = Number(customerWallet.balance || 0);

    const walletUpd = await cashbackModel.Wallet.updateOne(
      { _id: customerWallet._id, balance: { $gte: debitAmount } },
      { $inc: { balance: -debitAmount } },
      { session }
    );

    if (walletUpd.matchedCount !== 1) {
      throw new Error(
        "Wallet balance changed concurrently. Retry transaction."
      );
    }

    const newTransaction = new cashbackModel.Transaction({
      walletId: customerWallet._id,
      status: "completed",
      type: "debit",
      orderId: payload.id,
      orderName: payload.order_number,
      closingBalance: closingBalanceBeforeDebit - debitAmount,
      amount: debitAmount,
      note: `Cashback utilised on order ${payload.order_number}`,
    });

    await newTransaction.save({ session });

    await session.commitTransaction();

    return {
      debited: debitAmount,
      breakdown,
      wallet: walletUpd,
    };
  } catch (err) {
    await session.abortTransaction();
    throw new Error(
      "Failed to debit cashback utilised reason --> " + err.message
    );
  } finally {
    session.endSession();
  }
};

/**
 *
 * @param {string} shop - shopify store handle
 * @param {string} orderId - shopify order id
 * @returns
 */
const getCashbackUsedInOrderViaOrderTransaction = async (shop, orderId) => {
  try {
    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const shopifyOrderId = (orderId + "").includes("gid")
      ? orderId
      : "gid://shopify/Order/" + orderId;
    const query = `query{
      order(id: "${shopifyOrderId}"){
        transactions(first:50){
          gateway
          amountSet{
            shopMoney{
              amount
            }
          }
        }
      }
    }`;
    const request = await client.request(query);
    let data = request?.data?.order?.transactions;
    if (process.env.NODE_ENV == "dev") {
      data = [
        {
          gateway: "cash_on_delivery",
          amountSet: {
            shopMoney: {
              amount: "437.0",
            },
          },
        },
        {
          gateway: "Cashback",
          amountSet: {
            shopMoney: {
              amount: "60.0",
            },
          },
        },
      ];
    }
    const transactions = data.map((el) => ({
      gateway: el.gateway,
      amount: Number(el.amountSet?.shopMoney?.amount),
    }));
    return transactions;
  } catch (err) {
    throw new Error(
      "Failed to get cashback used in order via order order transaction reason -->" +
        err.message
    );
  }
};

const handleCashbackCancellation = async (payload) => {
  const cashbackModel = await cashbackModels();
  const session = await cashbackModel.conn.startSession();
  try {
    session.startTransaction();

    if (!payload?.id) throw new Error("Order id missing in payload");
    const orderId = payload.id;
    const orderName = payload.order_number;

    const customer = payload.customer;
    const customerId = customer?.id;
    if (!customerId) throw new Error("Customer id missing");

    const now = new Date();

    let customerWallet = await cashbackModel.Wallet.findOne({
      customerId,
    }).session(session);

    if (!customerWallet) {
      const newCustomer = new cashbackModel.Customer({
        customerId: customer.id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        phone: customer.phone,
        email: customer.email,
      });
      await newCustomer.save({ session });

      const newWallet = new cashbackModel.Wallet({
        customerId: customer.id,
        points: [],
        balance: 0,
      });
      customerWallet = await newWallet.save({ session });
    }
    const walletIdStr = String(customerWallet._id);

    const refundMarker = await cashbackModel.Transaction.findOne({
      orderId,
      walletId: walletIdStr,
      type: "credit",
      note: { $regex: /refund on cancellation/i },
    })
      .lean()
      .session(session);

    if (refundMarker) {
      await session.commitTransaction();
      return { ok: true, message: "Cancellation already processed" };
    }

    const debitTx = await cashbackModel.Transaction.findOne({
      orderId,
      walletId: walletIdStr,
      type: "debit",
      status: { $in: ["pending", "completed"] },
    }).session(session);

    let refundable = 0;
    let nonRefundableExpired = 0;

    if (debitTx) {
      const debitedAmount = Math.round(Number(debitTx.amount || 0));
      const usedPoints = await cashbackModel.Point.find({
        walletId: walletIdStr,
        customerId,
        "orders.id": orderId,
        "orders.type": "debit",
      }).session(session);

      for (const p of usedPoints) {
        const debitOrders = (p.orders || []).filter(
          (o) => o?.id === orderId && o?.type === "debit"
        );

        const usedFromThisPoint = Math.round(
          debitOrders.reduce((s, o) => s + Number(o.amount || 0), 0)
        );

        if (usedFromThisPoint <= 0) continue;

        const isExpired = p.expiresOn && new Date(p.expiresOn) <= now;

        if (isExpired) {
          nonRefundableExpired += usedFromThisPoint;
          continue;
        }

        const upd = await cashbackModel.Point.updateOne(
          { _id: p._id },
          {
            $inc: { amount: usedFromThisPoint },
            $push: {
              orders: {
                id: orderId,
                type: "credit",
                amount: usedFromThisPoint,
              },
            },
          },
          { session }
        );

        if (upd.matchedCount !== 1) {
          nonRefundableExpired += usedFromThisPoint;
          continue;
        }

        refundable += usedFromThisPoint;
      }
      const accounted = refundable + nonRefundableExpired;
      if (accounted < debitedAmount) {
        nonRefundableExpired += debitedAmount - accounted;
      }
      const balanceBeforeRefund = Number(customerWallet.balance || 0);
      const balanceAfterRefund = Number(customerWallet.balance + refundable);
      if (refundable > 0) {
        await cashbackModel.Wallet.updateOne(
          { _id: customerWallet._id },
          { $inc: { balance: refundable } },
          { session }
        );

        await new cashbackModel.Transaction({
          walletId: walletIdStr,
          status: "completed",
          type: "credit",
          orderId,
          orderName,
          closingBalance: balanceAfterRefund,
          amount: refundable,
          note: `Cashback refund on cancellation of order ${orderName}`,
        }).save({ session });
      } else {
        await new cashbackModel.Transaction({
          walletId: walletIdStr,
          status: "expired",
          type: "credit",
          orderId,
          orderName,
          closingBalance: balanceBeforeRefund,
          amount: 0,
          note: `Cashback refund on cancellation of order ${orderName} (0 refundable)`,
        }).save({ session });
      }

      if (nonRefundableExpired > 0) {
        await new cashbackModel.Transaction({
          walletId: walletIdStr,
          status: "expired",
          type: "credit",
          orderId,
          orderName,
          closingBalance: Number(customerWallet.balance || 0), // after refundable credit if any
          amount: nonRefundableExpired,
          note: `Cashback refund on cancellation blocked due to expired/missing points for order ${orderName}`,
        }).save({ session });
      }
      await cashbackModel.Transaction.updateOne(
        { _id: debitTx._id },
        {
          $set: {
            status: "cancelled",
            note: `${debitTx.note || ""} | Cancelled due to order cancellation`,
          },
        },
        { session }
      );
    }
    await cashbackModel.Transaction.updateOne(
      {
        orderId,
        walletId: walletIdStr,
        type: "credit",
        status: "pending",
      },
      {
        $set: {
          status: "cancelled",
          note: `Cashback credit cancelled due to order cancellation (${orderName})`,
        },
      },
      { session }
    );

    await cashbackModel.Point.updateOne(
      {
        walletId: walletIdStr,
        customerId,
        status: "pending",
        "orders.id": orderId,
        "orders.type": "credit",
      },
      {
        $set: { status: "cancelled" },
      },
      { session }
    );

    await session.commitTransaction();
    return {
      ok: true,
      message: "Cancellation cashback handling completed",
      refundableCreditedToWallet: refundable,
      nonRefundableExpired,
    };
  } catch (err) {
    await session.abortTransaction();
    throw new Error(
      "Failed to handle cancellation cashback reason --> " + err.message
    );
  } finally {
    session.endSession();
  }
};

const handleCashbackRefund = async (payload) => {
  const cashbackModel = await cashbackModels();
  const session = await cashbackModel.conn.startSession();

  try {
    const orderId = payload?.order_id;
    if (!payload || !orderId) throw new Error("Required params missing");

    session.startTransaction();

    const customerId = await getCustomerIdViaOrderId(payload.shop, orderId);
    if (!customerId) throw new Error("No customer id found for the order");

    const cashbackRefundTransaction = (payload.transactions || []).find(
      (el) => el?.kind === "refund" && el?.gateway === "Cashback"
    );

    const cashbackRefundAmountRaw =
      process.env.NODE_ENV === "dev"
        ? 100
        : Number(cashbackRefundTransaction?.amount || 0);

    let cashbackRefundAmount = Math.round(Number(cashbackRefundAmountRaw || 0));
    console.log(cashbackRefundAmount, "here is the refund amount");
    if (cashbackRefundAmount <= 0) {
      await session.commitTransaction();
      return { ok: true, message: "No cashback refund amount was found" };
    }

    const cashbackConfig = await cashbackModel.Settings.findOne({})
      .lean()
      .session(session);

    if (!cashbackConfig) throw new Error("Cashback settings not found");

    let customerWallet = await cashbackModel.Wallet.findOne({
      customerId,
    }).session(session);

    if (!customerWallet) {
      await new cashbackModel.Customer({ customerId }).save({ session });

      customerWallet = await new cashbackModel.Wallet({
        customerId,
        points: [],
        balance: 0,
      }).save({ session });
    }

    const walletIdStr = String(customerWallet._id);

    const existingRefundPoint = await cashbackModel.Point.findOne({
      walletId: walletIdStr,
      customerId: Number(customerId),
      "orders.id": Number(orderId),
      "orders.type": "credit",
      status: "ready",
    })
      .lean()
      .session(session);

    const existingRefundTx = await cashbackModel.Transaction.findOne({
      walletId: walletIdStr,
      orderId: Number(orderId),
      type: "credit",
      note: { $regex: /cashback refund credited/i },
    })
      .lean()
      .session(session);

    if (existingRefundPoint || existingRefundTx) {
      await session.commitTransaction();
      return { ok: true, message: "Refund already processed" };
    }

    const currentBalance = Number(customerWallet.balance || 0);
    const maxCashback = Number(cashbackConfig.max_cashback || 0);

    if (maxCashback > 0) {
      if (currentBalance >= maxCashback) {
        await new cashbackModel.Transaction({
          walletId: walletIdStr,
          status: "cancelled",
          type: "credit",
          orderId: Number(orderId),
          orderName: payload.order_name || payload.orderNumber || "",
          closingBalance: currentBalance,
          amount: cashbackRefundAmount,
          note: `Cashback refund skipped: wallet reached max cashback ${maxCashback}`,
        }).save({ session });

        await session.commitTransaction();
        return { ok: true, message: "Wallet max reached, refund not credited" };
      }

      if (currentBalance + cashbackRefundAmount > maxCashback) {
        cashbackRefundAmount = Math.max(
          0,
          Math.round(maxCashback - currentBalance)
        );
      }
    }

    if (cashbackRefundAmount <= 0) {
      await session.commitTransaction();
      return { ok: true, message: "Refund amount became 0 after max cap" };
    }

    const expiryDays = Number(cashbackConfig.expiry_period || 0);
    const expiresOn = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

    const refundPoint = await new cashbackModel.Point({
      customerId: Number(customerId),
      walletId: walletIdStr,
      status: "ready",
      amount: cashbackRefundAmount,
      expiresOn,
      orders: [
        {
          id: Number(orderId),
          type: "credit",
          amount: cashbackRefundAmount,
        },
      ],
    }).save({ session });

    const walletUpd = await cashbackModel.Wallet.updateOne(
      { _id: customerWallet._id },
      {
        $inc: { balance: cashbackRefundAmount },
        $push: { points: { id: String(refundPoint._id) } },
      },
      { session }
    );

    if (walletUpd.matchedCount !== 1) {
      throw new Error("Failed to update wallet balance");
    }

    await new cashbackModel.Transaction({
      walletId: walletIdStr,
      status: "completed",
      type: "credit",
      orderId: Number(orderId),
      orderName: payload.order_name || payload.orderNumber || "",
      closingBalance: currentBalance + cashbackRefundAmount,
      amount: cashbackRefundAmount,
      note: `Cashback refund credited for order ${payload.order_name || orderId}`,
    }).save({ session });

    await session.commitTransaction();
    return {
      ok: true,
      credited: cashbackRefundAmount,
      pointId: refundPoint?._id,
      message: "Cashback refund credited successfully",
    };
  } catch (err) {
    await session.abortTransaction();
    throw new Error(
      "Failed to handle cashback refund reason --> " + err.message
    );
  } finally {
    session.endSession();
  }
};

/**
 *
 * @param {string} shop - shopify store handle
 * @param {string} orderId - shopify order id
 * @returns
 */
const getCustomerIdViaOrderId = async (shop, orderId) => {
  try {
    const normalisedOrderId = (orderId + "").includes("gid")
      ? orderId
      : `gid://shopify/Order/${orderId}`;
    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const query = `query CustomerIdByOrderId($orderId: ID!){
      order(id: $orderId){
        id
        customer{
          id
        }
      }
    }`;
    const { data, errors, extensions } = await client.request(query, {
      variables: {
        orderId: normalisedOrderId,
      },
    });
    if (errors && errors.length > 0) {
      throw new Error("Failed to retrieve customer id");
    }
    return data?.order?.customer?.id?.replace("gid://shopify/Customer/", "");
  } catch (err) {
    throw new Error(
      "failed to get customer id via order id reason -->" + err.message
    );
  }
};

/**
 *
 * @typedef {object} payload
 * @property {string} phone - customer phone number
 * @property {Number} amount - cashback amount
 * @property {string} expiresOn - cashback expiry time
 *
 */

const handleManualCashbackDistribution = async ({
  phone,
  amount,
  expiresOn,
  note = "Manual cashback credit",
}) => {
  const cashbackModel = await cashbackModels();
  const session = await cashbackModel.conn.startSession();
  const normalizeToE164IndiaLoose = (phoneRaw) => {
    const p = String(phoneRaw ?? "").trim();
    if (!p) throw new Error("phone is required");

    const cleaned = p.replace(/\s+/g, "");

    if (/^\+91\d{10}$/.test(cleaned)) return cleaned;
    if (/^\d{10}$/.test(cleaned)) return `+91${cleaned}`;
    if (/^91\d{10}$/.test(cleaned)) return `+${cleaned}`;

    throw new Error(
      `Invalid phone: "${p}" (expected +91XXXXXXXXXX or 10 digits)`
    );
  };

  const parseAmount = (amountRaw) => {
    const s = String(amountRaw ?? "").trim();
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0)
      throw new Error(`Invalid amount: "${amountRaw}"`);
    return n;
  };

  const toDate = (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    if (!dt || Number.isNaN(dt.getTime()))
      throw new Error(`Invalid expiresOn: "${d}"`);
    return dt;
  };

  try {
    session.startTransaction();

    const rawPhone = String(phone ?? "").trim();
    const normalizedPhone = normalizeToE164IndiaLoose(rawPhone);
    const phoneCandidates = Array.from(new Set([rawPhone, normalizedPhone]));

    const safeAmount = parseAmount(amount);
    const safeExpiry = toDate(expiresOn);

    const customer = await cashbackModel.Customer.findOne({
      phone: { $in: phoneCandidates },
    })
      .lean()
      .session(session);

    if (!customer) {
      throw new Error(`Customer not found for phone: "${rawPhone}"`);
    }

    const wallet = await cashbackModel.Wallet.findOne({
      customerId: customer.customerId,
    }).session(session);

    if (!wallet) {
      throw new Error(
        `Wallet not found for customerId: ${customer.customerId}`
      );
    }

    // 3) Load settings for max cashback check
    const settings = await cashbackModel.Settings.findOne({})
      .lean()
      .session(session);

    const maxCashback = Number(settings?.max_cashback?.value ?? 0) || 0;

    if (maxCashback > 0) {
      const currentBalance = Number(wallet.balance ?? 0);
      if (currentBalance + safeAmount > maxCashback) {
        throw new Error(
          `Max cashback exceeded. Current balance=${currentBalance}, requested=${safeAmount}, max=${maxCashback}`
        );
      }
    }

    const pointDoc = await cashbackModel.Point.create(
      [
        {
          customerId: customer.customerId,
          walletId: String(wallet._id),
          amount: safeAmount,
          status: "ready",
          expiresOn: safeExpiry,
          orders: [],
        },
      ],
      { session }
    );

    const point = pointDoc[0];

    const updatedWallet = await cashbackModel.Wallet.findOneAndUpdate(
      { _id: wallet._id },
      {
        $push: { points: { id: String(point._id) } },
        $inc: { balance: safeAmount },
      },
      { new: true, session }
    );

    if (!updatedWallet) throw new Error("Failed to update wallet");

    const txnDoc = await cashbackModel.Transaction.create(
      [
        {
          walletId: String(wallet._id),
          status: "completed",
          type: "credit",
          amount: safeAmount,
          closingBalance: Number(updatedWallet.balance),
          note: note,
        },
      ],
      { session }
    );

    const txn = txnDoc[0];

    await session.commitTransaction();

    return {
      ok: true,
      customerId: customer.customerId,
      walletId: String(wallet._id),
      pointId: String(point._id),
      transactionId: String(txn._id),
      closingBalance: Number(updatedWallet.balance),
      normalizedPhone,
    };
  } catch (err) {
    await session.abortTransaction();
    throw new Error(
      "Failed to handle manual cashback distribution reason --> " + err.message
    );
  } finally {
    session.endSession();
  }
};

const getCustomersRedeemableValueBasedOnCart = async (payload) => {
  try {
    const customerPhoneIdentifier = payload?.id;
    const cashbackModel = await cashbackModels();

    if (!customerPhoneIdentifier) {
      throw new Error("Customer phone number not provided");
    }

    const normalisedPhoneNumber = normalizeIndianPhone(customerPhoneIdentifier);

    const phoneOr = [];
    if (normalisedPhoneNumber) phoneOr.push({ phone: normalisedPhoneNumber });
    phoneOr.push({ phone: String(customerPhoneIdentifier).trim() });

    const customer = await cashbackModel.Customer.findOne({
      $or: phoneOr,
    }).lean();
    if (!customer) return { balance: 0 };

    const wallet = await cashbackModel.Wallet.findOne({
      customerId: customer.customerId,
    }).lean();
    const walletBalance = Number(wallet?.balance || 0);

    const cartFinalAmount = Number(
      payload?.cart?.discount?.total_price ?? payload?.cart?.total_price ?? 0
    );

    const settings = await cashbackModel.Settings.findOne({}).lean();
    const usage = settings?.usage;
    if (!usage || usage.value == null || !usage.type) {
      return { balance: 0 };
    }

    let finalRedeemableAmount = 0;

    if (usage.type === "percentage") {
      const computed = (Number(usage.value) * cartFinalAmount) / 100;
      finalRedeemableAmount = Math.min(walletBalance, computed);
    } else {
      const usageValue = Number(usage.value);
      finalRedeemableAmount = Math.min(walletBalance, usageValue);
    }

    finalRedeemableAmount = Math.max(0, finalRedeemableAmount);

    return { balance: finalRedeemableAmount };
  } catch (err) {
    throw new Error(
      "Failed to get customers redeemable value based on cart reason --> " +
        err.message
    );
  }
};

export {
  updateCustomerWithEmptyPhoneField,
  assignCashbackPendingAssignedToCustomer,
  markPendingCashbackToReady,
  debitCashbackOnUtilisation,
  handleCashbackCancellation,
  handleCashbackRefund,
  handleManualCashbackDistribution,
  getCustomersRedeemableValueBasedOnCart,
};
