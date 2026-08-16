/**
 * Generate the PWA PNG icons for @local/dsh-desktop-app from the official
 * DSH favicon.svg (black whale). Dev/build-time script only — the generated
 * PNGs are committed into the package `assets/` directory and shipped inside
 * the tgz, so the plugin itself has zero runtime dependencies.
 *
 * Usage:
 *   node Generate-DshAppIcons.mjs <official-favicon.svg> <sharp-package-dir> <assets-out-dir>
 *
 * <sharp-package-dir> is the resolved `sharp` package directory of the DSH
 * installation (e.g. <harness-root>/node_modules/sharp); it is passed in so
 * this script does not hardcode a machine path.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const [sourceArgument, sharpDirArgument, outputArgument] = process.argv.slice(2)
if (!sourceArgument || !sharpDirArgument || !outputArgument) {
  throw new Error('Usage: node Generate-DshAppIcons.mjs <official-favicon.svg> <sharp-package-dir> <assets-out-dir>')
}

const require = createRequire(import.meta.url)
const sharp = require(path.resolve(sharpDirArgument))

const source = path.resolve(sourceArgument)
const outputDir = path.resolve(outputArgument)
if (path.basename(source).toLowerCase() !== 'favicon.svg' || !source.toLowerCase().includes('@deepseek-ai')) {
  throw new Error('The source must be the installed @deepseek-ai DSH favicon.svg.')
}

const svg = await readFile(source)
if (!svg.includes(Buffer.from('fill="#000"')) || !svg.includes(Buffer.from('viewBox="0 0 50 50"'))) {
  throw new Error('The installed DSH favicon did not match the expected black whale artwork.')
}

// Theme background matching the DSH dark UI (#0f1115), used for maskable icon.
const BACKGROUND = { r: 15, g: 17, b: 21, alpha: 1 }

const renderWhale = (size, density) =>
  sharp(svg, { density })
    .resize(size, size, { fit: 'contain' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer()

// 192x192 and 512x512 transparent "any" icons.
const icon192 = await renderWhale(192, 384)
const icon512 = await renderWhale(512, 384)

// Maskable icon: solid background, whale inside the 80% safe zone
// (the safe-zone radius is 80% of half the canvas, so the artwork is scaled
// to about 66% of the canvas and centered).
const whaleMaskable = await sharp(svg, { density: 384 })
  .resize(340, 340, { fit: 'contain' })
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toBuffer()
const maskable = await sharp({
  create: { width: 512, height: 512, channels: 4, background: BACKGROUND },
})
  .composite([{ input: whaleMaskable, gravity: 'center' }])
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toBuffer()

await mkdir(outputDir, { recursive: true })
await writeFile(path.join(outputDir, 'dsh-app-icon-192.png'), icon192)
await writeFile(path.join(outputDir, 'dsh-app-icon-512.png'), icon512)
await writeFile(path.join(outputDir, 'dsh-app-icon-maskable-512.png'), maskable)

console.log(path.join(outputDir, 'dsh-app-icon-192.png'))
console.log(path.join(outputDir, 'dsh-app-icon-512.png'))
console.log(path.join(outputDir, 'dsh-app-icon-maskable-512.png'))
