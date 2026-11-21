import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function resolveSubagentsRoot(packageManager) {
  const configured = packageManager
    .listConfiguredPackages()
    .find(({ scope, installedPath }) => {
      if (scope !== "user" || !installedPath) return false;
      const manifest = join(installedPath, "package.json");
      return (
        existsSync(manifest) &&
        JSON.parse(readFileSync(manifest, "utf8")).name === "pi-subagents"
      );
    });
  const root =
    configured?.installedPath ??
    packageManager.getInstalledPath("npm:pi-subagents", "user");
  if (!root)
    throw new Error(
      "Install pi-subagents in the test host's Pi profile before running this check.",
    );
  return root;
}

export function createSubagentsImporter(root) {
  let jiti;
  return async (modulePath) => {
    const compiled = join(root, `${modulePath}.js`);
    if (existsSync(compiled)) return import(pathToFileURL(compiled));

    const manifest = join(root, "package.json");
    jiti ??= createRequire(manifest)("jiti").createJiti(manifest, {
      fsCache: false,
    });
    return jiti.import(join(root, `${modulePath}.ts`));
  };
}
