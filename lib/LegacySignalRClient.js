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
var EventEmitter = require('events').EventEmitter;
function LegacySignalRClient(uri) {
    var self = this;
    var _hubName = 'integrationHub';
    const signalR = require('./signalR.js');
    const _client = new signalR.client(
        `${uri}/signalR`,
        [_hubName],
        10,
        true
    );

    this.start = function () {
        return new Promise(function (resolve, reject) {
            try {
                init();
                _client.start();
                resolve();
            } catch (error) {
                reject();
            }
        });
    }
    this.invoke = function (methodName) {
        var args = getArgValues(arguments);
        return _client.invoke.apply(_hubName, args);
    }
    this.isConnected = function () {
        return _client.isConnected();
    }
    function init() {
        // Wire up signalR events
        /* istanbul ignore next */
        _client.serviceHandlers = {
            bound: function () {
                self.emit('bound');
            },
            connectFailed: function (error) {
                self.emit('connectFailed', error);
            },
            connected: function (connection) {
                self.emit('connected', connection);
            },
            disconnected: function () {
                self.emit('disconnected');
            },
            onerror: function (error) {
                self.emit('onerror', error);
            },
            onUnauthorized: function (error) {
                self.emit('onUnauthorized', error);
            },
            messageReceived: function (message) {
                //console.log("Connection: " + "messageReceived: ".yellow + message.utf8Data);
            },
            bindingError: function (error) {
                self.emit('bindingError', error);
            },
            connectionLost: function (error) { // This event is forced by server
                self.emit('connectionLost', error);
            },
            reconnected: function (connection) {
                self.emit('reconnected', connection);
            },
            reconnecting: function (retry /* { inital: true/false, count: 0} */) {
                self.emit('reconnecting', retry);
            }
        };

        // Wire up signalR events
        /* istanbul ignore next */
        _client.on('integrationHub', 'errorMessage', function (message, errorCode) {
            self.emit('errorMessage', message, errorCode);
        });
        _client.on('integrationHub', 'ping', function (message) {
            self.emit('ping', message);
        });
        _client.on('integrationHub', 'getEndpoints', function (message) {
            self.emit('getEndpoints', message);
        });
        _client.on('integrationHub', 'updateItinerary', function (updatedItinerary) {
            self.emit('updateItinerary', updatedItinerary);
        });
        _client.on('integrationHub', 'changeState', function (state) {
            self.emit('changeState', state);
        });
        _client.on('integrationHub', 'changeDebug', function (debug) {
            self.emit('changeDebug', debug);
        });
        _client.on('integrationHub', 'changeTracking', function (enableTracking) {
            self.emit('changeTracking', enableTracking);
        });
        _client.on('integrationHub', 'sendMessage', function (message, destination) {
            self.emit('sendMessage', message, destination);
        });
        _client.on('integrationHub', 'signInMessage', function (response) {
            self.emit('signInMessage', response);
        });
        _client.on('integrationHub', 'nodeCreated', function (nodeData) {
            self.emit('nodeCreated', nodeData);
        });
        _client.on('integrationHub', 'heartBeat', function (id) {
            self.emit('heartBeat', id);
        });
        _client.on('integrationHub', 'forceUpdate', function () {
            self.emit('forceUpdate');
        });
        _client.on('integrationHub', 'restart', function () {
            self.emit('restart');
        });
        _client.on('integrationHub', 'reboot', function () {
            self.emit('reboot');
        });
        _client.on('integrationHub', 'shutdown', function () {
            self.emit('shutdown');
        });
        _client.on('integrationHub', 'refreshSnap', function (snap, mode, connId) {
            self.emit('refreshSnap', snap, mode, connId);
        });
        _client.on('integrationHub', 'reset', function (id) {
            self.emit('reset', id);
        });
        _client.on('integrationHub', 'resetKeepEnvironment', function (id) {
            self.emit('resetKeepEnvironment', id);
        });
        _client.on('integrationHub', 'updateFlowState', function (itineraryId, environment, enabled) {
            self.emit('updateFlowState', itineraryId, environment, enabled);
        });
        _client.on('integrationHub', 'enableDebug', function (connId) {
            self.emit('enableDebug', connId);
        });
        _client.on('integrationHub', 'stopDebug', function (connId) {
            self.emit('stopDebug', connId);
        });
        _client.on('integrationHub', 'reportState', function (id) {
            self.emit('reportState', id);
        });
        _client.on('integrationHub', 'uploadSyslogs', function (connectionId, fileName, account, accountKey) {
            self.emit('uploadSyslogs', connectionId, fileName, account, accountKey);
        });
        _client.on('integrationHub', 'resendHistory', function (req) {
            self.emit('resendHistory', req);
        });
        _client.on('integrationHub', 'requestHistory', function (req) {
            self.emit('requestHistory', req);
        });
        _client.on('integrationHub', 'transferToPrivate', function (req) {
            self.emit('transferToPrivate', req);
        });
        _client.on('integrationHub', 'updatedToken', function (token) {
            self.emit('updatedToken', token);
        });
        _client.on('integrationHub', 'updateFirmware', function (force, connid) {
            self.emit('updateFirmware', force, connid);
        });
        _client.on('integrationHub', 'grantAccess', function () {
            self.emit('grantAccess');
        });
        _client.on('integrationHub', 'runTest', function (testDescription) {
            self.emit('runTest', testDescription);
        });
        _client.on('integrationHub', 'pingNodeTest', function (connid) {
            self.emit('pingNodeTest', connid);
        });
        _client.on('integrationHub', 'updatePolicies', function (policies) {
            self.emit('updatePolicies', policies);
        });
        _client.on('integrationHub', 'setBootPartition', function (partition, connid) {
            self.emit('setBootPartition', partition, connid);
        });
        _client.on('integrationHub', 'executeScript', function (patchScript, connid) {
            self.emit('executeScript', patchScript, connid);
        });
        _client.on('integrationHub', 'updateVulnerabilities', function (connid) {
            self.emit('updateVulnerabilities', connid);
        });
        _client.on('integrationHub', 'testSiteConfiguration', function (configuration, connid) {
            self.emit('testSiteConfiguration', configuration, connid);
        });
        _client.on('integrationHub', 'testConnection', function (configuration, connid) {
            self.emit('testConnection', configuration, connid);
        });
    }
    function getArgValues(params) {
        var res = [_hubName];

        //if (params.length && params.length > 1) {
        for (var i = 0; i < params.length; i++) {
            var p = params[i];
            if (typeof p === "function" || typeof p === "undefined") {
                p = null;
            }
            res[i + 1] = p;
        }
        //}

        return res;
    }
}
module.exports = LegacySignalRClient;
LegacySignalRClient.prototype.__proto__ = EventEmitter.prototype;