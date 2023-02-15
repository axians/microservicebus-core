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

function MicroServiceBusDBusInterface(parent, callback) {
  try {
    const dbus = require('msb-dbus-native');
    var serviceName = 'com.microservicebus.core'; // our DBus service name
    var interfaceName = serviceName;
    var objectPath = "/com/microservicebus/core";
    var bus = dbus.systemBus();

    // Check the connection was successful
    if (!bus) {
      callback('Could not connect to the DBus.');
    }

    /*
      Then request our service name to the bus.
      The 0x4 flag means that we don't want to be queued if the service name we are requesting is already
      owned by another service ;we want to fail instead.
    */
    bus.requestName(serviceName, 0x4, (err, retCode) => {
      // If there was an error, warn user and fail
      if (err) {
        callback(`Could not request service name ${serviceName}, the error was: ${err}.`);
      }

      // Return code 0x1 means we successfully had the name
      if (retCode === 1) {
        callback();
      } else {
        callback(`Failed to request service name "${serviceName}". Check what return code "${retCode}" means.`);
      }
    });
  }
  catch (err) {
    callback(err);
  }


  MicroServiceBusDBusInterface.prototype.Start = function () {
    return new Promise(function (resolve, reject) {
      // Function called when we have successfully got the service name we wanted
      console.log('DBUS: Start')
      try {
        // First, we need to create our interface description (here we will only expose method calls)
        var ifaceDesc = {
          name: interfaceName,
          methods: {
            Ping: ['', 's', [], ['current_time']],
          },
          properties: {
            Version: 's'
          }
        };

        // Then we need to create the interface implementation (with actual functions)
        var iface = {
          Ping: function () {
            return new Date().toString();
          },
          Version: parent.version()
        };

        // Now we need to actually export our interface on our object
        bus.exportInterface(iface, objectPath, ifaceDesc);
        resolve();
      }
      catch (err) {
        reject(err);
      }
    });
  };
}
module.exports = MicroServiceBusDBusInterface;