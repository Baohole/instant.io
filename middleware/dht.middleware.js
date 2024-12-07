const DHT = require('../lib/dht');
class DHTManager {
    constructor() {
        if (!DHTManager.instance) {
            this._DHT = new DHT();
            DHTManager.instance = this;
        }
        return DHTManager.instance;
    }

    getDHT() {
        return this._DHT;
    }
}

// Middleware to attach shared DHT to request
module.exports = (req, res, next) => {
    req.dht = new DHTManager().getDHT();
    // console.log(req.dht);
    next();
}