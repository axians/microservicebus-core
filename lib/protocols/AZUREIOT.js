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
var webRequest = require('../WebRequest');
var storage = require('node-persist');
var util = require('../utils.js');
var guid = require('uuid');

function AZUREIOT(nodeName, connectionSettings) {
    var self = this;
    var stop = false;
    var storageIsEnabled = true;
    var sender;
    var twin;
    var tracker;
    var tokenRefreshTimer;
    var tokenRefreshInterval = (connectionSettings.tokenLifeTime * 60 * 1000) * 0.9;
    var npmPackage = "azure-iot-device@1.18.1";

    this.startInProcess = false;
    this.deviceClient;
    this.methods;

    switch (connectionSettings.communicationProtocol) {
        case "MQTT":
        case "MQTT-WS":
            npmPackage = "azure-iot-common@1.13.1,azure-iot-device@1.18.1,azure-iot-device-mqtt@1.16.1";
            break;
        case "AMQP":
        case "AMQP-WS":
            npmPackage = "azure-iot-common@1.13.1,azure-iot-device@1.18.1,azure-iot-device-amqp@1.14.1";
            break;
        default:
            break;
    }

    // Setup tracking
    var baseAddress = "https://" + connectionSettings.sbNamespace;
    if (!baseAddress.match(/\/$/)) {
        baseAddress += '/';
    }
    var restTrackingToken = connectionSettings.trackingToken;

    AZUREIOT.prototype.Start = function (callback) {
        self = this;
        self.stop = false;
        if (self.IsConnected() || self.startInProcess) {
            self.onQueueDebugCallback("AZURE IoT: Already connected, ignoring start");
            callback();
            return;
        }
        self.startInProcess = true;
        util.addNpmPackages(npmPackage, false, function (err) {
            try {
                if (err)
                    self.onQueueErrorReceiveCallback("AZURE IoT: Unable to download Azure IoT npm packages. " + err);
                else {
                    Message = require('azure-iot-common').Message;
                    var ReceiveClient = require('azure-iot-device').Client;
                    var DeviceProtocol;
                    self.onQueueDebugCallback("AZURE IoT: Using " + connectionSettings.communicationProtocol);

                    switch (connectionSettings.communicationProtocol) {
                        case "MQTT":
                            DeviceProtocol = require('azure-iot-device-mqtt').Mqtt;
                            break;
                        case "MQTT-WS":
                            DeviceProtocol = require('azure-iot-device-mqtt').MqttWs;
                            break;
                        case "AMQP":
                            DeviceProtocol = require('azure-iot-device-amqp').Amqp;
                            break;
                        case "AMQP-WS":
                            DeviceProtocol = require('azure-iot-device-amqp').AmqpWs;
                            break;
                        default:
                            DeviceProtocol = require('azure-iot-device-mqtt').Mqtt;
                            break;
                    }

                    if (!self.deviceClient) {
                        if (connectionSettings.receiveConnectionString) {
                            self.onQueueDebugCallback("AZURE IoT: Using Connection String");
                            self.deviceClient = ReceiveClient.fromConnectionString(connectionSettings.receiveConnectionString, DeviceProtocol);
                        }
                        else {
                            self.onQueueDebugCallback("AZURE IoT: Using Shared Access Signature");
                            self.deviceClient = ReceiveClient.fromSharedAccessSignature(connectionSettings.receiverToken, DeviceProtocol);
                        }

                        self.deviceClient.on('disconnect', function (e) {
                            self.deviceClient = null;
                            self.twin = null;
                            self.onQueueErrorReceiveCallback('AZURE IoT: Error: ' + JSON.stringify(e));
                            self.onDisconnectCallback('AZURE IoT: Disconnected', !self.stop);
                        });

                        // may fire if node is started without iot hub connection available.
                        self.deviceClient.on('error', function (err) {
                            console.error(err.message);
                            self.onSubmitQueueErrorCallback('AZURE IoT: Error: ' + err.message);
                            self.onSubmitQueueErrorCallback('AZURE IoT: Error: ' + JSON.stringify(err));
                            let twinError = self.twin ? JSON.stringify(self.twin) : null;
                            self.onQueueErrorReceiveCallback('AZURE IoT: Twin state: ' + twinError);
                        });

                        self.deviceClient.on('message', function (msg) {
                            try {
                                var service = msg.properties.propertyList.find(function (i) {
                                    return i.key === "service";
                                });
                                let message;
                                // Interpret as string
                                if (msg.contentType !== undefined && (msg.contentType.startsWith('text'))) {
                                    message = msg.data.toString('utf8');
                                }
                                // Interpret as binary. Do not touch
                                else if (msg.contentType === 'application/octet-stream') {
                                    message = msg.data;
                                }
                                else { // Assume JSON
                                    message = JSON.parse(msg.data.toString('utf8'));
                                }
                                if (!service) { // D2C message has no destination 
                                    let context = {
                                        ContentType: msg.contentType,
                                        Variables: msg.properties.propertyList.map(element => { return { Variable: element.key, Value: element.value } })
                                    };
                                    self.onQueueDebugCallback("AZURE IoT: Message recieved from Azure");
                                    self.onMessageReceivedCallback(message, context);
                                    self.deviceClient.complete(msg, function () { });
                                }
                                else { // D2D message with destination (service) defined
                                    var responseData = {
                                        body: message,
                                        applicationProperties: { value: { service: service.value } }
                                    }
                                    self.onQueueMessageReceivedCallback(responseData);
                                    self.deviceClient.complete(msg, function () { });
                                }
                            }
                            catch (e) {
                                self.onQueueErrorReceiveCallback('AZURE IoT: Could not connect1: ' + e.message);
                            }
                        });
                    }

                    // Disable retry policy
                    let NoRetry = require('azure-iot-common').NoRetry;
                    self.deviceClient.setRetryPolicy(new NoRetry());

                    self.deviceClient.open(function (err, transport) {
                        if (err) {
                            if (err.name === "NotConnectedError") {
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
                            self.onQueueDebugCallback("AZURE IoT: Receiver is ready");

                            try {
                                self.deviceClient.getTwin(function (err, twin) {
                                    if (!self.deviceClient) {
                                        self.onQueueErrorReceiveCallback('AZURE IoT: Got twin, but deviceClient is null');
                                        callback('Unable to set up twin, deviceClient is null');
                                        return;
                                    }

                                    self.twin = twin;

                                    if (err) {
                                        self.onQueueErrorReceiveCallback('AZURE IoT: Could not get twin: ' + err);
                                        self.startInProcess = false;
                                        callback(err);
                                    }
                                    else {
                                        self.onQueueDebugCallback("AZURE IoT: Device twin is ready");
                                        self.onConnectCallback();
                                        callback();
                                        twin.on('properties.desired', function (desiredChange) {
                                            // Incoming state
                                            self.onQueueDebugCallback("AZURE IoT: Received new state");
                                            self.currentState = {
                                                desired: desiredChange,
                                                reported: twin.properties.reported
                                            };

                                            self.onStateReceivedCallback(self.currentState);
                                            if (self.startInProcess) {
                                                self.startInProcess = false;
                                                //callback();
                                            }
                                        });
                                    }
                                });
                            }
                            catch (twinError) {
                                self.onQueueDebugCallback("AZURE IoT: An error occured when starting the TWIN:");
                                self.onQueueDebugCallback("AZURE IoT: " + twinError);
                                self.onQueueDebugCallback("AZURE IoT: PLEASE CONSIDER restarting the node");
                                self.startInProcess = false;
                                callback(twinError);
                            }

                            try {
                                self.deviceClient.onDeviceMethod('restart', (request, response) => {
                                    self.onActionCallback({ action: "restart" });
                                    response.send(200, `Restarting node`);
                                });
                            }
                            catch (methodError) {
                                self.onQueueDebugCallback("AZURE IoT: An error occured while setting up methods:");
                                self.onQueueDebugCallback("AZURE IoT: " + methodError);
                                self.onQueueDebugCallback("AZURE IoT: PLEASE CONSIDER restarting the node");
                                self.startInProcess = false;
                                callback(methodError);
                            }

                            // Only start sender if key is provided
                            if (connectionSettings.senderToken && !sender) {
                                startSender(function () {
                                    return;
                                });
                            }
                        }
                    });

                    if (!tokenRefreshTimer) {
                        tokenRefreshTimer = setInterval(function () {
                            self.onQueueDebugCallback("Update tracking tokens");
                            acquireToken("AZUREIOT", "TRACKING", restTrackingToken, function (token) {
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
                self.onQueueErrorReceiveCallback("AZURE IoT: " + ex);
                self.startInProcess = false;
                callback(ex);
            }
        });
    };
    AZUREIOT.prototype.ChangeState = function (state, node, callback) {
        for (const key of Object.keys(state)) {
            if (self.settingsHelper.settings.deviceState.reported[key] !== undefined) {
                if (state[key] === null) {
                    delete self.settingsHelper.settings.deviceState.reported[key];
                }
                else {
                    self.settingsHelper.settings.deviceState.reported[key] = state[key];
                }
            }
            else {
                self.settingsHelper.settings.deviceState.reported[key] = state[key];
            }
        }
        self.settingsHelper.save();
        self.onQueueDebugCallback("AZURE IoT: device state is changed");
        if (!self.twin) {
            self.onQueueErrorSubmitCallback('AZURE IoT: Device twin not registered');
            return;
        }
        self.twin.properties.reported.update(state, function (err) {
            if (err) {
                self.onQueueErrorReceiveCallback('AZURE IoT: Could not update twin: ' + err.message);
            } else {
                self.onQueueDebugCallback("AZURE IoT: twin state reported");
            }
            if (callback) {
                callback(err);
            }
        });
    };
    AZUREIOT.prototype.Stop = function (callback) {
        if (!self.IsConnected()) {
            self.onQueueDebugCallback("AZURE IoT: Already in stopped state");
            callback();
            return;
        }
        self.startInProcess = false
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
            self.onQueueDebugCallback("AZURE IoT: Closing self.deviceClient");
            self.deviceClient.close(function () {
                // This never happens
                self.onQueueDebugCallback("AZURE IoT: Stopped");
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
    AZUREIOT.prototype.Submit = function (msg, node, service) {
        if (self.stop || !self.IsConnected()) {
            let persistMsg = {
                node: node,
                service: service,
                message: message
            };
            if (storageIsEnabled)
                self.onPersistMessageCallback(persistMsg);

            return;
        }

        var json = JSON.stringify(msg);
        var message = new Message(json);

        message.properties.add("service", service);
        sender.send(node, message, function (err) {
            if (err)
                self.onSubmitQueueErrorCallback(err);
        });
    };
    AZUREIOT.prototype.Track = function (trackingMessage) {
        try {
            var self = this;

            var trackUri = baseAddress + connectionSettings.trackingHubName + "/messages" + "?timeout=60";

            webRequest({
                headers: {
                    "Authorization": restTrackingToken,
                    "Content-Type": "application/json",
                },
                url: trackUri,
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
    AZUREIOT.prototype.Update = function (settings) {
        restTrackingToken = settings.trackingToken;
        self.onQueueDebugCallback("Tracking token updated");
    };
    AZUREIOT.prototype.SubmitEvent = function (event, service, properties, contentType) {
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
                if (!isResend) {
                    self.onQueueDebugCallback("Connection is not established to IoT Hub. Persisting message.");
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

            if (contentType === "application/json" || contentType === "text/plain") {
                message.contentType = contentType;
                message.contentEncoding = "utf-8";
            }

            if (properties) {
                for (let i = 0; i < properties.length; i++) {
                    message.properties.add(properties[i].Variable, properties[i].Value);
                }
            }

            if (self.deviceClient) {
                self.deviceClient.sendEvent(message, function (err) {
                    if (err) {
                        self.onSubmitQueueErrorCallback('Unable to send message to to Azure IoT Hub');
                        if (!isResend)
                            self.onPersistEventCallback(persistMsg);
                        resolve('Unable to send message to to Azure IoT Hub');
                    }
                    else {
                        self.onPersistHistoryCallback(event);
                        self.onSubmitQueueSuccessCallback("Event has been sent to Azure IoT Hub");
                        resolve();
                    }
                });
            }
            else {
                if (!isResend)
                    self.onPersistEventCallback(persistMsg);

                self.onSubmitQueueErrorCallback('Client is not ready');
                resolve();
            }
        });
    };
    AZUREIOT.prototype.IsConnected = function () {
        if (!self.twin) {
            self.startInProcess = false
            return false;
        }
        else {
            self.startInProcess = true
            return true;
        }

    };
    function startSender(callback) {
        util.addNpmPackages("azure-iothub", false, function (err) {
            var SendClient = require('azure-iothub').Client;
            var ServiceProtocol = require('azure-iothub').AmqpWs; // Default transport for Receiver
            sender = SendClient.fromSharedAccessSignature(connectionSettings.senderToken, ServiceProtocol);
            sender.open(function (err) {
                if (err) {
                    self.onQueueErrorReceiveCallback('AZURE IoT: Unable to connect to Azure IoT Hub (send) : ' + err);
                }
                else {
                    self.onQueueDebugCallback("AZURE IoT: Sender is ready");
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
            // NOT TESTED
            webRequest({
                headers: {
                    "Content-Type": "application/json",
                },
                url: acquireTokenUri,
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
module.exports = AZUREIOT;

