import clientProvider from "../../../utils/clientProvider.js";

/**
 * @param {string} shop - shopify store handle Ex : swiss-local-dev.myshopify.com
 * @param {string} variantId - shopify variant id
 */
const getProductVariantDataFromShopify = async (shop, variantId) => {
  try {
    let maxRetries = 3;
    let retry = true;
    let variantData = null;
    if (!shop || !variantId) {
      throw new Error("Shop and variant id are required parameters");
    }
    while (retry && maxRetries > 0) {
      let ownerId = (variantId + "").includes("gid")
        ? variantId
        : `gid://shopify/ProductVariant/${variantId}`;
      const { client } = await clientProvider.offline.graphqlClient({ shop });
      const query = `query ProductVariantData($ownerId : ID!){
        productVariant(id: $ownerId){
          id
          barcode
          compareAtPrice
          product{
            title
          }
          price
          sku
          inventoryQuantity
        }
      }`;
      const { data, errors, extensions } = await client.request(query, {
        variables: {
          ownerId,
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
      variantData = data?.productVariant;
    }
    return variantData;
  } catch (err) {
    throw new Error(
      "Failed to get product variant data from shopify reason -->" + err.message
    );
  }
};
export { getProductVariantDataFromShopify };
