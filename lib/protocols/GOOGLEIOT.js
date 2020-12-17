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
var storage = require('node-persist');
var util = require('../utils.js');
var utils = require('util');
var fs = require('fs');
function GOOGLEIOT(nodeName, connectionSettings) {
    var isConnected = false;
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
            const deviceId = nodeName;
            const registryId = self.settingsHelper.settings.google.registryId;
            const projectId = self.settingsHelper.settings.google.projectId;
            const region = self.settingsHelper.settings.google.region;
            const algorithm = self.settingsHelper.settings.google.algorithm;
            const privateKeyFile = self.settingsHelper.settings.google.privateKeyFile;
            const mqttBridgeHostname = self.settingsHelper.settings.google.mqttBridgeHostname;
            const mqttBridgePort = self.settingsHelper.settings.google.mqttBridgePort;
            
            const createJwt = async (projectId, privateKeyFile, algorithm) => {
                const token = {
                    iat: parseInt(Date.now() / 1000),
                    exp: parseInt(Date.now() / 1000) + 20 * 60, // 20 minutes
                    aud: projectId,
                };
                const readFile = utils.promisify(fs.readFile);
                const privateKey = await readFile(privateKeyFile);
                return jwt.sign(token, privateKey, {
                    algorithm: algorithm
                });
            };

            const mqttClientId = `projects/${projectId}/locations/${region}/registries/${registryId}/devices/${deviceId}`;

            const connectionArgs = {
                host: mqttBridgeHostname,
                port: mqttBridgePort,
                clientId: mqttClientId,
                username: "unused",
                password: await createJwt(projectId, privateKeyFile, algorithm),
                protocol: "mqtts",
                secureProtocol: "TLSv1_2_method",
            };

            // Create a client, and connect to the Google MQTT bridge.
            const iatTime = parseInt(Date.now() / 1000);
            self.client = mqtt.connect(connectionArgs);
            self.client.on('connect', success => {
                isConnected = success;
                if (!success) {
                    self.onQueueDebugCallback("Google IoT Core: Unable to connect.");
                } else {
                    self.onQueueDebugCallback("Google IoT Core: Successfully connected.");
                    self.client.subscribe(`/devices/${deviceId}/config`, {
                        qos: 1
                    });
                    self.client.subscribe(`/devices/${deviceId}/commands/#`, {
                        qos: 0
                    });
                }
                callback();
            });

            self.client.on('message', (topic, message) => {
                let msg;
                if (topic === `/devices/${deviceId}/config`) {
                    // TODO

                } else if (topic.startsWith(`/devices/${deviceId}/commands`)) {
                    let contentType = "application/json";
                    msg = Buffer.from(message, 'base64').toString('ascii');
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
                self.onQueueErrorReceiveCallback(`Google IoT Core: Error: ${ JSON.stringify(err)}`);
            });

            self.client.on('packetsend', (m) => {
                // Note: logging packet send is very verbose
                //console.log(m);
            });
        });
    };
    GOOGLEIOT.prototype.ChangeState = function (state, node) {
        const self = this;
        self.onQueueDebugCallback(
            "This node is not connected to an IoT Hub and can therefor not change state. Consider adding an IoT Hub from the Organization page."
        );
    };
    GOOGLEIOT.prototype.Stop = function (callback) {};
    GOOGLEIOT.prototype.Submit = function (msg, node, service) {
        const self = this;
        self.onQueueDebugCallback(
            "This node is not connected to an IoT Hub and can therefor not sumbit messages. Consider adding an IoT Hub from the Organization page."
        );
    };
    GOOGLEIOT.prototype.Track = function (trackingMessage) {
        const self = this;
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
            self.onQueueDebugCallback(
                "This node is not connected to an IoT Hub and can therefor not sumbit messages. Consider adding an IoT Hub from the Organization page."
            );
            resolve();
        });
    };
    GOOGLEIOT.prototype.IsConnected = function () {
        const self = this;
        self.client.on('connect', success => {
            console.log('connected');

            if (!success) {
                console.log('Client not connected...');
            }
        });

    };
}
module.exports = GOOGLEIOT;