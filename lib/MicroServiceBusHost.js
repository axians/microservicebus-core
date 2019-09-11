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
var signalR = require('./signalR.js');
var moment = require('moment');
var extend = require('extend');
var os = require("os");
var fs = require('fs');
var path = require('path');
var util = require('./utils.js');
var guid = require('uuid');
var pjson = require('../package.json');
var moment = require('moment');
var retryRequest = require('retry-request', {
    request: require('request')
});

function MicroServiceBusHost(settingsHelper) {
    var self = this;

    // Callbacks
    this.onStarted = null;
    this.onStopped = null;
    this.onUnitTestComlete = null;

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
    var _debugMode = false;
    var _lastKnownLocation;
    var _locationNotification;
    var _locationNotificationInterval = 900000; // Report location every 15 minutes
    var _signInState = "NONE";
    var _lastConnectedTime;
    var _vulnerabilitiesScanJob;

    // Add npm path to home folder as services are otherwise not able to require them...
    // This should be added to start.js in mSB-node
    if (!settingsHelper.isRunningAsSnap) {
        var corePath = path.resolve(settingsHelper.nodePackagePath, "node_modules");
        require('app-module-path').addPath(corePath);
        require('module').globalPaths.push(corePath);
        require('module')._initPaths();
    }
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

            OnReset(null);
        }
        if (code === 101) { // The hub is notifying the node that the session 

            console.log('Restarting due to lost session.');
            restart();
        }
    }
    // Called by HUB when user clicks on the Hosts page
    function OnPing(id) {
        log("ping => " + microServiceBusNode.InboundServices().length + " active service(s)");

        _client.invoke('integrationHub', 'pingResponse', settingsHelper.settings.nodeName, os.hostname(), "Online", id, false);

    }
    // Called by HUB to receive all active services
    /* istanbul ignore next */
    function OnGetEndpoints(message) {
        console.log('OnGetEndpoints'.blue);
    }
    // Called by HUB when itineraries has been updated
    /* istanbul ignore next */
    function OnUpdateItinerary(updatedItinerary) {
        microServiceBusNode.UpdateItinerary(updatedItinerary);
        microServiceBusNode.PersistEvent("Updated flows");
    }
    // Called by HUB when itineraries has been updated
    function OnChangeState(state) {
        microServiceBusNode.ChangeState(state);
    }
    // Called by the HUB when disabling/enabling flow
    function OnUpdateFlowState(tineraryId, environment, enabled) {
        microServiceBusNode.UpdateFlowState(tineraryId, environment, enabled);
        microServiceBusNode.PersistEvent("Updated flow state");
    }
    // Update debug mode
    function OnChangeDebug(debug) {
        microServiceBusNode.SetDebug(debug);
        microServiceBusNode.PersistEvent("Debug = " + debug);
    }
    // Enable remote debugging
    /* istanbul ignore next */
    function OnEnableDebug(connId) {
        log("CHANGING DEBUG MODE...");
        microServiceBusNode.PersistEvent("Enabled remote debugging");
        settingsHelper.settings.debugHost = connId;
        settingsHelper.save();
        // Stop SignalR
        _client.end();
        _client = undefined;

        // Send notification to parent
        process.send({ cmd: 'START-DEBUG' });

        setTimeout(function () {
            log('Restarting for debug'.yellow);
            // Kill the process
            process.exit(98);

        }, 100);
    }
    function OnStopDebug() {
        log("CHANGING DEBUG MODE...");
        microServiceBusNode.PersistEvent("Disaabled remote debugging");
        settingsHelper.settings.debugHost = undefined;
        settingsHelper.save();
        // Stop SignalR
        _client.end();
        _client = undefined;

        // Send notification to parent
        process.send({ cmd: 'STOP-DEBUG' });

        setTimeout(function () {
            log('Restarting for debug'.red);
            // Kill the process
            process.exit();

        }, 100);

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

        // Check if we're in debug mode
        if (process.execArgv.find(function (e) { return e.startsWith('--inspect'); }) !== undefined && !process.env.VSCODE_PID) {
            /* istanbul ignore next */
            require('network').get_active_interface(function (err, nw) {
                let maxWidth = 75;
                let debugUri = 'http://' + nw.ip_address + ':' + process.debugPort + '/json/list';
                require("request")(debugUri, function (err, response, body) {
                    if (response.statusCode === 200) {
                        log();
                        log(util.padRight("", maxWidth, ' ').bgGreen.white.bold);
                        log(util.padRight(" IN DEBUG", maxWidth, ' ').bgGreen.white.bold);
                        log(util.padRight(" IP: " + nw.ip_address, maxWidth, ' ').bgGreen.white.bold);
                        log(util.padRight(" PORT: " + process.debugPort, maxWidth, ' ').bgGreen.white.bold);

                        let debugList = JSON.parse(body);
                        _client.invoke(
                            'integrationHub',
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

        _client.invoke('integrationHub', 'created', nodeData.id, settingsHelper.settings.nodeName, os.hostname(), "Online", nodeData.debug, pjson.version, settingsHelper.settings.organizationId);
        microServiceBusNode.PersistEvent("Node created");
    }
    // Called when the hub require state information (network, storage, memory and cpu)
    function OnReportState(id, debugCallback) {

        let network = require('network');
        _client.invoke('integrationHub', 'notify', id, `Fetching environment state from ${settingsHelper.settings.nodeName}.`, "INFO");

        network.get_interfaces_list(function (err, nw) {
            //let disk = require('diskusage');
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
                        util.getSnapList(function (err, snapList) {
                            if (!err) {
                                state.snapList = snapList;
                            }
                            else {
                                log("Unable to get snap info." + err);
                            }
                            log("REPORTED STATE - with snap")
                            _client.invoke('integrationHub', 'reportStateResponse', state, id);
                        });
                    }
                    /* istanbul ignore next */
                    else if (process.env.MSB_PLATFORM === "YOCTO") {
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
                            _client.invoke('integrationHub', 'reportStateResponse', state, id);
                        });
                    }
                    else {
                        log("REPORTED STATE - no snap or firmware info")
                        _client.invoke('integrationHub', 'reportStateResponse', state, id);
                    }
                }
            });
        });
        microServiceBusNode.PersistEvent("Required State");
    }
    // Update snap
    /* istanbul ignore next */
    function OnRefreshSnap(snap, mode, connid) {
        if (connid) {
            _client.invoke('integrationHub', 'notify', connid, `${settingsHelper.settings.nodeName} - Refreshing ${snap}`, "INFO");
        }
        util.refreshSnap(snap, mode, function (err, output) {
            let msg = `${settingsHelper.settings.nodeName} - ${snap} is refreshed`;
            if (err) {
                msg = `${settingsHelper.settings.nodeName} - Unable to refresh ${snap}. Error: ${err}`;
            }
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
        let msbHubUri = process.env.MSB_HOST ? "wss://" + process.env.MSB_HOST : "wss://microservicebus.com";

        settingsHelper.settings = {
            "debug": false,
            "hubUri": msbHubUri,
            "useEncryption": false
        };
        settingsHelper.save();
        _client.invoke('integrationHub', 'notify', id, `Node ${settingsHelper.settings.nodeName} has been reset`, "INFO");
        // Stop all services
        microServiceBusNode.ForceStop(function (callback) {

            // Restart
            setTimeout(function () {
                if (isRunningAsSnap)
                    restart();
                else
                    process.exit();
            }, 3000);

            /*
            //  Remove microservicebus.core
            util.removeNpmPackage("microservicebus-core", function (err) {
                if (err) {
                    log("ERROR: Unable to remove microservicebus-core".red);
                    log(err.grey);
                }
                else {
                    log("microservicebus-core was successfully removed".green);
                    util.rebuild(function (err) {
                        if (err)
                            log(err.red);
                        else
                            log("Rebuild complete.".green);
                        if (id)
                            _client.invoke('integrationHub', 'resetConfirmed', settingsHelper.settings.nodeName, id);

                        // Restart
                        setTimeout(function () {
                            if (isRunningAsSnap)
                                restart();
                            else
                                process.exit();
                        }, 3000);
                    });
                }
            });
            */
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

        _client.invoke('integrationHub', 'notify', id, `Node ${settingsHelper.settings.nodeName} has been reset`, "INFO");
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
            _client.invoke('integrationHub', 'notify', connectionId, `${settingsHelper.settings.nodeName} is running on Windows. The Upload Syslog feature is not implemented on Windows.`, "ERROR");
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
                    _client.invoke('integrationHub', 'notify', connectionId, "Unable to add azure-storage package." + err, "ERROR");
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
                                    _client.invoke('integrationHub', 'notify', connectionId, "Unable to create syslog file. " + err, "ERROR");
                                }
                            }
                            else {
                                log("Compressed " + originalFilePath + " to " + fileName);

                                util.sendToBlobStorage(account, accountKey, settingsHelper.settings.organizationId, settingsHelper.settings.nodeName, fileName, function (err) {
                                    log("Sent " + fileName + " to blobstorage");
                                });
                            }
                        });
                    }
                }
            });
            util.extractJournal(tmpPath, account, accountKey, settingsHelper.settings.organizationId, settingsHelper.settings.nodeName, log).then(function () {
                log("Sent all journallogs");
                _client.invoke('integrationHub', 'notify', connectionId, "Logfiles sent  to blobstorage", "INFO");
            }).catch(function (e) {
                log("Error uploading syslogs " + e);
                _client.invoke('integrationHub', 'notify', connectionId, "Error uploading syslogs " + e, "ERROR");
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


                            var request = https.get(metamodel.uri, function (response) {
                                response.pipe(file);
                                file.on('finish', function () {
                                    file.close(function () {
                                        log("Download complete".yellow);
                                        log("Calling RAUC".yellow);
                                        log("Installing ".yellow + fileName.grey);
                                        if (connid)
                                            _client.invoke('integrationHub', 'notify', connid, "Download complete, installation initiated on " + settingsHelper.settings.nodeName, "INFO");
                                        raucHandler.raucInstall(fileName, function (err) {
                                            if (err) {
                                                log("Unable to install RAUC image. ".red + err);
                                                if (connid)
                                                    _client.invoke('integrationHub', 'notify', connid, "Unable to install RAUC image on " + settingsHelper.settings.nodeName, "INFO");
                                            }
                                            else {
                                                log("Successfully installed RAUC image.".green);
                                                if (connid)
                                                    _client.invoke('integrationHub', 'notify', connid, "Successfully installed RAUC image on " + settingsHelper.settings.nodeName + ". Node is now rebooting", "INFO");

                                                _client.end();
                                                setTimeout(function () {
                                                    util.reboot();
                                                }, 2000);

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
        raucHandler.raucMarkPartition(partition, function (err) {
            if (err) {
                log("Unable to mark partition".red + err);
            }
            else {
                log("Successfully marked partition. Rebooting...".green);
                _client.invoke('integrationHub', 'notify', connid, "Successfully marked partition. Rebooting " + settingsHelper.settings.nodeName, "INFO");
                setTimeout(function () {
                    util.reboot();
                }, 2000);
            }
        })
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
        _client.invoke('integrationHub', 'pingNodeTestResponse', { nodeId: settingsHelper.settings.id, connId: connid });
    }
    function OnUpdatePolicies(policies) {
        settingsHelper.settings.policies = policies;
        settingsHelper.save();
        log("Policies has been updated. Restarting".green);
        _client.invoke('integrationHub', 'logMessage', settingsHelper.settings.nodeName, `Polycies for ${settingsHelper.settings.nodeName} has been updated.`, settingsHelper.settings.organizationId);
        setTimeout(restart, 2000);
    }
    function OnExecuteScript(patchScript, connid) {

        let localPatchUri = settingsHelper.settings.hubUri + '/api/Scripts/' + patchScript;
        localPatchUri = localPatchUri.replace('wss://', 'https://');
        let requestOptions = {
            retries: 2,
            uri: localPatchUri
        };
        retryRequest(localPatchUri, requestOptions, function (err, response, scriptContent) {
            if (response.statusCode != 200 || err != null) {
                if (connid)
                    _client.invoke('integrationHub', 'notify', connid, `Unable to download ${localPatchUri} for ${settingsHelper.settings.nodeName}.`, "INFO");
            }
            else {
                let fileName = path.basename(patchScript);
                let localPatchScript = path.resolve(settingsHelper.serviceDirectory, fileName);
                fs.writeFileSync(localPatchScript, scriptContent);
                util.executeScript(localPatchScript, function (err) {
                    if (connid)
                        _client.invoke('integrationHub', 'notify', connid, `${fileName} execute successfully on ${settingsHelper.settings.nodeName}.`, "INFO");
                });
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
                    'integrationHub',
                    'heartBeat',
                    lastHeartBeatId
                );

                microServiceBusNode.RestorePersistedMessages();

                _lastHeartBeatReceived = false;
            }, settingsHelper.settings.policies.disconnectPolicy.heartbeatTimeout * 1000);
        }
    }
    /* istanbul ignore next */
    function startVulnerabilitiesScan() {
        if (_vulnerabilitiesScanJob) {
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
                log("Vulnerabilities scan started");
                util.npmAudit(function (err, volnabilities) {
                    volnabilities.organizationId = settingsHelper.settings.organizationId;
                    volnabilities.id = settingsHelper.settings.id;
                    volnabilities.nodeName = settingsHelper.settings.nodeName;
                    volnabilities.dateTime = new Date();

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
                });
            },
            start: true,
            timeZone: timezone
        });

    }
    // Sends location data to mSB
    function startLocationNotification() {
        if (!_locationNotification) {
            log("startLocationNotification started");
            if (_lastKnownLocation) {
                _client.invoke(
                    'integrationHub',
                    'location',
                    _lastKnownLocation
                );
            }
            _locationNotification = setInterval(function () {
                if (_lastKnownLocation) {
                    log("Submitting location: " + JSON.stringify(_lastKnownLocation));
                    _client.invoke(
                        'integrationHub',
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

        if ((settingsHelper.settings.debug || force) && _client && _client.isConnected()) {// jshint ignore:line  
            _client.invoke(
                'integrationHub',
                'logMessage',
                settingsHelper.settings.nodeName,
                message,
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
        _client = new signalR.client(
            settingsHelper.settings.hubUri + '/signalR',
            ['integrationHub'],
            10, //optional: retry timeout in seconds (default: 10)
            true
        );

        // Wire up signalR events
        /* istanbul ignore next */
        _client.serviceHandlers = {
            bound: function () {
                log("Connection: " + "bound".yellow);
            },
            connectFailed: function (error) {
                log("Connection: " + "Connect Failed: ".red + error.red);
                let faultDescription = "Connect failed from mSB.com. " + error;
                let faultCode = '00098';
                trackException(faultCode, faultDescription);
                microServiceBusNode.ReportEvent(faultDescription);
                settingsHelper.isOffline = true;
            },
            connected: function (connection) {
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
            },
            disconnected: function () {

                log("Connection: " + "Disconnected".yellow);
                let faultDescription = 'Node has been disconnected.';
                let faultCode = '00098';
                trackException(faultCode, faultDescription);
                microServiceBusNode.ReportEvent("Disconnected from mSB.com");
                settingsHelper.isOffline = true;
            },
            onerror: function (error) {
                log("Connection: " + "Error: ".red, error);

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
            },
            onUnauthorized: function (error) {
                log("Connection: " + "Unauthorized: ".red, error);
            },
            messageReceived: function (message) {
                //console.log("Connection: " + "messageReceived: ".yellow + message.utf8Data);
            },
            bindingError: function (error) {
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
            },
            connectionLost: function (error) { // This event is forced by server
                log("Connection: " + "Connection Lost".red);
            },
            reconnected: function (connection) {
                log("Connection: " + "Reconnected ".green);
            },
            reconnecting: function (retry /* { inital: true/false, count: 0} */) {
                log("Connection: " + "Retrying to connect (".yellow + retry.count + ")".yellow);
                return true;
            }
        };

        // Wire up signalR inbound events handlers
        _client.on('integrationHub', 'errorMessage', function (message, errorCode) {
            OnErrorMessage(message, errorCode);
        });
        _client.on('integrationHub', 'ping', function (message) {
            OnPing(message);
        });
        _client.on('integrationHub', 'getEndpoints', function (message) {
            OnGetEndpoints(message);
        });
        _client.on('integrationHub', 'updateItinerary', function (updatedItinerary) {
            OnUpdateItinerary(updatedItinerary);
        });
        _client.on('integrationHub', 'changeState', function (state) {
            OnChangeState(state);
        });
        _client.on('integrationHub', 'changeDebug', function (debug) {
            OnChangeDebug(debug);
        });
        _client.on('integrationHub', 'changeTracking', function (enableTracking) {
            OnChangeTracking(enableTracking);
        });
        _client.on('integrationHub', 'sendMessage', function (message, destination) {
            OnSendMessage(message, destination);
        });
        _client.on('integrationHub', 'signInMessage', function (response) {
            OnSignInMessage(response);
        });
        _client.on('integrationHub', 'nodeCreated', function (nodeData) {
            OnNodeCreated(nodeData);
        });
        _client.on('integrationHub', 'heartBeat', function (id) {
            log("Connection: Heartbeat received".grey);
            _missedHeartBeats = 0;
            _lastHeartBeatReceived = true;

        });
        _client.on('integrationHub', 'forceUpdate', function () {
            log("forceUpdate".red);
            restart();
        });
        _client.on('integrationHub', 'restart', function () {
            log("restart".red);
            restart();
        });
        _client.on('integrationHub', 'reboot', function () {
            log("reboot".red);
            reboot();
        });
        _client.on('integrationHub', 'shutdown', function () {
            log("shutdown".red);
            shutdown();
        });
        _client.on('integrationHub', 'refreshSnap', function (snap, mode, connId) {
            log("Refreshing snap ".yellow + snap.gray);
            OnRefreshSnap(snap, mode, connId);
        });
        _client.on('integrationHub', 'reset', function (id) {
            OnReset(id);
        });
        _client.on('integrationHub', 'resetKeepEnvironment', function (id) {
            OnResetKeepEnvironment(id);
        });
        _client.on('integrationHub', 'updateFlowState', function (itineraryId, environment, enabled) {
            OnUpdateFlowState(itineraryId, environment, enabled);
        });
        _client.on('integrationHub', 'enableDebug', function (connId) {
            OnEnableDebug(connId);
        });
        _client.on('integrationHub', 'stopDebug', function (connId) {
            OnStopDebug();
        });
        _client.on('integrationHub', 'reportState', function (id) {
            OnReportState(id);
        });
        _client.on('integrationHub', 'uploadSyslogs', function (connectionId, fileName, account, accountKey) {
            OnUploadSyslogs(connectionId, fileName, account, accountKey);
        });
        _client.on('integrationHub', 'resendHistory', function (req) {
            OnResendHistory(req);
        });
        _client.on('integrationHub', 'requestHistory', function (req) {
            OnRequestHistory(req);
        });
        _client.on('integrationHub', 'transferToPrivate', function (req) {
            OnTransferToPrivate(req);
        });
        _client.on('integrationHub', 'updatedToken', function (token) {
            OnUpdatedToken(token);
        });
        _client.on('integrationHub', 'updateFirmware', function (force, connid) {
            OnUpdateFirmware(force, connid);
        });
        _client.on('integrationHub', 'grantAccess', function () {
            OnGrantAccess();
        });
        _client.on('integrationHub', 'runTest', function (testDescription) {
            OnRunTest(testDescription);
        });
        _client.on('integrationHub', 'pingNodeTest', function (connid) {
            OnPingNodeTest(connid);
        });
        _client.on('integrationHub', 'updatePolicies', function (policies) {
            OnUpdatePolicies(policies);
        });
        _client.on('integrationHub', 'setBootPartition', function (partition, connid) {
            OnSetBootPartition(partition, connid);
        });
        _client.on('integrationHub', 'executeScript', function (patchScript, connid) {
            OnExecuteScript(patchScript, connid);
        });
    }

    // this function is called when you want the server to die gracefully
    // i.e. wait for existing connections
    /* istanbul ignore next */
    function gracefulShutdown() {
        log("bye");
        _client.invoke('integrationHub', 'signOut', settingsHelper.settings.nodeName, os.hostname(), "Offline");
        log("Received kill signal, shutting down gracefully.");
        log(settingsHelper.settings.nodeName + ' signing out...');
        setTimeout(function () {
            process.kill(process.pid, 'SIGKILL');
        }, 100);

    }
    /* istanbul ignore next */
    function restart() {
        log("bye");
        _client.invoke('integrationHub', 'signOut', settingsHelper.settings.nodeName, os.hostname(), "Offline");
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
        _client.invoke('integrationHub', 'signOut', settingsHelper.settings.nodeName, os.hostname(), "Offline");
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
        _client.invoke('integrationHub', 'signOut', settingsHelper.settings.nodeName, os.hostname(), "Offline");
        log("Received kill signal, shutting down gracefully.");
        log(settingsHelper.settings.nodeName + ' signing out...');
        setTimeout(function () {
            setTimeout(function () {
                util.reboot();
            }, 500);
        }, 500);
    }
    this.isConected = function () {
        return _client.isConnected();
    }
    this.version = function () {
        var pjson = require('../package.json');
        return pjson.version;
    }

    // Prototypes
    MicroServiceBusHost.prototype.Start = function (testFlag) {
        try {
            util.displayAnsiiLogo();

            if (testFlag) {
                _debugMode = true;
            }
            else {
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
                    log("SERIOUS ERROR: Caught unhandledRejection", true);
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
            // Log in using settings
            if (settingsHelper.settings.hubUri && settingsHelper.settings.nodeName && settingsHelper.settings.organizationId) { // jshint ignore:line
                if (args.length > 0 && (args[0] == '/n' || args[0] == '-n')) {
                    settingsHelper.settings.nodeName = args[1];
                }
                log('Logging in using settings'.grey);
            }
            // First login
            else if (args.length > 0) {
                for (let index = 0; index < args.length; index++) {

                    var arg = args[index];
                    switch (arg) {
                        case '--imei':
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
                            _useMacAddress = true;
                            break;
                        case '/c':
                        case '-c':
                        case '-code':
                        case '/code':
                            if (!args[index + 1] || args[index + 1].startsWith('-'))
                                showError();
                            _temporaryVerificationCode = args[index + 1];
                            index++;
                            break;
                        case '/n':
                        case '-n':
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
                            _useAssert = true;
                            break;
                            // showError();
                            // return;
                        }
                    }
                }
            }
            else {
                showError();
                return;
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

            if (settingsHelper.settings.hubUri === "wss://localhost:44302")
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
                    'integrationHub',
                    'signInAsync',
                    hostData
                );
            });
            microServiceBusNode.OnPingResponse(function () {
                _client.invoke(
                    'integrationHub',
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
                    'integrationHub',
                    'createNode',
                    _temporaryVerificationCode,
                    hostPrefix,
                    _existingNodeName
                );
            });
            microServiceBusNode.OnCreateNodeFromMacAddress(function (macAddress) {
                _client.invoke(
                    'integrationHub',
                    'createNodeFromMacAddress',
                    macAddress
                );
            });
            microServiceBusNode.OnAssertNode(function (request) {
                 _client.invoke(
                    'integrationHub',
                    'assertNode',
                    request
                );
                log();
                log(`Device information such as host name, MAC addresses and IP addresses`.yellow );
                log(`has been submitted to ${settingsHelper.settings.hubUri.replace('wss://', '')} to pre-register the Node.`.yellow );
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
                    'integrationHub',
                    'requestHistoryDataResponse',
                    historyData
                );
            });
            microServiceBusNode.OnTestResult(function (result) {
                _client.invoke(
                    'integrationHub',
                    'testResultResponse',
                    result
                );
            });
            microServiceBusNode.OnTestComplete(function (caller) {
                _client.invoke(
                    'integrationHub',
                    'testCompleteResponse',
                    caller
                );
                restart();
            });
            microServiceBusNode.OnUnitTestComplete(function (result) {
                self.onUnitTestComlete(result);
            });

            setupClient();
            _client.start();
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
    // MicroServiceBusHost.prototype.TestStop = function (state) {
    //     //this.onStopped();
    //     gracefulShutdown();
    // };
    MicroServiceBusHost.prototype.TestThrowError = function (state) {

    };
}

module.exports = MicroServiceBusHost; 
