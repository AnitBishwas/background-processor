import { CronJob } from "cron";
import { generateRtoReport } from "../../modules/clickpost/controllers/report.js";

const rtoReportJob = new CronJob(
  "0 0 1 * * *", // ⏰ 03:00:00 AM every day
  function () {
    console.log("Rto report generation started");
    
  },
  null,
  true,
  "Asia/Kolkata"
);

generateRtoReport();