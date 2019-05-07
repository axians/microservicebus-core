function ImeiLoginHandler(settingsHelper){
    console.log("Signing in using IMEI")
    var os = require('os');
    var url = require('url');
    var request = require("request");
    var exec = require('child_process').exec;

    var self = this;
    const MAXIMEITRYCOUNT = 3;
    var currentImieTryCount = 0;
    var isFirstStart = settingsHelper.isFirstStart(); 
    this.interval = null;
    
    var packagePath = settingsHelper.nodePackagePath;

    process.env.NODE_PATH = packagePath;
    process.env.HOME = os.userInfo().homedir;

    this.start = function (callback) {
        this.interval = setInterval(function () {
            if (isFirstStart && (currentImieTryCount < MAXIMEITRYCOUNT)) {
                tryGetIMEI(function (imei) {
                    if (imei) {
                        clearInterval(self.interval);
                        self.interval = setInterval(function () {
                            tryLoginUsingICCID(imei, function (done) {
                                if (done) {
                                    clearInterval(self.interval);
                                    console.log("IMEI Signin: Restarting");
                                    callback();
                                }
                            });
                        }, 30000);
                    }
                    else {
                        currentImieTryCount++;
                    }
                });
            }
            else if (isFirstStart && (currentImieTryCount >= MAXIMEITRYCOUNT)) {
                clearInterval(self.interval);
                console.log();
                console.log("Was not able to get the IMEI id :(");
                console.log("Let's try logging in using whitelist instead...");
                console.log();

                process.argv.push("-w");
                callback("Unable to sign in using IMEI. Trying MAC address instead.");
                return;
            }
            else {
                pingBeforeStart(function (online) {
                    if (online) {
                        clearInterval(self.interval);
                        console.log("IMEI Signin: Online");
                        callback();
                    }
                })
            }
        }, 10000);
    };
    function pingBeforeStart(callback) {
        let host = process.env.MSB_HOST ? process.env.MSB_HOST: url.parse(settingsHelper.settings.hubUri).host;
        var uri = 'https://' + host;
        
        console.log("IMEI Signin: Pinging..." + uri);
        request.post({ url: uri, timeout: 5000 }, function (err, response, body) {
            if (err) {
                // Offline mode...
                if ((err.code === "ECONNREFUSED" ||
                    err.code === "EACCES" ||
                    err.code === "ENOTFOUND") &&
                    settingsHelper.settings.policies &&
                    settingsHelper.settings.policies.disconnectPolicy.offlineMode) {

                    console.log('Starting snap in offline mode');
                    require("./start.js");
                    callback(true);
                }
                else {
                    console.error("IMEI Signin: ERROR: error: " + err);
                    callback();
                    return;
                }
            }
            else if (response.statusCode !== 200) {
                console.error("IMEI Signin: FAILED: response: " + response.statusCode);
                callback();
                return;
            }
            else {
                console.log("IMEI Signin: Got response from microServiceBus.com. All good...");
                require("./start.js");
                callback(true);
            }
        })
    }

    function tryGetIMEI(callback) {

        exec("mmcli -m 0|sed \"s/'//g\"|grep -oE \"imei: (.*)\"|sed 's/imei: //g'", function (error, stdout, stderr) {
            console.log('IMEI Signin: imei: ' + stdout);
            if (error) {
                console.log("IMEI Signin: Unable to get the IMEI id");
                console.log('IMEI Signin: ERROR: ' + error);

                callback();
            }
            else {
                imei = stdout;
                callback(imei);
            }
        });
    }
    function tryLoginUsingICCID(imei, callback) {
        let host = process.env.MSB_HOST ? process.env.MSB_HOST: url.parse(settingsHelper.settings.hubUri).host;
        let uri = 'https://' + host + '/jasper/signInUsingICCID?iccid=' + imei;
        
        // NOT IMPLEMENTED IN PORTAL YET 2019-04-24
        //let uri = 'https://' + host + '/jasper/signInUsingIMEI?iccid=' + imei + '&hostname=' + os.hostname();

        console.log("IMEI Signin: calling jasper service..." + uri);
        request.post({ url: uri, timeout: 5000 }, function (err, response, body) {
            if (err) {
                console.error("IMEI Signin: ERROR: error: " + err);
                callback();
                return;
            }
            else if (response.statusCode === 302) {
                settingsHelper.settings.hubUri = "wss://" + url.parse(response.headers.location).host;
                console.log('REDIRECTED TO: ' + settingsHelper.settings.hubUri);
                settingsHelper.save();
                callback();
                return;

            }
            else if (response.statusCode !== 200) {
                console.error("IMEI Signin: FAILED: response: " + response.statusCode);
                callback();
                return;
            }
            else {
                console.log("IMEI Signin: Got settings from microServiceBus.com. All good...");

                var settings = JSON.parse(body);
                settingsHelper.settings.hubUri = "wss://" + host;
                settingsHelper.settings.id = settings.id;
                settingsHelper.settings.nodeName = settings.nodeName;
                settingsHelper.settings.organizationId = settings.organizationId;
                settingsHelper.settings.sas = settings.sas;
                settingsHelper.save();
                console.log("IMEI Signin: Saved settings");
                callback(true);
            }
        })
    }
}
module.exports = ImeiLoginHandler; 