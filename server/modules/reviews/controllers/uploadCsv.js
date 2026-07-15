import { v4 as uuidv4 } from "uuid";
import csvParser from "csv-parser";
import AWS from "aws-sdk";
import reviewModels from "../../../../utils/reviewModelProvider.js";
import clientProvider from "../../../../utils/clientProvider.js";
import syncProductMetafields from "../../../../utils/syncProductMetafields.js";

AWS.config.update({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_KEY,
});

const s3 = new AWS.S3();

// CSV column → internal field mapping:
// title, body, rating, review_date, source, curated,
// reviewer_name, reviewer_email, product_id, product_handle

const isTruthy = (val) =>
  ["true", "1", "yes"].includes(String(val).toLowerCase().trim());

const parseReviewDate = (val) => {
  if (!val?.trim()) return null;
  const d = new Date(val.trim());
  return isNaN(d.getTime()) ? null : d;
};

const validateRow = (row) => {
  const errors = [];

  if (!row.product_id?.trim() && !row.product_handle?.trim())
    errors.push("Missing: product_id or product_handle");
  if (!row.reviewer_name?.trim()) errors.push("Missing: reviewer_name");
  if (!row.rating?.toString().trim()) errors.push("Missing: rating");
  if (!row.title?.trim()) errors.push("Missing: title");
  if (!row.body?.trim()) errors.push("Missing: body");

  if (errors.length === 0) {
    const rating = Number(row.rating);
    if (isNaN(rating) || rating < 1 || rating > 5)
      errors.push("rating must be a number between 1 and 5");

    if (row.title.trim().length < 3 || row.title.trim().length > 120)
      errors.push("title must be 3–120 chars");

    if (row.body.trim().length < 10 || row.body.trim().length > 5000)
      errors.push("body must be 10–5000 chars");
  }

  return errors;
};

// Per-job cache: productId string → { productId, variantId, productTitle }
const fetchProductFromShopify = async (
  shop,
  productIdRaw,
  productHandle,
  cache
) => {
  const cacheKey = `handle:${productHandle?.trim()}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const { client } = await clientProvider.offline.graphqlClient({ shop });

  let productData = null;

  const gid = productIdRaw.trim().includes("gid")
    ? productIdRaw.trim()
    : `gid://shopify/Product/${productIdRaw.trim()}`;

  const { data, errors } = await client.request(
    `query GetProductByHandle($handle: String!) {
        productByHandle(handle: $handle) {
          id
          title
          variants(first: 1) {
            edges { node { id } }
          }
        }
      }`,
    { variables: { handle: productHandle?.trim() } }
  );
  if (errors?.length) throw new Error(errors[0].message);
  productData = data?.productByHandle;

  if (!productData) throw new Error(`Product not found in Shopify`);

  const result = {
    productId: productData.id.replace("gid://shopify/Product/", ""),
    productTitle: productData.title,
    variantId: productData.variants.edges[0]?.node?.id?.replace(
      "gid://shopify/ProductVariant/",
      ""
    ),
  };

  if (!result.variantId) throw new Error("Product has no variants");

  cache.set(cacheKey, result);
  return result;
};

