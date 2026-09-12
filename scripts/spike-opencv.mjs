#!/usr/bin/env node
/**
 * Phase 0 spike: prove opencv.js (WASM) loads in Node ESM and can recover a
 * known translation between two synthetic images with ORB + RANSAC.
 *
 *   node scripts/spike-opencv.mjs
 *
 * Prints the API coverage the engine needs, the recovered transform, the
 * load time and the resident memory. Exits 1 when the recovered translation
 * is off by more than 1 px, 2 when a required function is missing.
 */

import { performance } from 'node:perf_hooks'

const REQUIRED = [
  'Mat', 'MatVector', 'KeyPointVector', 'DMatchVectorVector', 'Size', 'Point', 'Rect', 'Scalar',
  'ORB', 'BFMatcher', 'estimateAffine2D', 'findHomography', 'warpAffine', 'warpPerspective',
  'matchTemplate', 'minMaxLoc', 'connectedComponentsWithStats', 'morphologyEx', 'getStructuringElement',
  'Sobel', 'convertScaleAbs', 'addWeighted', 'resize', 'cvtColor', 'GaussianBlur', 'absdiff', 'threshold',
  'matFromArray', 'findContours', 'boundingRect', 'transpose', 'rectangle', 'remap',
]
const OPTIONAL = ['phaseCorrelate', 'AKAZE', 'createHanningWindow', 'matFromImageData', 'estimateAffine2D']

const t0 = performance.now()
const mod = await import('@techstark/opencv-js')
const cv = await resolveCv(mod)
const loadMs = Math.round(performance.now() - t0)

function resolveCv(m) {
  const candidate = m.default ?? m
  // Emscripten MODULARIZE builds expose a `then` that resolves with the module
  // itself, which makes `await module` recurse forever. Use it once, then drop it.
  return new Promise((resolve) => {
    const ready = () => {
      delete candidate.then
      resolve(candidate)
    }
    if (typeof candidate.Mat === 'function') return ready()
    if (typeof candidate.then === 'function') return candidate.then(ready)
    candidate.onRuntimeInitialized = ready
  })
}

const missing = REQUIRED.filter((k) => typeof cv[k] !== 'function')
const optionalPresent = OPTIONAL.filter((k) => typeof cv[k] === 'function')
const orbProto = cv.ORB?.prototype ?? {}
const orbSeparate = typeof orbProto.detect === 'function' && typeof orbProto.compute === 'function'

console.log(`opencv.js loaded in ${loadMs} ms, export shape: ${typeof mod.default?.then === 'function' ? 'promise' : 'module'}`)
console.log(`required missing: ${missing.length ? missing.join(', ') : 'none'}`)
console.log(`optional present: ${optionalPresent.join(', ') || 'none'}`)
console.log(`ORB.detect/compute separate: ${orbSeparate}`)
if (missing.length) process.exit(2)

// --- synthetic images: text-like blocks on white, second one shifted by (17, -9)
const W = 640
const H = 480
const DX = 17
const DY = -9
let seed = 42
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}
const blocks = []
for (let i = 0; i < 400; i++) {
  blocks.push({ x: Math.floor(rand() * (W - 60)), y: Math.floor(rand() * (H - 20)), w: 4 + Math.floor(rand() * 40), h: 3 + Math.floor(rand() * 12), v: Math.floor(rand() * 160) })
}
function render(dx, dy) {
  const data = new Uint8ClampedArray(W * H * 4).fill(255)
  for (const b of blocks) {
    for (let y = b.y + dy; y < b.y + b.h + dy; y++) {
      if (y < 0 || y >= H) continue
      for (let x = b.x + dx; x < b.x + b.w + dx; x++) {
        if (x < 0 || x >= W) continue
        const i = (y * W + x) * 4
        data[i] = data[i + 1] = data[i + 2] = b.v
      }
    }
  }
  return data
}

const mats = []
const track = (m) => (mats.push(m), m)
try {
  const t1 = performance.now()
  const a = track(cv.matFromArray(H, W, cv.CV_8UC4, render(0, 0)))
  const b = track(cv.matFromArray(H, W, cv.CV_8UC4, render(DX, DY)))
  const ga = track(new cv.Mat())
  const gb = track(new cv.Mat())
  cv.cvtColor(a, ga, cv.COLOR_RGBA2GRAY)
  cv.cvtColor(b, gb, cv.COLOR_RGBA2GRAY)

  const orb = track(new cv.ORB(2000, 1.2, 8, 15, 0, 2, cv.ORB_HARRIS_SCORE, 31, 12))
  const kpa = track(new cv.KeyPointVector())
  const kpb = track(new cv.KeyPointVector())
  const da = track(new cv.Mat())
  const db = track(new cv.Mat())
  const none = track(new cv.Mat())
  orb.detectAndCompute(ga, none, kpa, da)
  orb.detectAndCompute(gb, none, kpb, db)

  const matcher = track(new cv.BFMatcher(cv.NORM_HAMMING, false))
  const knn = track(new cv.DMatchVectorVector())
  matcher.knnMatch(db, da, knn, 2)
  const src = []
  const dst = []
  for (let i = 0; i < knn.size(); i++) {
    const pair = knn.get(i)
    if (pair.size() < 2) continue
    const m0 = pair.get(0)
    const m1 = pair.get(1)
    if (m0.distance < 0.75 * m1.distance) {
      const pb = kpb.get(m0.queryIdx).pt
      const pa = kpa.get(m0.trainIdx).pt
      src.push(pb.x, pb.y)
      dst.push(pa.x, pa.y)
    }
  }
  const good = src.length / 2
  const srcMat = track(cv.matFromArray(good, 1, cv.CV_32FC2, src))
  const dstMat = track(cv.matFromArray(good, 1, cv.CV_32FC2, dst))
  const inlierMask = track(new cv.Mat())
  const M = track(cv.estimateAffine2D(srcMat, dstMat, inlierMask, cv.RANSAC, 3, 5000, 0.995, 10))
  const m = Array.from(M.data64F)
  let inliers = 0
  for (let i = 0; i < inlierMask.rows; i++) if (inlierMask.data[i]) inliers++
  const scale = Math.hypot(m[0], m[1])
  const rot = (Math.atan2(m[3], m[0]) * 180) / Math.PI
  const matchMs = Math.round(performance.now() - t1)

  console.log(`keypoints: ${kpa.size()} / ${kpb.size()}, ratio-test matches: ${good}, inliers: ${inliers}`)
  console.log(`recovered: scale ${scale.toFixed(4)}, rotation ${rot.toFixed(3)} deg, translation (${m[2].toFixed(2)}, ${m[5].toFixed(2)}), expected (${-DX}, ${-DY}) candidate->baseline`)
  console.log(`match pipeline: ${matchMs} ms, rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`)

  const ok = Math.abs(m[2] + DX) <= 1 && Math.abs(m[5] + DY) <= 1 && Math.abs(scale - 1) < 0.01
  console.log(ok ? 'PASS' : 'FAIL')
  process.exitCode = ok ? 0 : 1
} finally {
  for (const m of mats.reverse()) m.delete()
}
