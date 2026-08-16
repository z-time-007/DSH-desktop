import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { PolicyError, assertNoSymlinkSegments, resolveInside, throwIfAborted } from './security.js'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_PIXELS = 40_000_000
const MAX_IMAGE_DIMENSION = 8000
const MAX_IMAGES_PER_PRESENTATION = 30
const SLIDE_WIDTH_INCHES = 13.333333
const SLIDE_HEIGHT_INCHES = 7.5

function detectImageType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png'
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg'
  }
  return null
}

function requireNumber(value, field, { positive = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PolicyError('INVALID_IMAGE_LAYOUT', `${field} must be a finite number.`)
  }
  if (positive ? value <= 0 : value < 0) {
    throw new PolicyError('INVALID_IMAGE_LAYOUT', `${field} is outside the slide.`)
  }
  return value
}

function validateLayout(image, field) {
  const fit = image.fit ?? 'contain'
  if (!['contain', 'cover'].includes(fit)) {
    throw new PolicyError('INVALID_IMAGE_FIT', `${field}.fit must be contain or cover.`)
  }
  const x = requireNumber(image.x, `${field}.x`)
  const y = requireNumber(image.y, `${field}.y`)
  const w = requireNumber(image.w, `${field}.w`, { positive: true })
  const h = requireNumber(image.h, `${field}.h`, { positive: true })
  if (x + w > SLIDE_WIDTH_INCHES + 1e-6 || y + h > SLIDE_HEIGHT_INCHES + 1e-6) {
    throw new PolicyError('INVALID_IMAGE_LAYOUT', `${field} extends outside the 13.333 x 7.5 inch slide.`)
  }
  return { fit, x, y, w, h }
}

function validateExtension(relativePath) {
  const extension = path.extname(relativePath).toLowerCase()
  if (!['.png', '.jpg', '.jpeg'].includes(extension)) {
    throw new PolicyError('IMAGE_TYPE_DENIED', 'Only local .png, .jpg, and .jpeg files are accepted.')
  }
  return extension === '.png' ? 'png' : 'jpeg'
}

async function sanitizeImage({ inboxRoot, source, layout, signal }) {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new PolicyError('IMAGE_PATH_REQUIRED', 'image.path must be a non-empty relative path.')
  }
  const expectedType = validateExtension(source)
  const resolved = resolveInside(inboxRoot, source, { allowRoot: false })
  await assertNoSymlinkSegments(resolved.root, resolved.target, { allowMissing: false })
  const stats = await lstat(resolved.target)
  if (!stats.isFile()) throw new PolicyError('IMAGE_NOT_FILE', 'The requested image must be a regular file.')
  if (stats.size > MAX_IMAGE_BYTES) {
    throw new PolicyError('IMAGE_TOO_LARGE', 'Image exceeds the 10 MiB input limit.')
  }
  throwIfAborted(signal)
  const input = await readFile(resolved.target)
  if (input.length > MAX_IMAGE_BYTES) throw new PolicyError('IMAGE_TOO_LARGE', 'Image exceeds the 10 MiB input limit.')
  const detectedType = detectImageType(input)
  if (!detectedType || detectedType !== expectedType) {
    throw new PolicyError('IMAGE_MAGIC_MISMATCH', 'Image extension and PNG/JPEG file signature do not match.')
  }

  let metadata
  try {
    metadata = await sharp(input, { failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS, sequentialRead: true }).metadata()
  } catch (error) {
    throw new PolicyError('INVALID_IMAGE', `Image metadata could not be decoded safely: ${error.message}`)
  }
  if (metadata.format !== detectedType || !metadata.width || !metadata.height) {
    throw new PolicyError('INVALID_IMAGE', 'Decoded image format or dimensions are invalid.')
  }
  if (metadata.width > MAX_IMAGE_DIMENSION || metadata.height > MAX_IMAGE_DIMENSION || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
    throw new PolicyError('IMAGE_DIMENSIONS_EXCEEDED', 'Image exceeds 8000 px per side or 40 megapixels.')
  }

  throwIfAborted(signal)
  let pipeline = sharp(input, { failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS, sequentialRead: true })
    .rotate()
    .resize({
      width: MAX_IMAGE_DIMENSION,
      height: MAX_IMAGE_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
  pipeline = detectedType === 'png'
    ? pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
    : pipeline.jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: false })
  let encoded
  try {
    encoded = await pipeline.toBuffer({ resolveWithObject: true })
  } catch (error) {
    throw new PolicyError('INVALID_IMAGE', `Image could not be re-encoded safely: ${error.message}`)
  }
  if (!encoded.info.width || !encoded.info.height || encoded.info.width > MAX_IMAGE_DIMENSION || encoded.info.height > MAX_IMAGE_DIMENSION) {
    throw new PolicyError('INVALID_IMAGE', 'Re-encoded image dimensions are invalid.')
  }
  return {
    ...layout,
    data: Buffer.from(encoded.data),
    extension: detectedType === 'png' ? 'png' : 'jpeg',
    width: encoded.info.width,
    height: encoded.info.height,
  }
}

export async function prepareSlideImages({ workspaceRoot, slides, signal }) {
  let imageCount = 0
  for (const slide of slides) {
    if (!Array.isArray(slide.images)) throw new PolicyError('INVALID_IMAGES', 'slide.images must be an array.')
    imageCount += slide.images.length
  }
  if (imageCount > MAX_IMAGES_PER_PRESENTATION) {
    throw new PolicyError('TOO_MANY_IMAGES', `A presentation accepts at most ${MAX_IMAGES_PER_PRESENTATION} images.`)
  }
  if (imageCount === 0) return 0
  const inbox = resolveInside(workspaceRoot, 'assets/inbox', { allowRoot: false })
  await assertNoSymlinkSegments(inbox.root, inbox.target, { allowMissing: false })
  let current = 0
  for (const slide of slides) {
    const prepared = []
    for (const image of slide.images) {
      if (!image || typeof image !== 'object' || Array.isArray(image)) {
        throw new PolicyError('INVALID_IMAGE', `images[${current}] must be an object.`)
      }
      const layout = validateLayout(image, `images[${current}]`)
      prepared.push(await sanitizeImage({ inboxRoot: inbox.target, source: image.path, layout, signal }))
      current += 1
    }
    slide.images = prepared
  }
  return imageCount
}
