import { basename, dirname, resolve } from "node:path";

export function piPackageRoot(cliRealPath) {
  const directory = dirname(cliRealPath);
  return resolve(directory, basename(directory) === "bundle" ? "../.." : "..");
}
