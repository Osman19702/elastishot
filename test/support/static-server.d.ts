export interface StaticServer {
  url: string
  close(): Promise<void>
}

export function startStaticServer(root: string, options?: { host?: string; port?: number }): Promise<StaticServer>
