/** Shrink a photo to a data URL the AI proxy can take without a huge upload. */
export async function downscalePhoto(file: File, maxDim = 1280): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.8)
  } finally {
    bitmap.close()
  }
}
