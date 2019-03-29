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

function AZUREIOT(nodeName, connectionSettings) {
    var self = this;
    var stop = false;
    var storageIsEnabled = true;
    var sender;
    var twin;
    var tracker;
    var tokenRefreshTimer;
    var tokenRefreshInterval = (connectionSettings.tokenLifeTime * 60 * 1000) * 0.9;
    var npmPackage = "azure-iot-device@1.9.4";

    this.startInProcess = false;
    this.deviceClient;
    this.methods;

    switch (connectionSettings.communicationProtocol) {
        case "MQTT":
        case "MQTT-WS":
            npmPackage = "azure-iot-common@1.9.4,azure-iot-device@1.9.4,azure-iot-device-mqtt@1.9.4";
            break;
        case "AMQP":
        case "AMQP-WS":
            npmPackage = "azure-iot-common@1.9.4,azure-iot-device@1.9.4,azure-iot-device-amqp@1.9.4";
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
        if (self.IsConnected() || self.startInProcess) {
            self.onQueueDebugCallback("AZURE IoT: Already connected, ignoring start");
            callback();
            return;
        }
        self = this;
        stop = false;
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
                    }

                    // Disable retry policy
                    let NoRetry = require('azure-iot-common').NoRetry;
                    self.deviceClient.setRetryPolicy(new NoRetry());

                    self.deviceClient.open(function (err, transport) {
                        if (err) {
                            self.onQueueErrorReceiveCallback('AZURE IoT: Could not connect: ' + err);
                            if (err.name === "UnauthorizedError") {
                                self.onUnauthorizedErrorCallback();
                            }

                            callback(err);
                            self.startInProcess = false;
                            return;

                        }
                        else {
                            self.onQueueDebugCallback("AZURE IoT: Receiver is ready");

                            self.deviceClient.on('disconnect', function (e) {
                                self.deviceClient = null;
                                self.twin = null;
                                self.onQueueErrorReceiveCallback('AZURE IoT: Error: ' + JSON.stringify(e));
                                self.onDisconnectCallback('AZURE IoT: Disconnected', !stop);
                            });

                            self.deviceClient.on('error', function (err) {
                                console.error(err.message);
                                self.onQueueErrorReceiveCallback('AZURE IoT: Error: ' + err.message);
                                self.onQueueErrorReceiveCallback('AZURE IoT: Error: ' + JSON.stringify(err));
                                let twinError = self.twin ? JSON.stringify(self.twin) : null;
                                self.onQueueErrorReceiveCallback('AZURE IoT: Twin state: ' + twinError);
                            });

                            self.deviceClient.on('message', function (msg) {
                                try {
                                    var service = msg.properties.propertyList.find(function (i) {
                                        return i.key === "service";
                                    });

                                    // Parse to object
                                    let message = JSON.parse(msg.data.toString('utf8'));

                                    if (!service) { // D2C message has no destination 
                                        self.onQueueDebugCallback("AZURE IoT: Message recieved from Azure");
                                        self.onMessageReceivedCallback(message);
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
                                    self.onQueueErrorReceiveCallback('AZURE IoT: Could not connect: ' + e.message);
                                }
                            });

                            try {
                                self.deviceClient.getTwin(function (err, twin) {
                                    self.twin = twin;

                                    if (err) {
                                        self.onQueueErrorReceiveCallback('AZURE IoT: Could not get twin: ' + err);
                                        self.startInProcess = false;
                                        callback(err);
                                    }
                                    else {
                                        self.onQueueDebugCallback("AZURE IoT: Device twin is ready");

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
                                                callback();
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
    AZUREIOT.prototype.ChangeState = function (state, node) {
        self.settingsHelper.settings.deviceState.reported = state;
        self.settingsHelper.save();
        self.onQueueDebugCallback("AZURE IoT: device state is changed");
        if (!this.twin) {
            self.onQueueErrorSubmitCallback('AZURE IoT: Device twin not registered');
            return;
        }
        self.twin.properties.reported.update(state, function (err) {
            if (err) {
                self.onQueueErrorReceiveCallback('AZURE IoT: Could not update twin: ' + err.message);
            } else {
                self.onQueueDebugCallback("AZURE IoT: twin state reported");
            }
        });

    };
    AZUREIOT.prototype.Stop = function (callback) {
        stop = true;
        if (!self.IsConnected()) {
            self.onQueueDebugCallback("AZURE IoT: Already in stopped state");
            callback();
            return;
        }
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
                // This never happends
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
        if (stop || !self.IsConnected()) {
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
            if (stop || !self.IsConnected()) {
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
    AZUREIOT.prototype.Update = function (settings) {
        restTrackingToken = settings.trackingToken;
        self.onQueueDebugCallback("Tracking token updated");
    };
    AZUREIOT.prototype.SubmitEvent = function (event, service, properties) {
        return new Promise(function (resolve, reject) {
            if (stop || !self.IsConnected()) {
                if (!self.IsConnected()) {
                    self.onDisconnectCallback("Connection to the Azure IoT Hub cannot be established, persisting messages", !stop);
                }
                if (stop) {
                    self.onQueueErrorReceiveCallback("Service is stopped, persisting messages");
                }

                let persistMsg = {
                    node: self.settingsHelper.settings.nodeName,
                    service: service,
                    message: JSON.stringify(event)
                };
                if (storageIsEnabled) {
                    var isResend = false;
                    if (properties) {
                        isResend = properties.find(function (p) {
                            return p.Variable === "resent";
                        });
                    }
                    if (!isResend)
                        self.onPersistEventCallback(persistMsg);
                }
                resolve(event);
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
                    self.deviceClient.sendEvent(message, function (err) {
                        if (err) {
                            self.onSubmitQueueErrorCallback('Unable to send message to to Azure IoT Hub');
                            resolve('Unable to send message to to Azure IoT Hub');
                        }
                        else {
                            self.onPersistHistoryCallback(event);
                            self.onSubmitQueueSuccessCallback("Event has been sent to Azure IoT Hub");
                            resolve();
                        }
                    });
            }
            else{
                self.onSubmitQueueErrorCallback('Client is not ready');
                resolve();
            }
        });
    };
    AZUREIOT.prototype.IsConnected = function () {
        return self.twin != undefined;
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
module.exports = AZUREIOT;

