const createTorrent = require('create-torrent')
const debug = require('debug')('instant.io')
const dragDrop = require('drag-drop')
const escapeHtml = require('escape-html')
const get = require('simple-get')
const formatDistance = require('date-fns/formatDistance')
const path = require('path')
const prettierBytes = require('prettier-bytes')
const throttle = require('throttleit')
const thunky = require('thunky')
const uploadElement = require('upload-element')
const WebTorrent = require('webtorrent')
const JSZip = require('jszip')
const SimplePeer = require('simple-peer');
const Client = require('../lib/client');

const util = require('./util');
const wsPort = parseInt(document.querySelector('body').getAttribute('wsPort'));
let clientSocket;
const fileListModal = document.querySelector('.fileListModal');
const modalOverlay = document.querySelector('.modal-overlay');

globalThis.WEBTORRENT_ANNOUNCE = createTorrent.announceList
    .map(function (arr) {
        return arr[0]
    })
    .filter(function (url) {
        return url.indexOf('wss://') === 0 || url.indexOf('ws://') === 0
    })

const DISALLOWED = [
    '6feb54706f41f459f819c0ae5b560a21ebfead8f'
]

const getClient = thunky(function (cb) {
    getRtcConfig(function (err, rtcConfig) {
        if (err) util.error(err)
        const client = new WebTorrent({
            tracker: {
                rtcConfig: {
                    ...SimplePeer.config,
                    ...rtcConfig
                }
            }
        })
        window.client = client // for easier debugging
        client.on('warning', util.warning)
        client.on('error', util.error)
        cb(null, client)
    })
})

init()

function init() {
    if (!WebTorrent.WEBRTC_SUPPORT) {
        util.error('This browser is unsupported. Please use a browser with WebRTC support.')
    }
    clientSocket = new Client(wsPort);

    // For performance, create the client immediately
    getClient(function () { })

    // Seed via upload input element
    const upload = document.querySelector('input[name=upload]')
    if (upload) {
        uploadElement(upload, function (err, files) {
            if (err) return util.error(err)
            files = files.map(function (file) { return file.file })
            onFiles(files)
        })
    }

    // Seed via drag-and-drop
    dragDrop('body', onFiles)

    // Download via input element
    const form = document.querySelector('form')
    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault()
            downloadTorrent(document.querySelector('form input[name=torrentId]').value.trim())
        })
    }

    // Download by URL hash
    onHashChange()
    window.addEventListener('hashchange', onHashChange)
    function onHashChange() {
        const hash = decodeURIComponent(window.location.hash.substring(1)).trim()
        if (hash !== '') downloadTorrent(hash)
    }

    const download = document.querySelectorAll('.torrentInfo.nodata .torrentAction');
    download.forEach(d => {
        d.addEventListener('click', function () {
            const infoHash = d.querySelector('input').value.trim();
            if (infoHash !== '') downloadTorrent(infoHash);
            else util.log("Torrent is not already")
            d.remove()
        });
    });

    // Register a protocol handler for "magnet:" (will prompt the user)
    if ('registerProtocolHandler' in navigator) {
        navigator.registerProtocolHandler('magnet', window.location.origin + '#%s', 'Instant.io')
    }

    // Register a service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
    }
}

function getRtcConfig(cb) {
    // WARNING: This is *NOT* a public endpoint. Do not depend on it in your app.
    get.concat({
        url: '/__rtcConfig__',
        timeout: 5000
    }, function (err, res, data) {
        if (err || res.statusCode !== 200) {
            cb(new Error('Could not get WebRTC config from server. Using default (without TURN).'))
        } else {
            try {
                data = JSON.parse(data)
            } catch (err) {
                return cb(new Error('Got invalid WebRTC config from server: ' + data))
            }
            debug('got rtc config: %o', data.rtcConfig)
            cb(null, data.rtcConfig)
        }
    })
}

function onFiles(files) {
    debug('got files:')
    files.forEach(function (file) {
        debug(' - %s (%s bytes)', file.name, file.size)
    })

    // .torrent file = start downloading the torrent
    files.filter(isTorrentFile).forEach(downloadTorrentFile)

    // everything else = seed these files
    seed(files.filter(isNotTorrentFile))
}

function isTorrentFile(file) {
    const extname = path.extname(file.name).toLowerCase()
    return extname === '.torrent'
}

