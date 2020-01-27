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
var util = require('./utils.js');
var EventEmitter = require('events').EventEmitter;
var async = require("async");

var snap;
function SnapHelper() {

    this.isSnap = () => {
        return process.env.SNAP_NAME != null;
    };
    this.install = async function () {
        try {
            let Snap = require('node-snapd');
            snap = new Snap();
            this.emit('log', 'node-snapd is installed');
            return;
        }
        catch (e) {
            this.emit('log', 'installing node-snapd');

            await util.addNpmPackageAsync("node-snapd")
                .then(() => {
                    this.emit('log', 'node-snapd installed');
                    let Snap = require('node-snapd');
                    snap = new Snap();
                    return;
                })
                .catch(err => {
                    throw err
                });
        }
    };

    this.listSnaps = async function () {
        return new Promise(async (resolve, reject) => {
            if (!this.isSnap()) {
                this.emit('log', "this node is not running in snap environment");
                resolve();
                return;
            }
            let snaps = [];

            await this.install()
                .then(status => {
                    return true;
                })
                .catch(err => {
                    this.emit('log', "Failed installing node-snap. " + err);
                    return false;
                });

            await snap.listSnaps()
                .then(res => {
                    this.emit('log', "listing snaps");
                    async.map(res, async (snapName, callback) => {
                        await snap.info({ name: snapName })
                            .then(snapDetails => {
                                snaps.push(snapDetails);
                                callback();
                            })
                            .catch(error => {
                                this.emit('log', `Error: ${JSON.stringify(error)}`);
                                throw error;
                            });
                    }, () => {
                        this.emit('log', "listSnaps - complete");
                        snaps.sort((a, b) => a.name.localeCompare(b.name));
                        resolve(snaps);
                    });
                })
                .catch(error => {
                    this.emit('log', `Error: ${JSON.stringify(error)}`);
                });
        });
    };
    this.installSnap = async function (snapName) {
        return new Promise(async (resolve, reject) => {
            if (!this.isSnap()) {
                this.emit('log', "this node is not running in snap environment");
                resolve();
            }

            let snaps = [];
            await this.install()
                .then(status => {
                    this.emit('log', "All good");
                    return true;
                })
                .catch(err => {
                    this.emit('log', "Failed installing node-snap. " + err);
                    return false;
                });
            await snap.install({ name: snapName, opts: snapName.indexOf("microservicebus") === 0 ? "devmode" : "" })
                .then(id => {
                    console.log(`installting ${snapName}`);

                    snap.status({ id })
                        .then(res => {
                            this.emit('log', `snap.status() -> ${res.status}`)

                            snap.abort({ id })
                                .then(resres => this.emit('log', `snap.abort() -> ${JSON.stringify(resres)}`))
                                .catch(error => this.emit('log', `fail! snap.abort() -> ${JSON.stringify(error)}`))
                        })
                        .catch(error => this.emit('log', `fail! snap.status() -> ${JSON.stringify(error)}`))
                })
                .catch(error => this.emit('log', `fail! snap.install(${snapName}) ->  ${JSON.stringify(error)}`))

        });
    };
}

module.exports = SnapHelper;
SnapHelper.prototype.__proto__ = EventEmitter.prototype;