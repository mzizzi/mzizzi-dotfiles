import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function resolvePiSdk() {
  const npmRoot = execFileSync("npm", ["root", "-g"], {
    encoding: "utf8",
  }).trim();
  const root = join(npmRoot, "@earendil-works/pi-coding-agent");
  return { root, entry: pathToFileURL(join(root, "dist/index.js")) };
}
