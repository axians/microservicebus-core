'use strict';
const os = require('os');
const supportedPlatforms = ['darwin', 'linux'];
const SNAP_COMMON = process.env.SNAP_COMMON || os.tmpdir();
const socketPath = `http://unix:${SNAP_COMMON}/socket/dam.sock:`;
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
                    response('Socket not avaliable. Is DAM installed and/or running? Interfaces connected?', null);
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
