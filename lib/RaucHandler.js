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
function RaucHandler(){
    var self = this;
    RaucHandler.prototype.raucInstall = function (path, callback) {
        const dbus = require('dbus-native');
        const serviceName = 'de.pengutronix.rauc'; // the service we request
    
        // The interface we request of the service
        const interfaceName = 'de.pengutronix.rauc.Installer';
    
        // The object we request
        const objectPath = `/`;
    
        // First, connect to the system bus (works the same on the system bus, it's just less permissive)
        const systemBus = dbus.systemBus();
    
        // Check the connection was successful
        if (!systemBus) {
            throw new Error('Could not connect to the DBus session bus.');
        }
    
        const service = systemBus.getService(serviceName);
    
        this.raucGetProgress();
        service.getInterface(objectPath, interfaceName, (err, iface) => {
            if (err) {
                console.error(
                    `Failed to request interface '${interfaceName}' at '${objectPath}' : ${
                        err
                        }`
                        ? err
                        : '(no error)'
                );
                callback(err);
                return;
            }
    
            iface.Install(path, function (err) {});
            // Left from dbus-native example...
            iface.on('Completed', nb => {
                console.log(`Received Completed: ${nb}`);
                if (nb === 0) {
                    console.log('Done');
                    callback();
                    return;
                } else {
                    this.raucGetProperty("LastError", function (err, lastError) {
                        callback("RAUC ERROR: " + lastError);
                    });
                    return;
                }
            });
        });
    };    
    RaucHandler.prototype.raucGetSlotStatus = function (callback) {
        try {
            const dbus = require('dbus-native');
            if (!dbus) {
                callback("DBUS not installed");
            }
            const serviceName = 'de.pengutronix.rauc'; // the service we request
    
            // The interface we request of the service
            const interfaceName = 'de.pengutronix.rauc.Installer';
    
            // The object we request
            const objectPath = `/`;
    
            // First, connect to the session bus (works the same on the system bus, it's just less permissive)
            const systemBus = dbus.systemBus();
    
            // Check the connection was successful
            if (!systemBus) {
                callback('Could not connect to the DBus session bus.');
                return;
            }
    
            const service = systemBus.getService(serviceName);
    
            service.getInterface(objectPath, 'org.freedesktop.DBus.Properties', (err, iface) => {
                if (err) {
                    callback(`Failed to request interface org.freedesktop.DBus.Properties at '${objectPath}' : ${err}` ? err : '(no error)');
                    return;
                }
                else {
                    iface.Get("de.pengutronix.rauc.Installer", "Compatible", function (err, status) {
                        if (err) {
                            callback("Error reading Compatible: " + err);
                            return;
                        }
                        else {
                            console.log("Compatible: " + JSON.stringify(status));
                            if (status.length < 2) {
                                callback("Compatible status length is not 2");
                                return;
                            }
                            if (!status[1][0]) {
                                callback("status[1][0] is undefined");
                                return;
                            }
                            var compatible = status[1][0];
                            service.getInterface(objectPath, interfaceName, (err, iface) => {
                                if (err) {
                                    callback(`Failed to request interface '${interfaceName}' at '${objectPath}' : ${err}` ? err : '(no error)');
                                    return;
                                }
                                // Read status from rauc
                                iface.GetSlotStatus(function (err, status) {
                                    if (err) {
                                        callback(err);
                                        return;
                                    }
                                    else {
                                        let rootfs0 = status[0][1].map(function (s) {
                                            return { key: s[0], val: s[1][1][0] };
                                        });
                                        let rootfs1 = status[1][1].map(function (s) {
                                            return { key: s[0], val: s[1][1][0] };
                                        });
    
                                        callback(null, { rootfs0: rootfs0, rootfs1: rootfs1, platform: compatible });
                                        return;
                                    }
                                });
                            });
                        }
                    });
    
                }
            });
        }
        catch (e) {
            callback(e);
        }
    };
    RaucHandler.prototype.raucGetPlatform = function (callback) {
        const dbus = require('dbus-native');
        var bus = dbus.systemBus();
        const serviceName = 'de.pengutronix.rauc';
    
        bus.invoke(
            {
                path: '/',
                destination: serviceName,
                interface: 'org.freedesktop.DBus.Properties',
                member: 'Get',
                signature: 'ss',
                body: [
                    "de.pengutronix.rauc.Installer",
                    "Compatible"]
            },
            function (err, res) {
                if (err) {
                    console.log('error: ' + err);
                    callback(err);
                    return;
                }
                else {
                    console.log(res);
                    if (res.length !== 2 || res[1].length !== 1) {
                        callback("Unexpected result. " + JSON.stringify(res));
                        return;
                    }
    
                    callback(null, res[1][0]);
                }
            }
        );
    };    
    RaucHandler.prototype.raucGetProperty = function (property, callback) {
        const dbus = require('dbus-native');
        var bus = dbus.systemBus();
        const serviceName = 'de.pengutronix.rauc';
    
        bus.invoke(
            {
                path: '/',
                destination: serviceName,
                interface: 'org.freedesktop.DBus.Properties',
                member: 'Get',
                signature: 'ss',
                body: [
                    "de.pengutronix.rauc.Installer",
                    property]
            },
            function (err, res) {
                if (err) {
                    console.log('error: ' + err);
                    callback(err);
                    return;
                }
                else {
                    if (res.length !== 2 || res[1].length !== 1) {
                        callback("Unexpected result. " + JSON.stringify(res));
                        return;
                    }
    
                    callback(null, res);
                }
            }
        );
    };
    RaucHandler.prototype.raucGetProgress = function () {
        const dbus = require('dbus-native');
        var bus = dbus.systemBus();
        const serviceName = 'de.pengutronix.rauc';
    
        bus.invoke(
            {
                path: '/',
                destination: serviceName,
                interface: 'org.freedesktop.DBus.Properties',
                member: 'Get',
                signature: 'ss',
                body: [
                    "de.pengutronix.rauc.Installer",
                    "Progress"]
            },
            function (err, res) {
                if (err) {
                    console.log('progress error: ' + err);
                }
                else {
                    let status = res[1][0][2] ? 'failed':'success'
                    let msg = `progress: ${status} ${res[1][0][0]}% - ${res[1][0][1]}`;
                    self.emit('progress',msg);
                   //console.log(msg);
                }
            }
        );
    };
    RaucHandler.prototype.raucMarkPartition = function (partition, callback) {
        const dbus = require('dbus-native');
        var bus = dbus.systemBus();
        const serviceName = 'de.pengutronix.rauc';
        // The interface we request of the service
        const interfaceName = 'de.pengutronix.rauc.Installer';
    
        // The object we request
        const objectPath = `/`;
    
        // First, connect to the system bus (works the same on the system bus, it's just less permissive)
        const systemBus = dbus.systemBus();
    
        // Check the connection was successful
        if (!systemBus) {
            throw new Error('Could not connect to the DBus session bus.');
        }
    
        const service = systemBus.getService(serviceName);
    
        this.raucGetProgress();
        service.getInterface(objectPath, interfaceName, (err, iface) => {
            if (err) {
                console.error(
                    `Failed to request interface '${interfaceName}' at '${objectPath}' : ${
                        err
                        }`
                        ? err
                        : '(no error)'
                );
                callback(err);
                return;
            }
    
            iface.Mark("active", partition, function (err) {
                console.log("Mark err: "+ err);
            });
            // Left from dbus-native example...
            iface.on('Completed', nb => {
                console.log(`Received Completed: ${nb}`);
                if (nb === 0) {
                    console.log('Done');
                    callback();
                    return;
                } else {
                    this.raucGetProperty("LastError", function (err, lastError) {
                        callback("RAUC ERROR: " + lastError);
                    });
                    return;
                }
            });
        });
    };
}
module.exports = RaucHandler;
RaucHandler.prototype.__proto__ = EventEmitter.prototype;