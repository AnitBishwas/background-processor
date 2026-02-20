import mongoose from "mongoose";

import walletSchema from "@swiss-beauty/cashback-schema/src/schemas/Wallet.js";
import customerSchema from "@swiss-beauty/cashback-schema/src/schemas/Customer.js";
import pointSchema from "@swiss-beauty/cashback-schema/src/schemas/Point.js";
import transactionSchema from "@swiss-beauty/cashback-schema/src/schemas/Transaction.js";
import recordSchema from "@swiss-beauty/cashback-schema/src/schemas/Record.js";
import settingsSchema from "@swiss-beauty/cashback-schema/src/schemas/Settings.js";
import cashbackDiscountSchema from "@swiss-beauty/cashback-schema/src/schemas/CashbackDiscount.js";
import storefrontOfferSchema from "@swiss-beauty/cashback-schema/src/schemas/StorefrontOffer.js";
import orderSchema from "@swiss-beauty/cashback-schema/src/schemas/Order.js";

import { CASHBACK_COLLECTIONS } from "@swiss-beauty/cashback-schema/src/collectionsMaps.js";

let cachedConn = null;

const getCashbackConn = async () => {
  if (cachedConn) return cachedConn;

  const cashbackDbURI = process.env.CASHBACK_PROD_DB;
  if (!cashbackDbURI)
    throw new Error("Cashback db connection URI not provided");

  cachedConn = await mongoose
    .createConnection(cashbackDbURI, { maxPoolSize: 20 })
    .asPromise();
  console.log(
    "DB: here is our db's connection log 🕔",
    cachedConn.name,
    cachedConn.host
  );
  return cachedConn;
};

const cashbackModels = async () => {
  const conn = await getCashbackConn();

  const Wallet =
    conn.models.Wallet ||
    conn.model("Wallet", walletSchema, CASHBACK_COLLECTIONS.Wallet);

  const Transaction =
    conn.models.Transaction ||
    conn.model(
      "Transaction",
      transactionSchema,
      CASHBACK_COLLECTIONS.Transaction
    );

  const Point =
    conn.models.Point ||
    conn.model("Point", pointSchema, CASHBACK_COLLECTIONS.Point);

  const Settings =
    conn.models.Settings ||
    conn.model("Settings", settingsSchema, CASHBACK_COLLECTIONS.Settings);

  const StorefrontOffer =
    conn.models.StorefrontOffer ||
    conn.model(
      "StorefrontOffer",
      storefrontOfferSchema,
      CASHBACK_COLLECTIONS.StorefrontOffer
    );

  const Customer =
    conn.models.Customer ||
    conn.model("Customer", customerSchema, CASHBACK_COLLECTIONS.Customer);

  const Record =
    conn.models.Record ||
    conn.model("Record", recordSchema, CASHBACK_COLLECTIONS.Record);

  const CashbackDiscount =
    conn.models.CashbackDiscount ||
    conn.model(
      "CashbackDiscount",
      cashbackDiscountSchema,
      CASHBACK_COLLECTIONS.CashbackDiscount
    );

  const Order =
    conn.models.Order ||
    conn.model("Order", orderSchema, CASHBACK_COLLECTIONS.Order);

  return {
    conn,
    Wallet,
    Transaction,
    Point,
    Settings,
    StorefrontOffer,
    Customer,
    Record,
    CashbackDiscount,
    Order,
  };
};

export default cashbackModels;
