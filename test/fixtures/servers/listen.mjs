// A server that does what pr asks: listen on $PORT, say when it is ready.
import http from 'node:http'

const port = Number(process.env.PORT)
http
  .createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(`side ${process.env.ELASTISHOT_SIDE}`)
  })
  .listen(port, '127.0.0.1', () => console.log(`listening on ${port}`))
