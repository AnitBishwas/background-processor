import e from "express";
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
            tags
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
const getBundleDetailsViaBundleVariant = async (shop, variantId) => {
  try {
    const normalisedVariantId = variantId.includes("gid")
      ? variantId
      : `gid://shopify/ProductVariant/${variantId}`;
    const query = `query GetBundleDetails($ownerId: ID!){
        productVariant(id: $ownerId){
          id
          compareAtPrice
          displayName
          inventoryQuantity
          price
          product{
            id
            title 
            tags
          }
        } 
    }`;
    const variables = {
      ownerId: normalisedVariantId,
    };
    const { client } = await clientProvider.offline.graphqlClient({ shop });
    const { data, extensions, errors } = await client.request(query, {
      variables,
    });
    if (errors && errors.length > 0) {
      throw new Error(
        "Failed to get bundle details reason -->" + errors.join(",")
      );
    }
    const componentDetails = await getBundleItems(client, normalisedVariantId);
    const mappedData = {
      title: data.productVariant.displayName,
      id: data.productVariant.product.id.replace("gid://shopify/Product/", ""),
      mrp: data.productVariant.compareAtPrice,
      price: data.productVariant.price,
      tags_v2: data.productVariant.product.tags.join(","),
      ["currentInventory"]: data.productVariant.inventoryQuantity,
      items: componentDetails,
    };
    return mappedData;
  } catch (err) {
    throw new Error(
      "Failed to retrieve bundle details reason -->" + err.message
    );
  }
};
const getBundleItems = async (client, variantId) => {
  try {
    let compiledList = [];
    const normalisedVariantId = variantId.includes("gid")
      ? variantId
      : `gid://shopify/ProductVariant/${variantId}`;
    let next = false;
    do {
      const query = `query GetItemsList($ownerId: ID!, $after: String){
        productVariant(id: $ownerId){
          productVariantComponents(first:5, after:$after){
            edges{
              node{
                productVariant{
                  barcode
                  title
                  compareAtPrice
                  displayName
                  id
                  inventoryQuantity
                  price
                  sku
                  product{
                    id
                    tags 
                  } 
                }

              } 
            }
            pageInfo{
              hasNextPage
              endCursor 
            }
          } 
        } 
      }`;
      const variables = {
        ownerId: normalisedVariantId,
      };
      if (next) {
        variables["after"] = next;
      }
      const { data, extensions, errors } = await client.request(query, {
        variables,
      });
      if (errors && errors.length > 0) {
        throw new Error(
          "Failed to get bundle items reason -->",
          errors.join(",")
        );
      }
      let mappedData = data.productVariant.productVariantComponents.edges.map(
        ({ node }, index) => ({
          variantId: node.productVariant.id.replace(
            "gid://shopify/ProductVariant/",
            ""
          ),
          ean: node.productVariant.barcode,
          mrp: node.productVariant.compareAtPrice,
          price: node.productVariant.price,
          sku: node.productVariant.sku,
          title: node.productVariant.displayName,
          productId: node.productVariant.product.id.replace(
            "gid://shopify/Product/",
            ""
          ),
          currentInventory: node.productVariant.inventoryQuantity,
          tags_v2: node.productVariant.product.tags.join(","),
          variant: node.productVariant.title,
        })
      );
      compiledList = [...compiledList, ...mappedData];
      if (data.productVariant.productVariantComponents.pageInfo.hasNextPage) {
        next = data.productVariant.productVariantComponents.pageInfo.nextCursor;
      }
    } while (next);
    return compiledList;
  } catch (err) {
    throw new Error("Failed to get bundle items reason -->" + err.message);
  }
};
export { getProductVariantDataFromShopify, getBundleDetailsViaBundleVariant };
