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
if(fs.existsSync(socketPathPreferred)){
    SOCKET_PATH = socketPathPreferred;
    console.log(`SOCKET_PATH set to "${SOCKET_PATH}"`);
}
else if(fs.existsSync(socketPathFallback)) {
    SOCKET_PATH = socketPathFallback;
    console.log(`SOCKET_PATH set to "${SOCKET_PATH}"`);
}
else {
    console.log(`SOCKET_PATH set to "${socketPathPreferred}". DAM socket not present.`);
}

const socketPath = `http://unix:${SOCKET_PATH}/${socketFileName}:`;
const requestPath = '/refresh/access';

var request = require('request');
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
        request(socketPath + requestPath, function(error, res, body){
            if(error || res.statusCode < 200 || res.statusCode >= 300){
                if(error.errno === 'EACCES')
                    response('Insufficient permissions. Current user does not have enough permissions to DAM (not running as root?).', null);
                else if(error.errno === 'ECONNREFUSED' || error.errno === 'ENOENT')
                    response('Socket not avaliable. Is DAM installed, DAM_SOCKETPATH correctly and/or running? Snap interfaces connected?', null);
                else
                    response('Unknown error. ' + JSON.stringify(error) + ' With status code ' + res.statusCode, null);
            }
            else{
                response(null, body);
            }
        });
    };

}
module.exports = MicroServiceBusDAM;
