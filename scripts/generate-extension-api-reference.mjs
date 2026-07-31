import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  API_EXPORTS_BEGIN,
  API_EXPORTS_END,
  inspectPublicSdkPackages,
  renderApiExportsRegion,
  renderSdkSnapshotsRegion,
  replaceGeneratedRegion
} from './lib/extension-docs-validation.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docsRoot = join(root, 'docs', 'extensions')
const sdkPackages = await inspectPublicSdkPackages(root)
const check = process.argv.includes('--check')
let changed = false

for (const [name, locale] of [['api-reference.md', 'zh'], ['api-reference.en.md', 'en']]) {
  const path = join(docsRoot, name)
  const current = await readFile(path, 'utf8')
  const next = replaceGeneratedRegion(
    current,
    renderApiExportsRegion(sdkPackages, locale),
    API_EXPORTS_BEGIN,
    API_EXPORTS_END
  )
  if (next === current) continue
  changed = true
  if (!check) await writeFile(path, next, 'utf8')
}

if (check && changed) {
  throw new Error('Generated Extension API reference is stale; run node scripts/generate-extension-api-reference.mjs')
}

process.stdout.write(
  `${check ? 'Checked' : 'Generated'} Extension API reference. ` +
  `Copy this snapshot block into both API Changelogs only after documenting the public change:\n` +
  `${renderSdkSnapshotsRegion(sdkPackages)}\n`
)
