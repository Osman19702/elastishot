export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** Severity of a changed region: density, intensity and absolute size relative to the page. */
export function regionScore(areaFraction: number, meanDelta: number, pixelsChanged: number, pageArea: number): number {
  return clamp01(0.5 * areaFraction + 0.3 * meanDelta + 0.2 * Math.min(1, pixelsChanged / (0.002 * pageArea)))
}

/** Severity of an added or removed region. */
export function gapScore(area: number, pageArea: number, whitespaceOnly: boolean): number {
  const s = clamp01(0.4 + 0.6 * Math.min(1, area / (0.05 * pageArea)))
  return whitespaceOnly ? Math.min(0.1, s) : s
}

export function alignmentConfidence(inliers: number, inlierRatio: number, spread: number, reprojectionRms: number): number {
  return clamp01(
    0.4 * Math.min(1, inliers / 60) + 0.3 * clamp01(inlierRatio) + 0.2 * Math.min(1, spread) + 0.1 * (1 - Math.min(1, reprojectionRms / 3)),
  )
}

/** Overall similarity; a low-confidence alignment can never reach 1. */
export function similarityScore(changedPixelFraction: number, confidence: number): number {
  return clamp01((1 - Math.min(1, changedPixelFraction)) * (0.9 + 0.1 * clamp01(confidence)))
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}
