import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

const sendSubscribedEmailCashbackReport = async (reportData) => {
  try {
    const recipients = reportData.recipients;
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Cashback ${reportData.type} report ${new Date(reportData.dateRange.start).toDateString()} - ${new Date(reportData.dateRange.end).toDateString()}</h2>
        <p>
          <a href="${reportData.cdn}" style="display: inline-block; padding: 10px 20px; background-color: #0066cc; color: #fff; text-decoration: none; border-radius: 4px;">
            Download CSV Report
          </a>
        </p>
      </div>
    `;

    await ses.send(
      new SendEmailCommand({
        Source: reportData.user.email,
        Destination: { ToAddresses: recipients },
        Message: {
          Subject: {
            Data: `Cashback ${reportData.type} report ${new Date(reportData.dateRange.start).toDateString()} - ${new Date(reportData.dateRange.end).toDateString()}`,
          },
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

export { sendSubscribedEmailCashbackReport };
