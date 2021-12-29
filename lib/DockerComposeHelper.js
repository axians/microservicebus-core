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
const util = require('./utils.js');
const EventEmitter = require('events').EventEmitter;
const async = require("async");
const os = require("os");

function DockerComposeHelper() {
    this.compose = null;
    this.isInstalled = () => {
        return new Promise((resolve, reject) => {
            let exec = require('child_process').exec;
            exec("docker ps", (error, stdout, stderr) => {
                if (error || stderr) {
                    resolve(false);
                }
                else {
                    resolve(true);
                }
            });
        });
    };
    this.init = async () => {
        return new Promise(async (resolve, reject) => {
            try {
                this.compose = require('docker-compose');
                resolve();
            }
            catch (e) {
                // Install npm package
                util.addNpmPackage('docker-compose@0.23.14', (err) => {
                    if (err) {
                        this.emit('log', 'Failed installing docker-compose npm package');
                        reject('Failed installing docker-compose npm package');
                    }
                    else {
                        this.compose = require('docker-compose');
                        this.emit('log', 'docker-compose npm package installed successfully');
                        resolve();
                    }
                });

            }
        });
    };
    this.list = () => {
        return new Promise(async (resolve, reject) => {
            try {
                this.isInstalled()
                    .then(async installed => {
                        if (!installed) {
                            this.emit('log', "Docker compose is not installed on this device");
                            resolve([]);
                        }
                        else {
                            await this.init()
                                .catch(e => {
                                    reject(e);
                                    return;
                                });
                                const { exec } = require('child_process');

                                const ls = exec('docker-compose ls --format json', function (error, stdout, stderr) {
                                  if (error) {
                                    reject(`Unable to list compose: ${error.code}`);
                                  }
                                  else{
                                      resolve(JSON.parse(stdout));
                                  }
                                });    
                            
                        }
                    });

            }
            catch (err) {
                reject(err);
            }
        });
    };
    this.build = (cwd, config) => {
        return new Promise(async (resolve, reject) => {
            try {
                this.isInstalled()
                    .then(async installed => {
                        if (!installed) {
                            this.emit('log', "Docker compose is not installed on this device");
                            resolve([]);
                        }
                        else {
                            await this.init()
                                .catch(e => {
                                    reject(e);
                                    return;
                                });
                                const opts = {
                                    cwd: cwd,
                                    log: true,
                                    config: config
                                };
                                await this.compose.buildAll(opts);
                                resolve();
                            
                        }
                    });

            }
            catch (err) {
                reject(err);
            }
        });
    };
    this.up = (cwd, config) => {
        return new Promise(async (resolve, reject) => {
            try {
                this.isInstalled()
                    .then(async installed => {
                        if (!installed) {
                            this.emit('log', "Docker compose is not installed on this device");
                            resolve([]);
                        }
                        else {
                            await this.init()
                                .catch(e => {
                                    reject(e);
                                    return;
                                });
                                const opts = {
                                    cwd: cwd,
                                    log: true,
                                    config: config
                                };
                                await this.compose.upAll(opts);
                                resolve();
                            
                        }
                    });

            }
            catch (err) {
                reject(err);
            }
        });
    };
    this.down = (cwd, config) => {
        return new Promise(async (resolve, reject) => {
            try {
                this.isInstalled()
                    .then(async installed => {
                        if (!installed) {
                            this.emit('log', "Docker compose is not installed on this device");
                            resolve([]);
                        }
                        else {
                            await this.init()
                                .catch(e => {
                                    reject(e);
                                    return;
                                });
                                const opts = {
                                    cwd: cwd,
                                    log: true,
                                    config: config
                                };
                                await this.compose.down(opts);
                                resolve();
                        }
                    });

            }
            catch (err) {
                reject(err);
            }
        });
    };
}

module.exports = DockerComposeHelper;
DockerComposeHelper.prototype.__proto__ = EventEmitter.prototype;