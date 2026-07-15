import reviewModels from "../../../../utils/reviewModelProvider.js";
import { spawn } from "child_process";
import { PassThrough } from "stream";
import AWS from "aws-sdk";
import ffmpegStatic from "ffmpeg-static";

AWS.config.update({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_KEY,
});

const s3 = new AWS.S3();

const handleReviewMediaUpload = async ({ bucket, key }) => {
  try {
    const reviewModel = await reviewModels();
    if (!bucket && !key) {
      throw new Error("No key recieved");
    }
    const mediaUrl = `https://${bucket}.s3.${process.env.REVIEW_AWS_REGION}.amazonaws.com/${key}`;

    const mediaIndb = await reviewModel.ReviewMedia.findOne({
      originalUrl: mediaUrl,
    }).lean();
    if (mediaIndb && mediaIndb.type == "video") {
      const videoThumbnail = await generateAndUploadThumbnailForVideo({
        bucket,
        key,
      });
      await reviewModel.ReviewMedia.findByIdAndUpdate(mediaIndb._id, {
        thumbnailUrl: videoThumbnail,
      });
      console.log("generated video thumbnail in this case");
    }
  } catch (err) {
    console.log(
      "Failed to handle review media upload reason -->" + err.message
    );
  }
};
const generateAndUploadThumbnailForVideo = async ({ bucket, key }) => {
  try {
    const thumbnailKey = key.replace(/\.[^/.]+$/, "_thumbnail.jpg");

    const videoStream = s3
      .getObject({ Bucket: bucket, Key: key })
      .createReadStream();

    const ffmpegProcess = spawn(ffmpegStatic, [
      "-i",
      "pipe:0",
      "-ss",
      "00:00:01",
      "-vframes",
      "1",
      "-f",
      "image2",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    ]);

    videoStream.pipe(ffmpegProcess.stdin);

    ffmpegProcess.stdin.on("error", (err) => {
      if (err.code === "EPIPE") {
        videoStream.unpipe(ffmpegProcess.stdin);
        videoStream.destroy();
      } else {
        console.error(`[ffmpeg] stdin error: ${err.message}`);
      }
    });

    ffmpegProcess.stderr.on("data", (data) => {
      const log = data.toString();
      if (log.toLowerCase().includes("error")) {
        console.error(`[ffmpeg] ${log}`);
      }
    });

    const uploadPassThrough = new PassThrough();
    ffmpegProcess.stdout.pipe(uploadPassThrough);

    const uploadPromise = s3
      .upload({
        Bucket: process.env.REVIEW_AWS_S3_BUCKET || bucket,
        Key: thumbnailKey,
        Body: uploadPassThrough,
        ContentType: "image/jpeg",
      })
      .promise();

    await new Promise((resolve, reject) => {
      ffmpegProcess.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });

      ffmpegProcess.on("error", (err) => {
        reject(new Error(`ffmpeg spawn error: ${err.message}`));
      });

      videoStream.on("error", (err) => {
        // Ignore EPIPE here too — already handled above
        if (err.code !== "EPIPE") {
          ffmpegProcess.kill("SIGTERM");
          reject(new Error(`S3 read stream error: ${err.message}`));
        }
      });
    });

    await uploadPromise;
    return `https://${bucket}.s3.${process.env.REVIEW_AWS_REGION}.amazonaws.com/${thumbnailKey}`;
  } catch (err) {
    throw new Error(
      "Failed to generate and upload thumbnail reason --> " + err.message
    );
  }
};
export { handleReviewMediaUpload };
