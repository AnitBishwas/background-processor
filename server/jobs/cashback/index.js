import { CronJob } from "cron";
import { updateCustomerWithEmptyPhoneField } from "../../modules/cashback/controllers/index.js";
import { handleCashbackExpiry } from "../../modules/cashback/controllers/jobs.js";

const customerBlankPhoneSortingJob = new CronJob(
  "0 0 3 * * *", // ⏰ 03:00:00 AM every day
  function () {
    console.log("phone blank job started at 03:00:00 AM");
    updateCustomerWithEmptyPhoneField();
  },
  null,
  true,
  "Asia/Kolkata"
);

const cashbackExpiryJob = new CronJob(
  "10 * * * *", // run every hour
  function () {
    handleCashbackExpiry();
    console.log("running cashback expiry");
  },
  null,
  true,
  "Asia/Kolkata"
);
