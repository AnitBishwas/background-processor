import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

const RECIPIENTS = ["anit.biswas@swissbeauty.in"];

const sendSubscribedEmailRtoReport = async ({ dateStr, s3Url, summary }) => {
  try {
    const { totalOrders, totalRefundAmount, totalCashback } = summary;

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">RTO Report — ${dateStr}</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <thead>
            <tr style="background-color: #f5f5f5;">
              <th style="text-align: left; padding: 10px 14px; border: 1px solid #ddd;">Metric</th>
              <th style="text-align: right; padding: 10px 14px; border: 1px solid #ddd;">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding: 10px 14px; border: 1px solid #ddd;">Total Orders</td>
              <td style="padding: 10px 14px; border: 1px solid #ddd; text-align: right;">${totalOrders}</td>
            </tr>
            <tr style="background-color: #fafafa;">
              <td style="padding: 10px 14px; border: 1px solid #ddd;">Total Refunded Amount</td>
              <td style="padding: 10px 14px; border: 1px solid #ddd; text-align: right;">₹${totalRefundAmount.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; border: 1px solid #ddd;">Total Cashback Amount</td>
              <td style="padding: 10px 14px; border: 1px solid #ddd; text-align: right;">₹${totalCashback.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
        <p>
          <a href="${s3Url}" style="display: inline-block; padding: 10px 20px; background-color: #0066cc; color: #fff; text-decoration: none; border-radius: 4px;">
            Download CSV Report
          </a>
        </p>
      </div>
    `;

    await ses.send(
      new SendEmailCommand({
        Source: 'anit.biswas@swissbeauty.in',
        Destination: { ToAddresses: RECIPIENTS },
        Message: {
          Subject: { Data: `RTO Report — ${dateStr}`, Charset: "UTF-8" },
          Body: { Html: { Data: htmlBody, Charset: "UTF-8" } },
        },
      })
    );
  } catch (err) {
    throw new Error(
      "Failed to send subscribed emails rto report reason --> " + err.message
    );
  }
};

export { sendSubscribedEmailRtoReport };
