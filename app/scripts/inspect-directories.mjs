import { readDirectories } from "../lib/directories.mjs";

const directories = await readDirectories();

console.log(`Источник: ${directories.source}`);
console.log(`ЮЦ: ${directories.yucs.length}`);
for (const yuc of directories.yucs) {
  console.log(`\n${yuc}`);
  for (const region of directories.regionsByYuc[yuc] ?? []) {
    console.log(`  - ${region}`);
  }
}
