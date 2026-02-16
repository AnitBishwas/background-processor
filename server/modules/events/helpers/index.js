import clientProvider from "../../../../utils/clientProvider.js";

const getOrderDetailsFromShopify = async (orderId, shop) => {
  try {
    let maxRetries = 5;
    let orderData = {};
    while (maxRetries > 0) {
      const normalisedOrderId = (orderId + "").includes("gid")
        ? orderId
        : `gid://shopify/Order/${orderId}`;
      const { client } = await clientProvider.offline.graphqlClient({ shop });
      const query = `query OrderDetailsById($id: ID!){
                order(id: $id){
                    id
                    name
                    createdAt
                    totalDiscountsSet{
                        presentmentMoney{
                            amount
                        }
                    }
                    totalPriceSet{
                        presentmentMoney{
                            amount
                        }
                    }
                    customAttributes{
                        key
                        value
                    }
                    discountCodes
                }
            }`;
      const { data, errors, extensions } = await client.request(query, {
        variables: {
          id: normalisedOrderId,
        },
      });
      if (errors && errors.length > 0) {
        maxRetries--;
        await new Promise((res, rej) => {
          setTimeout(() => {
            res(true);
          }, 600);
        });
      } else {
        orderData = {
          name: data.order.name,
          id: data.order.id.replace("gid://shopify/Order/", ""),
          discountCodes: data.order?.discountCodes || [],
          subTotalPrice:
            Number(
              data.order?.totalDiscountsSet?.presentmentMoney?.amount || 0
            ) +
            Number(data.order?.totalPriceSet?.presentmentMoney?.amount || 0),
          totalPrice: Number(
            data.order?.totalPriceSet?.presentmentMoney?.amount
          ),
          note_attributes: data.order.customAttributes,
        };
        maxRetries = 0;
      }
    }
    return orderData;
  } catch (err) {
    throw new Error(
      "Failed to get shopify order details reason -->" + err.message
    );
  }
};
export { getOrderDetailsFromShopify };
