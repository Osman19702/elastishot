export type ErrorCode =
  | 'E_IMAGE_INVALID'
  | 'E_OPTIONS'
  | 'E_INPUT_UNSUPPORTED'
  | 'E_INPUT_NOT_FOUND'
  | 'E_DECODE'
  | 'E_FETCH'
  | 'E_ENGINE_UNAVAILABLE'
  | 'E_OPENCV_LOAD'
  | 'E_ABORTED'
  | 'E_STAGE'
  | 'E_CAPTURE'
  | 'E_CONFIG'
  | 'E_USAGE'

export interface ElastishotErrorOptions {
  cause?: unknown
  /** Pipeline stage that raised the error, when applicable. */
  stage?: string
}

export class ElastishotError extends Error {
  readonly code: ErrorCode
  readonly stage?: string

  constructor(code: ErrorCode, message: string, options: ElastishotErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ElastishotError'
    this.code = code
    if (options.stage !== undefined) this.stage = options.stage
  }
}

export function isElastishotError(error: unknown, code?: ErrorCode): error is ElastishotError {
  return error instanceof ElastishotError && (code === undefined || error.code === code)
}
