import clientProvider from "./clientProvider.js";

const METAFIELDS_SET_MUTATION = `#graphql
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        key
        namespace
        value
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const syncProductMetafields = async ({ shop, productId, stats }) => {
  const ownerId = productId.includes("gid")
    ? productId
    : `gid://shopify/Product/${productId}`;

  const metafields = [
    {
      ownerId,
      namespace: "reviews",
      key: "avg_rating",
      value: String(stats.avgRating ?? 0),
      type: "number_decimal",
    },
    {
      ownerId,
      namespace: "reviews",
      key: "total_reviews",
      value: String(stats.totalReviews ?? 0),
      type: "number_integer",
    },
    {
      ownerId,
      namespace: "reviews",
      key: "rating_1_count",
      value: String(stats.rating1Count ?? 0),
      type: "number_integer",
    },
    {
      ownerId,
      namespace: "reviews",
      key: "rating_2_count",
      value: String(stats.rating2Count ?? 0),
      type: "number_integer",
    },
    {
      ownerId,
      namespace: "reviews",
      key: "rating_3_count",
      value: String(stats.rating3Count ?? 0),
      type: "number_integer",
    },
    {
      ownerId,
      namespace: "reviews",
      key: "rating_4_count",
      value: String(stats.rating4Count ?? 0),
      type: "number_integer",
    },
    {
      ownerId,
      namespace: "reviews",
      key: "rating_5_count",
      value: String(stats.rating5Count ?? 0),
      type: "number_integer",
    },
    {
      ownerId,
      namespace: "reviews",
      key: "image_review_count",
      value: String(stats.imageReviewCount ?? 0),
      type: "number_integer",
    },
    {
      ownerId,
      namespace: "reviews",
      key: "video_review_count",
      value: String(stats.videoReviewCount ?? 0),
      type: "number_integer",
    },
    {
      ownerId,
      namespace: "reviews",
      key: "media_review_count",
      value: String(stats.mediaReviewCount ?? 0),
      type: "number_integer",
    },
  ];

  const { client } = await clientProvider.offline.graphqlClient({ shop });

  const { data, errors } = await client.request(METAFIELDS_SET_MUTATION, {
    variables: { metafields },
  });

  if (errors?.length > 0) {
    throw new Error(
      `Metafields mutation errors: ${errors.map((e) => e.message).join(", ")}`
    );
  }

  const userErrors = data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(
      `Metafield sync errors: ${userErrors.map((e) => e.message).join(", ")}`
    );
  }

  return data?.metafieldsSet?.metafields;
};

export default syncProductMetafields;
