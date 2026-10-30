import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    throw new Error(`Invalid Chrome extension version: ${version}`);
}

for (const relativePath of ["../src/manifest.json", "../package.json"]) {
    const path = new URL(relativePath, import.meta.url);
    const contents = readFileSync(path, "utf8");
    const parsed = JSON.parse(contents);
    if (typeof parsed.version !== "string") {
        throw new Error(`${relativePath} has no version`);
    }

    const updated = contents.replace(
        /("version"\s*:\s*")[^"]+(?=")/,
        (_match, prefix) => `${prefix}${version}`,
    );
    if (JSON.parse(updated).version !== version) {
        throw new Error(`Could not update ${relativePath} version`);
    }
    writeFileSync(path, updated);
}
