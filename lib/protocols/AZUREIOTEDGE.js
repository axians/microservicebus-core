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

var Message;
var url = require("url");
var crypto = require('crypto');
var httpRequest = require('request');
var storage = require('node-persist');
var util = require('../utils.js');
var guid = require('uuid');

function AZUREIOTEDGE(nodeName, connectionSettings) {
    var self = this;
    var stop = false;
    var storageIsEnabled = true;
    var sender;
    var twin;
    var tracker;
    var tokenRefreshTimer;
    var tokenRefreshInterval = (connectionSettings.tokenLifeTime * 60 * 1000) * 0.9;
    var npmPackage = "azure-iot-common@1.10.0,azure-iot-device@1.10.0,azure-iot-device-mqtt@1.10.0";

    this.startInProcess = false;
    this.deviceClient;
    this.methods;

    // Setup tracking
    var restTrackingToken = connectionSettings.trackingToken;
    var baseAddress = "https://" + connectionSettings.sbNamespace;
    if (!baseAddress.match(/\/$/)) {
        baseAddress += '/';
    }
    
    AZUREIOTEDGE.prototype.Start = function (callback) {
        self = this;
        self.stop = false;
        if (self.IsConnected() || self.startInProcess) {
            self.onQueueDebugCallback("AZURE IoT Edge: Already connected, ignoring start");
            callback();
            return;
        }
        self.startInProcess = true;
        util.addNpmPackages(npmPackage, false, function (err) {
            try {
                if (err)
                    self.onQueueErrorReceiveCallback("AZURE IoT Edge: Unable to download Azure IoT npm packages. " + err);
                else {
                    Message = require('azure-iot-device').Message;
                    var ReceiveClient = require('azure-iot-device').ModuleClient;
                    let DeviceProtocol= require('azure-iot-device-mqtt').Mqtt;

                    if (!self.deviceClient) {
                        
                        ReceiveClient.fromEnvironment(DeviceProtocol, function (err, client) {
                            if(err){
                                self.OnSubmitQueueError('AZURE IoT Edge: Error: ' + err.message);
                            }
                            else{
                                self.deviceClient = client;

                                self.deviceClient.on('disconnect', function (e) {
                                    self.deviceClient = null;
                                    self.twin = null;
                                    self.onQueueErrorReceiveCallback('AZURE IoT Edge: Error: ' + JSON.stringify(e));
                                    self.onDisconnectCallback('AZURE IoT Edge: Disconnected', !self.stop);
                                });
        
                                // may fire if node is started without iot hub connection available.
                                self.deviceClient.on('error', function (err) {
                                    self.OnSubmitQueueError('AZURE IoT Edge: Error: ' + err.message);
                                    self.OnSubmitQueueError('AZURE IoT Edge: Error: ' + JSON.stringify(err));
                                    let twinError = self.twin ? JSON.stringify(self.twin) : null;
                                    self.onQueueErrorReceiveCallback('AZURE IoT Edge: Twin state: ' + twinError);
                                });
        
                                self.deviceClient.on('inputMessage', function(service, msg) {
                                    try {
                                        var responseData = {
                                            body: message,
                                            applicationProperties: { value: { service: service} }
                                        }
                                        self.onQueueMessageReceivedCallback(responseData);
                                        if(self.deviceClient.complete){
                                            self.deviceClient.complete(msg, function () { });
                                        }
                                    }
                                    catch (e) {
                                        self.onQueueErrorReceiveCallback('AZURE IoT Edge: Could not connect1: ' + e.message);
                                    }
                                });

                                self.deviceClient.open(function (err, transport) {
                                    if (err) {
                                        if(err.name === "NotConnectedError") {
                                          self.onDisconnectCallback("Azure IoT: Unable to connect (NotConnected)", true);
                                        }
                                        else if (err.name === "UnauthorizedError") {
                                            self.onUnauthorizedErrorCallback();
                                        }
                                        else {
                                          self.onDisconnectCallback(`Azure IoT: Unable to connect: ${err}`, true);
                                        }
            
                                        callback(err);
                                        self.startInProcess = false;
                                        return;
                                    }
                                    else {
                                        self.onQueueDebugCallback("AZURE IoT Edge: Receiver is ready");
            
                                        try {
                                            self.deviceClient.getTwin(function (err, twin) {
                                                self.twin = twin;
            
                                                if (err) {
                                                    self.onQueueErrorReceiveCallback('AZURE IoT Edge: Could not get twin: ' + err);
                                                    self.startInProcess = false;
                                                    callback(err);
                                                }
                                                else {
                                                    self.onQueueDebugCallback("AZURE IoT Edge: Device twin is ready");
            
                                                    twin.on('properties.desired', function (desiredChange) {
                                                        // Incoming state
                                                        self.onQueueDebugCallback("AZURE IoT Edge: Received new state");
                                                        self.currentState = {
                                                            desired: desiredChange,
                                                            reported: twin.properties.reported
                                                        };
            
                                                        self.onStateReceivedCallback(self.currentState);
                                                        if (self.startInProcess) {
                                                            self.startInProcess = false;
                                                            callback();
                                                        }
                                                    });
                                                }
                                            });
                                        }
                                        catch (twinError) {
                                            self.onQueueDebugCallback("AZURE IoT Edge: An error occured when starting the TWIN:");
                                            self.onQueueDebugCallback("AZURE IoT Edge: " + twinError);
                                            self.onQueueDebugCallback("AZURE IoT Edge: PLEASE CONSIDER restarting the node");
                                            self.startInProcess = false;
                                            callback(twinError);
                                        }
                                        // Only start sender if key is provided
                                        if (connectionSettings.senderToken && !sender) {
                                            startSender(function () {
                                                return;
                                            });
                                        }
                                    }
                                });
                            }
                        });
                        
                    }

                    

                    if (!tokenRefreshTimer) {
                        tokenRefreshTimer = setInterval(function () {
                            self.onQueueDebugCallback("Update tracking tokens");
                            acquireToken("AZUREIOTEDGE", "TRACKING", restTrackingToken, function (token) {
                                if (token == null) {
                                    self.onQueueErrorSubmitCallback("Unable to aquire tracking token: " + token);
                                }
                                else {
                                    restTrackingToken = token;
                                }
                            });
                        }, tokenRefreshInterval);
                    }
                }
            }
            catch (ex) {
                self.onQueueErrorReceiveCallback("AZURE IoT Edge: " + ex);
                self.startInProcess = false;
                callback(ex);
            }
        });
    };
    AZUREIOTEDGE.prototype.ChangeState = function (state, node) {
        for (const key of Object.keys(state)){
            if(self.settingsHelper.settings.deviceState.reported[key] !== undefined){
                if(state[key] === null){
                    delete self.settingsHelper.settings.deviceState.reported[key];
                }
                else{
                    self.settingsHelper.settings.deviceState.reported[key] = state[key];
                }
            }
            else {
                self.settingsHelper.settings.deviceState.reported[key] = state[key];
            }
        }
        self.settingsHelper.save();
        self.onQueueDebugCallback("AZURE IoT Edge: device state is changed");
        if (!self.twin) {
            self.onQueueErrorSubmitCallback('AZURE IoT Edge: Device twin not registered');
            return;
        }
        self.twin.properties.reported.update(state, function (err) {
            if (err) {
                self.onQueueErrorReceiveCallback('AZURE IoT Edge: Could not update twin: ' + err.message);
            } else {
                self.onQueueDebugCallback("AZURE IoT Edge: twin state reported");
            }
        });

    };
    AZUREIOTEDGE.prototype.Stop = function (callback) {
        if (!self.IsConnected()) {
            self.onQueueDebugCallback("AZURE IoT Edge: Already in stopped state");
            callback();
            return;
        }
        self.stop = true;
        if (sender) {
            try {
                sender.close();
            }
            catch (err) {
                console.log('');

            }
        }
        if (self.deviceClient) {
            self.onQueueDebugCallback("AZURE IoT Edge: Closing self.deviceClient");
            self.deviceClient.close(function () {
                // This never happends
                self.onQueueDebugCallback("AZURE IoT Edge: Stopped");
                self.twin = null;
                self.deviceClient = undefined;
                callback();
            });
        }
        else {
            self.twin = null;
            self.deviceClient = undefined;
            callback();
        }
    };
    AZUREIOTEDGE.prototype.Track = function (trackingMessage) {
        try {
            var self = this;
            if (self.stop || !self.IsConnected()) {
                if (storageIsEnabled)
                    self.onPersistTrackingCallback(trackingMessage);

                return;
            }

            var trackUri = baseAddress + connectionSettings.trackingHubName + "/messages" + "?timeout=60";

            httpRequest({
                headers: {
                    "Authorization": restTrackingToken,
                    "Content-Type": "application/json",
                },
                uri: trackUri,
                json: trackingMessage,
                method: 'POST'
            },
                function (err, res, body) {
                    if (err != null) {
                        self.onQueueErrorSubmitCallback("Unable to send message. " + err.code + " - " + err.message)
                        console.log("Unable to send message. " + err.code + " - " + err.message);
                        if (storageIsEnabled)
                            self.onPersistTrackingCallback(trackingMessage);
                    }
                    else if (res.statusCode >= 200 && res.statusCode < 300) {
                    }
                    else if (res.statusCode == 401) {
                        console.log("Invalid token. Updating token...")

                        return;
                    }
                    else {
                        console.log("Unable to send message. " + res.statusCode + " - " + res.statusMessage);

                    }
                });

        }
        catch (err) {
            console.log();
        }
    };
    AZUREIOTEDGE.prototype.Update = function (settings) {
        restTrackingToken = settings.trackingToken;
        self.onQueueDebugCallback("Tracking token updated");
    };
    AZUREIOTEDGE.prototype.SubmitEvent = function (event, service, properties) {
        return new Promise(function (resolve, reject) {
            let persistMsg = {
                node: self.settingsHelper.settings.nodeName,
                service: service,
                message: JSON.stringify(event)
            };

            var isResend = false;
            if (storageIsEnabled) {
                if (properties) {
                    isResend = properties.find(function (p) {
                        return p.Variable === "resent";
                    });
                }
            }

            if (self.stop || !self.IsConnected()) {
                /* if (!self.IsConnected()) {
                    self.onDisconnectCallback("Connection to the Edge Hub cannot be established, persisting messages", !stop);
                }
                if (self.stop) {
                    self.onQueueErrorReceiveCallback("Service is stopped, persisting messages");
                }*/

                if (!isResend) {
                    self.onQueueDebugCallback("Connection is not established to Edge Hub. Persisting message.");
                    self.onPersistEventCallback(persistMsg);
                }

                resolve(event);
                return;
            }

            let isBuffer = event instanceof Buffer;

            if (!isBuffer) {
                event = JSON.stringify(event);
            }
            var message = new Message(event);

            if (properties) {
                for (let i = 0; i < properties.length; i++) {
                    message.properties.add(properties[i].Variable, properties[i].Value);
                }
            }
            
            if (self.deviceClient) {
                    self.deviceClient.sendOutputEvent("output", message, function (err) {
                        if (err) {
                            self.onSubmitQueueErrorCallback('Unable to send message to to Edge Hub');
                            if (!isResend)
                                self.onPersistEventCallback(persistMsg);
                            resolve('Unable to send message to to Edge Hub');
                        }
                        else {
                            self.onPersistHistoryCallback(event);
                            self.onSubmitQueueSuccessCallback("Output event has been sent to Edge Hub");
                            resolve();
                        }
                    });
            }
            else{
                if (!isResend)
                    self.onPersistEventCallback(persistMsg);

                self.onSubmitQueueErrorCallback('Client is not ready');
                resolve();
            }
        });
    };
    AZUREIOTEDGE.prototype.IsConnected = function () {
        return self.twin != undefined;
    };
    function startSender(callback) {
        util.addNpmPackages("azure-iothub", false, function (err) {
            var SendClient = require('azure-iothub').Client;
            var ServiceProtocol = require('azure-iothub').AmqpWs; // Default transport for Receiver
            sender = SendClient.fromSharedAccessSignature(connectionSettings.senderToken, ServiceProtocol);
            sender.open(function (err) {
                if (err) {
                    self.onQueueErrorReceiveCallback('AZURE IoT Edge: Unable to connect to Edge Hub (send) : ' + err);
                }
                else {
                    self.onQueueDebugCallback("AZURE IoT Edge: Sender is ready");
                }
                callback();
            });
        });
    }
    function acquireToken(provider, keyType, oldKey, callback) {
        try {
            var acquireTokenUri = self.hubUri.replace("wss:", "https:") + "/api/Token";
            var request = {
                "provider": provider,
                "keyType": keyType,
                "oldKey": oldKey
            };
            httpRequest({
                headers: {
                    "Content-Type": "application/json",
                },
                uri: acquireTokenUri,
                json: request,
                method: 'POST'
            },
                function (err, res, body) {
                    if (err != null) {
                        self.onQueueErrorSubmitCallback("Unable to acquire new token. " + err.message);
                        callback(null);
                    }
                    else if (res.statusCode >= 200 && res.statusCode < 300) {
                        callback(body.token);
                    }
                    else {
                        self.onQueueErrorSubmitCallback("Unable to acquire new token. Status code: " + res.statusCode);
                        callback(null);
                    }
                });
        }
        catch (err) {
            process.exit(1);
        }
    };
}
module.exports = AZUREIOTEDGE;

