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
function NOITOHUB(nodeName, connectionSettings) {
    var self;
    NOITOHUB.prototype.Start = function (callback) {
        self = this;
        self.onQueueDebugCallback("This node is not connected to an IoT Hub, Consider adding an IoT Hub from the Organization page.".yellow);
        callback();
    };
    NOITOHUB.prototype.ChangeState = function (state, node) {
        self.onQueueDebugCallback("This node is not connected to an IoT Hub and can therefor not change state. Consider adding an IoT Hub from the Organization page.");
    };
    NOITOHUB.prototype.Stop = function (callback) {
       
    };
    NOITOHUB.prototype.Submit = function (msg, node, service) {
        self.onQueueDebugCallback("This node is not connected to an IoT Hub and can therefor not sumbit messages. Consider adding an IoT Hub from the Organization page.");

    };
    NOITOHUB.prototype.Track = function (trackingMessage) {
    };
    NOITOHUB.prototype.Update = function (settings) {
   };
    NOITOHUB.prototype.SubmitEvent = function (event, service, properties, contentType) {
        return new Promise(function (resolve, reject) {
            self.onQueueDebugCallback("This node is not connected to an IoT Hub and can therefor not sumbit messages. Consider adding an IoT Hub from the Organization page.");
            resolve();
        });
    };
    NOITOHUB.prototype.IsConnected = function () {
        return true;
    };
}
module.exports = NOITOHUB;

