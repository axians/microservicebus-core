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
require('colors');
var URL = require('url').URL; // needed for backward compatibility

var EventEmitter = require('events').EventEmitter;
function SignalRClient(uri) {
    var self = this;
    let url = new URL(uri);
    if (url.hostname === "localhost") {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }
    const signalR = require("@microsoft/signalr");
    const connection = new signalR.HubConnectionBuilder()
        .withUrl(`${uri}/nodeHub`)
        .withAutomaticReconnect() // .withAutomaticReconnect([0, 2000, 10000, 30000]) yields the default behavior
        //.configureLogging(signalR.LogLevel.Debug)
        .configureLogging(new Logger())
        .build();
    connection.keepAliveIntervalInMilliseconds = 1000 * 60 * 3; // Three minutes
    connection.serverTimeoutInMilliseconds = 1000 * 60 * 6; // Six minutes

    this.start = function () {
        return new Promise(function (resolve, reject) {
            init();
            connection.start()
                .then(() => {
                    self.emit('connected', {});
                    resolve();
                })
                .catch((e) => {
                    // 404 should be handled by falling back to  legacy client
                    // and should not trigger onerror 
                    if (e.statusCode === 302) {
                        reject("NOTV2");
                    }
                    else {
                        self.emit('onerror', e);
                        reject(e);
                    }

                });
        });
    }
    this.invoke = function (methodName) {
        switch (arguments.length) {
            case 1:
                return connection.invoke(arguments[0]);
            case 2:
                return connection.invoke(arguments[0], arguments[1]);
            case 3:
                return connection.invoke(arguments[0], arguments[1], arguments[2]);
            case 4:
                return connection.invoke(arguments[0], arguments[1], arguments[2], arguments[3]);
            case 5:
                return connection.invoke(arguments[0], arguments[1], arguments[2], arguments[3], arguments[4]);
            case 6:
                return connection.invoke(arguments[0], arguments[1], arguments[2], arguments[3], arguments[4], arguments[5]);
            case 7:
                return connection.invoke(arguments[0], arguments[1], arguments[2], arguments[3], arguments[4], arguments[5], arguments[6]);
            case 8:
                return connection.invoke(arguments[0], arguments[1], arguments[2], arguments[3], arguments[4], arguments[5], arguments[6], arguments[7]);
            case 9:
                return connection.invoke(arguments[0], arguments[1], arguments[2], arguments[3], arguments[4], arguments[5], arguments[6], arguments[7], arguments[8]);
            case 9:
                return connection.invoke(arguments[0], arguments[1], arguments[2], arguments[3], arguments[4], arguments[5], arguments[6], arguments[7], arguments[8], arguments[9]);
            default:
                throw "unsupported length of parameters";
        }
    }
    this.isConnected = function () {
        return connection.connection.connectionState === "Connected";
    }
    function init() {
        // Wire up signalR events
        /* istanbul ignore next */
        connection.onclose(() => {
            self.emit('disconnected');
        });
        connection.onreconnecting(() => {
            self.emit('reconnecting', 0);
        });
        connection.onreconnected(() => {
            self.emit('reconnected', {});
        });

        // Wire up signalR events
        /* istanbul ignore next */
        connection.on('errorMessage', (message, errorCode) => {
            self.emit('errorMessage', message, errorCode);
        });
        connection.on('ping', (message) => {
            self.emit('ping', message);
        });
        connection.on('getEndpoints', (message) => {
            self.emit('getEndpoints', message);
        });
        connection.on('updateItinerary', (updatedItinerary) => {
            self.emit('updateItinerary', updatedItinerary);
        });
        connection.on('changeState', (state) => {
            self.emit('changeState', state);
        });
        connection.on('changeDebug', (debug) => {
            self.emit('changeDebug', debug);
        });
        connection.on('changeTracking', (enableTracking) => {
            self.emit('changeTracking', enableTracking);
        });
        connection.on('sendMessage', (message, destination) => {
            self.emit('sendMessage', message, destination);
        });
        connection.on('signInMessage', (response) => {
            self.emit('signInMessage', response);
        });
        connection.on('nodeCreated', (nodeData) => {
            self.emit('nodeCreated', nodeData);
        });
        connection.on('heartBeat', (id) => {
            self.emit('heartBeat', id);
        });
        connection.on('forceUpdate', () => {
            self.emit('forceUpdate');
        });
        connection.on('restart', () => {
            self.emit('restart');
        });
        connection.on('reboot', () => {
            self.emit('reboot');
        });
        connection.on('shutdown', () => {
            self.emit('shutdown');
        });
        connection.on('refreshSnap', (snap, mode, connId) => {
            self.emit('refreshSnap', snap, mode, connId);
        });
        connection.on('reset', (id) => {
            self.emit('reset', id);
        });
        connection.on('resetKeepEnvironment', (id) => {
            self.emit('resetKeepEnvironment', id);
        });
        connection.on('updateFlowState', (itineraryId, environment, enabled) => {
            self.emit('updateFlowState', itineraryId, environment, enabled);
        });
        connection.on('enableDebug', (connId) => {
            self.emit('enableDebug', connId);
        });
        connection.on('stopDebug', (connId) => {
            self.emit('stopDebug', connId);
        });
        connection.on('reportState', (id) => {
            self.emit('reportState', id);
        });
        connection.on('uploadSyslogs', (connectionId, fileName, account, accountKey) => {
            self.emit('uploadSyslogs', connectionId, fileName, account, accountKey);
        });
        connection.on('resendHistory', (req) => {
            self.emit('resendHistory', req);
        });
        connection.on('requestHistory', (req) => {
            self.emit('requestHistory', req);
        });
        connection.on('transferToPrivate', (req) => {
            self.emit('transferToPrivate', req);
        });
        connection.on('updatedToken', (token) => {
            self.emit('updatedToken', token);
        });
        connection.on('updateFirmware', (force, connid) => {
            self.emit('updateFirmware', force, connid);
        });
        connection.on('grantAccess', () => {
            self.emit('grantAccess');
        });
        connection.on('runTest', (testDescription) => {
            self.emit('runTest', testDescription);
        });
        connection.on('pingNodeTest', (connid) => {
            self.emit('pingNodeTest', connid);
        });
        connection.on('updatePolicies', (policies) => {
            self.emit('updatePolicies', policies);
        });
        connection.on('setBootPartition', (partition, connid) => {
            self.emit('setBootPartition', partition, connid);
        });
        connection.on('executeScript', (patchScript, connid) => {
            self.emit('executeScript', patchScript, connid);
        });
        connection.on('updateVulnerabilities', (connid) => {
            self.emit('updateVulnerabilities', connid);
        });

        connection.on('dockerListImages', (request, connid) => {
            self.emit('dockerListImages', request, connid);
        });
        connection.on('dockerListContainers', (request, connid) => {
            self.emit('dockerListContainers', request, connid);
        });
        connection.on('dockerInstallImage', (request, connid) => {
            self.emit('dockerInstallImage', request, connid);
        });
        connection.on('dockerDeleteImage', (request, connid) => {
            self.emit('dockerDeleteImage', request, connid);
        });
        connection.on('dockerStartContainer', (request, connid) => {
            self.emit('dockerStartContainer', request, connid);
        });
        connection.on('dockerStopContainer', (request, connid) => {
            self.emit('dockerStopContainer', request, connid);
        });
    }
    function getArgValues(params) {
        var res = [];

        if (params.length && params.length > 1) {
            for (var i = 1; i < params.length; i++) {
                var p = params[i];
                if (typeof p === "function" || typeof p === "undefined") {
                    p = null;
                }
                res[i - 1] = p;
            }
        }
        return res;
    }
    function Logger() {
        this.log = function (logLevel, message) {
            switch (logLevel) {
                case signalR.LogLevel.Critical:
                    self.emit('onerror', "Critical ".red + message.grey);
                case signalR.LogLevel.Error:
                    self.emit('onerror', "Error ".red + message.grey);
                case signalR.LogLevel.Warning:
                    self.emit('onerror', "Warning ".yellow + message.grey);
                // case signalR.LogLevel.Information:
                //     self.emit('onerror', "Information ".yellow + message.grey);
                // case signalR.LogLevel.Debug:
                //     self.emit('onerror', "Debug ".yellow + message.grey);
                // case signalR.LogLevel.Trace:
                //     self.emit('onerror', "Trace ".yellow + message.grey);
                default:
                    break;
            }
        }
    }
}
module.exports = SignalRClient;
SignalRClient.prototype.__proto__ = EventEmitter.prototype;