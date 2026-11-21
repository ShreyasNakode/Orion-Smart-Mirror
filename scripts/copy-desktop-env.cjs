const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const releaseDir = path.join(root, "release", "win-unpacked");
const sourceEnv = path.join(root, ".env.local");
const targetEnv = path.join(releaseDir, ".env.local");

if (!fs.existsSync(releaseDir)) {
  console.warn("Release folder not found; skipping .env.local copy.");
  process.exit(0);
}

if (!fs.existsSync(sourceEnv)) {
  console.warn(".env.local not found; create one from .env.example before using Spotify/Gemini features.");
  process.exit(0);
}

fs.copyFileSync(sourceEnv, targetEnv);
console.log(`Copied .env.local to ${targetEnv}`);