const createReviewFromRow = async (
  row,
  shop,
  reviewModel,
  productCache,
  updatedProductIds
) => {
  console.log(row);
  const { productId, variantId, productTitle } = await fetchProductFromShopify(
    shop,
    row.product_id,
    row.product_handle,
    productCache
  );

  const systemOrderId = uuidv4();
  const systemLineItemId = uuidv4();
  const customerId = uuidv4();

  const rating = Number(row.rating);
  const name = row.reviewer_name.trim();
  const email = row.reviewer_email?.trim() || null;
  const title = row.title.trim();
  const content = row.body.trim();
  const curated = isTruthy(row.curated) || true; // later we'll add this row so we can control the publication
  const reviewDate = parseReviewDate(row.review_date);

  const submissionStatus = curated ? "approved" : "submitted";
  const visibility = curated ? "visible" : "hidden";
  const verificationStatus = curated ? "verified" : "pending";

  const session = await reviewModel.conn.startSession();
  try {
    await session.withTransaction(async () => {
      const lastReview = await reviewModel.Reviews.findOne({
        productId,
        deletedAt: null,
      })
        .sort({ sortIndex: -1 })
        .select("sortIndex")
        .session(session)
        .lean();

      const sortIndex = lastReview?.sortIndex ? lastReview.sortIndex + 1 : 1;

      const reviewDoc = {
        productId,
        variantId,
        shopId: shop,
        orderId: `system_orderId_${systemOrderId}`,
        orderLineItemId: `system_lineItemId_${systemLineItemId}`,
        purchaseKey: `${shop}::system_orderId_${systemOrderId}::system_lineItemId_${systemLineItemId}`,
        customer: { customerId, name, email, phone: "system" },
        rating,
        title,
        content,
        submissionStatus,
        visibility,
        verificationStatus,
        verificationReason: "system_bulk_upload",
        hasImages: false,
        hasVideo: false,
        mediaCount: 0,
        verifiedBadge:true,
        sortIndex,
        ...(curated && { approvedAt: new Date(), publishedAt: new Date() }),
        ...(reviewDate && { createdAt: reviewDate }),
      };

      const [review] = await reviewModel.Reviews.create([reviewDoc], {
        session,
        timestamps: !reviewDate, // skip auto-timestamp if we have an explicit date
      });

      const statsUpdates = [];

      // Only update live ProductReviewStats counts if review is immediately visible/approved/verified
      if (curated) {
        statsUpdates.push(
          reviewModel.ProductReviewStats.updateOne(
            { productId },
            [
              {
                $set: {
                  productId,
                  title: productTitle,
                  totalReviews: {
                    $max: [{ $add: [{ $ifNull: ["$totalReviews", 0] }, 1] }, 0],
                  },
                  rating1Count: {
                    $add: [
                      { $ifNull: ["$rating1Count", 0] },
                      rating === 1 ? 1 : 0,
                    ],
                  },
                  rating2Count: {
                    $add: [
                      { $ifNull: ["$rating2Count", 0] },
                      rating === 2 ? 1 : 0,
                    ],
                  },
                  rating3Count: {
                    $add: [
                      { $ifNull: ["$rating3Count", 0] },
                      rating === 3 ? 1 : 0,
                    ],
                  },
                  rating4Count: {
                    $add: [
                      { $ifNull: ["$rating4Count", 0] },
                      rating === 4 ? 1 : 0,
                    ],
                  },
                  rating5Count: {
                    $add: [
                      { $ifNull: ["$rating5Count", 0] },
                      rating === 5 ? 1 : 0,
                    ],
                  },
                },
              },
              {
                $set: {
                  avgRating: {
                    $cond: [
                      { $gt: ["$totalReviews", 0] },
                      {
                        $round: [
                          {
                            $divide: [
                              {
                                $add: [
                                  { $multiply: ["$rating1Count", 1] },
                                  { $multiply: ["$rating2Count", 2] },
                                  { $multiply: ["$rating3Count", 3] },
                                  { $multiply: ["$rating4Count", 4] },
                                  { $multiply: ["$rating5Count", 5] },
                                ],
                              },
                              "$totalReviews",
                            ],
                          },
                          2,
                        ],
                      },
                      0,
                    ],
                  },
                },
              },
            ],
            { upsert: true, session, updatePipeline: true }
          )
        );
      } else {
        // Still upsert ProductReviewStats with title so the product is registered
        statsUpdates.push(
          reviewModel.ProductReviewStats.updateOne(
            { productId },
            [{ $set: { productId, title: productTitle } }],
            { upsert: true, session, updatePipeline: true }
          )
        );
      }

      await Promise.all([
        reviewModel.ReviewModerationLog.create(
          [{ reviewId: review._id, action: "submitted" }],
          { session }
        ),
        reviewModel.ReviewVerificationLog.create(
          [
            {
              reviewId: review._id,
              checkType: "purchase_check",
              status: "pending",
            },
          ],
          { session }
        ),
        ...statsUpdates,
        reviewModel.CustomerReviewStats.updateOne(
          { customerId },
          [
            {
              $set: {
                customerId,
                name,
                email,
                phone: "system",
                submittedReviews: {
                  $setUnion: [
                    { $ifNull: ["$submittedReviews", []] },
                    [review._id],
                  ],
                },
                reviewsCount: { $add: [{ $ifNull: ["$reviewsCount", 0] }, 1] },
                cashbackEarned: { $ifNull: ["$cashbackEarned", 0] },
                rating1Count: {
                  $add: [
                    { $ifNull: ["$rating1Count", 0] },
                    rating === 1 ? 1 : 0,
                  ],
                },
                rating2Count: {
                  $add: [
                    { $ifNull: ["$rating2Count", 0] },
                    rating === 2 ? 1 : 0,
                  ],
                },
                rating3Count: {
                  $add: [
                    { $ifNull: ["$rating3Count", 0] },
                    rating === 3 ? 1 : 0,
                  ],
                },
                rating4Count: {
                  $add: [
                    { $ifNull: ["$rating4Count", 0] },
                    rating === 4 ? 1 : 0,
                  ],
                },
                rating5Count: {
                  $add: [
                    { $ifNull: ["$rating5Count", 0] },
                    rating === 5 ? 1 : 0,
                  ],
                },
              },
            },
            {
              $set: {
                avgRating: {
                  $round: [
                    {
                      $divide: [
                        {
                          $add: [
                            { $multiply: ["$rating1Count", 1] },
                            { $multiply: ["$rating2Count", 2] },
                            { $multiply: ["$rating3Count", 3] },
                            { $multiply: ["$rating4Count", 4] },
                            { $multiply: ["$rating5Count", 5] },
                          ],
                        },
                        "$reviewsCount",
                      ],
                    },
                    2,
                  ],
                },
              },
            },
          ],
          { upsert: true, session, updatePipeline: true }
        ),
      ]);
    });
  } finally {
    await session.endSession();
  }

  if (curated && updatedProductIds) {
    updatedProductIds.add(productId);
  }
};

