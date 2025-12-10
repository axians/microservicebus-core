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
    this.isInstalled = () => {
        return new Promise(async (resolve, reject) => {
            try {
                this.emit('log', "Checking if docker is installed...");
                await util.executeAsync("docker ps");
            } catch (error) {
                reject("Docker is not installed on this gateway");
                return;
            }

            try {
                this.emit('log', "Checking if docker compose is installed...");
                const dockerComposeCmd = await this.whichDockerCompose();
                await util.executeAsync(`${dockerComposeCmd} ls --format json`);
                resolve(true);
            } catch (error) {
                if (process.platform === "win32") {
                    reject("docker compose is not installed on this gateway, and can not be automaticly installed. <a href='https://github.com/docker/compose/releases/'>For more information</a>.");
                    return;
                }
                else {
                    try {
                        const architecture = await util.executeAsync("uname -m");
                        this.emit('log', `Installing docker-compose for ${architecture}...`);
                        const cmd = `curl -SL https://github.com/docker/compose/releases/download/v2.2.2/${architecture === "x86_64" ? "docker-compose-linux-x86_64" : "docker-compose-linux-armv7"} -o /usr/bin/docker-compose;chmod +x /usr/bin/docker-compose`;
                        await util.executeAsync(cmd);
                        resolve();
                        return;
                    }
                    catch (error) {
                        reject("docker-compose is not installed on this gatway, and can not be automaticly installed. <a href='https://github.com/docker/compose/releases/'>For more information</a>.");
                    }
                }
            }
        });
    };
    this.list = () => {
        return new Promise(async (resolve, reject) => {
            try {
                const dockerComposeCmd = await this.whichDockerCompose();
                const ls = await util.executeAsync(`${dockerComposeCmd} ls --format json`);
                resolve(JSON.parse(ls));
            }
            catch (err) {
                reject(err);
            }
        });
    };
    this.build = (cwd) => {
        return new Promise(async (resolve, reject) => {
            try {
                const dockerComposeCmd = await this.whichDockerCompose();
                await util.executeAsync(`cd ${cwd}; ${dockerComposeCmd} build --no-cache`);
                resolve();
            }
            catch (err) {
                reject(`Unable to build: ${err}`);
            }
        });
    };
    this.up = (cwd) => {
        return new Promise(async (resolve, reject) => {
            try {
                const dockerComposeCmd = await this.whichDockerCompose();
                await util.executeAsync(`cd ${cwd}; ${dockerComposeCmd} up -d`);
                resolve();
            }
            catch (err) {
                reject(`Unable to bring up compose: ${err}`);
            }
        });
    };
    this.down = (cwd) => {
        return new Promise(async (resolve, reject) => {
            try {
                const dockerComposeCmd = await this.whichDockerCompose();
                await util.executeAsync(`cd ${cwd}; ${dockerComposeCmd} down`);
                resolve();
            }
            catch (err) {
                reject(`Unable to bring down compose: ${err}`);
            }
        });
    };
    this.whichDockerCompose = () => {
        return new Promise(async (resolve, reject) => {
            try {
                const response = await util.executeAsync(`docker-compose`); // Testing old docker-compose
                if (response.indexOf("error") >= 0) { // Old docker-compose not found
                    return resolve("docker compose");
                }
                return resolve("docker-compose");
            }
            catch (err) {
                return resolve("docker compose"); // Default to new docker compose
            }
        });
}

module.exports = DockerComposeHelper;
DockerComposeHelper.prototype.__proto__ = EventEmitter.prototype;