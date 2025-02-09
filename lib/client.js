const parallel = require('run-parallel');
const queueMicrotask = require('queue-microtask');
const parseTorrent = require('./parse-torrent');
const crypto = require('crypto');

module.exports = class Client {
    constructor(wsPort) {
        this.wsPort = wsPort;
        this.nodeId = crypto.randomBytes(16).toString('hex');
        this.torrents = [];
        this.infoHashs = [];
        this._initWebSocket();
    }

    _initWebSocket() {
        this.socket = new WebSocket(`wss://instant-io-orpin.vercel.app/`);
        this.socket.onopen = (e) => {
            console.log('success', e)
            this.socket.send(JSON.stringify({
                action: 'INIT',
                nodeId: this.nodeId,
                type: 'SERVER_ONLY'
            }))

        }
        this.socket.onerror = (err) => {
            console.error('WebSocket error:', err);
        }
        // this._onListening(e);
        this.socket.onmessage = (e) => {
            queueMicrotask(() => {
                this._onListening(e);
            });
        }

    }
    _onListening(e) {
        // const { data } = JSON.parse(e);
        console.log(e.data);
    }

    seeding(torrent) {
        const metadata = {
            infoHash: torrent.infoHash,
            magnetURI: torrent.magnetURI,
            length: torrent.length,
            name: torrent.name,
            pieceLength: torrent.pieceLength,
            files: torrent.files.map(file => ({
                    name: file.name,
                    _startPiece: file._startPiece,
                    _endPiece: file._endPiece
                }))
        };
        // console.log(metadata);
        this.torrents.push(metadata);
        this.infoHashs.push(torrent.infoHash);
        this.socket.send(JSON.stringify({
            action: 'SEED',
            nodeId: this.nodeId,
            metadata
        }));
    }
}
