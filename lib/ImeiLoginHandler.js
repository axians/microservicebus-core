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

function ImeiLoginHandler(settingsHelper){
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
                self.tryGetIMEI(function (imei, error) {
                    if(error){
                        console.log("IMEI Signin: Unable to get the IMEI id");
                        console.log('IMEI Signin: ERROR: ' + error);
                    }
                    if (imei) {
                        clearInterval(self.interval);
                        self.interval = setInterval(function () {
                            tryLoginUsingIMEI(imei, function (done) {
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

    this.tryGetIMEI = function(callback) {

        exec("mmcli -m 0|sed \"s/'//g\"|grep -oE \"imei: (.*)\"|sed 's/imei: //g'", function (error, stdout, stderr) {
            console.log('IMEI Signin: imei: ' + stdout);
            if (error) {
                callback(null, error);
            }
            else {
                let imei = stdout.length >= 14 ? stdout.substring(0,14) : null;
                callback(imei);
            }
        });
    }
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
    function tryLoginUsingIMEI(imei, callback) {
        let host = process.env.MSB_HOST ? process.env.MSB_HOST: url.parse(settingsHelper.settings.hubUri).host;
        //let uri = 'https://' + host + '/jasper/signInUsingICCID?iccid=' + imei;
        
        // NOT IMPLEMENTED IN PORTAL YET 2019-04-24
        let uri = `https://${host}/jasper/signInUsingIMEI?imeiId=${imei}&hostname=${os.hostname()}`;

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