// A server that ignores $PORT and takes a port of its own, as a dev server
// does when its configured port is busy. pr must not compare it.
import http from 'node:http'

const server = http.createServer((req, res) => res.end('elsewhere'))
server.listen(0, '127.0.0.1', () => console.log(`listening on ${server.address().port}`))
