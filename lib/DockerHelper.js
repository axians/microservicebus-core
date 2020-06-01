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

function DockerHelper() {
    var docker;
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
                let { Docker } = require('node-docker-api');
                docker = new Docker({ socketPath: '/var/run/docker.sock' });
                resolve();
            }
            catch (e) {
                // Install npm package
                util.addNpmPackage('node-docker-api@1.1.22',  (err) => {
                    if (err) {
                        this.emit('log', 'Failed installing node-docker-api');
                        reject('Unable to install node-docker-api');
                    }
                    else {
                        this.emit('log', 'node-docker-api installed successfully');
                        resolve();
                    }
                });
                
            }
        });
    };
    this.listContainers = (all) => {
        return new Promise(async (resolve, reject) => {
            try {
                if (!this.isInstalled()) {
                    this.emit('log', "Docker is not installed on this device");
                    resolve([]);
                    return;
                }
                else {
                    await this.init()
                        .catch(e => {
                            reject(e);
                        });
                    let options = {
                        all: all
                    }
                    docker.container.list(options)
                        .then(containers => {
                            let arr = containers.map((c) => {
                                return {
                                    image: c.data.Image,
                                    name: c.data.Names[0],
                                    state: c.data.State,
                                    status: c.data.Status
                                };
                            });
                            resolve(arr);
                        })
                        .catch(error => reject(error));
                }
            }
            catch (err) {
                reject(err);
            }

        });
    };
    this.findContainer = (containerName) => {
        return new Promise(async (resolve, reject) => {
            try {
                if (!this.isInstalled()) {
                    this.emit('log', "Docker is not installed on this device");
                    resolve([]);
                    return;
                }
                else {
                    await this.init()
                        .catch(e => {
                            reject(e);
                        });
                    let options = {
                        all: true
                    }
                    docker.container.list(options)
                        .then(containers => {
                            let container = containers.find(c => c.data.Names[0] === containerName);
                            resolve(container);
                        })
                        .catch(error => reject(error));
                }
            }
            catch (err) {
                reject(err);
            }

        });
    };
    this.createContainer = (c) => {
        return new Promise(async (resolve, reject) => {
            try {
                if (!this.isInstalled()) {
                    this.emit('log', "Docker is not installed on this device");
                    resolve([]);
                    return;
                }
                else {
                    await this.init()
                        .catch(e => {
                            reject(e);
                        });
                    docker.container.create(c)
                        .then(container => {
                            this.emit('log', `${c.name} was installed successfully`);
                            resolve();
                        })
                        .catch(error => {
                            reject(error);
                        });
                }
            }
            catch (err) {
                reject(err);
            }

        });
    };
    this.deleteContainer = (containerName) => {
        return new Promise(async (resolve, reject) => {
            try {
                if (!this.isInstalled()) {
                    this.emit('log', "Docker is not installed on this device");
                    resolve([]);
                    return;
                }
                else {
                    await this.init()
                        .catch(e => {
                            console.log("ups");
                            reject(e);
                        });
                    let options = {
                        all: true
                    }
                    docker.container.list(options)
                        .then(containers => {
                            let container = containers.find(c => c.data.Names[0] === containerName);

                            if (!container) {
                                reject("Container not found");
                                return;
                            }

                            container.delete({ force: true })
                                .then(() => {
                                    this.emit('log', `${containerName} deleted successfully`);
                                    resolve();
                                })
                                .catch(e => reject())

                            resolve();
                        })
                        .catch(error => reject(error));
                }
            }
            catch (err) {
                reject(err);
            }
        });
    };
    this.startContainer = (containerName) => {
        
        return new Promise(async (resolve, reject) => {
            try {
                if (!this.isInstalled()) {
                    this.emit('log', "Docker is not installed on this device");
                    resolve([]);
                    return;
                }
                else {
                    await this.init()
                        .catch(e => {
                            reject(e);
                        });
                    docker.container.list({
                        all: true
                    })
                        .then(containers => {
                            let container = containers.find(c => c.data.Names[0] === containerName);

                            if (!container) {
                                reject("Container not found");
                                return;
                            }

                            container.start()
                                .then(() => {
                                    this.emit('log', `${containerName} started successfully`);
                                    resolve();
                                });

                        })
                        .catch(error => reject(error));
                }
            }
            catch (err) {
                reject(err);
            }

        });
    };
    this.stopContainer = (containerName) => {
        return new Promise(async (resolve, reject) => {
            try {
                if (!this.isInstalled()) {
                    this.emit('log', "Docker is not installed on this device");
                    resolve([]);
                    return;
                }
                else {
                    await this.init()
                        .catch(e => {
                            console.log("ups");
                            reject(e);
                        });
                    docker.container.list()
                        .then(containers => {
                            let container = containers.find(c => c.data.Names[0] == containerName);
                            container.stop();
                            this.emit('log', `${containerName} stopped successfully`);
                            resolve();
                        })
                        .catch(error => reject(error));
                }
            }
            catch (err) {
                reject(err);
            }
        });
    };
    this.listImages = () => {
        return new Promise(async (resolve, reject) => {
            try {
                if (!this.isInstalled()) {
                    this.emit('log', "Docker is not installed on this device");
                    resolve([]);
                    return;
                }
                else {
                    await this.init()
                        .catch(e => {
                            reject(e);
                        });
                    let options = {
                        all: true
                    }
                    docker.image.list(options)
                        // Inspect
                        .then(images => {
                            var arr = images.map(i => {
                                if (!i.data.RepoDigests || i.data.RepoDigests.length === 0) return null;
                                return {
                                    id: i.id,
                                    repo: i.data.RepoDigests[0].substring(0, i.data.RepoDigests[0].lastIndexOf("@")),
                                    tags: i.data.RepoTags,
                                    size: i.data.Size
                                };
                            });
                            resolve(arr);
                        })

                        .catch(error => reject(error));
                }
            }
            catch (err) {
                reject(err);
            }

        });
    };
    this.deleteImage = (imageName) => {
        return new Promise(async (resolve, reject) => {
            try {
                if (!this.isInstalled()) {
                    this.emit('log', "Docker is not installed on this device");
                    resolve([]);
                    return;
                }
                else {
                    await this.init()
                        .catch(e => {
                            reject(e);
                        });
                    let options = {
                        all: true
                    }
                    docker.image.list(options)
                        // Inspect
                        .then(images => {
                            let image = images.find((i) => {
                                if (!i.data.RepoDigests || i.data.RepoDigests.length === 0) return null;
                                let name = i.data.RepoDigests[0].substring(0, i.data.RepoDigests[0].lastIndexOf("@"));
                                return name === imageName
                            });
                            if (!image) {
                                this.emit('log', "Image not found");
                                reject("Not found");
                            }
                            else {
                                image.remove({ force: true })
                                    .then(() => {
                                        this.emit('log', `${imageName} deleted successfully`);
                                        resolve();
                                    })
                                    .catch(e => reject())
                            }
                        })
                        .catch(error => reject(error));
                }
            }
            catch (err) {
                reject(err);
            }

        });
    };
    this.createImage = (createRequest) => {
        return new Promise(async (resolve, reject) => {
            try {
                if (!this.isInstalled()) {
                    this.emit('log', "Docker is not installed on this device");
                    resolve([]);
                    return;
                }
                else {
                    await this.init()
                        .catch(e => {
                            reject(e);
                        });

                    docker.image.create({}, createRequest)
                        .then(image => {
                            this.emit('log', `Image was installed successfully`);
                            resolve(image);
                        })
                        .catch(error => {
                            reject(error);
                        });
                }
            }
            catch (err) {
                reject(err);
            }

        });
    };
    this.wait = async (ms) =>{
        return new Promise(resolve => {
            setTimeout(resolve, ms);
        });
    }
}

module.exports = DockerHelper;
DockerHelper.prototype.__proto__ = EventEmitter.prototype;