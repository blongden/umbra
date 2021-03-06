"use strict";
var util = require("util");
var stripAnsi = require("strip-ansi");
var EventEmitter = require("events").EventEmitter;
var blocks = require("./blocks");
var replacables = require("./replaceables");

/////////////////////////////////////////
// Helpful helpers

if (typeof String.prototype.startsWith !== "function") {
  String.prototype.startsWith = function(str) {
    return this.indexOf(str) === 0;
  };
}

if (!Array.prototype.last) {
  Array.prototype.last = function() {
    return this[this.length - 1];
  };
}

/////////////////////////////////////////
// AvParser setup

const channelrefs = {};

function AvParser(shadowclient) {
  this._emitter = new EventEmitter();
  this.init(shadowclient);
  // I don't trust prototype inheritance (due to an unexplained bug where self.emit becomes undefined),
  // so we delegate instead
}

AvParser.prototype.on = function() {
  this._emitter.on.apply(this._emitter, arguments);
};

AvParser.prototype.init = function(shadowclient) {
  const self = this;
  self.shadowclient = shadowclient;

  let blockStack = new blocks.BlockStack();
  let lineBuffer = [];
  let monospaced = false;

  let inMap = false;
  let mapLoc = "";
  let mapLines = [];

  const emit = function() {
    self._emitter.emit.apply(self._emitter, arguments);
  };

  let flushLineBuffer = function() {
    if (lineBuffer.length > 0) {
      // console.log("flushing lines: ");
      // lineBuffer.forEach(function(line) {
      //   console.log(`  »»${line}««`);
      // });
      lineBuffer.forEach(function(line) {
        let entry = { qual: "line", line: line };
        let tags = [];
        if (monospaced) {
          tags.push("monospaced");
        }
        if (lineBuffer.length === 1) {
          tags.push("oneliner");
        }
        if (tags.length > 0) {
          entry.tags = tags;
        }
        blockStack.addEntry(entry);
      });
      monospaced = false;
      lineBuffer = [];
    }
  };

  let appendOutput = function(data) {
    flushLineBuffer();
    blockStack.addEntry(data);
  };

  let appendLine = function(line) {
    if (line.indexOf("   ") >= 0) {
      monospaced = true;
    }
    if (line.trim().length > 0) {
      // console.log(`        appending line: »»${line}««`);
      lineBuffer.push(line);
    }
  };

  let appendReplacableLine = function(line, id) {
    appendOutput({
      qual: "line",
      line: line,
      replacableId: id
    });
  };

  const promptRegex = /^(\d+)\/(\d+)h, (\d+)\/(\d+)m (\S*) (.*)(?:-|=).*$/;

  let flushOutput = function(ansiPrompt) {
    flushLineBuffer();
    let block = blockStack.popAll();
    if (block) {
      try {
        if (ansiPrompt) {
          block.ansiPrompt = ansiPrompt;
          const prompt = stripAnsi(ansiPrompt).trim();
          block.prompt = prompt;
          // console.log("clean prompt: [" + prompt + "]");
          let promptMatch = promptRegex.exec(prompt);
          if (promptMatch) {
            let promptVars = {
              health: promptMatch[1],
              healthMax: promptMatch[2],
              mana: promptMatch[3],
              manaMax: promptMatch[4],
              flags: promptMatch[5],
              visFlags: promptMatch[6]
            };
            // console.log("parsed prompt: " + JSON.stringify(promptVars));
            block.promptVars = promptVars;
          }
        }

        block.emitted = new Date();
        emit("block", block);
      } catch (err) {
        if (typeof emit !== "function") {
          console.log(
            "emit is fubar, currently set to: " + JSON.stringify(emit)
          );
        }
        console.log("error in popped block: " + JSON.stringify(block));
        console.log(err);
        throw err;
      }
    } else {
      console.log("attempted to flush an empty block, on prompt: " + prompt);
    }
  };

  // needs handling:
  //
  // Gigglefluff of Mercinae (scholar; on the hunter course) is requesting ADVICE at "Gardens of the Hunter Gatherer school". Your help may be needed.

  let endMapFor = function(region) {
    let padRegex = /^((?:\u001b\[\d+m)*)(\s*)(.*?)$/;
    let padding = 999;
    mapLines.forEach(function(line) {
      if (line.length > 0) {
        //console.log('map line: →' + line.replace('\u001b', '⌂') + '←');
        let matches = padRegex.exec(line);
        let ansiPart = matches[1] || "";
        let padPart = matches[2];
        let remainder = matches[3];
        let linePad = padPart.length;
        //console.log('split: →' + ansiPart.replace('\u001b', '⌂') + '↔' + padPart.replace('\u001b', '⌂') + '↔' + remainder.replace('\u001b', '⌂') + '←');
        if (remainder.length > 0) {
          padding = Math.min(linePad, padding);
        }
        //console.log('padding = ' + padding);
      }
    });
    let cleanLines = [];
    mapLines.forEach(function(line) {
      let matches = padRegex.exec(line);
      let ansiPart = matches[1] || "";
      let padPart = matches[2];
      let remainder = matches[3];
      let cleanLine = ansiPart + padPart.substring(padding) + remainder;
      cleanLines.push(cleanLine);
    });
    appendOutput({
      qual: "map",
      loc: mapLoc,
      region: region,
      lines: cleanLines
    });
    mapLoc = "";
    mapLines = [];
    inMap = false;
  };

  let fnEndMap = function(match) {
    endMapFor(match[1]);
  };

  let sequences = [
    {
      regex: /^###ack prompt (\S*) (.*)$/,
      func: function(match) {
        emit("protocol", {
          code: "promptvar",
          content: match[0],
          name: match[1],
          value: match[2]
        });
      }
    },
    {
      regex: /^###ack macro@ ###id=(\d+) ###name=(.+) ###def=(.*)$/,
      func: function(match) {
        appendOutput({
          qual: "protocol",
          code: "macro",
          content: match[0],
          macroId: match[1],
          macroName: match[2],
          macroDef: match[3]
        });
      }
    },
    {
      regex: /^###macro (\d+) (.*)$/,
      func: function(match) {
        appendOutput({
          qual: "protocol",
          code: "macro",
          content: match[0],
          macroId: match[1],
          macroDef: match[2]
        });
      }
    },
    {
      regex: /^>>> (.*) @ UMBRA: "(.*)"$/,
      func: function(match, rawLine) {
        appendOutput({
          qual: "umbra",
          chan: "umbra",
          who: match[1],
          comms: true,
          msg: match[2]
        });
      }
    },
    {
      regex: /^Initiating CLIENT \/ AVALON protocol codes\.$/,
      func: function(match) {
        /* do nothing*/
      }
    },
    {
      regex: /^Vicinity MAP around "(.+)" location:$/,
      func: function(match) {
        mapLoc = match[1];
        inMap = true;
      }
    },
    {
      regex: /^Map (?:depicts|shows) (.*)$/,
      cond: function() {
        return inMap;
      },
      func: fnEndMap
    },
    {
      regex: /^.*$/,
      cond: function() {
        return inMap;
      },
      func: function(match, rawLine) {
        mapLines.push(rawLine);
      }
    },
    {
      regex: /^###msg@ (.+)$/,
      func: function(match) {
        var data = { qual: "avmsg" };
        var parts = match[1].split("###");
        var partcount = parts.length;
        for (var i = 1; i < partcount; i++) {
          var part = parts[i];
          var keyarr = part.split("=", 1);
          var key = keyarr[0];
          var value = part.substring(key.length + 1);
          data[key] = value.trim();
        }
        appendOutput(data);
      }
    },
    {
      regex: /^###begin@ (.+)$/,
      func: function(match) {
        //console.log('multiline message start: ' + match[0]);
        let newBlock = new blocks.Block("avmsg");
        let parts = match[1].split("###");
        let partcount = parts.length;
        let cmd = "";
        for (var i = 1; i < partcount; i++) {
          var part = parts[i];
          var keyarr = part.split("=", 1);
          var key = keyarr[0];
          var value = part.substring(key.length + 1);
          if (key === "cmd") {
            cmd = value;
          }
          if (key === "tag") {
            var tags = value.split(" ");
            tags.push("block");
            newBlock.tags = tags;
          } else {
            newBlock[key] = value.trim();
          }
        }
        blockStack.push(newBlock);
        if (cmd.toUpperCase() === "WHO") {
          appendLine("You can see the following people in the land:");
        }
      }
    },
    {
      regex: /^###end@.*$/,
      func: function() {
        flushLineBuffer();
        blockStack.pop();
      }
    },
    {
      //de-duping locations in oracular watch
      regex: /^At "(.*)": (At \1: )(.*)\.$/,
      func: function(match, rawLine) {
        let spammyBit = match[2];
        appendLine(rawLine.replace(spammyBit, ""));
      }
    },
    {
      regex: /^###channel (\S+) (.+)$/,
      func: function(match) {
        let code = match[1];
        let name = match[2];

        if (code === "ccc") {
          emit("protocol", { code: "city", content: name });
        }
        if (code === "ccg") {
          emit("protocol", { code: "guild", content: name });
        }
        if (code === "ccp") {
          emit("protocol", { code: "profession", content: name });
        }
        if (code === "cco") {
          emit("protocol", { code: "order", content: name });
        }

        appendOutput({
          qual: "channel",
          code: code,
          name: name
        });
      }
    },
    {
      regex: /^Your rune-bug picks up words: (.+)$/,
      func: function(match) {
        let suppress = false;
        let txt = match[1];

        blockStack.currentEntries().forEach(function(entry) {
          //matching text
          if (entry.comms && txt.indexOf(entry.msg) >= 0) {
            if (entry.qual === "speech to" || entry.qual === "tell to") {
              //from us!
              suppress = true;
            } else if (entry.who && txt.indexOf(entry.who) >= 0) {
              //matching person
              suppress = true;
            }
          }
          //TODO: if there's an existing entry from "someone" or "a shadowy figure"
          //      but the body matches regardless...
          //      match that as well and rewrite the name
        });

        if (!suppress) {
          appendOutput({
            qual: "rune-bug",
            chan: "rune-bug",
            comms: true,
            msg: txt
          });
        }
      }
    },
    {
      regex: /^>>> (.+) @ NOVICES: "(.*)"$/,
      func: function(match) {
        let who = match[1];
        let msg = match[2];
        let dirn = who === "You call" ? "to" : "from";
        appendOutput({
          qual: "novice-calling " + dirn,
          chan: "novices",
          comms: true,
          who: who,
          msg: msg
        });
      }
    },
    {
      regex: /^>>> (.+) @ (.+): "(.*)"$/,
      func: function(match) {
        let who = match[1];
        let chan = match[2];
        let msg = match[3];
        let dirn = who === "You call" ? "to" : "from";
        appendOutput({
          qual: "calling " + dirn,
          comms: true,
          who: who,
          chan: chan,
          msg: msg
        });
      }
    },
    {
      regex: /^(\S+) calls to (.+?): "(.*)"$/,
      func: function(match) {
        appendOutput({
          qual: "calling from",
          comms: true,
          who: match[1],
          chan: match[2],
          msg: match[3]
        });
      }
    },
    {
      regex: /^You call to (.+?): "(.*)"$/,
      func: function(match) {
        appendOutput({
          qual: "calling to",
          who: "You",
          comms: true,
          chan: match[1],
          msg: match[2]
        });
      }
    },
    {
      regex: /^(.*?) tells you, "(.*)"$/,
      func: function(match) {
        appendOutput({
          qual: "tell from",
          //chan: 'From',
          comms: true,
          who: match[1],
          msg: match[2]
        });
      }
    },
    {
      regex: /^You (tell|answer) (.*?), "(.*)"$/,
      func: function(match) {
        appendOutput({
          qual: "tell to",
          //chan: 'To',
          comms: true,
          who: match[2],
          msg: match[3]
        });
      }
    },
    {
      regex: /^(.+?) (asks|says|exclaims), "(.+)"$/,
      func: function(match) {
        appendOutput({
          qual: "speech from",
          comms: true,
          who: match[1],
          msg: match[3]
        });
      }
    },
    {
      regex: /^You (ask|say|exclaim), "(.+)"$/,
      func: function(match) {
        appendOutput({
          qual: "speech to",
          comms: true,
          msg: match[2]
        });
      }
    },
    {
      regex: /^###user@ (.*)$/,
      func: function(match) {
        var data = { qual: "user" };
        var parts = match[1].split("###");
        var partcount = parts.length;
        for (var i = 1; i < partcount; i++) {
          var part = parts[i];
          var keyarr = part.split(" ", 1);
          var key = keyarr[0];
          var value = part.substring(key.length);
          data[key] = value.trim();
        }
        appendOutput(data);
      }
    },
    {
      regex: /^###(\S+) ?(.*)$/,
      func: function(match) {
        // any protocol without special handling above gets taken out-of-band
        emit("protocol", {
          code: match[1],
          content: match[2]
        });
      }
    }
  ];

  // Your rune-bug picks up words: Billum asks, "Did you find an emerald?"
  // Your rune-bug picks up words: Satsuki answers Craftmaster Billum Submerged Involved, "Thank you."

  var onLine = function(line) {
    let cleanLine = stripAnsi(line);

    let seqLen = sequences.length;
    for (let i = 0; i < seqLen; i++) {
      let entry = sequences[i];
      if (entry.cond === undefined || entry.cond()) {
        let match;
        if (entry.ansiRegex) {
          match = entry.ansiRegex.exec(line);
        } else if (entry.regex) {
          match = entry.regex.exec(cleanLine);
        } else {
          console.error(
            "Parser entry with no regex defined: " + JSON.stringify(entry)
          );
        }
        if (match) {
          entry.func(match, line);
          return;
        }
      }
    }

    let tag = replacables.attempt(cleanLine);
    tag ? appendReplacableLine(line, tag) : appendLine(line);
  };

  let onPrompt = function(prompt) {
    if (inMap) {
      endMapFor("unknown");
    }
    flushOutput(prompt);
  };

  ///////////////////////////////////////////
  // shadowclient event handlers

  self.shadowclient.on("line", onLine);

  self.shadowclient.on("prompt", onPrompt);

  self.shadowclient.on("login result", function(data) {
    emit("login result", data);
  });

  self.shadowclient.on("avalon connected", function() {
    emit("avalon connected");
  });

  self.shadowclient.on("avalon disconnected", function(had_error) {
    emit("avalon disconnected", had_error);
  });
};

AvParser.prototype.write = function(input) {
  this.shadowclient.write(input);
};

AvParser.prototype.close = function() {
  this.shadowclient.close();
};

module.exports = AvParser;
