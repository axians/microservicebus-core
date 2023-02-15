/*
The MIT License (MIT)

Copyright (c) 2014 microServiceBus.com

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/* jshint node: true */
/* jshint esversion: 6 */
/* jshint strict:false */
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const supportedPlatforms = ['darwin', 'linux'];

const socketFileName = 'dam.sock';
var SOCKET_PATH = process.env.SNAP_COMMON || process.env.DAM_SOCKETPATH || os.tmpdir();
const socketPathPreferred = `${SOCKET_PATH}/${socketFileName}`;
const socketPathFallback = `${SOCKET_PATH}/socket/${socketFileName}`;

// Fix for backward compability
if (fs.existsSync(socketPathPreferred)) {
    SOCKET_PATH = socketPathPreferred;
    console.log(`SOCKET_PATH set to "${SOCKET_PATH}"`);
}
else if (fs.existsSync(socketPathFallback)) {
    SOCKET_PATH = socketPathFallback;
    console.log(`SOCKET_PATH set to "${SOCKET_PATH}"`);
}
else {
    console.log(`SOCKET_PATH set to "${socketPathPreferred}". DAM socket not present.`);
}

const socketPath = `http://unix:${SOCKET_PATH}:`;
const requestPath = '/refresh/access';

var request = require('./WebRequest');
function MicroServiceBusDAM() {
    var self = this;
    this.onLog = null;

    this.OnLogCallback = function (callback) {
        this.onLog = callback;
    };
    this.refresh = function (response) {
        // make sure we're running on a supported platform. if not, let's stop here.
        if (!supportedPlatforms.includes(os.platform())) {
            response("Unsupported platform", null);
            return;
        }
        request(socketPath + requestPath, function (error, res, body) {
            if (error || res.statusCode < 200 || res.statusCode >= 300) {
                if (error && error.errno && error.errno === 'EACCES')
                    response('Insufficient permissions. Current user does not have enough permissions to DAM (not running as root?).', null);
                else if ((error && error.errno && error.errno === 'ECONNREFUSED') || (error && error.errno && error.errno === 'ENOENT'))
                    response('Socket not avaliable. Is DAM installed, DAM_SOCKETPATH correctly and/or running? Snap interfaces connected?', null);
                else
                    response(`Unknown error. error: ${JSON.stringify(error)} status code: ${res.statusCode} body: ${JSON.stringify(body)}`, null);
            }
            else {
                response(null, body);
            }
        });
    };

}
module.exports = MicroServiceBusDAM;
