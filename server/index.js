require('./rollbar')

const compress = require('compression')
const cors = require('cors')
const express = require('express')
const http = require('http')
const pug = require('pug')
const path = require('path')

const config = require('../config')

const PORT = Number(process.argv[2]) || 3000;
const dhtMiddleware = require('../middleware/dht.middleware');

const CORS_WHITELIST = [
    // Favor to friends :)
    'http://rollcall.audio',
    'https://rollcall.audio'
]

let secret
try {
    secret = require('../secret')
} catch (err) { }

const app = express()
const server = http.createServer(app)

// Trust "X-Forwarded-For" and "X-Forwarded-Proto" nginx headers
app.enable('trust proxy')

// Disable "powered by express" header
app.set('x-powered-by', false)

// Use pug for templates
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'pug')
app.engine('pug', pug.renderFile)

// Pretty print JSON
app.set('json spaces', 2)

// Use GZIP
app.use(compress())

app.use(express.static(path.join(__dirname, '../public')))

app.get('/', dhtMiddleware, function (req, res) {
    const metadataList = req.dht.getAllTorrent();
    // console.log(metadataList);
    const wsPort = req.dht.port
    res.render('index', {
        title: 'Instant.io - Streaming file transfer over WebTorrent',
        metadataList,
        wsPort,
    })
})

// WARNING: This is *NOT* a public endpoint. Do not depend on it in your app.
app.get('/__rtcConfig__', cors({
    origin: function (origin, cb) {
        const allowed = CORS_WHITELIST.indexOf(origin) >= 0 ||
            /https?:\/\/localhost(:|$)/.test(origin) ||
            /https?:\/\/airtap\.local(:|$)/.test(origin)
        cb(null, allowed)
    }
}), function (req, res) {
    // console.log('referer:', req.headers.referer, 'user-agent:', req.headers['user-agent'])
    const rtcConfig = secret.rtcConfig

    if (!rtcConfig) return res.status(404).send({ rtcConfig: {} })
    res.send({
        comment: 'WARNING: This is *NOT* a public endpoint. Do not depend on it in your app',
        rtcConfig: rtcConfig
    })
})

// app.get('/500', (req, res, next) => {
//   next(new Error('Manually visited /500'))
// })

app.get('*', function (req, res) {
    res.status(404).render('error', {
        title: '404 Page Not Found - Instant.io',
        message: '404 Not Found'
    })
})

if (global.rollbar) app.use(global.rollbar.errorHandler())

// error handling middleware
app.use(function (err, req, res, next) {
    console.error(err.stack)
    const code = typeof err.code === 'number' ? err.code : 500
    res.status(code).render('error', {
        title: '500 Internal Server Error - Instant.io',
        message: err.message || err
    })
})

server.listen(PORT, '127.0.0.1', function () {
    console.log('listening on port %s', server.address().port)
})
