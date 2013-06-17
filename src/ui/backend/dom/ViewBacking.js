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

import device;
import event.Callback as Callback;
import animate;
import animate.transitions as transitions;
import event.input.InputEvent as InputEvent;
import math.geom.Point as Point;
from util.browser import $;

import ..BaseBacking;

var Canvas = device.get('Canvas');

var AVOID_CSS_ANIM = device.isAndroid;

var TRANSFORM_PREFIX = 'transform';
function CHECK_TRANSLATE3D() {
    var el = document.createElement('p'),
        has3d,
        transforms = {
            'webkitTransform':'-webkit-transform',
            'OTransform':'-o-transform',
            'msTransform':'-ms-transform',
            'MozTransform':'-moz-transform',
            'transform':'transform'
        };

    // Add it to the body to get the computed style.
    document.body.insertBefore(el, null);

    for (var t in transforms) {
        if (el.style[t] !== undefined) {
            el.style[t] = "translate3d(1px,1px,1px)";
            has3d = window.getComputedStyle(el).getPropertyValue(transforms[t]);
            TRANSFORM_PREFIX = t;
        }
    }

    document.body.removeChild(el);

    return (has3d !== undefined && has3d.length > 0 && has3d !== "none");
}

var SUPPORTS_TRANSLATE3D = CHECK_TRANSLATE3D();


