#!/usr/bin/env node
import { scaffoldExtension } from './scaffold.mjs'

function usage() {
  return `Usage: create-kun-extension <directory> --publisher <publisher> --name <name> [options]

Options:
  --template <node|webview|react>  Project shape (default: node)
  --display-name <name>            Human-readable name
  --json                           Emit machine-readable result
  --help                           Show this help`
}

function parseArguments(argv) {
  const options = { template: 'node', json: false }
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') options.help = true
    else if (argument === '--json') options.json = true
    else if (argument === '--publisher') options.publisher = argv[++index]
    else if (argument === '--name') options.name = argv[++index]
    else if (argument === '--template') options.template = argv[++index]
    else if (argument === '--display-name') options.displayName = argv[++index]
    else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`)
    else positional.push(argument)
  }
  options.targetDirectory = positional[0]
  if (positional.length > 1) throw new Error('Only one target directory may be supplied')
  return options
}

try {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
  } else {
    const result = await scaffoldExtension(options)
    if (options.json) console.log(JSON.stringify({ schemaVersion: 1, ...result }))
    else {
      console.log(`Created ${result.extensionId} (${result.template}) in ${result.targetDirectory}`)
      console.log('Next: npm install && npm test && npm run validate && npm run pack')
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exitCode = 1
}
