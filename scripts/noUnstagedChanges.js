const { execSync } = require("child_process");

try {
  execSync("git diff-index --quiet HEAD");
} catch (e) {
  console.log("cannot deploy: You have unstaged changes.");
  console.log("Please commit or stash them.");
  process.exitCode = 1;
}
