const net = require('net');
const WebSocket = require('ws');
const crypto = require('crypto');
const HashMap = require('hashmap');
const { da } = require('date-fns/locale');
// const parallel = require('run-parallel');

module.exports = class ConnPool {
    constructor(dht) {
        this.maxConnections = dht.maxConnections || 50;
        this.connections = new Map();
        this.port = dht.port || 4000;
        this.host = dht.host || '0.0.0.0';
        this.tcpServer = null;
        this.wsServer = new WebSocket.Server({ port: this.port });
        this._dht = dht;

        this.start();
    }

    start() {
        this.createTcpServer();
        this.createWebSocketServer();
    }

    createTcpServer() {
        this.tcpServer = net.createServer((socket) => {
            if (this.connections.size >= this.maxConnections) {
                socket.write(JSON.stringify({
                    type: 'error',
                    message: 'Connection pool is full'
                }));
                socket.end();
                return;
            }

            socket.on('data', (data) => {
                data = JSON.parse(data);
                const id = data.nodeId;
                // console.log(data);
                switch (data.action) {
                    case 'INIT': {
                        if (data.nodeId) {
                            socket.id = id;
                            this.connections.set(id, socket);
                            // this._dht.addConn(id, new HashMap())
                            socket.write(JSON.stringify({
                                type: 'connection',
                                message: `${id} to TCP connection pool`,
                                poolSize: this.connections.size,
                                port: this.port
                            }));
                        }
                        else {
                            socket.end();
                        }
                        break;
                    }

                    case 'SEED': {
                        this._dht.addTorrent(data.metadata, id);
                        // console.log(this._dht.getAllTorrent())
                        break;
                    }
                }
            });

            socket.on('close', async () => {
                this.connections.delete(socket.id);
                await this._dht.connClose(socket.id);
            });
            socket.on('error', (err) => {
                console.error('Socket error:', err);
                this.connections.delete(socket.id);
                // this._dht.deleteConn(socket.id);
                // console.log(this.connections.size);
            });
        });

        this.tcpServer.listen(this.port, this.host, () => {
            console.log(`TCP Connection pool started on ${this.host}:${this.port}`);
        });

        this.tcpServer.on('error', (err) => {
            console.error('Server error:', err);
        });
    }

    createWebSocketServer() {
        this.wsServer.on('connection', (ws) => {
            const tcpClient = net.createConnection({
                host: this.host,
                port: this.port
            }, () => {
                console.log('WebSocket connected to TCP server');
            });
            // console.log(tcpClient);
            ws.on('message', (message) => {
                tcpClient.write(message.toString());
            });

            tcpClient.on('data', (data) => {
                // console.log(data);
                ws.send(data.toString());
            });

            ws.on('close', () => tcpClient.end());
            tcpClient.on('error', (err) => {
                console.error('TCP client error:', err);
                ws.close();
            });
        });
    }

    handleMessage(socket, data) {
        try {
            const message = JSON.parse(data.toString().trim());
            // console.log('Sever received message:', message);
            // client.write(message);
            this.broadcast(data, socket);
            // switch (message.type) {
            //     case 'broadcast':
            //         // console.log('ok');
            //         this.broadcast(data, socket);
            //         break;
            //     case 'ping':
            //         socket.write(JSON.stringify({
            //             type: 'pong',
            //             timestamp: Date.now()
            //         }));
            //         break;
            //     default:
            //         console.log('Unhandled message type');
            // }
        } catch (error) {
            console.error('Message parsing error:', error);
        }
    }

    broadcast(message, sender) {
        for (let client of this.connections) {
            console.log(client);
            if (client.key !== sender && !client.destroyed) {
                client.value.write(message);
            }
        }
    }

    async privateMess(opts) {
        let client = this.connections.get(opts.sender);
        if (client) {
            // console.log(opts.message);
            await client.write(JSON.stringify(opts.message));
        }
    }

    destroy() {
        if (this.tcpServer) {
            this.tcpServer.close();
            this.connections.forEach(socket => socket.end());
            this.connections.clear();
        }
        if (this.wsServer) {
            this.wsServer.close();
        }
    }
}


// // Graceful shutdown example
// process.on('SIGINT', () => {
//     console.log('Shutting down connection pool');
//     const connPool = new ConnPool();
//     connPool.close();
//     process.exit();
// });