function isNotTorrentFile(file) {
    return !isTorrentFile(file)
}

function formatName(name) {
    if (name.length > 20) {
        name = name.substring(0, 17) + '...';
    }

    return name
}

function downloadTorrent(torrentId, opts = 0) {
    const disallowed = DISALLOWED.some(function (infoHash) {
        return torrentId.indexOf(infoHash) >= 0
    })

    if (disallowed) {
        util.log('File not found ' + torrentId)
    } else {
        util.log('Downloading torrent from ' + torrentId)
        getClient(function (err, client) {
            if (err) return util.error(err)
            client.add(torrentId, torrent => {
                onTorrent(torrent, opts);
            })
        })
    }
}

function downloadTorrentFile(file) {
    util.unsafeLog('Downloading torrent from <strong>' + escapeHtml(file.name) + '</strong>')
    getClient(function (err, client) {
        if (err) return util.error(err)
        client.add(file, onTorrent)
    })
}

function seed(files) {
    if (files.length === 0) return
    util.log('Seeding ' + files.length + ' files')

    // Seed from WebTorrent
    getClient(function (err, client) {
        if (err) return util.error(err)
        client.seed(files, torrent => {
            onTorrent(torrent);
            clientSocket.seeding(torrent)
        });

    })
}
function toTitleCase(str) {
    return str
        .toLowerCase() // Convert the string to lowercase
        .split(' ') // Split the string into an array of words
        .map(word => word.charAt(0).toUpperCase() + word.slice(1)) // Capitalize the first letter of each word
        .join(' '); // Join the words back into a single string
}

