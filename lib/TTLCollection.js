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
var _ = require('underscore');
var moment = require('moment');
var util = require('util');
let path = require('path');

function TTLCollection(options) {
    const MAXCOLLECTIONCOUNT = 10000;
    var self = this;
    this.options = options;
    this._collection = [];
    this.fileName = path.resolve(options.persistDir, options.persistFileName);

    // Interval to check for expired items
    setInterval( () => {
        this._check();
    }, this.options.checkPeriod);

    // Interval (this.options.persistPeriod) for persising this._collection
    setInterval(() => {
        this.persist( (err) => {
            if (err)
                console.log('Unable to persist TTL Collection: ' + err);
        })
    }, this.options.persistPeriod);

    // Restore from last collection
    if (!fs.existsSync(options.persistDir)) {
        fs.mkdirSync(options.persistDir);
    }
    if (!fs.existsSync(this.fileName)) {
        fs.writeFileSync(this.fileName, "[]", 'utf-8');
    }
    fs.readFile(this.fileName, (err, data) => {

        if (err) {
            console.log('Unable to desirialize TTL Collection: ' + err);
        }
        else {
            try {
                let collection = JSON.parse(data);
                if (collection)
                    this._collection = collection.concat(this._collection);
            }
            catch (e) { }
        }
    });
    TTLCollection.prototype.persist = function (callback) {
        fs.writeFile(this.fileName, JSON.stringify(this._collection), 'utf-8', function (err) {
            if (err)
                callback(err);
            else {
                callback();
            }
        });
    };
    // Evaluates each item in this.collection and removes old items
    TTLCollection.prototype._check = function () {
        if (this._collection.length > MAXCOLLECTIONCOUNT) {
            var delCount = this._collection.length - MAXCOLLECTIONCOUNT;

            console.log('History exeeded max length. Removing ' + delCount + ' items');

            this._collection.splice(0, delCount);
        }
        let firstNoneExpiredElement = this._collection.findIndex((element) => {
            return !this._hasExpired(element);
        });
        if (firstNoneExpiredElement >= 0) {
            this._collection.splice(0, firstNoneExpiredElement);
        }
    };
    // Checks if item has expired
    TTLCollection.prototype._hasExpired = function (element) {
        return element.expire < Date.now();
    };
    // Adds item to this._collection
    TTLCollection.prototype.push = function (element, label, group) {
        this._collection.push({
            created: Date.now(),
            label: label,
            group: group,
            expire: Date.now() + this.options.ttl,
            val: element
        });
    };
    // Adds item to this._collection
    TTLCollection.prototype.pushUnique = function (element, label, group) {

        let item = this._collection.find((i) => {
            return i.label === label && group === group;
        });

        if (item) {
            item.created = Date.now();
            item.group = group;
            item.expire = Date.now() + this.options.ttl;
            item.val = element;
        }
        else {
            this._collection.push({
                created: Date.now(),
                label: label,
                group: group,
                expire: Date.now() + this.options.ttl,
                val: element
            });
        }
    };
    TTLCollection.prototype.getLength = function () {
        return this._collection.length;
    };
    // Create an aggregated collection grouped by option.groupByUnit
    TTLCollection.prototype.groupCollection = function (unit, callback) {
        try {
            try {

                let groupedResults = _.groupBy(this._collection, (item) =>
                    moment(item.created).startOf(unit)
                );

                let result = _.map(groupedResults, (arr, dt) => {
                    return { dt: dt, count: arr.length };
                });

                callback(null, result);
            }
            catch (err) {
                callback(err);
            }


        }
        catch (err) {
            callback(err);
        }
    };
    // Returns a date (from, to) filtered aggregated collection
    TTLCollection.prototype.filterCollection = function (from, to, unit, callback) {
        try {
            try {
                let selction = this._collection.filter( (element) => {
                    return element.created >= from && element.created <= to;
                });

                let groupedResults = _.groupBy(selction, (item) =>
                    moment(item.created).startOf(unit)
                );

                let result = _.map(groupedResults, (arr, dt) => {
                    let label = arr.map( (i) => {
                        return i.label ? i.label + ':' : null;
                    }).join('');
                    return { dt: dt, count: arr.length, label: label };
                });

                callback(null, result);
            }
            catch (err) {
                callback(err);
            }


        }
        catch (err) {
            callback(err);
        }
    };
    // Returns a date (from, to) filtered aggregated collection
    TTLCollection.prototype.filterByGroup = function (group) {
        let groupCollection = this._collection.filter((i) => {
            return i.group === group;
        });
        return groupCollection.map((i) => {
            return i.val;
        });
    };
    // Returns a date (from, to) filtered aggregated collection
    TTLCollection.prototype.removeItem = function (item) {
        this._collection = this._collection.filter(m=>{
            return m.val != item;
        });
    };
}

module.exports = TTLCollection;