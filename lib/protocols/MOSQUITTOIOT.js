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
var minimist = require('minimist');

function MOSQUITTOIOT(nodeName, connectionSettings) {
    var self = this;
    var stop = false;
    var storageIsEnabled = true;
    var npmPackage = "mqtt@4.2.8";

    this.mqttClient = null;
    this.startInProcess = false;

    // Setup tracking
    var baseAddress = "https://" + connectionSettings.sbNamespace;
    if (!baseAddress.match(/\/$/)) {
        baseAddress += '/';
    }
    var restTrackingToken = connectionSettings.trackingToken;

    MOSQUITTOIOT.prototype.Start = function (callback) {
        self = this;
        self.stop = false;
        if (self.IsConnected() || self.startInProcess) {
            self.onQueueDebugCallback("MOSQUITTO Broker: Already connected, ignoring start");
            callback();
            return;
        }
        self.startInProcess = true;
        util.addNpmPackages(npmPackage, false, function (err) {
            try {
                if (err)
                    self.onQueueErrorReceiveCallback("MOSQUITTO Broker: Unable to download MOSQUITTO Broker npm packages. " + err);
                else {
                    const mqtt = require('mqtt');
                    self.mqttClient = mqtt.connect({
                        host: connectionSettings.connectionSettings.server,
                        port: connectionSettings.connectionSettings.port,
                        username: connectionSettings.connectionSettings.username,
                        password: connectionSettings.connectionSettings.password
                    });
                    
                    self.mqttClient.on('connect', function () {
                        self.onQueueDebugCallback("MOSQUITTO Broker: Connected");
                        self.mqttClient.subscribe(`clients/${connectionSettings.user}`, function (err) {
                            if (!err) {
                                self.onQueueDebugCallback("MOSQUITTO Broker: Receiver is ready");
                                callback();
                            }
                            else{
                                callback('Unable to set up subscription');
                            }
                        })
                    })
                    self.mqttClient.on('disconnect', function (error) {
                        self.mqttClient = null;
                        self.onQueueErrorReceiveCallback(`MOSQUITTO Broker: Error: ${err.message}` );
                        self.onDisconnectCallback('MOSQUITTO Broker: Disconnected', !self.stop);
                    });
                    self.mqttClient.on('error', function (err) {
                        if(err.code === 'ENOTFOUND'){
                            self.onQueueErrorReceiveCallback(`MOSQUITTO Broker: Unable to connect to host at ${err.hostname}` );
                        }
                        else{
                            self.onQueueErrorReceiveCallback(`MOSQUITTO Broker: Error: ${err.message}` );
                        }
                    });
                }
            }
            catch (ex) {
                self.onQueueErrorReceiveCallback("MOSQUITTO Broker: " + ex);
                self.startInProcess = false;
                callback(ex);
            }
        });
    };
    MOSQUITTOIOT.prototype.Stop = function (callback) {
        if (!self.IsConnected()) {
            self.onQueueDebugCallback("MOSQUITTO Broker: Already in stopped state");
            callback();
            return;
        }
        self.startInProcess = false
        self.stop = true;
        self.mqttClient.end();
    };
    MOSQUITTOIOT.prototype.Track = function (trackingMessage) {
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
    MOSQUITTOIOT.prototype.Update = function (settings) {
        restTrackingToken = settings.trackingToken;
        self.onQueueDebugCallback("Tracking token updated");
    };
    MOSQUITTOIOT.prototype.SubmitEvent = function (event, service, properties, contentType) {
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
            
            let options = {
                properties:{
                    userProperties:[],
                    contentType:""
                } 
            };
            if (contentType === "application/json" || contentType === "text/plain") {
                options.properties.contentType = contentType;
            }

            if (properties) {
                for (let i = 0; i < properties.length; i++) {
                    options.properties.userProperties.push(properties[i].Variable, properties[i].Value);
                }
            }

            if (self.mqttClient) {
                self.mqttClient.publish("events",event,options,(err)=>{
                    if (err) {
                        self.onSubmitQueueErrorCallback('Unable to send message to to MOSQUITTO Broker Hub');
                        if (!isResend)
                            self.onPersistEventCallback(persistMsg);

                        resolve('Unable to send message to to MOSQUITTO Broker Hub');
                    }
                    else {
                        self.onPersistHistoryCallback(event);
                        self.onSubmitQueueSuccessCallback("Event has been sent to MOSQUITTO Broker Hub");
                        resolve();
                    }
                });
            }
            else {
                if (!isResend)
                    self.onPersistEventCallback(persistMsg);

                self.onSubmitQueueErrorCallback('MQTT client is not ready');
                resolve();
            }
        });
    };
    MOSQUITTOIOT.prototype.IsConnected = function () {
        if (!self.mqttClient) {
            self.startInProcess = false
            return false;
        }
        else {
            return self.mqttClient.connected;
        }

    };

}
module.exports = MOSQUITTOIOT;