const handleReviewUploadJob = (job) => {
  console.log("Handling review upload job here --->");
  return new Promise((resolve) => {
    const { _id: jobId, shopId: shop, file } = job;

    if (!file?.key) {
      console.error(`[ReviewUpload] No file key for jobId=${jobId}`);
      return resolve();
    }

    let reviewModel = null;
    let successCount = 0;
    let failedCount = 0;
    let rowIndex = 1;
    const errors = [];
    const productCache = new Map();
    const updatedProductIds = new Set();

    const finalize = async (status) => {
      if (reviewModel) {
        try {
          await reviewModel.UploadJob.findByIdAndUpdate(jobId, {
            $set: {
              status,
              processedCount: successCount + failedCount,
              successCount,
              failedCount,
              errors: errors.slice(0, 100),
            },
          });
        } catch (err) {
          console.error(
            `[ReviewUpload] Failed to finalize job ${jobId}: ${err.message}`
          );
        }
      }
      console.log(
        `[ReviewUpload] jobId=${jobId} done — status=${status}, success=${successCount}, failed=${failedCount}`
      );
      resolve();
    };

    reviewModels()
      .then(async (models) => {
        reviewModel = models;

        await reviewModel.UploadJob.findByIdAndUpdate(jobId, {
          $set: { status: "processing" },
        }).catch((err) =>
          console.warn(
            `[ReviewUpload] Could not mark processing: ${err.message}`
          )
        );

        console.log(
          `[ReviewUpload] Starting jobId=${jobId}, shop=${shop}, key=${file.key}`
        );

        const s3Stream = s3
          .getObject({
            Bucket: process.env.REVIEW_AWS_S3_BUCKET,
            Key: file.key,
          })
          .createReadStream();

        const csv = csvParser({
          mapHeaders: ({ header }) => header.trim(),
          mapValues: ({ value }) => value?.trim() ?? "",
        });

        s3Stream.on("error", async (err) => {
          console.error(
            `[ReviewUpload] S3 error for jobId=${jobId}: ${err.message}`
          );
          s3Stream.unpipe(csv);
          csv.destroy();
          await finalize("failed");
        });

        csv.on("data", async (row) => {
          csv.pause();
          const currentRow = rowIndex++;

          const validationErrors = validateRow(row);
          if (validationErrors.length > 0) {
            failedCount++;
            errors.push({
              row: currentRow,
              reason: validationErrors.join("; "),
            });
            console.warn(
              `[ReviewUpload] jobId=${jobId} row ${currentRow} invalid: ${validationErrors.join("; ")}`
            );
            csv.resume();
            return;
          }

          try {
            await createReviewFromRow(
              row,
              shop,
              reviewModel,
              productCache,
              updatedProductIds
            );
            successCount++;
            console.log(`[ReviewUpload] jobId=${jobId} row ${currentRow} ✓`);
          } catch (err) {
            failedCount++;
            errors.push({ row: currentRow, reason: err.message });
            console.error(
              `[ReviewUpload] jobId=${jobId} row ${currentRow} ✗ ${err.message}`
            );
          }

          csv.resume();
        });

        csv.on("end", async () => {
          const finalStatus =
            successCount === 0 && failedCount > 0 ? "failed" : "completed";
          await finalize(finalStatus);

          if (updatedProductIds.size > 0) {
            (async () => {
              for (const productId of updatedProductIds) {
                try {
                  const stats = await reviewModel.ProductReviewStats.findOne({
                    productId,
                  }).lean();
                  if (stats) {
                    await syncProductMetafields({ shop, productId, stats });
                    console.log(
                      `[ReviewUpload] Synced metafields for product ${productId}`
                    );
                  }
                } catch (err) {
                  console.error(
                    `[ReviewUpload] Failed to sync metafields for product ${productId}: ${err.message}`
                  );
                }
              }
            })();
          }
        });

        csv.on("error", async (err) => {
          console.error(
            `[ReviewUpload] CSV parse error jobId=${jobId}: ${err.message}`
          );
          await finalize("failed");
        });

        s3Stream.pipe(csv);
      })
      .catch(async (err) => {
        console.error(
          `[ReviewUpload] DB connect failed for jobId=${jobId}: ${err.message}`
        );
        resolve();
      });
  });
};

export { handleReviewUploadJob };