function onTorrent(torrent, opts = 0) {
    torrent.on('warning', util.warning)
    torrent.on('error', util.error)

    const upload = document.querySelector('input[name=upload]')
    upload.value = upload.defaultValue // reset upload element

    const torrentFileName = formatName(torrent.name) + '.torrent'
    const torrentName = toTitleCase(torrent.name) + '.torrent'

    const info = document.createElement('div');
    info.classList.add('torrentInfo', 'data');
    info.innerHTML += `
        <p class="torrentName">${torrentFileName}</p>
        <div class="infoHash">
            <span>Torrent info hash: ${torrent.infoHash}</span>
            <div><i class="fa-regular fa-copy"></i></div>
        </div>
        <section class="torrentBar">
            <a href="/#${torrent.infoHash}"
                onclick="prompt('Share this link with anyone you want to download this torrent:', ${this.href});return false;"
                class="shareLink">[Share link]</a>
            <a href=${torrent.magnetURI} target="_blank" class="getMagnetURI">[Magnet URI]</a>
            <a href=${torrent.torrentFileBlobURL} target="_blank" download=${torrentName} class="downloadTorrent">[Download.torrent]</a>
        </section>`;


    function updateSpeed() {
        const progress = (100 * torrent.progress).toFixed(1)

        let remaining
        if (torrent.done) {
            remaining = 'Done.'
        } else {
            remaining = torrent.timeRemaining !== Infinity
                ? formatDistance(torrent.timeRemaining, 0, { includeSeconds: true })
                : 'Infinity years'
            remaining = remaining[0].toUpperCase() + remaining.substring(1) + ' remaining.'
        }

        util.updateSpeed(
            '<b>Peers:</b> ' + torrent.numPeers + ' ' +
            '<b>Progress:</b> ' + progress + '% ' +
            '<b>Download speed:</b> ' + prettierBytes(window.client.downloadSpeed) + '/s ' +
            '<b>Upload speed:</b> ' + prettierBytes(window.client.uploadSpeed) + '/s ' +
            '<b>ETA:</b> ' + remaining
        )
    }

    torrent.on('download', throttle(updateSpeed, 250))
    torrent.on('upload', throttle(updateSpeed, 250))
    setInterval(updateSpeed, 5000)
    updateSpeed()

    const downloadAllBtn = document.createElement('a');
    downloadAllBtn.innerHTML = '<i class="fa-solid fa-download"></i>';
    downloadAllBtn.classList.add('download');
    downloadAllBtn.href = '#';
    // Track file URLs to enable bulk download
    const fileUrls = [];
    torrent.files.forEach(function (file) {
        // append download link
        file.getBlobURL(function (err, url) {
            if (err) return util.error(err)

            const a = document.createElement('a')
            a.target = '_blank'
            a.download = file.name
            a.href = url
            fileUrls.push(a);
        })
    })

    // Add click event for downloading all files
    downloadAllBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        fileUrls.forEach(a => {
            a.click();
        })
    });

    if (opts !== 0) {
        downloadAllBtn.click();
    }

    const downloadZip = document.createElement('a')
    downloadZip.href = '#'
    downloadZip.target = '_blank'
    downloadZip.textContent = 'Download all files as zip'
    downloadZip.addEventListener('click', function (event) {
        let addedFiles = 0
        const zipFilename = path.basename(torrent.name, path.extname(torrent.name)) + '.zip'
        let zip = new JSZip()
        event.preventDefault()

        torrent.files.forEach(function (file) {
            file.getBlob(function (err, blob) {
                addedFiles += 1
                if (err) return util.error(err)

                // add file to zip
                zip.file(file.path, blob)

                // start the download when all files have been added
                if (addedFiles === torrent.files.length) {
                    if (torrent.files.length > 1) {
                        // generate the zip relative to the torrent folder
                        zip = zip.folder(torrent.name)
                    }
                    zip.generateAsync({ type: 'blob' })
                        .then(function (blob) {
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.download = zipFilename
                            a.href = url
                            a.click()
                            setTimeout(function () {
                                URL.revokeObjectURL(url)
                            }, 30 * 1000)
                        }, util.error)
                }
            })
        })
    })


    info.querySelector('.torrentBar').appendChild(downloadZip);
    const action = document.createElement('div');
    action.className = 'torrentAction';
    const openFileList = document.createElement('i');
    openFileList.classList.add('fa-solid', 'fa-folder-open');
    action.appendChild(openFileList);
    action.appendChild(downloadAllBtn);
    info.appendChild(action);
    downloadSelected(openFileList);
    util.appendElemToLog(info);
    const infoHashContainer = document.querySelector('.infoHash');
    const copyIcon = infoHashContainer.querySelector('.fa-copy');
    const infoHashText = infoHashContainer.querySelector('span');

    copyIcon.addEventListener('click', () => {
        // Extract the info hash text (assuming it's after the ': ')
        const infoHash = infoHashText.textContent.split(': ')[1];

        // Use the Clipboard API to copy the text
        navigator.clipboard.writeText(infoHash)
            .then(() => {
                // Optional: Add a visual feedback
                copyIcon.classList.add('copied');
                setTimeout(() => {
                    copyIcon.classList.remove('copied');
                }, 1000);
            })
            .catch(err => {
                console.error('Failed to copy text: ', err);
            });
    });


    function downloadSelected(btn) {
        btn.addEventListener('click', function () {
            fileListModal.innerHTML += `<span class='folderName'>${torrentFileName}</span>`;

            const ul = document.createElement('ul');
            ul.classList.add('file-list')
            for (let index in fileUrls) {
                // console.log(index);
                const li = document.createElement('li');
                li.innerHTML += `
                    <input type="checkbox" class="file-checkbox" value=${index}>
                    <i class="file-icon fas fa-file-lines"></i>
                    <span class="file-name">${torrent.files[index].name}</span>
                `
                ul.appendChild(li);
            }

            const downloadBtn = document.createElement('button');
            downloadBtn.classList.add('download-button');
            downloadBtn.innerHTML = 'Download ';

            fileListModal.appendChild(ul);
            fileListModal.appendChild(downloadBtn);
            downloadBtn.addEventListener('click', function () {
                const fileCheckbox = fileListModal.querySelectorAll('.file-checkbox');
                const selected = Array.from(fileCheckbox)
                    .filter(box => box.checked)
                    .map(box => JSON.parse(box.value));
                if (selected.length === 0) {
                    util.log('No files selected');
                    return;
                }
                selected.forEach(indx => {
                    fileUrls[indx].click();
                })
                // console.log(selected);
            });

            modalOverlay.classList.remove('hidden');
            fileListModal.classList.remove('hidden');
            const closeBtn = fileListModal.querySelector('.close-button');
            // console.log(closeBtn)
            closeBtn.addEventListener('click', function () {
                fileListModal.innerHTML = '';
                modalOverlay.classList.add('hidden');
                fileListModal.classList.add('hidden');
            });
        });
    }

}