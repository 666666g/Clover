function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function buildSvgArtifactSkeleton(options: {
  title: string
  brief?: string
  width: number
  height: number
}): string {
  const title = escapeXml(options.title.trim() || 'SVG motion')
  const description = escapeXml(options.brief?.trim() || 'SVG motion design generated in Kun.')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(options.width)} ${Math.round(options.height)}" width="${Math.round(options.width)}" height="${Math.round(options.height)}" role="img" aria-labelledby="title desc">`,
    `  <title id="title">${title}</title>`,
    `  <desc id="desc">${description}</desc>`,
    '  <g id="artwork" />',
    '</svg>',
    ''
  ].join('\n')
}
