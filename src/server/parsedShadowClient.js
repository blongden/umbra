'use strict';
let util = require('util');
let EventEmitter = require('events').EventEmitter;

let ShadowClient = require('./shadowclient');
let AvParser = require('./avparser');
let Tabulator = require('./tabulator');

let tabulator = new Tabulator();


function ParsedShadowClient(params) {
  EventEmitter.call(this);
  this.init(params);
}

util.inherits(ParsedShadowClient, EventEmitter);

ParsedShadowClient.prototype.init = function(params) {
  let self = this;
  let sc = new ShadowClient(params);
  let parser = new AvParser(sc);

  self.params = params;
  self.sc = sc;
  self.parser = parser;

  if(params.game && params.game !== 'avalon') {
    self.id = params.username + '@' + params.game;
  } else {
    self.id = params.username;
  }

  sc.on('login result', function(data) {
    self.emit('login result', data);
    if(data.success) {
      sc.write('protocol on\r\n');
      sc.write('macrolist\r\n');
    } else {
      sc.close();
    }
  });

  sc.on('avalon disconnected', function (had_error) {
    self.emit('avalon disconnected', had_error);
    sc.close();
  });


  parser.on('block', function (data) {
    let processedBlock = tabulator.tabulate(data);
    if(sc.loggedIn) { self.emit('block', processedBlock); }
  });
};


ParsedShadowClient.prototype.write = function(input) { this.sc.write(input); };

ParsedShadowClient.prototype.close = function() { this.sc.close(); };

ParsedShadowClient.prototype.pause = function() { this.sc.pause(); };

module.exports = ParsedShadowClient;