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
var colors = require('colors');
var moment = require('moment');
var extend = require('extend');
var os = require("os");
var fs = require('fs');
var path = require('path');
var util = require('./utils.js');
var guid = require('uuid');
var pjson = require('../package.json');
var moment = require('moment');
const { utils } = require('mocha');
const { exec } = require('child_process');
var retryRequest = require('retry-request', {
    request: require('request')
});

function MicroServiceBusHost(settingsHelper) {
    var self = this;
    const DEBUGEXPIRATION = 1000 * 60 * 30 // Used for automaticly switching off debug output
    // Callbacks
    this.onStarted = null;
    this.onStopped = null;
    this.onUnitTestComlete = null;
    this.proxyService = null;

    // Handle settings
    var microServiceBusNode;
    var microServiceBusDAM;
    var microServiceBusDBusInterface;
    var _temporaryVerificationCode;
    var _useMacAddress = false;
    var _useAssert = false;
    var _client;
    var _heartBeatInterval;
    var _lastHeartBeatReceived = true;
    var _missedHeartBeats = 0;
    var _logStream;
    var _existingNodeName;
    var _debugModeEnabled = undefined;
    var _lastKnownLocation;
    var _locationNotification;
    var _locationNotificationInterval = 900000; // Report location every 15 minutes
    var _signInState = "NONE";
    var _lastConnectedTime;
    var _vulnerabilitiesScanJob;
    var _dockerHelper;
    var _dockerComposeHelper;
    var _ptyProcess, _ptyProcessUser;
    var _vpnHelper;
    // Add npm path to home folder as services are otherwise not able to require them...
    // This should be added to start.js in mSB-node
    var corePath = path.resolve(settingsHelper.nodePackagePath, "node_modules");
    require('app-module-path').addPath(corePath);
    require('module').globalPaths.push(corePath);
    require('module')._initPaths();

    if (!settingsHelper.settings.policies) {
        settingsHelper.settings.policies = {
            "disconnectPolicy": {
                "heartbeatTimeout": 120,
                "missedHearbeatLimit": 3,
                "disconnectedAction": "RESTART",
                "reconnectedAction": "NOTHING",
                "offlineMode": true
            }
        };
        settingsHelper.save();
    }
    // Called by HUB if it was ot able to process the request
    /* istanbul ignore next */
    function OnErrorMessage(message, code) {
        console.log('Error: '.red + message.red + " code: ".grey + code);

        if (code < 100) { // All exceptions less than 100 are serious and should reset settings

            let faultDescription = 'Node is being reset due to error code: ' + code + '. Message: ' + message;
            let faultCode = '00099';
            trackException(faultCode, faultDescription);

            try {
                _client.invoke('traceLog', os.hostname(), `${faultDescription}. CODE:${faultCode}`);
            }
            catch (e) { }
            // Wait 5 min before trying again
            setTimeout(() => {
                OnReset(null);
            }, 5 * 60 * 1000);
        }
        if (code === 101) { // The hub is notifying the node that the session 

            console.log('Restarting due to lost session.');
            restart();
        }
    }
    // Called by HUB when user clicks on the Hosts page
    function OnPing(id) {
        log("ping => " + microServiceBusNode.InboundServices().length + " active service(s)");

        _client.invoke('pingResponse', settingsHelper.settings.nodeName, os.hostname(), "Online", id, false);

    }
    // Called by HUB to receive all active services
    /* istanbul ignore next */
    function OnGetEndpoints(message) {
        console.log('OnGetEndpoints'.blue);
    }
    // Called by HUB when itineraries has been updated
    /* istanbul ignore next */
    function OnUpdateItinerary(flowServiceUri) {

        if (typeof (flowServiceUri) === "string") {
            microServiceBusNode.UpdateItinerary(flowServiceUri);
        }
        else {
            microServiceBusNode.UpdateItinerary_Legacy(flowServiceUri);
        }
        microServiceBusNode.PersistEvent("Updated flows");
    }
    // Called by HUB when itineraries has been updated
    function OnChangeState(state) {
        microServiceBusNode.ChangeState(state);
    }
    // Called by the HUB when disabling/enabling flow
    function OnUpdateFlowState(tineraryId, environment, enabled) {
        microServiceBusNode.UpdateFlowState(tineraryId, environment, enabled)
            .then(() => {
                microServiceBusNode.PersistEvent("Updated flow state");
            });
    }
    // Update debug mode
    function OnChangeDebug(debug) {
        microServiceBusNode.SetDebug(debug);
        _debugModeEnabled = debug ? Date.now() : Date.parse('2030-12-31');
        microServiceBusNode.PersistEvent("Debug = " + debug);
    }
    // Update debug mode
    function OnRestartCom(callback) {
        microServiceBusNode.RestartCom(() => {
            callback();
        });
    }
    // Enable remote debugging
    /* istanbul ignore next */
    function OnEnableDebug(connId) {
        log("CHANGING DEBUG MODE...");
        microServiceBusNode.PersistEvent("Enabled remote debugging");
        settingsHelper.settings.debugHost = connId;
        settingsHelper.save();
        // Stop SignalR
        _client.stop()
            .then(() => {
                process.send({ cmd: 'START-DEBUG' });
            })
            .catch(() => {
                process.send({ cmd: 'START-DEBUG' });
            });
        setTimeout(function () {
            log('Restarting for debug'.yellow);
            // Kill the process
            process.exit(98);

        }, 1000);
    }
    function OnStopDebug() {
        log("CHANGING DEBUG MODE...");
        microServiceBusNode.PersistEvent("Disaabled remote debugging");
        settingsHelper.settings.debugHost = undefined;
        settingsHelper.save();
        // Stop SignalR
        _client.stop()
            .then(() => {
                process.send({ cmd: 'STOP-DEBUG' });
            })
            .catch(() => {
                process.send({ cmd: 'STOP-DEBUG' });
            });

        setTimeout(function () {
            log('Restarting for debug'.red);
            // Kill the process
            process.exit();

        }, 1000);

    }
    // Enable remote debugging
    function OnChangeTracking(enableTracking) {
        microServiceBusNode.SetTracking(enableTracking);
        microServiceBusNode.PersistEvent("Tracking = " + enableTracking);
    }
    // Incoming message from HUB
    function OnSendMessage(message, destination) {
        log(message.blue);
    }
    // Called by HUB when signin  has been successful
    function OnSignInMessage(response) {
        log('Sign in complete...'.grey);
        response.basePath = __dirname;
        _signInState = "SIGNEDIN";
        microServiceBusNode.SignInComplete(response);

        if (response.policies.proxyPolicy && response.policies.proxyPolicy.enableProxy) {
            const ProxyService = require('./services/proxyService.js');
            self.proxyService = new ProxyService(log);
            self.proxyService.Start(response.policies.proxyPolicy)
                .then(() => {
                    log('Proxy started'.grey);
                })
                .catch(e => {
                    log('Proxy failed to start'.red);
                });
        }

        if (require("os").platform() === "linux" &&
            response.policies.logPolicy &&
            response.policies.logPolicy.transmitLogsAfterReboot) {
            util.getUptime()
                .then(seconds => {
                    if (seconds < 200) {
                        try {
                            OnUploadSyslogs(null, null, response.policies.logPolicy.account, response.policies.logPolicy.accountKey)
                        }
                        catch (e) {
                            log(`Unable to transmit log files. ${e}`.red);
                        }
                    }
                    else {
                        log(`System was rebooted ${(seconds / 60).toFixed(0)} minutes ago. No log files will be transmitted`.yellow);
                    }
                })
                .catch(e => {
                    log("Unable to fetch system uptime. No logs will be transmitted".red);
                })
        }

        log("Marking partition as good".yellow);
        let RaucHandler = require('./RaucHandler');
        let raucHandler = new RaucHandler();
        raucHandler.raucMarkPartition("good", "booted", function (err, slot, msg) {
            if (err) {
                log("Unable to mark partition as good".red + err);
            }
            else {
                log(`Successfully ${msg}`.green);
            }
        });

        _debugModeEnabled = response.debug ? Date.now() : Date.parse('2030-12-31');

        // Check if we're in debug mode
        if (process.execArgv.find(function (e) { return e.startsWith('--inspect'); }) !== undefined && !process.env.VSCODE_PID) {
            /* istanbul ignore next */
            require('network').get_active_interface(function (err, nw) {
                let maxWidth = 75;
                let debugUri = 'http://' + nw.ip_address + ':' + process.debugPort + '/json/list';
                require("request")(debugUri, function (err, response, body) {
                    if (response && response.statusCode === 200) {
                        log();
                        log(util.padRight("", maxWidth, ' ').bgGreen.white.bold);
                        log(util.padRight(" IN DEBUG", maxWidth, ' ').bgGreen.white.bold);
                        log(util.padRight(" IP: " + nw.ip_address, maxWidth, ' ').bgGreen.white.bold);
                        log(util.padRight(" PORT: " + process.debugPort, maxWidth, ' ').bgGreen.white.bold);

                        let debugList = JSON.parse(body);
                        _client.invoke(
                            'debugResponse',
                            {
                                debugHost: settingsHelper.settings.debugHost,
                                organizationId: settingsHelper.settings.organizationId,
                                list: debugList
                            }
                        );
                    }
                    else {
                        log('Unable to receive debug data.'.red);
                    }
                });


            });
        }
        // Check for wireguard installation
        exec("wg", function (error, stdout, stderr) {
            if (!error && !stderr) {
                _client.invoke('getVpnSettings', null);
            }
        });
    }
    // Called by HUB when node has been successfully created    
    /* istanbul ignore next */
    function OnNodeCreated(nodeData) {

        nodeData.machineName = os.hostname();

        settingsHelper.settings = extend(settingsHelper.settings, nodeData);

        log('Successfully created node: ' + nodeData.nodeName.green);

        settingsHelper.save();

        microServiceBusNode.settingsHelper = settingsHelper;
        microServiceBusNode.NodeCreated();

        _client.invoke('created', nodeData.id, settingsHelper.settings.nodeName, os.hostname(), "Online", nodeData.debug, pjson.version, settingsHelper.settings.organizationId);
        microServiceBusNode.PersistEvent("Node created");
    }
    // Called when the hub require state information (network, storage, memory and cpu)
    function OnReportState(id, debugCallback) {

        let network = require('network');
        _client.invoke('notify', id, `Fetching environment state from ${settingsHelper.settings.nodeName}.`, "INFO");

        network.get_interfaces_list(function (err, nw) {
            let path = os.platform() === 'win32' ? 'c:' : '/';

            var state = {
                networks: nw,
                memory: {
                    totalMem: (os.totalmem() / 1000 / 1000).toFixed(2) + ' Mb',
                    freemem: (os.freemem() / 1000 / 1000).toFixed(2) + ' Mb'
                },
                cpus: os.cpus(),
                os: os,
                env: process.env,
                devs: ['darwin', 'linux'].includes(os.platform()) ? fs.readdirSync('/dev') : []
            };
            util.getAvailableDiskspace(function (err, storeageState) {
                if (!err) {
                    state.storage = storeageState;
                }

                if (debugCallback) {
                    debugCallback(true);
                }
                else {
                    /* istanbul ignore next */
                    if (process.env.SNAP) {

                        let SnapHelper = require('./SnapHelper')
                        let snapHelper = new SnapHelper()
                        snapHelper.on('log', (msg) => {
                            log(msg);
                        });
                        snapHelper.listSnaps()
                            .then((list) => {
                                log("mapping snaps")
                                state.snapList = list.map((snap => {
                                    return {
                                        Name: snap.name,
                                        Version: snap.version,
                                        Rev: snap.revision,
                                        Tracking: snap["tracking-channel"],
                                        Publisher: snap.publisher ? snap.publisher["display-name"] : "-",
                                        Notes: snap.summary
                                    }
                                }));

                                log("REPORTED STATE - with snap")
                                _client.invoke('reportStateResponse', state, id);
                            })
                            .catch(e => {
                                log(`Error ${e}`);
                            });
                    }
                    /* istanbul ignore next */
                    else if (process.env.MSB_PLATFORM === "YOCTO" || process.env.MSB_PLATFORM === "AZUREIOTEDGE") {
                        let RaucHandler = require('./RaucHandler');
                        let raucHandler = new RaucHandler();
                        raucHandler.raucGetSlotStatus(function (err, raucState) {
                            if (!err) {
                                let arrayToObject = (array) =>
                                    array.reduce((obj, item) => {
                                        obj[item.key] = item.val
                                        return obj
                                    }, {})
                                state.raucState = {
                                    rootfs0: arrayToObject(raucState.rootfs0),
                                    rootfs1: arrayToObject(raucState.rootfs1)
                                };
                            }
                            log("REPORTED STATE - with yocto")
                            _client.invoke('reportStateResponse', state, id);
                        });
                    }
                    else {
                        log("REPORTED STATE - no snap or firmware info")
                        _client.invoke('reportStateResponse', state, id);
                    }
                }
            });
        });
        microServiceBusNode.PersistEvent("Required State");
    }
    // Update snap
    /* istanbul ignore next */
    function OnRefreshSnap(snap, mode, connid) {
        mode = snap.indexOf("microservicebus") === 0 ? "devmode" : mode;

        if (connid) {
            _client.invoke('notify', connid, `${settingsHelper.settings.nodeName} - Refreshing ${snap} (${mode})`, "INFO");
        }

        util.refreshSnap(snap, mode, function (err, output) {
            let msg = `${settingsHelper.settings.nodeName} - ${snap} is refreshed`;
            if (err) {
                msg = `${settingsHelper.settings.nodeName} - Unable to refresh ${snap}. Error: ${err}`;
            }
            _client.invoke('notify', connid, msg, "INFO");
            console.log(msg);
            console.log(output);
        });
    }
    // Called by HUB when node is to be resetted
    /* istanbul ignore next */
    function OnReset(id) {
        log("RESETTING NODE".bgRed.white);
        microServiceBusNode.PersistEvent("Node is being reset");
        var isRunningAsSnap = settingsHelper.isRunningAsSnap;
        let msbHubUri = settingsHelper.settings.hubUri;

        settingsHelper.settings = {
            "debug": false,
            "hubUri": msbHubUri,
            "useEncryption": false
        };
        settingsHelper.save();
        _client.invoke('notify', id, `Node ${settingsHelper.settings.nodeName} has been reset`, "INFO");
        // Stop all services
        microServiceBusNode.ForceStop(function (callback) {

            // Restart
            setTimeout(function () {
                if (isRunningAsSnap)
                    restart();
                else
                    process.exit();
            }, 3000);
        });
    }
    // Called by HUB when node is to be resetted
    /* istanbul ignore next */
    function OnResetKeepEnvironment(id) {
        log("RESETTING NODE".bgRed.white);
        microServiceBusNode.PersistEvent("Node is being reset");
        var isRunningAsSnap = settingsHelper.isRunningAsSnap;
        let msbHubUri = settingsHelper.settings.hubUri;

        settingsHelper.settings = {
            "debug": false,
            "hubUri": msbHubUri,
            "useEncryption": false
        };
        settingsHelper.save();

        _client.invoke('notify', id, `Node ${settingsHelper.settings.nodeName} has been reset`, "INFO");
        // Stop all services
        microServiceBusNode.ForceStop(function (callback) {
            // Restart
            setTimeout(function () {
                if (isRunningAsSnap)
                    restart();
                else
                    process.exit();
            }, 3000);
        });
    }
    // Calling for syslogs from the portal
    // Logs are extracted and pushed to blob storage
    /* istanbul ignore next */
    function OnUploadSyslogs(connectionId, f, account, accountKey, debugCallback) {
        if (os.platform() === 'win32') {
            _client.invoke('notify', connectionId, `${settingsHelper.settings.nodeName} is running on Windows. The Upload Syslog feature is not implemented on Windows.`, "ERROR");
            return;
        }

        log("Requesting syslogs");
        const tmpPath = "/tmp/";     // MUST end with / 'slash'
        const logPath = "/var/log/"; // MUST end with / 'slash'
        const filePattern = /^syslog.*|^messages.*|^system.*|^journallog.*/;

        let fileNamePrefix = settingsHelper.settings.organizationId + "-" + settingsHelper.settings.nodeName + "-" + new Date().toISOString().replace(/[:\.\-T]/g, '') + "-";
        util.addNpmPackage('azure-storage', function (err) {

            if (err) {
                log("Unable to add azure-storage package." + err);

                if (debugCallback) {
                    debugCallback(false);
                }
                else {
                    _client.invoke('notify', connectionId, "Unable to add azure-storage package." + err, "ERROR");
                }
                return;
            }
            else {
                log("azure-storage package installed.");
            }
            fs.readdir(logPath, function (err, items) {
                if (err) {
                    log(`ERROR: ${JSON.stringify(err)}`);
                    throw `${JSON.stringify(err)}`;
                }
                else if (items.length === 0) {
                    log("No files found");
                    throw "No files found";
                }
                else {
                    for (var i = 0; i < items.length; i++) {
                        // ignore non interesting log files.
                        if (!items[i].match(filePattern))
                            continue;

                        log("Found " + items[i]);
                        var originalFilePath = path.resolve(logPath, items[i]);
                        let newFilePath = path.resolve(tmpPath, fileNamePrefix + items[i] + ".gz");

                        util.compress(originalFilePath, newFilePath, function (err, fileName) {
                            if (err) {
                                log("Unable to create syslog file. " + err);
                                if (debugCallback) {
                                    debugCallback(false);
                                }
                                else {
                                    _client.invoke('notify', connectionId, "Unable to create syslog file. " + err, "ERROR");
                                }
                            }
                            else {
                                log("Compressed " + originalFilePath + " to " + fileName);

                                util.sendToBlobStorage(account, accountKey, settingsHelper.settings.organizationId, settingsHelper.settings.nodeName, fileName, "syslogs", function (err) {
                                    log("Sent " + fileName + " to blobstorage");
                                });
                            }
                        });
                    }
                }
            });
            util.extractJournal(tmpPath, account, accountKey, settingsHelper.settings.organizationId, settingsHelper.settings.nodeName, log).then(function () {
                log("Sent all journallogs");
                if (connectionId) {
                    _client.invoke('notify', connectionId, "Logfiles sent  to blobstorage", "INFO");
                }
            }).catch(function (e) {
                log("Error uploading syslogs " + e);
                if (connectionId) {
                    _client.invoke('notify', connectionId, "Error uploading syslogs " + e, "ERROR");
                }
            });

        });
    }
    // Called from portal to resubmit messages
    function OnResendHistory(req) {
        microServiceBusNode.ResendHistory(new Date(req.startdate), new Date(req.enddate));
        microServiceBusNode.PersistEvent("Resent history");
    }
    // Submitting events and alters to the portal
    function OnRequestHistory(req) {
        microServiceBusNode.RequestHistory(new Date(req.startdate).getTime(), new Date(req.enddate).getTime(), req.connId);
    }
    // Resetting the host in the settings.json and restarting the node
    function OnTransferToPrivate(req) {
        microServiceBusNode.PersistEvent("Node Transfered");
        settingsHelper.settings = {
            "debug": false,
            "hubUri": req.hubUri,
            "useEncryption": false
        };

        settingsHelper.save();
        restart();
    }
    // Triggered when token is updated
    function OnUpdatedToken(token) {
        microServiceBusNode.UpdateToken(token);
        log("Token has been updated");
        microServiceBusNode.PersistEvent("Updated token");

        // TODO!
        // Sign in again
    }
    // Triggered from portal to update Yocto firmware
    /* istanbul ignore next */
    function OnUpdateFirmware(force, connid) {
        let RaucHandler = require('./RaucHandler');
        let raucHandler = new RaucHandler();
        raucHandler.on('progress', function (progressInfo) {
            log(progressInfo);
        });
        raucHandler.raucGetSlotStatus(function (err, platformStatus) {
            if (err) {
                log("Unable to update firmware".red + err);
            }
            else {
                let rootfs0_status = platformStatus.rootfs0.find(function (p) { return p.key === 'state'; });
                let currentPlatform = rootfs0_status.val === "booted" ? platformStatus.rootfs0 : platformStatus.rootfs1;
                let platform = platformStatus.platform;
                let version = currentPlatform.find(function (p) { return p.key === 'bundle.version'; });
                let bootStatus = currentPlatform.find(function (p) { return p.key === 'boot-status'; });
                let installed = currentPlatform.find(function (p) { return p.key === 'installed.timestamp'; });

                if (!version) {
                    version = { val: "0.0.0" };
                }
                if (!bootStatus) {
                    bootStatus = { val: "FIRST INSTALL" };
                }
                if (!installed) {
                    installed = { val: "FIRST INSTALL" };
                }
                var uri = settingsHelper.settings.hubUri + '/api/nodeimages/' + settingsHelper.settings.organizationId + "/" + platform;
                uri = uri.replace('wss://', 'https://');
                log("Notified on new firmware".yellow);
                log("Current firmware platform: ".yellow + platform.grey);
                log("Current firmware version: ".yellow + version.val.grey);
                log("Current boot status: ".yellow + bootStatus.val.grey);
                log("Current firmware installed: ".yellow + installed.val.grey);

                log("Fetching meta data from: ".yellow + uri.grey);

                require("request")(uri, function (err, response, data) {
                    if (response.statusCode != 200 || err != null) {
                        log("No firmware image found".red);
                        return;
                    }
                    else {
                        let metamodel = JSON.parse(data);

                        if (force || util.compareVersion(metamodel.version, version.val)) {
                            if (settingsHelper.settings.state === "Active") {
                                microServiceBusNode.ChangeState("InActive");
                            }
                            log("New firmware version".yellow);
                            let dir = path.resolve(settingsHelper.homeDirectory, "firmwareimages");

                            if (!fs.existsSync(dir)) {
                                log("Creating firmwareimages directory".yellow);
                                fs.mkdirSync(dir);
                            }
                            else {
                                fs.readdirSync(dir).forEach(function (file, index) {
                                    log("Removing existing file".yellow);
                                    var curPath = path.resolve(dir, file);
                                    fs.unlinkSync(curPath);
                                });
                            }

                            var fileName = path.resolve(dir, path.basename(metamodel.uri));

                            var file = fs.createWriteStream(fileName);
                            var https = require('https');
                            log("Downloading image from ".yellow + metamodel.uri.grey);

                            let options = {
                                timeout: 1000 * 60 * 10, //10 min timeout
                            };
                            var request = https.get(metamodel.uri, options, function (response) {
                                response.pipe(file);
                                file.on('finish', function () {
                                    file.close(function () {
                                        log("Download complete".yellow);
                                        log("Calling RAUC".yellow);
                                        log("Installing ".yellow + fileName.grey);
                                        if (connid)
                                            _client.invoke('notify', connid, "Download complete, installation initiated on " + settingsHelper.settings.nodeName, "INFO");
                                        raucHandler.raucInstall(fileName, function (err) {
                                            if (err) {
                                                log("Unable to install RAUC image. ".red + err);
                                                if (connid)
                                                    _client.invoke('notify', connid, "Unable to install RAUC image on " + settingsHelper.settings.nodeName, "INFO");
                                            }
                                            else {
                                                log("Successfully installed RAUC image.".green);

                                                if (connid) {
                                                    _client.invoke('notify', connid, "Successfully installed RAUC image on " + settingsHelper.settings.nodeName + ". Node is now rebooting", "INFO");
                                                }
                                                setTimeout(function () {
                                                    util.reboot();
                                                }, 10000);
                                            }
                                        });
                                    });
                                });
                            }).on('error', function (err) { // Handle errors
                                fs.unlink(fileName); // Delete the file async. (But we don't check the result)
                                log("unable to download firmware".red);
                            });
                        }
                        else {
                            log("Already running latest version".yellow);
                        }
                    }
                });

            }
        });
    }
    /* istanbul ignore next */
    function OnSetBootPartition(partition, connid) {
        log("Marking partition ".yellow + partition);
        let RaucHandler = require('./RaucHandler');
        let raucHandler = new RaucHandler();
        raucHandler.raucMarkPartition("active", partition, function (err, slot, msg) {
            if (err) {
                log("Unable to mark partition".red + err);
            }
            else {
                log(`Successfully ${msg}. Rebooting...`.green);
                _client.invoke('notify', connid, "Successfully marked partition. Rebooting " + settingsHelper.settings.nodeName, "INFO");
                setTimeout(function () {
                    util.reboot();
                }, 2000);
            }
        });
    }
    // Call mSB-dam to update grants
    /* istanbul ignore next */
    function OnGrantAccess() {
        log("Grant Access called");
        //Load DAM dependency
        let MicroServiceBusDAM = require('./MicroServiceBusDAM.js');
        microServiceBusDAM = new MicroServiceBusDAM();
        //refresh grants
        microServiceBusDAM.refresh(function (err, response) {
            if (err) {
                log("Grants was not updated due to error: ".red + err);
            }
            else {
                log("Grants was updated".green);
            }
        });

    }
    // Execute tests script
    /* istanbul ignore next */
    function OnRunTest(testDescription) {
        log("Run test called");
        microServiceBusNode.RunTest(testDescription);
    }
    function OnPingNodeTest(connid) {
        _client.invoke('pingNodeTestResponse', { nodeId: settingsHelper.settings.id, connId: connid });
    }
    function OnUpdatePolicies(policies) {
        settingsHelper.settings.policies = policies;
        settingsHelper.save();
        log("Policies has been updated. Restarting".green);
        _client.invoke('logMessage', settingsHelper.settings.nodeName, `Polycies for ${settingsHelper.settings.nodeName} has been updated.`, settingsHelper.settings.organizationId);
        setTimeout(restart, 2000);
    }
    function OnExecuteScript(patchScript, parametes, connid) {
        let localPatchUri = settingsHelper.settings.hubUri + '/api/Scripts/' + patchScript;
        localPatchUri = localPatchUri.replace('wss://', 'https://');

        let requestOptions = {
            retries: 2,
            uri: localPatchUri
        };
        log(`Downloading script: ${localPatchUri}`);
        retryRequest(localPatchUri, requestOptions, function (err, response, scriptContent) {
            if (response.statusCode != 200 || err != null) {
                if (connid)
                    _client.invoke('notify', connid, `Unable to download ${localPatchUri} for ${settingsHelper.settings.nodeName}.`, "INFO");
            }
            else {
                let fileName = path.basename(patchScript);
                let localPatchScript = path.resolve(settingsHelper.serviceDirectory, fileName);

                scriptContent = scriptContent.replace("\r\n", "\n");

                fs.writeFileSync(localPatchScript, scriptContent);
                log("Executing script");
                util.executeScript(`${localPatchScript} ${parametes}`, function (err) {
                    log(`Done executing script. Errors: ${err}`);
                    if (connid)
                        _client.invoke('notify', connid, `${fileName} execute successfully on ${settingsHelper.settings.nodeName}.`, "INFO");
                });
            }
        });
    }
    function OnUpdateVulnerabilities(connid) {
        log('Vulnerabilities scan initiated'.gray);
        doVulnerabilitiesScan();
        _client.invoke('notify', connid, `Vulnerabilities scan initiated on ${settingsHelper.settings.nodeName}.`, "INFO");

    }
    // Docker operations
    function OnDockerListImages(request, connid) {
        initDockerHelper();

        _dockerHelper.listImages()
            .then(result => {
                log(`${arr.length} images installed before installation`);
                _client.invoke('dockerListImagesResponse', result, connid);
            })
            .catch(e => {
                log(`Error ${e}`)
            });
    };
    function OnDockerListContainers(request, connid) {
        initDockerHelper();

        _dockerHelper.listContainers(request.all)
            .then(result => {
                log(`${result.length} containers in total...`);
                log(JSON.stringify(result));
                _client.invoke('dockerListContainersResponse', result, connid);
            })
            .catch(e => {
                log(`Error ${e}`)
            });
    };
    function OnDockerInstallImage(request, connid) {
        initDockerHelper();

        let createImageRequest = {
            fromImage: request.fromImage
        }
        _client.invoke('dockerInstallImageResponse', `Starting to install ${request.fromImage}image`, connid);
        _dockerHelper.createImage(createImageRequest)
            .then(async result => {
                await _dockerHelper.wait(8000);

                let createContainerRequest = {
                    Image: request.image,
                    name: request.name
                }
                _client.invoke('dockerInstallImageResponse', `${request.fromImage} installed... starting up`, connid);
                _dockerHelper.createContainer(createContainerRequest)
                    .then(async () => {
                        await _dockerHelper.wait(2000);
                        _dockerHelper.startContainer(`/${createContainerRequest.name}`)
                            .then(async () => {
                                _client.invoke('dockerInstallImageResponse', `${request.fromImage} installed and started successfully`, connid);
                                await _dockerHelper.wait(4000);
                                _dockerHelper.listContainers(true)
                                    .then(result => {
                                        _client.invoke('dockerListContainersResponse', result, connid);
                                    })
                                    .catch(e => {
                                        log(`Error ${e}`)
                                    });
                            })
                            .catch(e => {
                                _client.invoke('dockerDeleteImageResponse', `Failed to start ${createContainerRequest.name}: ${e}`, connid);
                                console.log(`Error ${e} - ${createContainerRequest.name}`)
                            });
                    })
                    .catch(e => {
                        _client.invoke('dockerDeleteImageResponse', `Failed to create ${createContainerRequest.name}: ${e}`, connid);
                        console.log(`Error ${e}`)
                    });
            })
            .catch(e => {
                _client.invoke('dockerDeleteImageResponse', `Failed to install image ${request.fromImage}: ${e}`, connid);
                log(`Error ${e}`)
            });
    };
    function OnDockerDeleteImage(request, connid) {
        initDockerHelper();

        _dockerHelper.deleteContainer(request.name)
            .then(async () => {
                if (request.tryDeleteImage) {
                    await _dockerHelper.wait(2000);
                    _dockerHelper.deleteImage(container.data.Image)
                        .then(async () => {
                            _client.invoke('dockerDeleteImageResponse', `${request.name} deleted successfully`, connid);
                            await _dockerHelper.wait(2000);
                            _dockerHelper.listContainers(true)
                                .then(result => {
                                    _client.invoke('dockerListContainersResponse', result, connid);
                                })
                                .catch(e => {
                                    _client.invoke('dockerDeleteImageResponse', `Failed to delete ${request.name}: ${e}`, connid);
                                    log(`Error ${e}`)
                                });
                        })
                        .catch(e => {
                            _client.invoke('dockerDeleteImageResponse', `Failed to delete ${request.name}: ${e}`, connid);
                            console.log(`Error ${e}`)
                        });
                }
                else {
                    _client.invoke('dockerDeleteImageResponse', `${request.name} deleted successfully`, connid);
                    await _dockerHelper.wait(2000);
                    _dockerHelper.listContainers(true)
                        .then(result => {
                            _client.invoke('dockerListContainersResponse', result, connid);
                        })
                        .catch(e => {
                            log(`Error ${e}`)
                        });
                }
            })
            .catch(e => {
                _client.invoke('dockerDeleteImageResponse', `Failed to delete ${request.name}: ${e}`, connid);
                console.log(`Error ${e}`)
            });
    };
    function OnDockerStartContainer(request, connid) {
        initDockerHelper();
        log(`Starting container ${request.name}`);
        _dockerHelper.startContainer(request.name)
            .then(async result => {

                _client.invoke('dockerStartContainerResponse', `${request.name} started successfully`, connid);
                await _dockerHelper.wait(1000);
                _dockerHelper.listContainers(true)
                    .then(result => {
                        _client.invoke('dockerListContainersResponse', result, connid);
                    })
                    .catch(e => {
                        log(`Error ${e}`)
                    });
            })
            .catch(e => {
                console.log(`Error ${e}`)
            });
    };
    function OnDockerStopContainer(request, connid) {
        log(`Stopping container`);
        _dockerHelper.stopContainer(request.name)
            .then(async result => {
                _client.invoke('dockerStopContainerResponse', `${request.name} stopped successfully`, connid);
                await _dockerHelper.wait(1000);
                _dockerHelper.listContainers(true)
                    .then(result => {
                        _client.invoke('dockerListContainersResponse', result, connid);
                    })
                    .catch(e => {
                        log(`Error ${e}`)
                    });
            })
            .catch(e => {
                console.log(`Error ${e}`)
            });
    };
    function OnDockerComposeList(connid) {
        _client.invoke('notify', connid, `docker-compose list called on ${settingsHelper.settings.nodeName}.`, "INFO");
        initDockerContainerHelper()
            .then(() => {
                _dockerComposeHelper.list()
                    .then(async result => {
                        _client.invoke('dockerComposelistResponse', result, connid);
                    })
                    .catch(error => {
                        log(`Error ${error}`);
                        _client.invoke('notify', connid, `(OnDockerComposeList) ${error}`, "ERROR");
                    });
            })
            .catch(error => {
                log(e);
                _client.invoke('notify', connid, `(OnDockerComposeList) ${error}`, "ERROR");
            });
    }
    function OnDockerComposeInstall(request, connid) {
        _client.invoke('notify', connid, `docker-compose install called on ${settingsHelper.settings.nodeName}.`, "INFO");
        initDockerContainerHelper()
            .then(async () => {
                try {
                    const fileName = "docker-compose.yaml"
                    // Create directory
                    const dockerComposePath = path.resolve(settingsHelper.homeDirectory, "docker-compose");
                    if (!fs.existsSync(dockerComposePath)) {
                        fs.mkdirSync(dockerComposePath);
                    }
                    const dockerComposeService = request.name.replace(/\.[^/.]+$/, "");
                    const dockerComposeServicePath = path.resolve(dockerComposePath, dockerComposeService.toLowerCase());
                    if (!fs.existsSync(dockerComposeServicePath)) {
                        fs.mkdirSync(dockerComposeServicePath);
                    }

                    // Download docker-compose file
                    await util.downloadFile(dockerComposeServicePath, fileName, `${settingsHelper.settings.hubUri}/api/scripts${request.url}`);

                    // Download dependancy files
                    for (let index = 0; index < request.dependancies.length; index++) {
                        const dependancy = request.dependancies[index];
                        await util.downloadFile(dockerComposeServicePath, dependancy.name, `${settingsHelper.settings.hubUri}/api/scripts${dependancy.url}`);
                    }
                    await _dockerComposeHelper.build(dockerComposeServicePath);
                    await _dockerComposeHelper.up(dockerComposeServicePath);
                    const list = await _dockerComposeHelper.list();
                    _client.invoke('dockerComposelistResponse', list, connid);
                }
                catch (error) {
                    log(error);
                    _client.invoke('notify', connid, `(OnDockerComposeList) ${error}`, "ERROR");
                }
            })
            .catch(error => {
                log(error);
                _client.invoke('notify', connid, `(OnDockerComposeList) ${error}`, "ERROR");
            });
    }
    function OnDockerComposeDown(config, connid) {
        _client.invoke('notify', connid, `docker-compose down called on ${settingsHelper.settings.nodeName}.`, "INFO");
        initDockerContainerHelper()
            .then(async () => {
                // Create directory
                try {
                    const dockerComposePath = path.resolve(settingsHelper.homeDirectory, "docker-compose");
                    const dockerComposeServicePath = path.resolve(dockerComposePath, config.toLowerCase());
                    await _dockerComposeHelper.down(dockerComposeServicePath);
                    const list = await _dockerComposeHelper.list();
                    _client.invoke('dockerComposelistResponse', list, connid);
                }
                catch (error) {
                    log(error);
                    _client.invoke('notify', connid, `(OnDockerComposeList) ${error}`, "ERROR");
                }
            })
            .catch(error => {
                log(error);
                _client.invoke('notify', connid, `(OnDockerComposeList) ${error}`, "ERROR");
            });
    }
    // Pseudo terminal
    function OnStartTerminal(connid, user) {
        log(`Starting terminal for ${user}`);
        var pty, os;
        try {
            pty = require('node-pty');
        }
        catch (ex) {
            _client.invoke('terminalError', `Terminal dependencies are not yet installed. Please try again in a couple of minutes.`, connid);
            util.addNpmPackage('node-pty', (err) => {
                if (err) {
                    log(`Unable to install terminal dependancies. Error ${err}`);
                }
                else {
                    log(`Terminal dependencies installed successfully.`);
                    _ptyProcessUser = user;
                    os = require('os');
                    pty = require('node-pty');

                    var shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

                    _ptyProcess = pty.spawn(shell, [], {
                        name: 'xterm-color',
                        cols: 100,
                        rows: 100,
                        cwd: process.env.HOME,
                        env: process.env
                    });

                    _ptyProcess.on('data', function (data) {
                        _client.invoke('terminalData', data, connid);
                    });
                    _client.invoke('terminalReady', connid);
                    log(`Terminal started`);
                }
            });
            return;
        }
        _ptyProcessUser = user;
        os = require('os');
        pty = require('node-pty');

        var shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

        _ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-color',
            cols: 100,
            rows: 100,
            cwd: process.env.HOME,
            env: process.env
        });

        _ptyProcess.on('data', function (data) {
            _client.invoke('terminalData', data, connid);
        });
        _client.invoke('terminalReady', connid);
        log(`Terminal started`);
    }
    function OnStopTerminal() {
        if (_ptyProcess) {
            _ptyProcess.kill();
            _ptyProcess = null;
            log(`terminal closed for ${_ptyProcessUser}`);
            _ptyProcessUser = null;

        }
    }
    function OnTerminalCommand(command) {
        _ptyProcess.write(command);
        //console.log(`terminal command: ${command}`);
    }
    function OnDownloadFile(request) {
        let requestOptions = {
            retries: 2,
            uri: request.uri
        };
        var filename = path.parse(request.uri).base;
        var filePath = path.resolve(request.directory, request.fileName);
        if (fs.existsSync(filePath) && !request.overrideIfExists) {
            log("Local file already exists.");
            _client.invoke('notify', request.connId, "Local file already exists.", "ERROR");
        }
        else {
            var file = fs.createWriteStream(filePath);
            let https = require('https');
            var fileDownloadResponse = `${request.fileName} has successfully been saved in ${request.directory} on ${settingsHelper.settings.nodeName}`;
            var connId = request.connId
            var request = https.get(request.uri, function (response) {
                response.pipe(file);
                file.on('finish', () => {
                    file.close();  // close() is async, call cb after close completes.
                    log(fileDownloadResponse);
                    _client.invoke('notify', connId, fileDownloadResponse, "INFO");
                });

            }).on('error', function (err) { // Handle errors
                fs.unlink(dest); // Delete the file async. (But we don't check the result)
                log(`Unable to save file. Error: ${err}`);
                _client.invoke('notify', request.connId, `Unable to save file. Error: ${err}`, "ERROR");
            });
        }
    }
    function OnUploadFile(request) {
        util.addNpmPackage('azure-storage', function (err) {
            if (err) {
                log("Unable to add azure-storage package." + err);
                _client.invoke('notify', request.connId, "Unable to install required packages", "ERROR");
                return;
            }
            else if (!fs.existsSync(request.file)) {
                _client.invoke('notify', request.connId, `File ${request.file} does not exist.`, "ERROR");
            }
            else {
                log("azure-storage package installed.");
                util.sendToBlobStorage(request.account, request.accountKey, settingsHelper.settings.organizationId, settingsHelper.settings.nodeName, request.file, request.containerName, (err, x, y) => {
                    log(`Sent ${request.file} to blob storage`);
                    const azure = require('azure-storage');
                    var blobService = azure.createBlobService(request.account, request.accountKey);
                    // let fileName = path.basename(request.file);
                    // let blobUri = `${request.containerUri}/${fileName}${request.containerSas}`;

                    var startDate = new Date();
                    var expiryDate = new Date(startDate);
                    expiryDate.setMinutes(startDate.getMinutes() + 100);
                    startDate.setMinutes(startDate.getMinutes() - 100);

                    var sharedAccessPolicy = {
                        AccessPolicy: {
                            Permissions: azure.BlobUtilities.SharedAccessPermissions.READ,
                            Start: startDate,
                            Expiry: expiryDate
                        }
                    };

                    var token = blobService.generateSharedAccessSignature(request.containerName, path.basename(request.file), sharedAccessPolicy);
                    var blobUri = blobService.getUrl(request.containerName, path.basename(request.file), token);

                    _client.invoke('downloadResponse', request.connId, blobUri, path.basename(request.file));
                });
            }
        });
    }
    function initDockerHelper() {
        if (!_dockerHelper) {
            let DockerHelper = require('./DockerHelper');
            _dockerHelper = new DockerHelper();
            _dockerHelper.on("log", function (m) {
                log(`docker: ${m}`);
            });
            _dockerHelper.isInstalled()
                .then(installed => {
                    if (installed) {
                        _dockerHelper.init();
                    }
                });
        }
    }
    function initDockerContainerHelper() {
        return new Promise(async (resolve, reject) => {
            if (!_dockerComposeHelper) {
                const DockerComposeHelper = require('./DockerComposeHelper');
                _dockerComposeHelper = new DockerComposeHelper();
                _dockerComposeHelper.on("log", function (m) {
                    log(`docker-compose: ${m}`);
                });

                const installed = await _dockerComposeHelper.isInstalled();

                if (installed) {
                    log("docker-compose is installed");
                    resolve();
                }
                else {
                    log("docker-compose is not installed");
                    _client.invoke('notify', connid, `docker-compose is not installed on ${settingsHelper.settings.nodeName}`, "ERROR");
                    reject(`docker-compose is not installed on ${settingsHelper.settings.nodeName}`);
                }
            }
            else {
                resolve();
            }
        });
    }
    // Sends heartbeat to server every disconnectPolicy.heartbeatTimeout interval
    /* istanbul ignore next */
    function startHeartBeat() {

        if (!_heartBeatInterval) {

            log("Connection: Heartbeat started".grey);
            _heartBeatInterval = setInterval(function () {
                var lastHeartBeatId = guid.v1();
                log("Connection: Heartbeat triggered".grey);

                if (!_lastHeartBeatReceived || _signInState != "SIGNEDIN") {
                    log("Connection: MISSING HEARTBEAT".bgRed.white);
                    _missedHeartBeats++;
                    if (_missedHeartBeats > settingsHelper.settings.policies.disconnectPolicy.missedHearbeatLimit) {
                        log("Connection: UNABLE TO RESOLVE CONNECTION".bgRed.white);

                        switch (settingsHelper.settings.policies.disconnectPolicy.disconnectedAction) {
                            case "RESTART":
                                log("Connection: TRYING TO RESTART".bgRed.white);
                                restart();
                                break;
                            case "REBOOT":
                                log("Connection: TRYING TO REBOOT".bgRed.white);
                                reboot();
                                break;
                            default:
                                log("Connection: NO ACTION TAKEN".bgRed.white);
                                break;
                        }
                    }
                }

                if (_signInState != "SIGNEDIN") {
                    log("Connection: MISSING SIGNIN RESPONSE".bgRed.white);
                    process.exit(99);
                }

                _client.invoke(
                    'heartBeat',
                    lastHeartBeatId
                );

                microServiceBusNode.RestorePersistedMessages();

                _lastHeartBeatReceived = false;
            }, settingsHelper.settings.policies.disconnectPolicy.heartbeatTimeout * 1000);
        }
        //doVulnerabilitiesScan();
    }
    /* istanbul ignore next */
    function startVulnerabilitiesScan() {
        if (_vulnerabilitiesScanJob || !settingsHelper.settings.isManaged) {
            return;
        }

        let CronJob = require('cron').CronJob;
        let timezone = settingsHelper.settings.timezone ? settingsHelper.settings.timezone : 'GMT';
        let seconds = Math.floor(Math.random() * (+59 - +0));
        let minutes = Math.floor(Math.random() * (+59 - +0));
        let pattern = `${seconds} ${minutes} 0 * * *`;
        _vulnerabilitiesScanJob = new CronJob({
            cronTime: pattern,
            onTick: function () {
                doVulnerabilitiesScan();
            },
            start: true,
            timeZone: timezone
        });
    }
    function doVulnerabilitiesScan() {
        log("Vulnerabilities scan started");
        (async () => {
            // Set up response ...
            const vulnerabilities = {
                organizationId: settingsHelper.settings.organizationId,
                id: settingsHelper.settings.id,
                nodeName: settingsHelper.settings.nodeName,
                dateTime: new Date()
            }

            // Get npm vulnerabilities
            const npmAudit = await util.npmAudit();
            if (!npmAudit.error) {
                vulnerabilities.npmVulnabilities = npmAudit.npmVulnabilities;
            }

            // Get all snaps
            const SnapHelper = require('./SnapHelper')
            const snapHelper = new SnapHelper()
            snapHelper.on('log', (msg) => {
                //log(msg);
            });
            const snapList = await snapHelper.listSnaps()
            vulnerabilities.snapList = snapList.map(snap => {
                return {
                    name: snap.name,
                    version: snap.version,
                    revision: snap.revision,
                    channel: snap.channel,
                    publisher: snap.publisher ? snap.publisher["display-name"] : "-",
                    summary: snap.summary,
                    description: snap.description,
                    confinement: snap.confinement,
                    devmode: snap.devmode
                }
            });

            // Get daemon and package vulnerabilities
            const DebianVulnerabilityHelper = require('./DebianVulnerabilityHelper')
            const debianVulnerabilityHelper = new DebianVulnerabilityHelper()
            vulnerabilities.packageVulnerabilities = await debianVulnerabilityHelper.scan();

            let zlib = require('zlib');
            zlib.gzip(JSON.stringify(vulnerabilities), (err, buffer) => {
                if (!err) {
                    const options = {
                        uri: settingsHelper.settings.hubUri.replace('wss://', 'https://') + "/api/nodes/uploadblob/0",
                        body: buffer,
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    };

                    require('request').post(options, (error, response, body) => {
                        if (error) {
                            log("Vulnerabilities scan failed: " + error);
                            return;
                        }
                        log("Vulnerabilities scan completed");
                    });
                } else {
                    log("Unable to compress volnabilities");
                }
            });

        })();
        util.npmAudit(function (err, npmVulnabilities) {
            var volnabilities = {
                organizationId: settingsHelper.settings.organizationId,
                id: settingsHelper.settings.id,
                nodeName: settingsHelper.settings.nodeName,
                dateTime: new Date(),
                npmVulnabilities: npmVulnabilities
            }
            let SnapHelper = require('./SnapHelper')
            let snapHelper = new SnapHelper()
            snapHelper.on('log', (msg) => {
                log(msg);
            });
            snapHelper.listSnaps()
                .then((list) => {
                    log("mapping snaps")
                    volnabilities.snapList = list.map(snap => {
                        return {
                            name: snap.name,
                            version: snap.version,
                            revision: snap.revision,
                            channel: snap.channel,
                            publisher: snap.publisher ? snap.publisher["display-name"] : "-",
                            summary: snap.summary,
                            description: snap.description,
                            confinement: snap.confinement,
                            devmode: snap.devmode
                        }
                    });
                    let zlib = require('zlib');
                    zlib.gzip(JSON.stringify(volnabilities), (err, buffer) => {
                        if (!err) {
                            const options = {
                                uri: settingsHelper.settings.hubUri.replace('wss://', 'https://') + "/api/nodes/uploadblob/0",
                                body: buffer,
                                headers: {
                                    'Content-Type': 'application/json'
                                }
                            };

                            require('request').post(options, (error, response, body) => {
                                if (error) {
                                    log("Vulnerabilities scan failed: " + error);
                                    return;
                                }
                                log("Vulnerabilities scan completed");
                            });
                        } else {
                            log("Unable to compress volnabilities");
                        }
                    });
                })
                .catch(e => {
                    log(`Error ${e}`);
                });
        });
    }
    // Sends location data to mSB
    function startLocationNotification() {
        if (!_locationNotification) {
            log("startLocationNotification started");
            if (_lastKnownLocation) {
                _client.invoke(
                    'location',
                    _lastKnownLocation
                );
            }
            _locationNotification = setInterval(function () {
                if (_lastKnownLocation) {
                    log("Submitting location: " + JSON.stringify(_lastKnownLocation));
                    _client.invoke(
                        'location',
                        _lastKnownLocation
                    );
                }
            }, _locationNotificationInterval);
        }
    }
    // Allways logs to console and submits debug info to the portal if settings.debug === true
    function log(message, force) {
        message = message === undefined ? "" : message;

        if (settingsHelper.settings.log && _logStream) {
            _logStream.write(new Date().toString() + ': ' + colors.strip(message) + '\r\n');
        }

        console.log("mSB: ".gray + message);

        if ((settingsHelper.settings.debug || force) &&
            _client &&
            _client.isConnected()) {// jshint ignore:line  
            _client.invoke(
                'logMessage',
                settingsHelper.settings.nodeName,
                message,
                settingsHelper.settings.organizationId);
        }

        if (_debugModeEnabled && (Date.now() > _debugModeEnabled + DEBUGEXPIRATION)) {
            settingsHelper.settings.debug = false;
            _debugModeEnabled = undefined;
            _client.invoke(
                'logMessage',
                settingsHelper.settings.nodeName,
                "Disabling console output due to time expiration",
                settingsHelper.settings.organizationId);
        }
    }
    // submits exception data to the tracking
    function trackException(faultCode, faultDescription) {
        if (!faultCode)
            return;

        let messageBuffer = new Buffer('');
        let time = moment();
        let msg = {
            TimeStamp: time.utc().toISOString(),
            InterchangeId: guid.v1(),
            IntegrationId: '',
            IntegrationName: '',
            Environment: '',
            TrackingLevel: '',
            ItineraryId: '',
            CreatedBy: '',
            LastActivity: '',
            ContentType: '',
            Itinerary: '',
            NextActivity: null,
            Node: settingsHelper.settings.nodeName,
            OrganizationId: settingsHelper.settings.organizationId,
            MessageBuffer: null,
            _messageBuffer: messageBuffer.toString('base64'),
            IsBinary: false,
            IsLargeMessage: false,
            IsCorrelation: false,
            IsFirstAction: true,
            IsFault: true,
            IsEncrypted: false,
            Variables: [],
            FaultCode: faultCode,
            FaultDescripton: faultDescription
        };

        microServiceBusNode.TrackException(msg, null, "Fault", faultCode, faultDescription);
    }
    // Set up SignalR _client
    function setupClient() {
        if (settingsHelper.settings.hubUri.startsWith('wss://')) {
            settingsHelper.settings.hubUri = settingsHelper.settings.hubUri.replace('wss://', 'https://');
        }
        var SignalRClient = require('./SignalRClient');
        _client = new SignalRClient(settingsHelper.settings.hubUri);
        setupClientEvents();
    }
    // Set up SignalR event listeners
    function setupClientEvents() {
        // Wire up signalR events
        _client.on('bound', function () {
            log("Connection: " + "bound".yellow);
        });
        _client.on('connectFailed', function (error) {
            log("Connection: " + "Connect Failed: ".red + error.red);
            let faultDescription = "Connect failed from mSB.com. " + error;
            let faultCode = '00098';
            trackException(faultCode, faultDescription);
            microServiceBusNode.ReportEvent(faultDescription);
            settingsHelper.isOffline = true;
        });
        _client.on('connected', function (connection) {
            let connectTime = new Date().getTime();
            if (_lastConnectedTime) {
                if (connectTime - _lastConnectedTime < 3000) {
                    log("Reconnection loop detected. Restarting");
                    microServiceBusNode.ReportEvent("Reconnection loop detected");
                    restart();
                    return;
                }
            }
            _lastConnectedTime = connectTime;
            log("Connection: " + "Connected".green);

            if (!settingsHelper.settings.policies) {
                settingsHelper.settings.policies = {
                    "disconnectPolicy": {
                        "heartbeatTimeout": 120,
                        "missedHearbeatLimit": 3,
                        "disconnectedAction": "RESTART",
                        "reconnectedAction": "NOTHING",
                        "offlineMode": true
                    }
                };
            }
            _signInState = "INPROCESS";
            microServiceBusNode.settingsHelper = settingsHelper;
            if (settingsHelper.isOffline) { // We are recovering from offline mode
                log('Connection: *******************************************'.bgGreen.white);
                log('Connection: RECOVERED FROM OFFLINE MODE...'.bgGreen.white);
                log('Connection: *******************************************'.bgGreen.white);
                settingsHelper.isOffline = false;
                _missedHeartBeats = 0;
                _lastHeartBeatReceived = true;


                switch (settingsHelper.settings.policies.disconnectPolicy.reconnectedAction) {
                    case "UPDATE":
                        microServiceBusNode.Stop(function () {
                            microServiceBusNode.SignIn(_existingNodeName, _temporaryVerificationCode, _useMacAddress, false);
                        });
                        break;
                    case "NOTHING":
                        microServiceBusNode.SignIn(_existingNodeName, _temporaryVerificationCode, _useMacAddress, true);
                        _signInState = "SIGNEDIN";
                    default:
                        break;
                }
            }
            else {
                microServiceBusNode.SignIn(_existingNodeName, _temporaryVerificationCode, _useMacAddress, null, _useAssert);
            }
            microServiceBusNode.ReportEvent("Connected to mSB.com");
            startVulnerabilitiesScan();
        });
        _client.on('disconnected', function () {

            log("Connection: " + "Disconnected".yellow);
            let faultDescription = 'Node has been disconnected.';
            let faultCode = '00098';
            trackException(faultCode, faultDescription);
            microServiceBusNode.ReportEvent("Disconnected from mSB.com");
            settingsHelper.isOffline = true;
        });
        _client.on('onerror', function (error) {
            log("SignalR: ".green + "Error - " + error);

            if (!error) {
                return;
            }

            let faultDescription = error;
            let faultCode = '00097';
            trackException(faultCode, faultDescription);

            try {
                if (error.endsWith("does not exist for the organization")) {
                    if (self.onStarted)
                        self.onStarted(0, 1);
                }
            }
            catch (e) { }
        });
        _client.on('onUnauthorized', function (error) {
            log("Connection: " + "Unauthorized: ".red, error);
        });
        _client.on('messageReceived', function (message) {
            //console.log("Connection: " + "messageReceived: ".yellow + message.utf8Data);
        });
        _client.on('bindingError', function (error) {
            log("Connection: " + "Binding Error: ".red + error);
            // Check if on offline mode
            if ((error.code === "ECONNREFUSED" || error.code === "EACCES" || error.code === "ENOTFOUND") &&
                !settingsHelper.isOffline &&
                settingsHelper.settings.offlineSettings) {

                log('*******************************************'.bgRed.white);
                log('SIGN IN OFFLINE...'.bgRed.white);
                log('*******************************************'.bgRed.white);

                settingsHelper.isOffline = true;

                microServiceBusNode.SignInComplete(settingsHelper.settings.offlineSettings);
            }
            startHeartBeat();
        });
        _client.on('connectionLost', function (error) { // This event is forced by server
            log("Connection: " + "Connection Lost".red);
        });
        _client.on('reconnected', function (connection) {
            // This feels like it would be a good idea, but I haven't got around to test it...
            _client.invoke('reconnected', settingsHelper.settings.id);
            log("Connection: " + "Reconnected ".green);
        });
        _client.on('reconnecting', function (retry) {
            log("Connection: " + "Retrying to connect (".yellow + retry.count + ")".yellow);
            return true;
        });

        // Wire up signalR inbound events handlers
        _client.on('errorMessage', function (message, errorCode) {
            OnErrorMessage(message, errorCode);
        });
        _client.on('ping', function (message) {
            OnPing(message);
        });
        _client.on('getEndpoints', function (message) {
            OnGetEndpoints(message);
        });
        _client.on('updateItinerary', function (updatedItinerary) {
            OnUpdateItinerary(updatedItinerary);
        });
        _client.on('changeState', function (state) {
            OnChangeState(state);
        });
        _client.on('changeDebug', function (debug) {
            OnChangeDebug(debug);
        });
        _client.on('changeTracking', function (enableTracking) {
            OnChangeTracking(enableTracking);
        });
        _client.on('sendMessage', function (message, destination) {
            OnSendMessage(message, destination);
        });
        _client.on('signInMessage', function (response) {
            OnSignInMessage(response);
        });
        _client.on('nodeCreated', function (nodeData) {
            OnNodeCreated(nodeData);
        });
        _client.on('heartBeat', function (id) {
            log("Connection: Heartbeat received".grey);
            _missedHeartBeats = 0;
            _lastHeartBeatReceived = true;

        });
        _client.on('forceUpdate', function () {
            log("forceUpdate".red);
            restart();
        });
        _client.on('restart', function () {
            log("restart".red);
            restart();
        });
        _client.on('restartCom', function (nodeId, nodeName, organizationId) {
            OnRestartCom(() => {
                _client.invoke('restartComCompleted', nodeId, nodeName, organizationId);
            });
        });
        _client.on('reboot', function () {
            log("reboot".red);
            reboot();
        });
        _client.on('shutdown', function () {
            log("shutdown".red);
            shutdown();
        });
        _client.on('refreshSnap', function (snap, mode, connId) {
            log("Refreshing snap ".yellow + snap.gray);
            log(`devmode = ${snap.indexOf("microservicebus") === 0}`);
            OnRefreshSnap(snap, mode, connId);
        });
        _client.on('reset', function (id) {
            OnReset(id);
        });
        _client.on('resetKeepEnvironment', function (id) {
            OnResetKeepEnvironment(id);
        });
        _client.on('updateFlowState', function (itineraryId, environment, enabled) {
            OnUpdateFlowState(itineraryId, environment, enabled);
        });
        _client.on('enableDebug', function (connId) {
            OnEnableDebug(connId);
        });
        _client.on('stopDebug', function (connId) {
            OnStopDebug();
        });
        _client.on('reportState', function (id) {
            OnReportState(id);
        });
        _client.on('uploadSyslogs', function (connectionId, fileName, account, accountKey) {
            OnUploadSyslogs(connectionId, fileName, account, accountKey);
        });
        _client.on('resendHistory', function (req) {
            OnResendHistory(req);
        });
        _client.on('requestHistory', function (req) {
            OnRequestHistory(req);
        });
        _client.on('transferToPrivate', function (req) {
            OnTransferToPrivate(req);
        });
        _client.on('updatedToken', function (token) {
            OnUpdatedToken(token);
        });
        _client.on('updateFirmware', function (force, connid) {
            OnUpdateFirmware(force, connid);
        });
        _client.on('grantAccess', function () {
            OnGrantAccess();
        });
        _client.on('runTest', function (testDescription) {
            OnRunTest(testDescription);
        });
        _client.on('pingNodeTest', function (connid) {
            OnPingNodeTest(connid);
        });
        _client.on('updatePolicies', function (policies) {
            OnUpdatePolicies(policies);
        });
        _client.on('setBootPartition', function (partition, connid) {
            OnSetBootPartition(partition, connid);
        });
        _client.on('executeScript', function (patchScript, connid) {
            let parameters = "";
            if (path.basename(patchScript).indexOf(" ") > 0) { // Check for parameters
                parameters = patchScript.split(" ").splice(1).join(" ");
                patchScript = patchScript.split(" ")[0];
            }

            OnExecuteScript(patchScript, parameters, connid);
        });
        _client.on('updateVulnerabilities', function (connid) {
            OnUpdateVulnerabilities(connid);
        });
        _client.on('dockerListImages', function (request, connid) {
            OnDockerListImages(request, connid);
        });
        _client.on('dockerListContainers', function (request, connid) {
            OnDockerListContainers(request, connid);
        });
        _client.on('dockerInstallImage', function (request, connid) {
            OnDockerInstallImage(request, connid);
        });
        _client.on('dockerDeleteImage', function (request, connid) {
            OnDockerDeleteImage(request, connid);
        });
        _client.on('dockerStartContainer', function (request, connid) {
            OnDockerStartContainer(request, connid);
        });
        _client.on('dockerStopContainer', function (request, connid) {
            OnDockerStopContainer(request, connid);
        });
        _client.on('dockerComposeList', function (connid) {
            OnDockerComposeList(connid);
        });
        _client.on('dockerComposeInstall', function (request, connid) {
            OnDockerComposeInstall(request, connid);
        });
        _client.on('dockerComposeUp', function (config, connid) {
            OnDockerComposeUp(config, connid);
        });
        _client.on('dockerComposeDown', function (config, connid) {
            OnDockerComposeDown(config, connid);
        });

        _client.on('startTerminal', function (connid, user) {
            OnStartTerminal(connid, user);
        });
        _client.on('stopTerminal', function () {
            OnStopTerminal();
        });
        _client.on('terminalCommand', function (command) {
            OnTerminalCommand(command);
        });
        _client.on('downloadFile', function (request) {
            OnDownloadFile(request);
        });
        _client.on('uploadFile', function (request) {
            OnUploadFile(request);
        });
        _client.on('getVpnSettingsResponse', async function (vpnConfig, interfaceName, endpoint) {
            const vpnConfigPath = `${settingsHelper.homeDirectory}/${interfaceName}.conf`;
            const VpnHelper = require('./VpnHelper');
            _vpnHelper = new VpnHelper(vpnConfigPath);
            var http = require('http');

            if (!vpnConfig) { // VPN disabled
                await _vpnHelper.down();
                log("VPN deactivated");
                return;
            }

            try {
                const nw = await util.getNetWorkInterfaces();
                let ip = nw.ip_address;

                if(settingsHelper.settings.vpnHostIp){ // Used for nodes hosted behind private ip's
                    ip = settingsHelper.settings.vpnHostIp
                }
                

                if (ip === endpoint) { // No change...continue to set up interface
                    fs.writeFile(vpnConfigPath, vpnConfig, async (err) => {
                        if (err) {
                            log(`Failed saving VPN Configuration: ${JSON.stringify(err)}`);
                            return;
                        }
                        try {
                            await _vpnHelper.down();
                            await _vpnHelper.up();
                            log(`VPN successfully activated ${ip}`);
                        } catch (error) {
                            log(`Failed activating VPN: ${error}`);
                        }
                    });
                }
                else { // Notify portal that the IP has changed
                    _client.invoke('updateVpnEndpoint', ip);
                    log(`VPN successfully activated ${ip}`);
                }
            } catch (error) {

            }
        });
        _client.on('refreshVpnSettings', function (vpnConfig, interfaceName) {
            _client.invoke('getVpnSettings', null);
        });
    }
    function shutDownVpn() {
        if (_vpnHelper) {
            _vpnHelper.down().then(() => {
                log("VPN session has been terminated.".green);
                _vpnHelper = null;
            }).catch(e => {
                log(`Failed to shut down VPN: ${e}`);
                _vpnHelper = null;
            });
        }
    }
    // this function is called when you want the server to die gracefully
    // i.e. wait for existing connections
    /* istanbul ignore next */
    function gracefulShutdown() {
        log("bye");
        shutDownVpn();
        _client.invoke('signOut', settingsHelper.settings.nodeName, os.hostname(), "Offline");
        log("Received kill signal, shutting down gracefully.");
        log(settingsHelper.settings.nodeName + ' signing out...');
        setTimeout(function () {
            process.kill(process.pid, 'SIGKILL');
        }, 100);

    }
    /* istanbul ignore next */
    function restart() {
        let cachedFiles = Object.keys(require.cache).filter((c) => {
            return true;;
        });
        log(cachedFiles.length + " cached elements");

        cachedFiles.forEach((c) => {
            delete require.cache[c];
        });
        log('require cache cleared');

        log("bye");
        shutDownVpn();
        _client.invoke('signOut', settingsHelper.settings.nodeName, os.hostname(), "Offline");
        log("Received kill signal, shutting down gracefully.");
        log(settingsHelper.settings.nodeName + ' signing out...');
        microServiceBusNode.ForceStop(function () {
            setTimeout(function () {
                log('Restarting'.red);
                process.kill(process.pid, 'SIGKILL');
            }, 2000);
        });
    }
    /* istanbul ignore next */
    function shutdown() {
        log("bye");
        shutDownVpn();
        if (_vpnHelper) {
            _vpnHelper.down().then(() => {
                log("VPN session has been terminated.".green);
                _vpnHelper = null;
            }).catch(e => {
                log(`Failed to shut down VPN: ${e}`);
                _vpnHelper = null;
            });
        }
        _client.invoke('signOut', settingsHelper.settings.nodeName, os.hostname(), "Offline");
        log("Received kill signal, shutting down gracefully.");
        log(settingsHelper.settings.nodeName + ' signing out...');
        setTimeout(function () {
            setTimeout(function () {
                util.shutdown();
            }, 500);
        }, 500);
    }
    /* istanbul ignore next */
    function reboot() {
        log("bye");
        _client.invoke('signOut', settingsHelper.settings.nodeName, os.hostname(), "Offline");
        log("Received kill signal, shutting down gracefully.");
        log(settingsHelper.settings.nodeName + ' signing out...');
        setTimeout(function () {
            setTimeout(function () {
                util.reboot();
            }, 500);
        }, 500);
    }
    this.isConnected = function () {
        return _client.isConnected();
    }
    this.version = function () {
        var pjson = util.requireNoCache('../package.json');
        return pjson.version;
    }

    // Prototypes
    MicroServiceBusHost.prototype.Start = function (testFlag) {
        try {
            util.displayAnsiiLogo();
            log(`Core version: ${this.version()}`);
            testFlag = false;
            if (!testFlag) {
                // listen for TERM signal .e.g. kill 
                process.on('SIGTERM', function (x) {
                    gracefulShutdown();
                });

                // listen for INT signal e.g. Ctrl-C
                process.on('SIGINT', function (x) {
                    gracefulShutdown();
                });

                process.on('uncaughtException', function (err) {
                    /* istanbul ignore next */
                    if (err.errno === 'EADDRINUSE' || err.errno === 'EACCES') {
                        log("");
                        log("Error: ".red + "The address is in use. Either close the program is using the same port, or change the port of the node in the portal.".yellow);
                    }
                    else if (err.message == 'gracefulShutdown is not defined') {
                        gracefulShutdown();
                    }
                    else if (err.message == 'Error: channel closed') {
                        gracefulShutdown();
                    }
                    else
                        log('Uncaught exception: '.red + err);
                    log('Stack: '.red + err.stack);

                });
                /* istanbul ignore next */
                process.on('unhandledRejection', err => {
                    log("SERIOUS ERROR (mSB-core): Caught unhandledRejection", true);

                    if (err === "WebSocket is not in the OPEN state") {
                        _client.stop()
                            .then(() => {
                                log("SignalR client is stopped".yellow);
                            })
                            .catch(() => {
                                log("Unable to stop SignalR client".red);
                            });
                    }

                    if (err && typeof (err) === 'object') {
                        log(JSON.stringify(err), true);
                    }
                    else {
                        log(err, true);
                    }
                });
            }

            var args = process.argv.slice(2);

            if (settingsHelper.settings.log) {
                _logStream = fs.createWriteStream(settingsHelper.settings.log);
            }
            /* istanbul ignore next */
            let showError = function () {
                log('Sorry, missing arguments :('.red);
                log('To start the node using temporary verification code, use the /code paramenter.'.yellow);
                log('Visit https://microServiceBus.com/nodes to generate a code.'.yellow);
                log('');
                log('Eg: node start -c ABCD1234 -n node00001'.yellow);
                log('');
                log("If you're using a private- or self hosted instance of microsServiceBus.com".yellow);
                log('  you should use the /env parameter git the instance:'.yellow);
                log('Eg: node start -c ABCD1234 -n node00001 -env myorg.microservicebus.com'.yellow);
                log('');
                log('There are many other ways to provition your nodes, such as through white listing '.grey);
                log('  MAC addresses or through integration with Cisco Jasper'.grey);
                log('');


                if (self.onStarted) {
                    self.onStarted(0, 1);
                }
                process.send({ cmd: 'SHUTDOWN' });
                //process.exit(99);
            };
            let showHelp = function () {
                log('By only typing "node start", the Node will register it self to be claimed in the microService.com. This '.yellow);
                log("\taction will however require Site Manager privilages, unless your are connected to a private instance.".yellow);
                log();
                log('To start the node using temporary verification code, use the -code or -c paramenter.'.yellow);
                log('Visit https://microServiceBus.com/nodes to generate a code.'.yellow);
                log('');
                log('Eg: node start -c ABCD1234 -n node00001'.yellow);
                log('');
                log("If you're using a private- or self hosted instance of microsServiceBus.com".yellow);
                log('  you should use the /env parameter git the instance:'.yellow);
                log('Eg: node start -c ABCD1234 -n node00001 -env myorg.microservicebus.com'.yellow);
                log('');
                log('There are many other ways to provition your nodes, such as through white listing '.grey);
                log('  MAC addresses or through integration with Cisco Jasper'.grey);
                log();
                log('For more information, visit https://docs.microservicebus.com/provitioning-of-nodes'.yellow);
                log('');


                if (self.onStarted) {
                    self.onStarted(0, 1);
                }
                process.send({ cmd: 'SHUTDOWN' });
                //process.exit(99);
            };

            settingsHelper.settings.hubUri = process.env.MSB_HOST ?
                `https://${process.env.MSB_HOST}` :
                settingsHelper.settings.hubUri;


            // Log in using settings
            if (settingsHelper.settings.hubUri && settingsHelper.settings.nodeName && settingsHelper.settings.organizationId) { // jshint ignore:line
                if (args.length > 0 && (args[0] == '/n' || args[0] == '-n')) {
                    settingsHelper.settings.nodeName = args[1];
                }
                log('Logging in using settings'.grey);
            }
            // First login
            else if (args.length > 0) {
                _useAssert = true;
                for (let index = 0; index < args.length; index++) {
                    var arg = args[index];
                    switch (arg) {
                        case '--imei':
                            _useAssert = false;
                            let ImeiLoginHandler = require("./ImeiLoginHandler");
                            let imeiLoginHandler = new ImeiLoginHandler(settingsHelper);
                            imeiLoginHandler.start(function (err) {
                                process.argv = process.argv.filter(function (value, index, arr) {
                                    return value != "--imei";
                                });
                                self.Start(testFlag);
                            });
                            return;
                        case '--assert':
                            _useAssert = true;
                            break;
                        case '-w':
                        case '/w':
                            _useAssert = false;
                            _useMacAddress = true;
                            break;
                        case '/c':
                        case '-c':
                        case '-code':
                        case '/code':
                            _useAssert = false;
                            if (!args[index + 1] || args[index + 1].startsWith('-'))
                                showError();
                            _temporaryVerificationCode = args[index + 1];
                            index++;
                            break;
                        case '/n':
                        case '-n':
                            _useAssert = false;
                            if (!args[index + 1] || args[index + 1].startsWith('-'))
                                showError();
                            _existingNodeName = args[index + 1];
                            index++;
                            break;
                        case '/env':
                        case '-env':
                            if (!args[index + 1] || args[index + 1].startsWith('-'))
                                showError();
                            settingsHelper.settings.hubUri = 'wss://' + args[index + 1];
                            settingsHelper.save();
                            index++;
                            break;
                        case '--beta':
                            break;
                        case '--help':
                        case '/h':
                        case '-h':
                            showHelp();
                            return;
                        default: {
                            break;
                            // showError();
                            // return;
                        }
                    }
                }
            }
            else {
                // showError();
                // return;
                _useAssert = true;
            }
            if (typeof String.prototype.startsWith != 'function') {
                // see below for better implementation!
                String.prototype.startsWith = function (str) {
                    return this.indexOf(str) === 0;
                };
            }
            // Only used for localhost
            var debug = process.execArgv.find(function (e) { return e.startsWith('--debug'); }) !== undefined;
            var args = process.argv.slice(1);

            if (settingsHelper.settings.hubUri === "wss://localhost:44390")
                process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";


            // Load microservicebus-core
            var MicroServiceBusNode = require("./MicroServiceBusNode.js");

            microServiceBusNode = new MicroServiceBusNode(settingsHelper);
            microServiceBusNode.nodeVersion = pjson.version;
            microServiceBusNode.OnStarted(function (loadedCount, exceptionCount) {
                if (self.onStarted)
                    self.onStarted(loadedCount, exceptionCount);
            });
            microServiceBusNode.OnStopped(function () {
            });
            microServiceBusNode.OnSignedIn(function (hostData) {
                hostData.npmVersion = pjson.version;
                hostData.platform = util.platform();
                log('Hub: ' + settingsHelper.settings.hubUri.green);
                log('Node: ' + settingsHelper.settings.nodeName.green);
                log('Signing in...'.grey);

                _client.invoke(
                    'signInAsync',
                    hostData
                );
            });
            microServiceBusNode.OnPingResponse(function () {
                _client.invoke(
                    'signedIn',
                    settingsHelper.settings.nodeName,
                    os.hostname(),
                    "Online",
                    settingsHelper.settings.organizationId,
                    false
                );
            });
            microServiceBusNode.OnLog(function (message, force) {
                log(message, force);
            });
            microServiceBusNode.OnCreateNode(function (_temporaryVerificationCode, hostPrefix, _existingNodeName) {
                log('Create node...'.grey);
                _client.invoke(
                    'createNode',
                    _temporaryVerificationCode,
                    hostPrefix,
                    _existingNodeName
                );
            });
            microServiceBusNode.OnCreateNodeFromMacAddress(function (macAddress) {
                _client.invoke(
                    'createNodeFromMacAddress',
                    macAddress
                );
            });
            microServiceBusNode.OnAssertNode(function (request) {
                _client.invoke(
                    'assertNode',
                    request
                );
                log();
                log(`Device information such as host name, MAC addresses and IP addresses`.yellow);
                log(`has been submitted to ${settingsHelper.settings.hubUri.replace('wss://', '')} to pre-register the Node.`.yellow);
                log(`Please visit ${settingsHelper.settings.hubUri.replace('wss://', 'https://')}/Nodes to claim this Node.`.yellow);
                log();

            });
            microServiceBusNode.OnUpdatedItineraryComplete(function () {
                self.OnUpdatedItineraryComplete();
            });
            /* istanbul ignore next */
            microServiceBusNode.OnAction(function (message) {
                log('Action received: '.grey + message.action);
                switch (message.action) {
                    case "restart":
                        log("restart".red);
                        restart();
                        return;
                    case "reboot":
                        log("reboot".red);
                        reboot();
                        return;
                    default:
                        log("Unsupported action");
                        break;
                }
            });
            /* istanbul ignore next */
            microServiceBusNode.OnReportLocation(function (location) {
                log('Reporting location...');
                _lastKnownLocation = location;
                startLocationNotification();

            });
            microServiceBusNode.OnRequestHistory(function (historyData) {
                log('sending history data...');
                _client.invoke(
                    'requestHistoryDataResponse',
                    historyData
                );
            });
            microServiceBusNode.OnTestResult(function (result) {
                _client.invoke(
                    'testResultResponse',
                    result
                );
            });
            microServiceBusNode.OnTestComplete(function (caller) {
                _client.invoke(
                    'testCompleteResponse',
                    caller
                );
                restart();
            });
            microServiceBusNode.OnUnitTestComplete(function (result) {
                self.onUnitTestComlete(result);
            });

            setupClient();
            _client.start()
                .then(() => {
                    initDockerHelper();
                })
                .catch((error) => {
                    if ((error.code === "ECONNREFUSED" || error.code === "EACCES" || error.code === "ENOTFOUND") &&
                        !settingsHelper.isOffline &&
                        settingsHelper.settings.offlineSettings) {

                        log('*******************************************'.bgRed.white);
                        log('SIGN IN OFFLINE...'.bgRed.white);
                        log('*******************************************'.bgRed.white);

                        settingsHelper.isOffline = true;

                        microServiceBusNode.SignInComplete(settingsHelper.settings.offlineSettings);
                    }
                    else {
                        setTimeout(() => {
                            restart();
                        }, 10000);
                    }
                });

            // Start interval if we're not online after 2 min
            setTimeout(() => {
                startHeartBeat();

            }, 120000);

            if (os.platform() !== 'win32' && !process.env.UNITTEST) {
                let MicroServiceBusDBusInterface = require("./MicroServiceBusDBusInterface");
                microServiceBusDBusInterface = new MicroServiceBusDBusInterface(this, function (err) {
                    if (err) {
                        //console.log(err);
                    }
                    else {
                        microServiceBusDBusInterface.Start()
                            .then(function () {
                                log('DBUS:'.green + ' Interface exposed to DBus clients');
                            })
                            .catch(function (err) {
                                log('DBUS:'.green + ' ERROR: '.red + err.red);
                            });
                    }
                });

            }

            // Startig using proper config
            if (settingsHelper.settings.nodeName != null && settingsHelper.settings.organizationId != null) {
                if (_temporaryVerificationCode != null)
                    log('Settings has already set. Temporary verification code will be ignored.'.gray);

                settingsHelper.settings.machineName = os.hostname();
                settingsHelper.save();
            }
        }
        catch (err) {
            log("Unable to start".red);
            log("ERROR:".red + err);
            log("Stack:".red + err.stack);
        }
    };
    MicroServiceBusHost.prototype.OnStarted = function (callback) {
        this.onStarted = callback;
    };
    MicroServiceBusHost.prototype.OnStopped = function (callback) {
        this.onStopped = callback;
    };
    MicroServiceBusHost.prototype.OnUnitTestComplete = function (callback) {
        this.onUnitTestComlete = callback;
    };
    MicroServiceBusHost.prototype.OnUpdatedItineraryComplete = function (callback) {
        this.onUpdatedItineraryComplete = callback;
    };

    // Test methods
    MicroServiceBusHost.prototype.SetTestParameters = function (message) {

    };
    MicroServiceBusHost.prototype.TestOnPing = function (message) {
        try {
            OnPing(message);
        }
        catch (ex) {
            return false;
        }
        return true;
    };
    MicroServiceBusHost.prototype.TestStop = function (callback) {
        microServiceBusNode.ChangeState("InActive", function (err) {
            callback(err);
        });
    };
    MicroServiceBusHost.prototype.TestOnChangeTracking = function (callback) {
        try {
            OnChangeTracking(true);
            setTimeout(() => {
                callback(settingsHelper.settings.enableTracking);
            }, 200);
        }
        catch (ex) {
            callback(false);;
        }
    };
    MicroServiceBusHost.prototype.TestOnReportState = function (callback) {
        try {
            OnReportState("11234", function (success) {
                callback(success);
            });
        }
        catch (ex) {
            callback(false);;
        }
    };
    MicroServiceBusHost.prototype.TestOnUploadSyslogs = function (callback) {
        try {
            if (os.platform() === 'win32' || os.platform() === 'win64') {
                callback(true);
            }
            else {
                OnUploadSyslogs('1234', "", "microservicebusstorage", "poSL/pkag8TiKLVNmFvPyNbVQe2koRujwYF91fK9XqkKX0tSwSXqZnGqSswu0QV4IyJBibWk7ZFmNeHFTMCu1g==", function (success) {
                    callback(success);
                });
            }
        }
        catch (ex) {
            callback(false);
        }
        return true;
    };
    MicroServiceBusHost.prototype.TestOnChangeDebug = function (callback) {

        try {
            OnChangeDebug(true);
            setTimeout(() => {
                callback(settingsHelper.settings.debug);
            }, 200);
        }
        catch (ex) {
            callback(false);
        }
    };
    MicroServiceBusHost.prototype.TestOnUpdateItinerary = function (updatedItinerary) {
        try {
            OnUpdateItinerary(updatedItinerary);
        }
        catch (ex) {
            return false;
        }
        return true;
    };
    MicroServiceBusHost.prototype.TestOnChangeState = function (state) {
        OnChangeState(state);
        return true;
    };
    MicroServiceBusHost.prototype.TestThrowError = function (state) {

    };
}

module.exports = MicroServiceBusHost;
