import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateExtensionDocumentation } from './lib/extension-docs-validation.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const result = await validateExtensionDocumentation(root)

if (result.problems.length > 0) {
  throw new Error(`Extension documentation validation failed:\n- ${result.problems.join('\n- ')}`)
}

process.stdout.write(
  `Extension docs OK: ${result.files.length} files, ${result.pairs.length} bilingual pairs, ` +
  `${result.checkedSnippets} JSON/TypeScript snippets, links/anchors, and ` +
  `${result.sdkPackages.length} SDK export/type snapshots verified.\n`
)
