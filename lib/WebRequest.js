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

'use strict';

const https = require('https');
class WebRequest{
    constructor() {}
    request(options, callback) {
        // Set this.options for the first call
        if (!this.options) {
            if (typeof (options) === "string") {
                options = {
                    url: options
                };
            }
            if (options.url) {
                const url = new URL(options.url);
                options.hostname = url.hostname;
                options.path = url.pathname + url.search;
                if (url.port !== '') {
                    options.port = Number(url.port);
                }
            }
            options.method = options.method ? options.method : "GET"
            options.maxAttempts ? options.maxAttempts : 1;
            options.retryDelay ? options.retryDelay : 3000;
            options.attempts = 0
            options.callback = callback;
            this.options = options;
        }
        this._req = this._request(this.options, async function (err, response, body) {
            if (response) {
                response.attempts = this.options.attempts;
            }

            if (err) {
                err.attempts = this.options.attempts;
            }

            var mustRetry = err != null;

            if (mustRetry && this.options.maxAttempts > this.options.attempts) {
                this._timeout = setTimeout(this.request.bind(this), this.options.retryDelay);
                return;
            }

            this.options.callback(err, response, body);
        }.bind(this));
    }
    _request(options, callback) {
        const opt = this ? this.options : options;

        opt.attempts++;

        switch (options.method) {
            case "PUT":
            case "POST":
                return this._post(options, options.json)
                    .then(ret => { callback(null, this.response, ret); })
                    .catch(err => { callback(err, this.response, null); });
            default:
                return this._get(options)
                    .then(ret => { callback(null, this.response, ret); })
                    .catch(err => { callback(err, this.response, null); });
        }
    }
    _post(options) {
        return new Promise((resolve, reject) => {
            if(options.json && typeof(options.json)==="object"){
                options.json = JSON.stringify(options.json);
            }
            if (!options.method) options.method = "POST";
            if (!options.headers) options.headers = {};
            if (!options.headers["Content-Type"]) options.headers["Content-Type"] = "application/json";
            if (!options.headers["Accept"]) options.headers["Accept"] = "application/json";
            if (!options.headers["Content-Length"] && options.json) options.headers["Content-Length"] = Buffer.byteLength(options.json);

            if (options.attempts > 1)
                console.log(`attemt #${options.attempts} to get ${options.url}`);

            var request = https.request(options, (response) => {
                this.response = response;
                
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    return reject(response);
                }
                const body = []
                response.on('data', (chunk) => body.push(chunk))
                response.on('end', () => {
                    const resString = Buffer.concat(body).toString()
                    resolve(resString)
                })
            });

            request.on('error', (e) => {
                reject(e);
            });

            request.write(options.json);
            request.end();

        });
    };
    _get(options) {
        if (!options.method) options.method = "GET";

        return new Promise((resolve, reject) => {
            if (options.attempts > 1)
                console.log(`attemt #${options.attempts} to get ${options.url}`);
            const request = https.request(options, (response) => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    return reject(response);
                }
                this.response = response;
                let data = '';
                response.on('data', (chunk) => {
                    data = data + chunk.toString();
                });

                response.on('end', function() {
                    resolve(data);
                });
            });

            request.on('error', (error) => {
                reject(error);
            });

            request.end()
        });
    };
}
function Factory(options, callback) {
    const webRequest = new WebRequest();
    webRequest.request(options, callback);
    return webRequest;
}
module.exports = Factory;

