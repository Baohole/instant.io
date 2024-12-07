const crypto = require('crypto');
const ConnPool = require('./conn-pool');
const HashMap = require('hashmap');

module.exports = class DHT {
    constructor(opts = {}) {
        if (opts.dhtId) {
            this.dhtId = opts.dhtId; // dht ID
        }
        else {
            this.dhtId = crypto.randomBytes(16).toString('hex'); // Generate a random
        }

        this.port = opts?.port ?? Math.floor(Math.random() * 9000) + 1000;
        this._connPool = new ConnPool(this);
        this.nodeConns = new HashMap();
        this._torrents = opts._torrents || new HashMap();
    }

    // Add a new torrent's metadata to the DHS
    addConn(nodeID, torrents) {
        this.nodeConns.set(nodeID, torrents);
        // console.log(this.nodeConns.get(nodeID));
        // console.log(`Added torrent metadata to DHS: ${infoHash}`);
    }

    connClose(conn) {
        // this.nodeConns.delete(nodeID);
        this._torrents.forEach(elm => {
            // console.log('elm', elm);
            const index = elm._conn.indexOf(conn);
            if (index > -1) { // only splice array when item is found
                elm._conn.splice(index, 1); // 2nd parameter means remove one item only
                if (elm._conn.length <= 0) {
                    this._torrents.delete(elm.key, elm);
                }
            }
        })
        console.log(this._torrents);
        // console.log(`Added torrent metadata to DHS: ${infoHash}`);
    }

    addTorrent(metadata, conn) {
        const { infoHash } = metadata.infoHash;
        const torrent = this._torrents.get(infoHash);
        if (torrent) {
            // console.log(`Torrent already exists in DHS: ${infoHash}`);
            const index = torrent._conn.indexOf(conn);
            if (index < 0) {
                torrent._conn.push(conn);
                this._torrents.set(infoHash, torrent);
            }
            return;
        }
        metadata._conn = [conn];
        this._torrents.set(infoHash, metadata);
        // console.log(`Added torrent metadata to DHS: ${infoHash}`);
    }

    updateTorrent(infoHash, conn) {
        this._torrents.get(infoHash)._conn.push(conn);
    }


    getTorrentData(infoHash) {
        return this._torrents.get(infoHash);
    }

    getAllTorrent() {
        let metadata = [];
        this._torrents.forEach(e => {
            // console.log(infoHash, torrent);
            metadata.push(e);
        });

        return metadata;
    }



    // Register a peer in the DHS for a specific piece
    registerPeer(infoHash, pieceIndex, peerInfo) {
        const key = `${infoHash}_piece_${pieceIndex}`;
        const existingPeers = this.dhsNode.get(key) || [];
        existingPeers.push(peerInfo);
        this.dht.put(key, existingPeers);
        console.log(`Registered peer for piece ${pieceIndex}:`, peerInfo);
    }

    // Retrieve peers holding a specific piece
    getPeers(infoHash, pieceIndex) {
        const key = `${infoHash}_piece_${pieceIndex}`;
        return this.dhsNode.get(key) || [];
    }

    /**
      * Select a group of nodes for the seeder to send file pieces
      * @param {number} nums - Number of nodes to select
      * @returns {Array} Selected nodes
      */
    selection(owner, infoHash, piece, nums = 0) {
        // Fetch all nodes and their metadata
        const allNodes = Array.from(this.nodeConns.keys()).map((nodeId) => ({
            nodeId,
            torrent: this.nodeConns.get(nodeId),
        }));

        if (nums > 0) {
            nums = Math.max(2, nums);
            // Sort nodes by the number of pieces they have (ascending order)
            const sortedNodes = allNodes.sort((a, b) => {
                const piecesA = a.torrent?.size || 0;
                const piecesB = b.torrent?.size || 0;
                return piecesA - piecesB;
            });

            // Return only the nodeId values from the sorted nodes
            let nodeIds = new Set();
            for (let i = 0; i < nums && i < sortedNodes.length; i++) {
                const nodeId = sortedNodes[i].nodeId;
                if (nodeId != owner) {
                    nodeIds.add(nodeId);
                    this.updateNodeTorrent(nodeId, infoHash, piece)
                }
            }
            return nodeIds;
        }
        else {
            const node = allNodes.find(n => {
                console.log(n.torrent.get(infoHash));
                // n.torrent.get(infoHash).contains(piece);
            });
            return node;
        }
    }
}
