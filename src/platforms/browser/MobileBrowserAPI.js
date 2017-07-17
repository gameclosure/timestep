let exports = {};

/**
 * @license
 * This file is part of the Game Closure SDK.
 *
 * The Game Closure SDK is free software: you can redistribute it and/or modify
 * it under the terms of the Mozilla Public License v. 2.0 as published by Mozilla.

 * The Game Closure SDK is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * Mozilla Public License v. 2.0 for more details.

 * You should have received a copy of the Mozilla Public License v. 2.0
 * along with the Game Closure SDK.  If not, see <http://mozilla.org/MPL/2.0/>.
 */
import {
  merge,
  bind,
  logger
} from 'base';

import PubSub from 'lib/PubSub';
import device from 'device';
import underscore from 'util/underscore';
let _ = underscore._;

var defaults = {
  oneChannelOnly: device.isMobileBrowser,
  compiledFilename: 'compiled'
};

/**
 * @extends lib.PubSub
 */
exports = class extends PubSub {
  constructor (opts) {
    opts = merge(opts, defaults);
    super(opts);
    this._opts = opts;
    this._map = opts.map;
    this._audios = {};
    this.oneChannelOnly = opts.oneChannelOnly;

    setInterval(bind(this, '_ontimeupdate'), 200);

    if (!this.oneChannelOnly) {
      _.each(opts.background, function (name) {
        opts.map[name] = { 'name': name };
      }, this);
    }

    // Install the event listener right away. Set usecapture=true so that
    // nothing else will affect us from intercepting this event.
    this._load();
    if (this.oneChannelOnly) {
      this._boundLoadHandler = bind(this, '_playFirst');
      document.body.addEventListener('mouseDown', this._boundLoadHandler, true);
      document.body.addEventListener('touchStart', this._boundLoadHandler, true);
    }
    window.addEventListener('pagehide', bind(this, 'pause'), false);
  }
  _createChannel (name, src) {
    var audio = new Audio(src);
    this._audios[name] = audio;

    audio.addEventListener('error', bind(this, '_onerror'));
    audio.addEventListener('timeupdate', bind(this, '_ontimeupdate'));

    audio.load();
  }
  setMuted (muted) {
    this.muted = muted;
    if (muted) {
      this.setVolume(0);
    }
  }
  setVolume (volume) {
    _.each(this._audios, function (audio, key) {
      audio.volume = volume;
    });
  }
  unload () {
    this.pause();
    _.each(this._audios, function (audio, key) {
      audio.src = '';
    }, this);
  }
  _load () {
    this._audios = {};
    var path = this._opts.path.replace(/\/$/, '');
    if (this.oneChannelOnly) {
      this._createChannel('AUDIO', path + '/' + this._opts.compiledFilename +
        '.m4a');
    } else {
      for (var key in this._map)
        { if (this._map.hasOwnProperty(key)) {
          if (key == 'SILENCE') {
            continue;
          }
          this._createChannel(key, path + '/' + key + '.mp3');
        } }
    }

    logger.info('now loading', this._opts.src);

    if (!this._publishedReady) {
      this.publish('Ready');
      // this is as close as we'll get with multiple sounds
      this._publishedReady = true;
    }
  }
  _playFirst () {
    document.body.removeEventListener('mouseDown', this._boundLoadHandler, true);
    document.body.removeEventListener('touchStart', this._boundLoadHandler, true);

    this._audios['AUDIO'].play();
  }
  _ontimeupdate (evt) {
    _.each(this._audios, function (audio, key) {
      if (audio.paused && !audio._pausedOnce) {
        audio.pause();
        audio._pausedOnce = true;
        audio._ready = true;
      }

      if (this.oneChannelOnly) {
        if (!this._nowPlaying || audio.currentTime >= this._nowPlaying.end) {
          this.play('SILENCE');
        }
      }
    }, this);
  }
  _onerror (event) {
    var s = '';
    for (var key in event) {
      s += event[key] + ' ';
    }
    logger.info('ERROR', s);
  }
  canPlay (name) {
    if (!this._map[name]) {
      return false;
    }

    var requiredEnd = null;
    if (this.oneChannelOnly) {
      requiredEnd = this._map[name].end;
      name = 'AUDIO';
    }
    var audio = this._audios[name];
    if (!audio) {
      return false;
    }

    // if (!audio._ready) {
    //  return; // try downloading the whole file...
    // }
    if (audio._ready || !requiredEnd) {
      return true;
    } else {
      try {
        var end = audio.seekable.end();
        return requiredEnd <= end;
      } catch (e) {
        logger.log(e);
        return false;
      }
    }
  }
  play (name, volume, loop) {
    if (this.muted) {
      return;
    }

    if (volume === undefined) {
      volume = 1;
    }
    if (!this.canPlay(name)) {
      logger.info('Not ready yet');
      return;
    }

    var audio = this._audios[this.oneChannelOnly ? 'AUDIO' : name];
    try {
      if (!audio.paused) {
        audio.pause();
      }
      // it glitches if you move currentTime while playing?
      var startTime = 0;
      if (this.oneChannelOnly && this._map[name].start != null) {
        startTime = this._map[name].start;
      }
      if (audio.currentTime != startTime) {
        // logger.log('SEEK to play',name, startTime, 'from',audio.currentTime); //
        audio.currentTime = startTime;
      }
      audio.volume = volume;
      audio.play();
      this._nowPlaying = this._map[name];
    } catch (e) {}
  }
  pause () {
    _.each(this._audios, function (audio, key) {
      audio.pause();
    }, this);
  }
  playBackgroundMusic (name, volume) {
    if (this.muted) {
      return;
    }

    if (this.oneChannelOnly) {
      return false;
    }

    // cannot play bg music here.
    this._backgroundSoundPlaying = name;
    this.play(name, volume);
  }
  pauseBackgroundMusic () {
    if (!this._backgroundSoundPlaying) {
      return;
    }
    this._audios[this._backgroundSoundPlaying].pause();
  }
};

export default exports;
