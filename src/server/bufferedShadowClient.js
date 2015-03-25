'use strict';
let util = require('util');
let EventEmitter = require('events').EventEmitter;
let ParsedShadowClient = require('./parsedShadowclient');
var CBuffer = require('cbuffer');

function BufferedShadowClient(params) {
  EventEmitter.call(this);
  this.init(params);
}

util.inherits(BufferedShadowClient, EventEmitter);

BufferedShadowClient.prototype.init = function(params) {
  let self = this;
  let sc = new ParsedShadowClient(params);

  self.params = params;
  self.sc = sc;
  self.id = sc.id;
  self.inputBuffer = new CBuffer(100);

  sc.on('login result', data => self.emit('login result', data));

  sc.on('avalon disconnected', had_error => self.emit('avalon disconnected', had_error));

  sc.on('block', function (data) {
    self.inputBuffer.push(data);
    self.emit('block', data);
  });

  sc.on('prompt', function (data) {
    self.inputBuffer.push(data);
    self.emit('prompt', data);
  });
};


BufferedShadowClient.prototype.write = function(input) { this.sc.write(input); };

BufferedShadowClient.prototype.close = function() { this.sc.close(); };

BufferedShadowClient.prototype.pause = function() { this.sc.pause(); };

BufferedShadowClient.prototype.replay = function(outputFn) {
  this.inputBuffer.forEach(outputFn);
};

BufferedShadowClient.prototype.replayFrom = function(dt, outputFn) {
  this.inputBuffer.forEach(function(block) {
    if(block.timestamp > dt) { outputFn(block); }
  });
};

module.exports = BufferedShadowClient;