var ViewBacking = exports = Class(BaseBacking, function () {

	var arr = ['x', 'y', 'r', 'width', 'height', 'visible', 'anchorX', 'anchorY',
			   'opacity', 'scale', 'zIndex', 'scrollLeft', 'scrollTop', 'flipX', 'flipY'];

	var CUSTOM_KEYS = {};

	arr.forEach(function (prop) {
		CUSTOM_KEYS[prop] = true;

		this.__defineGetter__(prop, function () {
			if (prop in this._computed) {
				return this._computed[prop];
			} else {
				return parseInt(this._node.style[prop]);
			}
		});
		this.__defineSetter__(prop, function (val) {
			var props = {};
			props[prop] = val;
			this._setProps(props);
			return val;
		});
	}, this);

	this.init = function (view, opts) {
		this._view = view;
		this._subviews = [];

		var n = this._node = document.createElement(opts.elementType || 'div');

		// used to identify dom nodes
		n._view = view;
		n.addEventListener("webkitTransitionEnd", bind(this, "_transitionEnd"), false);
		n.className = "view" + " " + opts.className;

		var s = n.style;
		s.fontSize = '1px';
		s.position = "absolute";
		
		this.position(0, 0);
		
		if (!device.isAndroid) {
			s.webkitBackfaceVisibility = 'hidden';
		}

		s.webkitTransformOrigin = '0px 0px';

		// add any custom CSS style
		for (var name in opts.styles) {
			s[name] = opts.styles[name];
		}

		// store for the computed styles
		this._computed = {
			x: 0,
			y: 0,
			r: 0,
			width: undefined,
			height: undefined,
			anchorX: 0,
			anchorY: 0,
			opacity: 1,
			visible: true,
			zIndex: 0,
			scale: 1
		};

		// animation
		this._animating = false;
		this._animationQueue = [];
		this._animationCallback = null;
	}

	this.getElement = function () { return this._node; }

	var ADD_COUNTER = 900000;
	this.addSubview = function (view) {
		var backing = view.__view;
		var node = backing._node;
		var superview = node.parentNode && node.parentNode._view;
		if (superview == this._view) {
			return false;
		} else {
			if (superview) { superview.__view.removeSubview(view); }
			var n = this._subviews.length;
			this._subviews[n] = view;
			this._node.appendChild(node);

			backing._setAddedAt(++ADD_COUNTER);
			if (n && backing.__sortKey < this._subviews[n - 1].__view.__sortKey) {
				this._needsSort = true;
			}

			return true;
		}
	}

	this.removeSubview = function (targetView) {
		var index = this._subviews.indexOf(targetView);
		if (index != -1) {
			this._subviews.splice(index, 1);
			this._node.removeChild(targetView.__view._node);
			return true;
		}

		return false;
	}

	this.getSuperview = function () {
		var p = this._node.parentNode;
		if (p == document.body || !p) {
			return null;
		}

		return p._view;
	}

	this.getSubviews = function () {
		if (this._needsSort) { this._needsSort = false; this._subviews.sort(); }
		return this._subviews;
	}

	this.wrapTick = function (dt, app) {
		this._view.tick && this._view.tick(dt, app);

		for (var i = 0, view; view = this._subviews[i]; ++i) {
			view.__view.wrapTick(dt, app);
		}
	}

	this.wrapRender = function (ctx, opts) {
		if (!this.visible) { return; }

		if (!this.__firstRender) { this._view.needsReflow(true); }
		if (this._needsSort) { this._needsSort = false; this._subviews.sort(); }


		var width = this._computed.width;
		var height = this._computed.height;
		if (!width || !height || width < 0 || height < 0) { return; }

		// var filters = this._view.getFilters();
		// ctx.setFilters(filters);

		try {
			var render = this._view.render;
			if (render && !render.isFake) {
				if (!this._canvas) {
					var canvas = new Canvas();
					this._canvas = canvas;
					this._node.insertBefore(this._canvas, this._node.firstChild);
					this.ctx = this._canvas.getContext('2d');
				}

				var needsRepaint = this._view._needsRepaint;

				// clear the canvas
				if ((width | 0) != this._canvas.width || (height | 0) != this._canvas.height) {
					needsRepaint = true;
					this._canvas.width = width;
					this._canvas.height = height;
				}

				if (needsRepaint) {
					this._view._needsRepaint = false;
					this._canvas.style.display = 'none';
					this.ctx.clear();
					// this.ctx.fillStyle = 'red';
					// this.ctx.fillRect(0, 0, 1000, 1000);
					this.ctx.save();
					render.call(this._view, this.ctx, opts);
					this.ctx.restore();
					this._canvas.style.display = 'block';
				}
			}

			this._renderSubviews(ctx, opts);
		} catch(e) {
		 	logger.error(this, e.message, e.stack);
		}
	}

	this._renderSubviews = function (ctx, opts) {
		var i = 0;
		var view;
		var subviews = this._subviews;
		while (view = subviews[i++]) {
			view.__view.wrapRender(ctx, opts);
		}
	}

	this.localizePoint = function (pt) {
		var s = this._computed;
		pt.x -= s.x + s.anchorX;
		pt.y -= s.y + s.anchorY;
		if (s.r) { pt.rotate(-s.r); }
		pt.scale(1 / s.scale);
		pt.x += s.anchorX;
		pt.y += s.anchorY;
		return pt;
	}

	// exports the current style object
	this.copy = function () {
		return merge({}, this._computed);
	}

	this.update = function (style) { this._setProps(style); }
	
	this.position = function (x, y) {
		var s = this._node.style;

		if (SUPPORTS_TRANSLATE3D) {
			var translate = 'translate3d(' + (x) + 'px,' + (y) + 'px,0)';

			// Check for differences and other properties like scale, rotate, translate, etc
			if (s[TRANSFORM_PREFIX] != '' && s[TRANSFORM_PREFIX] != translate) {
				s[TRANSFORM_PREFIX] += translate;
			}
			else {
				s[TRANSFORM_PREFIX] = translate;
			}

		}
		else {
			s.left = x + 'px';
			s.top = y + 'px';
		}
	};

	//****************************************************************
	// ANIMATION

	function getEasing(fn) {
		if (typeof fn == 'string') { return fn; }
		if (fn == transitions.easeIn) { return 'ease-in'; }
		if (fn == transitions.easeOut) { return 'ease-out'; }
		if (fn == transitions.easeInOut) { return 'ease-in-out'; }
		if (fn == transitions.linear) { return 'linear'; }
		return 'ease';
	};

	this._updateOrigin = function () {
		this._node.style.webkitTransformOrigin = (this._computed.anchorX || 0) + 'px ' + (this._computed.anchorY || 0) + 'px';
	}

	// {
	// 	'x': {value: 0, cb: '_onPosition'},
	// 	'y': {value: 0, cb: '_onPosition'},
	// }

	this._onPosition = function (key, value) {
		value = Math.floor(value);
		this._setMatrix();
	}

	this._onResize = function () {
		// order matters
		this._setMatrix();
		this._setCenter();
		this._view.needsReflow();
	}

	this._setProps = function (props, anim) {
		var setMatrix = false;
		var s = this._node.style;
		var animCount = 0;
		var resized = false;
		var previous = {};
		for (var key in props) {
			var value = props[key];
			if (key == "dx" || key == "dy") {
				key = key.substr(1);
				value = this._computed[key] + value;
			}
			switch (key) {
				case "anchorX":
				case "anchorY":
					this._computed[key] = value;
					this._updateOrigin();
					break;
				case "clip":
					this._computed.clip = value;
					s.overflow = value ? 'hidden' : 'visible';
					break;
				case "zIndex":
					if (this._computed.zIndex != value) {
						this._computed.zIndex = value;
						s.zIndex = value;
						this._onZIndex(value);
					}
					break;
				case "x":
				case "y":
					value = Math.floor(value);
				case "r":
				case "scale":
					if (this._computed[key] != value) {
						previous[key] = this._computed[key];
						this._computed[key] = value;
						setMatrix = true;
					}
					break;
				default:
					if (this._computed[key] != value) {
						++animCount;
					    this._computed[key] = value;
						if (key == 'width' || key == 'height') {
							s[key] = value + 'px';
							resized = true;
						} else if (key == 'visible') {
							s.display = (value ? this._displayStyle || 'block' : 'none');
							//s.visibility = (value ? 'visible' : 'hidden');
							// chrome has an obscure rendering bug where visibility:hidden won't
							// hide the canvas element child nodes sometimes. If you set opacity to zero, it will.
							//s.opacity = (value ? this._computed['opacity'] : 0);

						} else if (key == 'opacity') {
							s[key] = value;
						} else {
							s[key] = value;
							
							if (!CUSTOM_KEYS[key]) {
								this[key] = value;
							}
						}

					}
					break;
			}
		}
		if (setMatrix) {
			++animCount;
			if (AVOID_CSS_ANIM) {
				var obj = {
					scale: previous.scale || this._computed.scale,
					r: previous.r || this._computed.r
				};
				// because of android bugs,
				// we must never animate -webkit-transform.
				// http://code.google.com/p/android/issues/detail?id=12451
				if (anim && ((obj.scale != this._computed.scale) ||
							 (obj.r != this._computed.r))) {
					// logger.log('set transform animated', obj.scale, this._computed.scale, obj.r, this._computed.r);
					animate(obj).now({
						scale: this._computed.scale,
						r: this._computed.r
					}, anim.duration, anim.easing, bind(this, function () {
						s.WebkitTransform = ('scale(' + (this._computed.flipX ? obj.scale * -1 : obj.scale) +
											 ',' + (this._computed.flipY ? obj.scale * -1 : obj.scale) + ') ' +
											 'rotate(' + obj.r + 'rad)');
					})).then(bind(this, function () {
						s.WebkitTransform = ('scale(' + (this._computed.flipX ? obj.scale * -1 : obj.scale) +
											 ',' + (this._computed.flipY ? obj.scale * -1 : obj.scale) + ') '  +
											 'rotate(' + this._computed.r + 'rad)');
					}));

				} else if ((obj.scale != this._computed.scale) ||
						   (obj.r != this._computed.r)) {
					// logger.log('set transform', this._computed.scale, this._computed.r);
					s.WebkitTransform = ('scale(' + (this._computed.flipX ? this._computed.scale * -1 : this._computed.scale) +
											',' + (this._computed.flipY ? this._computed.scale * -1 : this._computed.scale) + ') ' +
										 'rotate(' + this._computed.r + 'rad)');
				}
				// use CSS animations for left and top though, since
				// those can still be taken out of javascript.
			        var computed = {
                    			x: (this._center ? -this.width / 2 | 0 : 0) + this._computed.x,
                    			y: (this._center ? -this.height / 2 | 0 : 0) + this._computed.y
                		};
				
				this.position(computed.x, computed.y);
			} else {
				var matrix = new WebKitCSSMatrix();
				matrix = matrix.translate(
					this._computed.x,
					this._computed.y
				);

				matrix = matrix.rotate(this._computed.r * 180 / 3.14159);
				matrix = matrix.scale(this._computed.scale);

				if(this._computed.flipX || this._computed.flipY) {
					matrix = matrix.translate(
						this._computed.flipX ? -this._computed.width : 0,
						this._computed.flipY ? this._computed.height / 2 : 0
					);
					matrix = matrix.scale(
						this._computed.flipX ? -1 : 1,
						this._computed.flipY ? -1 : 1
					);
					matrix = matrix.translate(
						this._computed.flipX ? this._computed.width : 0,
						this._computed.flipY ? -this._computed.height / 2 : 0
					);
				}
				// on iOS, forcing a 3D matrix provides huge performance gains.
				// Rotate it about the y axis 360 degrees to achieve this.
				matrix = matrix.rotate(0, 360, 0);
				s.WebkitTransform = matrix;
			}

		}
		if (resized) {
			this._onSizeChanged && this._onSizeChanged();
		}

		return animCount;
	};

	this._setCenter = function () {
		var s = this._node.style;
		var origin = {
			x: 0,
			y: 0
		};
		if (AVOID_CSS_ANIM) {
			origin.x += this._computed.x;
			origin.y += this._computed.y;
		}
		
		this.position(origin.x, origin.y);
	}

	this._onSizeChanged = function () {
		this._setCenter();
		this._view.needsReflow();
	}

	// ----- zIndex -----

	var LEN_Z = 8;
	var MAX_Z = 99999999;
	var MIN_Z = -99999999;
	var PAD = "00000000";

	this._sortIndex = "00000000";

	this._onZIndex = function (zIndex) {
		zIndex = ~~zIndex;

		if (zIndex < MIN_Z) { zIndex = this._zIndex = MIN_Z; }
		if (zIndex > MAX_Z) { zIndex = this._zIndex = MAX_Z; }
		if (zIndex < 0) {
			zIndex *= -1;
			this._sortIndex = '-' + PAD.substring(0, LEN_Z - ('' + zIndex).length) + zIndex;
		} else {
			this._sortIndex = PAD.substring(0, LEN_Z - ('' + zIndex).length) + zIndex;
		}

		this._setSortKey();
	}

	this._setAddedAt = function (addedAt) {
		this._addedAt = addedAt;
		this._setSortKey();
	}

	this._setSortKey = function () {
		this.__sortKey = this._sortIndex + this._addedAt;
	}

	// ----- ANIMATION -----

	this._transitionEnd = function (evt) {
		$.stopEvent(evt);
		if (this.transitionCallback.fired()) {
			return;
		}

		this.transitionCallback.fire();
		this.transitionCallback.reset();

		if (evt) {
			evt.cancelBubble = true;
		} else if (this._transitionEndTimeout) {
			this._transitionEndTimeout = null;
		}

		this._node.style.webkitTransition = "none";

		this._animating = false;
		if (this._animationCallback) {
			var callback = this._animationCallback;
			this._animationCallback = null;
			callback();
		}

		this._processAnimation();
	};


	this._processAnimation = function (doNow) {
		if (this._animationQueue.length == 0 || this._isPaused) {
			return;
		}
		if (doNow) {
				clearTimeout(this._queuedTimeout);
				this._queuedTimeout = null;
		}
		if (this._queuedTimeout) {
			return;
		}
		if (!doNow) {
			if (!this._queuedTimeout) {
				this._queuedTimeout = setTimeout(bind(this, function () {
					this._queuedTimeout = false;
					this._processAnimation(true);
				}), 0);
			}
			return;
		}

		var anim = this._animationQueue.shift();
		switch (anim.type) {
		case "animate":
			var s = this._node.style;
			if (AVOID_CSS_ANIM) {
				s.webkitTransitionProperty = "left, top, opacity, width, height";
			} else {
				s.webkitTransitionProperty = "-webkit-transform, opacity, width, height";
			}
			s.webkitTransitionDuration = (anim.duration|0) + "ms";
			s.webkitTransitionTimingFunction = getEasing(anim.easing);
			this._setProps(anim.props, anim);

			// fall through
		case "wait":
			this._animating = true;
			this._animationCallback = anim.callback || null;

			this.transitionCallback = new Callback();

			this.transitionCallback.runOrTimeout(function () {
				// if webkitTransitionEnd fires, do nothing
			}, bind(this, function (evt) {
				// webkitTransitionEnd is too late, baby, it's too late
				this._transitionEnd(evt);
			}), anim.duration);
			break;
		case "callback":
			//logger.log('doing callback', anim.callback, doNow);
			anim.callback();
			if (!this._animating) {
				this._processAnimation();
			}
			break;
		}

	};

	this.getQueue = function () {
		return [];
	}
	this.getAnimation = function () {
		return this;
	}

	this.animate = function () {
		if (!arguments[0]) {
			return this;
		}
		return this.next.apply(this, arguments);
	}

	this.clear = function () {
		this.transitionCallback && this.transitionCallback.fire();
		if (this._transitionEndTimeout) {
			clearTimeout(this._transitionEndTimeout);
		}
		this._animationQueue = [];
		this._animationCallback = null;
		this._animating = false;
		return this;
	};

	this.finishNow = function () {
		this._node.style.webkitTransition = 'none';
		// TODO: this isn't really right; you need to actually finish the queue

		return this;
	}

	var DURATION = 600;

	this.pause = function () {
		this._isPaused = true;
	}

	this.resume = function () {
		this._isPaused = false;
		this._processAnimation();
	}

	this.animate = function (props, duration, easing, callback) {
		//this.clear();
		return this.then(props, duration, easing, callback);
	};

	this.now = function (props, duration, easing, callback) {
		this.clear();
		return this.then(props, duration, easing, callback);
	}

	this.then = function (props, duration, easing, callback) {
		if (arguments.length == 1 && typeof props === 'function') {
			return this.callback(props);
		}
		this._animationQueue.push({
			type: "animate",
			props: props,
			duration: duration || DURATION,
			callback: callback && bind(this, callback),
			easing: easing
		});
		if (this._animationQueue.length == 1 && !this._animating) {
			this._processAnimation();
		}
		return this;
	};

	this.callback = function (fn) {
		this._animationQueue.push({
			type: "callback",
			duration: 0,
			callback: fn && bind(this, fn)
		});
		if (this._animationQueue.length == 1 && !this._animating) {
			this._processAnimation();
		}
		return this;
	}

	this.wait = function (duration, callback) {
		this._animationQueue.push({
			type: "wait",
			duration: duration,
			callback: callback
		});
		if (this._animationQueue.length == 1 && !this._animating) {
			this._processAnimation();
		}
		return this;
	};

	this.fadeIn = function (duration, callback) {
		this.show();

		if (this._node.style.opacity == 1) {
			if (callback) {
				callback();
			}
			return;
		}

		this.then({
			opacity: 1
		}, duration, null, callback);
		return this;
	};

	this.fadeOut = function (duration, callback) {
		if (this._node.style.opacity == 0) {
			this.hide();
			if (callback) {
				callback();
			}
			return;
		}

		this.then({
			opacity: 0
		}, duration, null, bind(this, function () {
			this.hide();
			if (callback) {
				callback();
			}
		}));

		return this;
	};

});

