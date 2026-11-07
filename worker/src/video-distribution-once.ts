import { loadConfig } from "./config.js";
import { runVideoDistributionOnce } from "./agents/video-distribution.js";

try {
  const count = await runVideoDistributionOnce(loadConfig());
  console.log(`video distribution batch complete; claimed=${count}`);
} catch (error) {
  console.error("video distribution batch failed:", error);
  process.exitCode = 1;
}
