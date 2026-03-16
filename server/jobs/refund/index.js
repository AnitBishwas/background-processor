import { CronJob } from "cron";
import handleRtoOrders from "../../modules/refund/index.js";

// const customerBlankPhoneSortingJob = new CronJob(
//   "0 0 3 * * *", // ⏰ 03:00:00 AM every day
//   function () {
//     console.log("phone blank job started at 03:00:00 AM");
//     updateCustomerWithEmptyPhoneField();
//   },
//   null,
//   true,
//   "Asia/Kolkata"
// );
handleRtoOrders();
