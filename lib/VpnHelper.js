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
var fs = require('fs');
var util = require('./utils');

function VpnHelper(vpnConfigPath) {
    VpnHelper.prototype.up = async function () {
        return new Promise(async (resolve, reject) => {
            try {
                // Download wireguard-tools
                await util.addNpmPackageAsync('wireguard-tools@0.1.0')
                const { WgConfig, getConfigObjectFromFile } = require('wireguard-tools');
                const config = new WgConfig(vpnConfigPath);
                await config.parseFile(vpnConfigPath);
                await config.up();
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    };
    VpnHelper.prototype.down = async function () {
        return new Promise(async (resolve, reject) => {
            try {
                const { WgConfig, getConfigObjectFromFile } = require('wireguard-tools');
                const config = new WgConfig(vpnConfigPath);
                await config.parseFile(vpnConfigPath);
                await config.down();
                resolve();
            } catch (error) {
                resolve();
            }
        });
    };
}

module.exports = VpnHelper;