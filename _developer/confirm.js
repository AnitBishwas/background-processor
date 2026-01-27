import readline from "readline";

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

const answer = (
  await ask("⚠️  This will update the production app, Are you sure? (y/N): ")
)
  .trim()
  .toLowerCase();

if (answer !== "y" && answer !== "yes") {
  console.log("❌ Cancelled.");
  process.exit(1);
} else {
  console.log("✅ Approved.");
  process.exit(0);
}
