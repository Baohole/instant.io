const crypto = require('crypto');

function decodeString(buffer, start) {
    const colonIndex = buffer.indexOf(':', start);
    const length = parseInt(buffer.slice(start, colonIndex).toString());
    const stringStart = colonIndex + 1;
    return {
        value: buffer.slice(stringStart, stringStart + length).toString(),
        end: stringStart + length
    };
}

function decodeInteger(buffer, start) {
    const endIndex = buffer.indexOf('e', start);
    return {
        value: parseInt(buffer.slice(start + 1, endIndex).toString()),
        end: endIndex + 1
    };
}

function decodeList(buffer, start) {
    const list = [];
    let currentPos = start + 1;

    while (buffer[currentPos] !== 'e'.charCodeAt(0)) {
        const decoded = decode(buffer, currentPos);
        list.push(decoded.value);
        currentPos = decoded.end;
    }

    return {
        value: list,
        end: currentPos + 1
    };
}

function decodeDictionary(buffer, start) {
    const dict = {};
    let currentPos = start + 1;

    while (buffer[currentPos] !== 'e'.charCodeAt(0)) {
        const keyDecoded = decode(buffer, currentPos);
        currentPos = keyDecoded.end;

        const valueDecoded = decode(buffer, currentPos);
        dict[keyDecoded.value] = valueDecoded.value;
        currentPos = valueDecoded.end;
    }

    return {
        value: dict,
        end: currentPos + 1
    };
}

function decode(buffer, start = 0) {
    switch (buffer[start]) {
        case '0'.charCodeAt(0):
        case '1'.charCodeAt(0):
        case '2'.charCodeAt(0):
        case '3'.charCodeAt(0):
        case '4'.charCodeAt(0):
        case '5'.charCodeAt(0):
        case '6'.charCodeAt(0):
        case '7'.charCodeAt(0):
        case '8'.charCodeAt(0):
        case '9'.charCodeAt(0):
            return decodeString(buffer, start);
        case 'i'.charCodeAt(0):
            return decodeInteger(buffer, start);
        case 'l'.charCodeAt(0):
            return decodeList(buffer, start);
        case 'd'.charCodeAt(0):
            return decodeDictionary(buffer, start);
        default:
            throw new Error('Invalid torrent file format');
    }
}
function parseTorrent(torrentBuf) {
    // Decode the entire torrent file
    const decoded = decode(torrentBuf);
    const torrentInfo = decoded.value;

    // Extract info dictionary
    const infoDict = torrentInfo.info;
    console.log(torrentInfo);

    // Generate infoHash
    const infoHash = crypto.createHash('sha1')
        .update(Buffer.from(JSON.stringify(infoDict)))
        .digest('hex');

    // Construct basic info
    const info = {
        name: infoDict.name.toString(),
        length: infoDict.length ||
            (infoDict.input && infoDict.input.reduce((total, file) => total + file.length, 0)),
        input: infoDict.input ? infoDict.input.map(file => ({
            path: file.path.map(p => p.toString()).join('/'),
            length: file.length
        })) : null,
        pieceLength: infoDict['piece length'],
        pieces: infoDict.pieces || []
    };

    // Construct magnet URI
    const magnetURI = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(info.name)}`;

    return {
        ...info,
        infoHash,
        magnetURI,
        originalTorrent: torrentInfo,
        _hashes:[]
    };


}

module.exports = (input) => {
    return new Promise((resolve, reject) => {
        // Ensure the input is a Blob
        if (!(input instanceof Blob)) {
            input = new Blob([input], { type: 'application/x-bittorrent' });
        }
        // console.log(input);
        const reader = new FileReader();

        reader.onload = () => {
            try {
                const arrayBuffer = reader.result;
                const buffer = Buffer.from(arrayBuffer);

                // Parse the torrent
                const parsed = parseTorrent(buffer);
                resolve(parsed);
            } catch (error) {
                reject(error);
            }
        };

        reader.onerror = (error) => {
            reject(error);
        };

        reader.readAsArrayBuffer(input);
    });
};