import cashbackModels from "../../../../utils/cashbackModelProvider.js";
import clientProvider from "../../../../utils/clientProvider.js";

const handleAccountMergeCashback = async (data) => {
  const cashbackModel = await cashbackModels();
  const session = await cashbackModel.conn.startSession();
  try {
    const { shop, payload } = data;
    if (
      !payload?.admin_graphql_api_customer_kept_id ||
      !payload?.admin_graphql_api_customer_deleted_id
    ) {
      throw new Error("Payload missing");
    }
    if (payload.status !== "completed" || payload.errors?.length > 0) {
      throw new Error(
        `Account merge did not complete successfully: ${JSON.stringify(payload.errors)}`
      );
    }

    const deletedCustomerId = Number(
      payload.admin_graphql_api_customer_deleted_id.replace(
        "gid://shopify/Customer/",
        ""
      )
    );
    const keptCustomerId = Number(
      payload.admin_graphql_api_customer_kept_id.replace(
        "gid://shopify/Customer/",
        ""
      )
    );

    const [deletedWallet, keptWallet] = await Promise.all([
      cashbackModel.Wallet.findOne({ customerId: deletedCustomerId }).lean(),
      cashbackModel.Wallet.findOne({ customerId: keptCustomerId }).lean(),
    ]);

    // Deleted customer has no wallet — nothing to merge
    if (!deletedWallet) return;

    // Fetch kept customer info from Shopify before entering the transaction
    // (HTTP calls must not hold Mongo transaction locks)
    const keptCustomerInfo = await pullCustomerInfoFromShopify(
      shop,
      keptCustomerId
    );
    if (!keptCustomerInfo) throw new Error("Kept customer not found in Shopify");
    const keptCustomerFields = {
      customerId: keptCustomerId,
      firstName: keptCustomerInfo.firstName,
      lastName: keptCustomerInfo.lastName,
      phone:
        keptCustomerInfo.defaultPhoneNumber?.phoneNumber ??
        keptCustomerInfo.defaultAddress?.phone,
      email: keptCustomerInfo.defaultEmailAddress?.emailAddress,
    };

    await session.withTransaction(async () => {
      if (!keptWallet) {
        // Deleted has wallet, kept has none — reassign wallet ownership to kept customer
        await cashbackModel.Wallet.updateOne(
          { _id: deletedWallet._id },
          { $set: { customerId: keptCustomerId } },
          { session }
        );
        await cashbackModel.Point.updateMany(
          { walletId: deletedWallet._id.toString() },
          { $set: { customerId: keptCustomerId } },
          { session }
        );
        // Reassign the deleted customer's doc to the kept customer with their Shopify details
        // upsert: true ensures a Customer doc is created if none existed for the deleted customer
        await cashbackModel.Customer.updateOne(
          { customerId: deletedCustomerId },
          { $set: keptCustomerFields },
          { session, upsert: true }
        );
      } else {
        // Both have wallets — merge deleted wallet into kept wallet
        await cashbackModel.Wallet.updateOne(
          { _id: keptWallet._id },
          {
            $inc: { balance: deletedWallet.balance },
            $push: { points: { $each: deletedWallet.points } },
          },
          { session }
        );
        await cashbackModel.Point.updateMany(
          { walletId: deletedWallet._id.toString() },
          {
            $set: {
              walletId: keptWallet._id.toString(),
              customerId: keptCustomerId,
            },
          },
          { session }
        );
        await cashbackModel.Transaction.updateMany(
          { walletId: deletedWallet._id.toString() },
          { $set: { walletId: keptWallet._id.toString() } },
          { session }
        );
        await cashbackModel.Wallet.deleteOne(
          { _id: deletedWallet._id },
          { session }
        );
        await cashbackModel.Customer.deleteOne(
          { customerId: deletedCustomerId },
          { session }
        );
        // Refresh kept customer's details with latest Shopify data
        // upsert: true ensures a Customer doc is created if none existed for the kept customer
        await cashbackModel.Customer.updateOne(
          { customerId: keptCustomerId },
          { $set: keptCustomerFields },
          { session, upsert: true }
        );
      }
    });
  } catch (err) {
    throw new Error(
      "Failed to handle account merge cashback reason -->" + err.message
    );
  } finally {
    await session.endSession();
  }
};

const pullCustomerInfoFromShopify = async (shop, customerId) => {
  try {
    const normalisedCustomerId = `gid://shopify/Customer/${customerId}`;
    const query = `query GetCustomerInfo($ownerId: ID!){
            customer(id: $ownerId){
                firstName
                lastName
                defaultPhoneNumber{
                    phoneNumber
                }
                defaultEmailAddress{
                    emailAddress
                }
                defaultAddress{
                    phone
                }
            }
        }`;
    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const { data, errors } = await client.request(query, {
      variables: {
        ownerId: normalisedCustomerId,
      },
    });
    if (errors) throw new Error(JSON.stringify(errors));
    return data.customer;
  } catch (err) {
    throw new Error(
      "Failed to pull customer Info from shopify reason -->" + err.message
    );
  }
};

export { handleAccountMergeCashback };



