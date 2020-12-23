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
"use strict";
var jwt, mqtt;
require('colors')
var storage = require('node-persist');
var httpRequest = require('request');
var util = require('../utils.js');
var utils = require('util');
var fs = require('fs');
var deviceId;

function GOOGLEIOT(nodeName, connectionSettings) {
    var forcedDissconnect = false;
    var storageIsEnabled = true;
    var tokenTTL = 60 * 60 * 24
    this.client = null;

    GOOGLEIOT.prototype.Start = async function (callback) {
        const self = this;
        util.addNpmPackages("jsonwebtoken, mqtt", false, async function (err) {
            if (err) {
                self.onQueueErrorReceiveCallback("Google IoT Core: Unable to download npm packages. " + err);
                callback(err);
            }

            jwt = require("jsonwebtoken");
            mqtt = require("mqtt");
            deviceId = nodeName;
            await self.connect();

            setInterval(async () => {
                await self.connect();
            }, 1000 * tokenTTL);

            callback();

        });
    };
    GOOGLEIOT.prototype.ChangeState = function (state, node) {
        const self = this;
        self.onQueueDebugCallback(
            "This node is not connected to an IoT Hub and can therefor not change state. Consider adding an IoT Hub from the Organization page."
        );
    };
    GOOGLEIOT.prototype.Stop = function (callback) {
        const self = this;
        self.client.end();
        callback();
    };
    GOOGLEIOT.prototype.Submit = function (msg, node, service) {
        const self = this;
        self.onQueueDebugCallback(
            "This node is not connected to an IoT Hub and can therefor not sumbit messages. Consider adding an IoT Hub from the Organization page."
        );
    };
    GOOGLEIOT.prototype.Track = function (trackingMessage) {
        const self = this;
        try {
            if (!self.IsConnected()) {
                if (storageIsEnabled)
                    self.onPersistTrackingCallback(trackingMessage);

                return;
            }
            //var trackUri = `https://${connectionSettings.sbNamespace}/${connectionSettings.trackingHubName}/messages?timeout=60`;
            httpRequest({
                headers: {
                    "Authorization": connectionSettings.trackingToken,
                    "Content-Type": "application/json",
                },
                uri: `https://${connectionSettings.sbNamespace}/${connectionSettings.trackingHubName}/messages?timeout=60`,
                json: trackingMessage,
                method: 'POST'
            },
                function (err, res, body) {
                    if (err != null) {
                        self.onQueueErrorSubmitCallback("Unable to send message. " + err.code + " - " + err.message)
                        console.log("Unable to send message. " + err.code + " - " + err.message);
                        if (storageIsEnabled)
                            self.onPersistTrackingCallback(trackingMessage);
                    } else if (res.statusCode >= 200 && res.statusCode < 300) { } else if (res.statusCode == 401) {
                        console.log("Invalid token. Updating token...")

                        return;
                    } else {
                        console.log("Unable to send message. " + res.statusCode + " - " + res.statusMessage);

                    }
                });

        } catch (err) {
            console.log();
        }
    };
    GOOGLEIOT.prototype.Update = function (settings) {
        const self = this;
    };
    GOOGLEIOT.prototype.SubmitEvent = function (
        event,
        service,
        properties,
        contentType
    ) {
        const self = this;
        return new Promise(function (resolve, reject) {
            var message;
            // MQTT kan bara skicka Buffer eller String https://www.npmjs.com/package/mqtt#publish
            if (!contentType || contentType == "application/json") {
                message = JSON.stringify(event);
            } else {
                message = event;
            }
            // The MQTT topic that this device will publish data to. The MQTT topic name is
            // required to be in the format below. The topic name must end in 'state' to
            // publish state and 'events' to publish telemetry. Note that this is not the
            // same as the device registry's Cloud Pub/Sub topic.
            const mqttTopic = `/devices/${deviceId}/events`;
            if (self.client.connected) {
                self.client.publish(mqttTopic, message), {
                    qos: 1
                }, err => {
                    if (!err) {
                        //shouldBackoff = false;
                        //backoffTime = MINIMUM_BACKOFF_TIME;
                        self.onSubmitQueueSuccessCallback("Event has been sent to Google IoT Core");
                        resolve(event);
                    } else {
                        self.onSubmitQueueErrorCallback('Unable to send message to Google IoT Core');
                    }
                };
            } else {
                self.onQueueDebugCallback(
                    "Connection is not established to Google MQTT Bridge. Persisting message."
                );
            }
        })
    };
    GOOGLEIOT.prototype.IsConnected = function () {
        const self = this;
        return self.client ? self.client.connected : false;

    };
    GOOGLEIOT.prototype.connect = async function() {
        const self = this;
        const registryId = self.settingsHelper.settings.google.registryId;
        const projectId = self.settingsHelper.settings.google.projectId;
        const region = self.settingsHelper.settings.google.region;
        const algorithm = self.settingsHelper.settings.google.algorithm;
        const privateKeyFile = self.settingsHelper.settings.google.privateKeyFile;
        const mqttBridgeHostname = self.settingsHelper.settings.google.mqttBridgeHostname;
        const mqttBridgePort = self.settingsHelper.settings.google.mqttBridgePort;
        const mqttClientId = `projects/${projectId}/locations/${region}/registries/${registryId}/devices/${deviceId}`;

        const createJwt = async (projectId, privateKeyFile, algorithm) => {
            const token = {
                iat: parseInt(Date.now() / 1000),
                exp: parseInt(Date.now() / 1000) + tokenTTL,
                aud: projectId,
            };
            const readFile = utils.promisify(fs.readFile);
            const privateKey = await readFile(privateKeyFile);
            return jwt.sign(token, privateKey, {
                algorithm: algorithm
            });
        };
        const connectionArgs = {
            host: mqttBridgeHostname,
            port: mqttBridgePort,
            clientId: mqttClientId,
            username: "unused",
            password: await createJwt(projectId, privateKeyFile, algorithm),
            protocol: "mqtts",
            secureProtocol: "TLSv1_2_method",
        };
        if(self.client && self.client.connected){
            self.onQueueDebugCallback("Google IoT Core: Refreshing token");
            self.client.end();
        }
        self.client = mqtt.connect(connectionArgs);
        self.client.on('connect', success => {

            if (!success) {
                self.onQueueDebugCallback("Google IoT Core: Unable to connect.");
            } else {
                forcedDissconnect = true;
                self.onQueueDebugCallback("Google IoT Core: Successfully connected.");
                self.client.subscribe(`/devices/${deviceId}/config`, {
                    qos: 1
                });
                self.client.subscribe(`/devices/${deviceId}/commands/#`, {
                    qos: 0
                });
            }
            
        });
        self.client.on('reconnect', () => {
            //self.onQueueDebugCallback(`Google IoT Core: Trying to reconnect`);
        });
        self.client.on('close', () => {
            if (!forcedDissconnect)
                self.onQueueDebugCallback(`Google IoT Core: Closed`);
        });
        self.client.on('offline', () => {
            self.onQueueErrorReceiveCallback(`Google IoT Core: ${"Offline".red}`);
        });
        self.client.on('message', (topic, message) => {
            if(message.length === 0){
                return;
            }
            
            let msg = Buffer.from(message, 'base64').toString('ascii');
            
            if (topic === `/devices/${deviceId}/config`) {
                self.onQueueDebugCallback("Google IoT Core: Received new state");
                msg = JSON.parse(msg);
                self.currentState.desired = msg;
                self.onStateReceivedCallback(self.currentState);
            } 
            else if (topic.startsWith(`/devices/${deviceId}/commands`)) {
                let contentType = "application/json";
                
                try {
                    msg = JSON.parse(msg);
                } catch (e) {
                    contentType = "text/xml";
                }
                self.onQueueDebugCallback("Google IoT Core: Message recieved from Azure");
                let context = {
                    ContentType: contentType,
                    Variables: []
                };
                self.onMessageReceivedCallback(msg, context);
            }
        });
        self.client.on('error', err => {
            if (err.code !== 'EACCES') { // EACCES is a followup error of lost connection is is very chatty. The error has already been reported so we ignore it.
                self.onQueueErrorReceiveCallback(`Google IoT Core: Error: ${JSON.stringify(err)}`);
            } else {
                forcedDissconnect = true;
            }
        });
        self.client.on('packetsend', (m) => {
            // Note: logging packet send is very verbose
            //console.log(m);
        });
    };
}
module.exports = GOOGLEIOT;