/**
 * The slice of the opencv.js API the engine calls, typed structurally so a
 * test can inject a fake and so the engine does not depend on any particular
 * build's own type definitions. Every call passes the full argument list:
 * opencv.js registers one overload per argument count and a build may lack
 * the shorter ones.
 */

export interface Deletable {
  delete(): void
  isDeleted?(): boolean
}

export interface Mat extends Deletable {
  rows: number
  cols: number
  data: Uint8Array
  data32S: Int32Array
  data32F: Float32Array
  data64F: Float64Array
  type(): number
  channels(): number
  empty(): boolean
  isContinuous(): boolean
  roi(rect: Rect): Mat
  clone(): Mat
  copyTo(dst: Mat): void
  setTo(value: Scalar): void
}

export interface MatConstructor {
  new (): Mat
  new (rows: number, cols: number, type: number): Mat
  new (rows: number, cols: number, type: number, fill: Scalar): Mat
  zeros(rows: number, cols: number, type: number): Mat
  ones(rows: number, cols: number, type: number): Mat
}

export interface MatVector extends Deletable {
  size(): number
  get(i: number): Mat
  push_back(m: Mat): void
}

export interface KeyPoint {
  pt: { x: number; y: number }
  size: number
  angle: number
  response: number
  octave: number
  class_id: number
}

export interface KeyPointVector extends Deletable {
  size(): number
  get(i: number): KeyPoint
}

export interface DMatch {
  queryIdx: number
  trainIdx: number
  imgIdx: number
  distance: number
}

export interface DMatchVector extends Deletable {
  size(): number
  get(i: number): DMatch
}

export interface DMatchVectorVector extends Deletable {
  size(): number
  get(i: number): DMatchVector
}

export interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export type Scalar = number[]

export interface FeatureDetector extends Deletable {
  detect(image: Mat, keypoints: KeyPointVector, mask: Mat): void
  compute(image: Mat, keypoints: KeyPointVector, descriptors: Mat): void
  detectAndCompute(image: Mat, mask: Mat, keypoints: KeyPointVector, descriptors: Mat): void
}

export interface DescriptorMatcher extends Deletable {
  knnMatch(query: Mat, train: Mat, matches: DMatchVectorVector, k: number): void
}

export interface MinMaxLoc {
  minVal: number
  maxVal: number
  minLoc: Point
  maxLoc: Point
}

export interface CV {
  Mat: MatConstructor
  MatVector: new () => MatVector
  KeyPointVector: new () => KeyPointVector
  DMatchVectorVector: new () => DMatchVectorVector
  Size: new (width: number, height: number) => Size
  Rect: new (x: number, y: number, width: number, height: number) => Rect
  Point: new (x: number, y: number) => Point
  Scalar: new (...values: number[]) => Scalar
  ORB: new (
    nFeatures: number,
    scaleFactor: number,
    nLevels: number,
    edgeThreshold: number,
    firstLevel: number,
    wtaK: number,
    scoreType: number,
    patchSize: number,
    fastThreshold: number,
  ) => FeatureDetector
  AKAZE?: new () => FeatureDetector
  BFMatcher: new (normType: number, crossCheck: boolean) => DescriptorMatcher

  matFromArray(rows: number, cols: number, type: number, array: ArrayLike<number>): Mat
  cvtColor(src: Mat, dst: Mat, code: number, dstCn: number): void
  resize(src: Mat, dst: Mat, dsize: Size, fx: number, fy: number, interpolation: number): void
  GaussianBlur(src: Mat, dst: Mat, ksize: Size, sigmaX: number, sigmaY: number, borderType: number): void
  estimateAffine2D(
    from: Mat,
    to: Mat,
    inliers: Mat,
    method: number,
    ransacReprojThreshold: number,
    maxIters: number,
    confidence: number,
    refineIters: number,
  ): Mat
  findHomography(src: Mat, dst: Mat, method: number, ransacReprojThreshold: number, mask: Mat, maxIters: number, confidence: number): Mat
  warpAffine(src: Mat, dst: Mat, m: Mat, dsize: Size, flags: number, borderMode: number, borderValue: Scalar): void
  warpPerspective(src: Mat, dst: Mat, m: Mat, dsize: Size, flags: number, borderMode: number, borderValue: Scalar): void
  Sobel(src: Mat, dst: Mat, ddepth: number, dx: number, dy: number, ksize: number, scale: number, delta: number, borderType: number): void
  convertScaleAbs(src: Mat, dst: Mat, alpha: number, beta: number): void
  addWeighted(a: Mat, alpha: number, b: Mat, beta: number, gamma: number, dst: Mat, dtype: number): void
  threshold(src: Mat, dst: Mat, thresh: number, maxval: number, type: number): number
  morphologyEx(src: Mat, dst: Mat, op: number, kernel: Mat, anchor: Point, iterations: number, borderType: number, borderValue: Scalar): void
  bitwise_or(src1: Mat, src2: Mat, dst: Mat): void
  morphologyDefaultBorderValue(): Scalar
  getStructuringElement(shape: number, ksize: Size, anchor: Point): Mat
  connectedComponentsWithStats(image: Mat, labels: Mat, stats: Mat, centroids: Mat, connectivity: number, ltype: number): number
  matchTemplate(image: Mat, templ: Mat, result: Mat, method: number, mask: Mat): void
  minMaxLoc(src: Mat, mask: Mat): MinMaxLoc
  meanStdDev(src: Mat, mean: Mat, stddev: Mat, mask: Mat): void

  CV_8U: number
  CV_8UC1: number
  CV_8UC4: number
  CV_16S: number
  CV_32S: number
  CV_32F: number
  CV_32FC1: number
  CV_32FC2: number
  CV_64F: number
  COLOR_RGBA2GRAY: number
  COLOR_GRAY2RGBA: number
  INTER_AREA: number
  INTER_LINEAR: number
  INTER_NEAREST: number
  BORDER_CONSTANT: number
  BORDER_DEFAULT: number
  RANSAC: number
  NORM_HAMMING: number
  ORB_HARRIS_SCORE: number
  MORPH_RECT: number
  MORPH_OPEN: number
  MORPH_CLOSE: number
  MORPH_ERODE: number
  THRESH_BINARY: number
  TM_CCOEFF_NORMED: number
  CC_STAT_LEFT: number
  CC_STAT_TOP: number
  CC_STAT_WIDTH: number
  CC_STAT_HEIGHT: number
  CC_STAT_AREA: number
}
