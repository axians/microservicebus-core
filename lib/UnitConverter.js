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

function UnitConverter() {

    /**
    * Check for overflow and converts a int16 value to signed int16 value
    * @param {Number} value number to be checked for overflow
    * @return {Number} Value as a number
    */
    this.convertToInt16 = function (value) {
        if (value > 32767) {
            value = -1 * (65536 - value);
        }
        return value;
    };
    /**
    * Converts two int16 values to a signed int32 value and checks for overflow
    * @param {Number} leastSignificantWord Least significant byte. Usually from index 0
    * @param {Number} mostSignificantWord Most Significant byte. Usually from index 1
    * @return {Number} Value as a number
    */
    this.convertToInt32 = function (leastSignificantWord, mostSignificantWord) {
        let value = ((mostSignificantWord << 16) | leastSignificantWord); // 32 bit are signed values
        // Check if negative
        if (value > 2147483647) {
            value = -1 * (4294967296 - value);
        }
        return value;
    };
    /**
    * Converts two int16 values to a unsigned int32 value
    * @param {Number} leastSignificantWord Least significant byte. Usually from index 0
    * @param {Number} mostSignificantWord Most Significant byte. Usually from index 1
    * @return {Number} Value as a number
    */
    this.convertToUInt32 = function (leastSignificantWord, mostSignificantWord) {
        const value = ((mostSignificantWord << 16) | leastSignificantWord);
        return value;
    };
    /**
    * Converts four int16 values to a signed int64 value and checks for overflow
    * @param {Number} mostSignificantWord0 Two Least Significant bytes. Usually from index 2
    * @param {Number} leastSignificantWord0 Two Least Significant bytes. Usually from index 3
    * @param {Number} mostSignificantWord1 Two Most Significant bytes. Usually from index 0
    * @param {Number} leastSignificantWord1 Two Most Significant bytes. Usually from index 1
    * @return {Number} Value as a number
    */
    this.convertToInt64 = function (mostSignificantWord0, leastSignificantWord0, mostSignificantWord1, leastSignificantWord1) {
        const lowerValue = exports.convertToUInt32(leastSignificantWord1, mostSignificantWord1); // The highest register
        const higherValue = exports.convertToUInt32(leastSignificantWord0, mostSignificantWord0); // The loweest register
        let value = ((lowerValue) + (higherValue * 4294967296));
        // Check if negative
        if (value > 9223372036854775807) {
            value = -1 * (18446744073709551616 - value);
        }
        return value;
    };
    /**
     * Converts array that should contain 16bits words into easy readable binary string
     * @param {Array}  dataArray array with words from Modbus Register
     * @return {String} binary reprezentation of number
     */
    this.convertToBinString = function (dataArray) {
        let stringWord;
        let i = 0;
        let convertVal = '';
        for (i = 0; i < dataArray.length; i++) {
            stringWord = dataArray[i].toString(2);
            while (stringWord.length < 16) {
                stringWord = '0' + stringWord;
            }
            convertVal = convertVal + ' ' + stringWord;
        }
        return convertVal;
    };
    /**
    * Converts a Float Buffer to a number
    * @param {Buffer} buffer Buffer containing data to be converted
    * @param {Number} bytesToSkip Skips number of bytes specified before converting
    * @return {Number} Value as a number
    */
    this.convertToFloat = function (buffer, bytesToSkip) {
        let value = buffer.readFloatBE(bytesToSkip);
        value = Number(Number.parseFloat(value).toFixed(7)); // Remove unnecessary decimals and convert back to a number
        return value;
    };
    this.convert = require('convert-units');
}
module.exports = UnitConverter;