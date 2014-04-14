define([
	'dojo/lang',
	'dojo/Deferred',
	'./Element',
	'./statusCodes',
	'./storage',
	'./strategies',
	'./waitForDeleted',
	'./util'
], function (lang, Deferred, Element, statusCodes, storage, strategies, waitForDeleted, util) {
	function convertToElements(session, returnValue) {
		function convert(value) {
			if (value && value.ELEMENT) {
				value = new Element(value, session);
			}

			return value;
		}

		if (Array.isArray(returnValue)) {
			returnValue = returnValue.map(convert);
		}
		else {
			returnValue = convert(returnValue);
		}

		return returnValue;
	}

	function createPromise(value) {
		var dfd = new Deferred();
		dfd.resolve(value);
		return dfd.promise;
	}

	function fixExecuteError(error) {
		// As of 2.40.0 (March 2014), all drivers incorrectly transmit an UnknownError instead of a
		// JavaScriptError when user code fails to execute correctly; correct this status code, under the
		// assumption that drivers will follow the spec in future
		if (error.name === 'UnknownError') {
			error.status = 17;
			error.name = statusCodes[error.status][0];
		}

		throw error;
	}

	function noop() {
		// At least ios-driver 0.6.6 returns an empty object for methods that are supposed to return no value at all,
		// which is not correct
	}

	function proxyToServer(method) {
		return function (path, requestData, pathParts) {
			path = 'session/' + this._sessionId + (path ? ('/' + path) : '');
			return this._server[method](path, requestData, pathParts).then(returnValue);
		};
	}

	function pushCookieProperties(target, source) {
		Object.keys(source).forEach(function (key) {
			var value = source[key];

			if (key === 'name' || key === 'value' || (key === 'domain' && value === 'http')) {
				return;
			}

			if (typeof value === 'boolean') {
				value && target.push(key);
			}
			else {
				target.push(key + '=' + encodeURIComponent(value));
			}
		});
	}

	function returnValue(response) {
		return response.value;
	}

	function simulateKeys(keys) {
		var target = document.activeElement;

		function dispatch(kwArgs) {
			var event = document.createEvent('KeyboardEvent');
			event.initKeyboardEvent(
				kwArgs.type,
				kwArgs.bubbles || true,
				kwArgs.cancelable || false,
				window,
				kwArgs.key || '',
				kwArgs.location || 3,
				kwArgs.modifiers || '',
				kwArgs.repeat || 0,
				kwArgs.locale || ''
			);

			return target.dispatchEvent(event);
		}

		function dispatchInput() {
			var event = document.createEvent('Event');
			event.initEvent('input', true, false);
			return target.dispatchEvent(event);
		}

		keys = Array.prototype.concat.apply([], keys.map(function (keys) {
			return keys.split('');
		}));

		for (var i = 0, j = keys.length; i < j; ++i) {
			var key = keys[i];
			var performDefault = true;

			performDefault = dispatch({ type: 'keydown', cancelable: true, key: key });
			performDefault = performDefault && dispatch({ type: 'keypress', cancelable: true, key: key });

			if (performDefault) {
				if ('value' in target) {
					target.value = target.value.slice(0, target.selectionStart) + key +
						target.value.slice(target.selectionEnd);
					dispatchInput();
				}
				else if (target.isContentEditable) {
					var node = document.createTextNode(key);
					var selection = window.getSelection();
					var range = selection.getRangeAt(0);
					range.deleteContents();
					range.insertNode(node);
					range.setStartAfter(node);
					range.setEndAfter(node);
					selection.removeAllRanges();
					selection.addRange(range);
				}
			}

			dispatch({ type: 'keyup', cancelable: true, key: key });
		}
	}

	function simulateMouse(kwArgs) {
		var position = kwArgs.position;

		function dispatch(kwArgs) {
			var event = document.createEvent('MouseEvents');
			event.initMouseEvent(
				kwArgs.type,
				kwArgs.bubbles || true,
				kwArgs.cancelable || false,
				window,
				kwArgs.detail || 0,
				window.screenX + position.x,
				window.screenY + position.y,
				position.x,
				position.y,
				kwArgs.ctrlKey || false,
				kwArgs.altKey || false,
				kwArgs.shiftKey || false,
				kwArgs.metaKey || false,
				kwArgs.button || 0,
				kwArgs.relatedTarget || null
			);

			return kwArgs.target.dispatchEvent(event);
		}

		function click(target, button, detail) {
			if (!down(target, button)) {
				return false;
			}

			if (!up(target, button)) {
				return false;
			}

			return dispatch({
				button: button,
				cancelable: true,
				detail: detail,
				target: target,
				type: 'click'
			});
		}

		function down(target, button) {
			return dispatch({
				button: button,
				cancelable: true,
				target: target,
				type: 'mousedown'
			});
		}

		function up(target, button) {
			return dispatch({
				button: button,
				cancelable: true,
				target: target,
				type: 'mouseup'
			});
		}

		function move(currentElement, newElement, xOffset, yOffset) {
			if (newElement) {
				var bbox = newElement.getBoundingClientRect();

				if (xOffset == null) {
					xOffset = (bbox.right - bbox.left) * 0.5;
				}

				if (yOffset == null) {
					yOffset = (bbox.bottom - bbox.top) * 0.5;
				}

				position = { x: bbox.left + xOffset, y: bbox.top + yOffset };
			}
			else {
				position.x += xOffset || 0;
				position.y += yOffset || 0;

				newElement = document.elementFromPoint(position.x, position.y);
			}

			if (currentElement !== newElement) {
				dispatch({ type: 'mouseout', target: currentElement, relatedTarget: newElement });
				dispatch({ type: 'mouseleave', target: currentElement, relatedTarget: newElement, bubbles: false });
				dispatch({ type: 'mouseenter', target: newElement, relatedTarget: currentElement, bubbles: false });
				dispatch({ type: 'mouseover', target: newElement, relatedTarget: currentElement });
			}

			dispatch({ type: 'mousemove', target: newElement, bubbles: true });

			return position;
		}

		var target = document.elementFromPoint(position.x, position.y);

		if (kwArgs.action === 'mousemove') {
			return move(target, kwArgs.element, kwArgs.xOffset, kwArgs.yOffset);
		}
		else if (kwArgs.action === 'mousedown') {
			return down(target, kwArgs.button);
		}
		else if (kwArgs.action === 'mouseup') {
			return up(target, kwArgs.button);
		}
		else if (kwArgs.action === 'click') {
			return click(target, kwArgs.button, 0);
		}
		else if (kwArgs.action === 'dblclick') {
			if (!click(target, kwArgs.button, 0)) {
				return false;
			}

			if (!click(target, kwArgs.button, 1)) {
				return false;
			}

			return dispatch({
				type: 'dblclick',
				target: target,
				button: kwArgs.button,
				detail: 2,
				cancelable: true
			});
		}
	}

	function toString(fn) {
		if (typeof fn === 'function') {
			fn = 'return (' + fn.toString() + ').apply(this, arguments);';
		}

		return fn;
	}

	function Session(sessionId, server, capabilities) {
		this._sessionId = sessionId;
		this._server = server;
		this._capabilities = capabilities;
		this._closedWindows = {};
	}

	Session.prototype = {
		constructor: Session,

		_movedToElement: false,
		_lastMousePosition: null,
		_lastAltitude: null,
		_closedWindows: null,

		// TODO: Timeouts are held so that we can fiddle with the implicit wait timeout to add efficient `waitFor`
		// and `waitForDeleted` convenience methods. Technically only the implicit timeout is necessary.
		_timeouts: {
			script: createPromise(0),
			implicit: createPromise(0),
			'page load': createPromise(Infinity)
		},

		get capabilities() {
			return this._capabilities;
		},

		get sessionId() {
			return this._sessionId;
		},

		_get: proxyToServer('_get'),
		_post: proxyToServer('_post'),
		_delete: proxyToServer('_delete'),

		getTimeout: function (type) {
			return this._timeouts[type];
		},

		setTimeout: function (type, ms) {
			var self = this;
			var promise = this._post('timeouts', {
				type: type,
				ms: ms
			}).otherwise(function (error) {
				// Appium as of April 2014 complains that `timeouts` is unsupported, so try the more specific
				// endpoints if they exist
				if (error.name === 'UnknownCommand') {
					if (type === 'script') {
						return self._post('timeouts/async_script', { ms: ms });
					}
					else if (type === 'implicit') {
						return self._post('timeouts/implicit_wait', { ms: ms });
					}
				}

				throw error;
			}).then(noop);

			this._timeouts[type] = promise.then(function () {
				return ms;
			});

			return promise;
		},

		getCurrentWindowHandle: function () {
			var self = this;
			return this._get('window_handle').then(function (name) {
				if (self.capabilities.brokenDeleteWindow && self._closedWindows[name]) {
					var error = new Error();
					error.status = 23;
					error.name = statusCodes[error.status][0];
					error.message = statusCodes[error.status][1];
					throw error;
				}

				return name;
			});
		},

		getAllWindowHandles: function () {
			var self = this;
			return this._get('window_handles').then(function (names) {
				if (self.capabilities.brokenDeleteWindow) {
					return names.filter(function (name) { return !self._closedWindows[name]; });
				}

				return names;
			});
		},

		getCurrentUrl: function () {
			return this._get('url');
		},

		get: function (url) {
			this._movedToElement = false;

			if (this.capabilities.brokenMouseEvents) {
				this._lastMousePosition = { x: 0, y: 0 };
			}

			return this._post('url', {
				url: url
			}).then(noop);
		},

		goForward: function () {
			return this._post('forward').then(noop);
		},

		goBack: function () {
			return this._post('back').then(noop);
		},

		refresh: function () {
			if (this.capabilities.brokenRefresh) {
				return this.execute('location.reload();');
			}

			return this._post('refresh').then(noop);
		},

		execute: function (script, args) {
			// At least FirefoxDriver 2.40.0 will throw a confusing NullPointerException if args is not an array;
			// provide a friendlier error message to users that accidentally pass a non-array
			if (typeof args !== 'undefined' && !Array.isArray(args)) {
				throw new Error('Arguments passed to execute must be an array');
			}

			return this._post('execute', {
				script: toString(script),
				args: args || []
			}).then(lang.partial(convertToElements, this), fixExecuteError);
		},

		executeAsync: function (script, args) {
			// At least FirefoxDriver 2.40.0 will throw a confusing NullPointerException if args is not an array;
			// provide a friendlier error message to users that accidentally pass a non-array
			if (typeof args !== 'undefined' && !Array.isArray(args)) {
				throw new Error('Arguments passed to executeAsync must be an array');
			}

			return this._post('execute_async', {
				script: toString(script),
				args: args || []
			}).then(lang.partial(convertToElements, this), fixExecuteError);
		},

		takeScreenshot: function () {
			return this._get('screenshot').then(function (data) {
				/*jshint node:true */
				return new Buffer(data, 'base64');
			});
		},

		getAvailableImeEngines: function () {
			return this._get('ime/available_engines');
		},

		getActiveImeEngine: function () {
			return this._get('ime/active_engine');
		},

		isImeActivated: function () {
			return this._get('ime/activated');
		},

		deactivateIme: function () {
			return this._post('ime/deactivate');
		},

		activateIme: function (engine) {
			return this._post('ime/activate', {
				engine: engine
			});
		},

		switchToFrame: function (id) {
			return this._post('frame', {
				id: id
			}).then(noop);
		},

		switchToWindow: function (name) {
			return this._post('window', {
				name: name
			}).then(noop);
		},

		switchToParentFrame: function () {
			var self = this;
			return this._post('frame/parent').otherwise(function (error) {
				// At least FirefoxDriver 2.40.0 does not implement this command, but we can fake it by retrieving
				// the parent frame element using JavaScript and switching to it directly by reference
				// At least Selendroid 0.9.0 also does not support this command, but unfortunately throws an incorrect
				// error so it looks like a fatal error; see https://github.com/selendroid/selendroid/issues/364
				if (error.name === 'UnknownCommand' ||
					(
						self.capabilities.browserName === 'selendroid' &&
						error.message.indexOf('Error occured while communicating with selendroid server') > -1
					)
				) {
					return self.execute('return window.parent.frameElement;').then(function (parent) {
						// TODO: Using `null` if no parent frame was returned keeps the request from being invalid,
						// but may be incorrect and may cause incorrect frame retargeting on certain platforms;
						// At least Selendroid 0.9.0 fails both commands
						return self.switchToFrame(parent || null);
					});
				}

				throw error;
			}).then(noop);
		},

		closeCurrentWindow: function () {
			var self = this;
			return this._delete('window').otherwise(function (error) {
				// ios-driver 0.6.6-SNAPSHOT April 2014 does not implement close window command
				if (error.name === 'UnknownCommand') {
					return self.getCurrentWindowHandle().then(function (name) {
						return self.execute('window.close();').then(function () {
							if (self.capabilities.brokenDeleteWindow) {
								self._closedWindows[name] = true;
							}
						});
					});
				}

				throw error;
			}).then(noop);
		},

		setWindowSize: function (windowHandle, width, height) {
			if (typeof height === 'undefined') {
				height = width;
				width = windowHandle;
				windowHandle = 'current';
			}

			return this._post('window/$0/size', {
				width: width,
				height: height
			}, [ windowHandle ]).then(noop);
		},

		getWindowSize: function (windowHandle) {
			if (typeof windowHandle === 'undefined') {
				windowHandle = 'current';
			}

			return this._get('window/$0/size', null, [ windowHandle ]);
		},

		setWindowPosition: function (windowHandle, x, y) {
			if (typeof y === 'undefined') {
				y = x;
				x = windowHandle;
				windowHandle = 'current';
			}

			return this._post('window/$0/position', {
				x: x,
				y: y
			}, [ windowHandle ]).then(noop);
		},

		getWindowPosition: function (windowHandle) {
			if (typeof windowHandle === 'undefined') {
				windowHandle = 'current';
			}

			return this._get('window/$0/position', null, [ windowHandle ]);
		},

		maximizeWindow: function (windowHandle) {
			if (typeof windowHandle === 'undefined') {
				windowHandle = 'current';
			}

			return this._post('window/$0/maximize', null, [ windowHandle ]).then(noop);
		},

		getCookies: function () {
			return this._get('cookie');
		},

		setCookie: function (cookie) {
			var self = this;
			return this._post('cookie', {
				cookie: cookie
			}).otherwise(function (error) {
				// At least ios-driver 0.6.0-SNAPSHOT April 2014 does not know how to set cookies
				if (error.name === 'UnknownCommand') {
					// Per RFC6265 section 4.1.1, cookie names must match `token` (any US-ASCII character except for
					// control characters and separators as defined in RFC2616 section 2.2)
					if (/[^A-Za-z0-9!#$%&'*+.^_`|~-]/.test(cookie.name)) {
						error = new Error();
						error.status = 25;
						error.name = statusCodes[error.status[0]];
						error.message = 'Invalid cookie name';
						throw error;
					}

					if (/[^\u0021\u0023-\u002b\u002d-\u003a\u003c-\u005b\u005d-\u007e]/.test(cookie.value)) {
						error = new Error();
						error.status = 25;
						error.name = statusCodes[error.status[0]];
						error.message = 'Invalid cookie value';
						throw error;
					}

					var cookieToSet = [ cookie.name + '=' + cookie.value ];

					pushCookieProperties(cookieToSet, cookie);

					return self.execute(function (cookie) {
						document.cookie = cookie;
					}, [ cookieToSet.join(';') ]);
				}

				throw error;
			}).then(noop);
		},

		clearCookies: function () {
			return this._delete('cookie').then(noop);
		},

		deleteCookie: function (name) {
			if (this.capabilities.brokenDeleteCookie) {
				var self = this;
				return this.getCookies().then(function (cookies) {
					var cookie;
					if (cookies.some(function (value) {
						if (value.name === name) {
							cookie = value;
							return true;
						}
					})) {
						var expiredCookie = [
							cookie.name + '=',
							'expires=Thu, 01 Jan 1970 00:00:00 GMT'
						];

						pushCookieProperties(expiredCookie, cookie);

						return self.execute(function (expiredCookie) {
							document.cookie = expiredCookie + ';domain=' + encodeURIComponent(document.domain);
						}, [ expiredCookie.join(';') ]);
					}
				});
			}

			return this._delete('cookie/$0', null, [ name ]).then(noop);
		},

		getPageSource: function () {
			return this._get('source');
		},

		getPageTitle: function () {
			return this._get('title');
		},

		getElement: function (using, value) {
			var self = this;
			return this._post('element', {
				using: using,
				value: value
			}).then(function (element) {
				return new Element(element, self);
			});
		},

		getElements: function (using, value) {
			var self = this;
			return this._post('elements', {
				using: using,
				value: value
			}).then(function (elements) {
				return elements.map(function (element) {
					return new Element(element, self);
				});
			});
		},

		getActiveElement: function () {
			var self = this;
			return this._get('element/active').then(function (element) {
				if (element) {
					return new Element(element, self);
				}
				// The driver will return `null` if the active element is the body element; for consistency with how
				// the DOM `document.activeElement` property works, we want to always return an element
				else {
					return self.execute('return document.activeElement;');
				}
			}, function (error) {
				// At least ChromeDriver 2.9 does not implement this command, but we can fake it by retrieving
				// the active element using JavaScript
				if (error.name === 'UnknownCommand') {
					return self.execute('return document.activeElement;');
				}

				throw error;
			});
		},

		type: function (keys) {
			if (!Array.isArray(keys)) {
				keys = [ keys ];
			}

			if (this.capabilities.brokenSendKeys) {
				return this.execute(simulateKeys, [ keys ]);
			}

			return this._post('keys', {
				value: keys
			}).then(noop);
		},

		getOrientation: function () {
			return this._get('orientation');
		},

		setOrientation: function (orientation) {
			return this._post('orientation', {
				orientation: orientation
			}).then(noop);
		},

		getAlertText: function () {
			return this._get('alert_text');
		},

		typeInPrompt: function (text) {
			if (Array.isArray(text)) {
				text = text.join('');
			}

			return this._post('alert_text', {
				text: text
			}).then(noop);
		},

		acceptAlert: function () {
			return this._post('accept_alert').then(noop);
		},

		dismissAlert: function () {
			return this._post('dismiss_alert').then(noop);
		},

		moveMouseTo: function (element, xOffset, yOffset) {
			var self = this;

			if (typeof yOffset === 'undefined' && typeof xOffset !== 'undefined') {
				yOffset = xOffset;
				xOffset = element;
				element = null;
			}

			if (this.capabilities.brokenMouseEvents) {
				return this.execute(simulateMouse, [ {
					action: 'mousemove',
					position: self._lastMousePosition,
					element: element,
					xOffset: xOffset,
					yOffset: yOffset
				} ]).then(function (newPosition) {
					self._lastMousePosition = newPosition;
				});
			}

			if (element) {
				element = element.elementId;
			}
			// If the mouse has not been moved to any element on this page yet, drivers will either throw errors
			// (FirefoxDriver 2.40.0) or silently fail (ChromeDriver 2.9) when trying to move the mouse cursor relative
			// to the "previous" position; in this case, we just assume that the mouse position defaults to the
			// top-left corner of the document
			else if (!this._movedToElement) {
				return this.execute('return document.documentElement;').then(function (element) {
					return self.moveMouseTo(element, xOffset, yOffset);
				});
			}

			return this._post('moveto', {
				element: element,
				xoffset: xOffset,
				yoffset: yOffset
			}).then(function () {
				self._movedToElement = true;
			});
		},

		click: function (button) {
			if (this.capabilities.brokenMouseEvents) {
				return this.execute(simulateMouse, [ {
					action: 'click',
					button: button,
					position: this._lastMousePosition
				} ]).then(noop);
			}

			var self = this;
			return this._post('click', {
				button: button
			}).then(function () {
				// ios-driver 0.6.6-SNAPSHOT April 2014 does not wait until the default action for a click event occurs
				// before returning
				if (self.capabilities.touchEnabled) {
					return util.sleep(300);
				}
			});
		},

		pressMouseButton: function (button) {
			if (this.capabilities.brokenMouseEvents) {
				return this.execute(simulateMouse, [ {
					action: 'mousedown',
					button: button,
					position: this._lastMousePosition
				} ]).then(noop);
			}

			return this._post('buttondown', {
				button: button
			}).then(noop);
		},

		releaseMouseButton: function (button) {
			if (this.capabilities.brokenMouseEvents) {
				return this.execute(simulateMouse, [ {
					action: 'mouseup',
					button: button,
					position: this._lastMousePosition
				} ]).then(noop);
			}

			return this._post('buttonup', {
				button: button
			}).then(noop);
		},

		doubleClick: function () {
			if (this.capabilities.brokenMouseEvents) {
				return this.execute(simulateMouse, [ {
					action: 'dblclick',
					button: 0,
					position: this._lastMousePosition
				} ]).then(noop);
			}
			else if (this.capabilities.brokenDoubleClick) {
				var self = this;
				return this.pressMouseButton().then(function () {
					return self.releaseMouseButton();
				}).then(function () {
					return self._post('doubleclick');
				});
			}

			return this._post('doubleclick').then(noop);
		},

		tap: function (element) {
			if (element) {
				element = element.elementId;
			}

			return this._post('touch/click', {
				element: element
			}).then(noop);
		},

		pressFinger: function (x, y) {
			return this._post('touch/down', {
				x: x,
				y: y
			}).then(noop);
		},

		releaseFinger: function (x, y) {
			return this._post('touch/up', {
				x: x,
				y: y
			}).then(noop);
		},

		moveFinger: function (x, y) {
			return this._post('touch/move', {
				x: x,
				y: y
			}).then(noop);
		},

		touchScroll: function (element, xOffset, yOffset) {
			if (typeof yOffset === 'undefined' && typeof xOffset !== 'undefined') {
				yOffset = xOffset;
				xOffset = element;
				element = undefined;
			}

			if (this.capabilities.brokenTouchScroll) {
				return this.execute(function (element, x, y) {
					var rect = { left: window.scrollX, top: window.scrollY };
					if (element) {
						var bbox = element.getBoundingClientRect();
						rect.left += bbox.left;
						rect.top += bbox.top;
					}

					window.scrollTo(rect.left + x, rect.top + y);
				}, [ element, xOffset, yOffset ]);
			}

			if (element) {
				element = element.elementId;
			}

			// TODO: If using this, please correct for device pixel ratio to ensure consistency
			return this._post('touch/scroll', {
				element: element,
				xoffset: xOffset,
				yoffset: yOffset
			}).then(noop);
		},

		doubleTap: function (element) {
			if (element) {
				element = element.elementId;
			}

			return this._post('touch/doubleclick', {
				element: element
			}).then(noop);
		},

		longTap: function (element) {
			if (element) {
				element = element.elementId;
			}

			return this._post('touch/longclick', {
				element: element
			}).then(noop);
		},

		flickFinger: function (element, xOffset, yOffset, speed) {
			if (typeof speed === 'undefined' && typeof yOffset === 'undefined' && typeof xOffset !== 'undefined') {
				return this._post('touch/flick', {
					xspeed: element,
					yspeed: xOffset
				}).then(noop);
			}

			if (element) {
				element = element.elementId;
			}

			return this._post('touch/flick', {
				element: element,
				xoffset: xOffset,
				yoffset: yOffset,
				speed: speed
			}).then(noop);
		},

		getGeolocation: function () {
			var self = this;
			return this._get('location').then(function (location) {
				// ChromeDriver 2.9 ignores altitude being set and then returns 0; to match the Geolocation API
				// specification, we will just pretend that altitude is not supported by the browser at all by
				// changing the value to `null` if it is zero but the last set value was not zero
				if (location.altitude === 0 && self._lastAltitude !== location.altitude) {
					location.altitude = null;
				}

				return location;
			});
		},

		setGeolocation: function (location) {
			if (location.altitude !== undefined) {
				this._lastAltitude = location.altitude;
			}

			return this._post('location', {
				location: location
			}).then(noop);
		},

		getLogsFor: function (type) {
			return this._post('log', {
				type: type
			}).then(function (logs) {
				// At least Selendroid 0.9.0 returns logs as an array of strings instead of an array of log objects,
				// which is a spec violation; see https://github.com/selendroid/selendroid/issues/366
				if (logs && typeof logs[0] === 'string') {
					return logs.map(function (log) {
						var logData = /\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)/.exec(log);
						if (logData) {
							return {
								timestamp: Date.parse(logData[1]),
								level: logData[2],
								message: logData[3]
							};
						}

						return {
							timestamp: NaN,
							level: 'INFO',
							message: log
						};
					});
				}

				return logs;
			});
		},

		getAvailableLogTypes: function () {
			if (this.capabilities.fixedLogTypes) {
				return createPromise(this.capabilities.fixedLogTypes);
			}

			return this._get('log/types');
		},

		getApplicationCacheStatus: function () {
			return this._get('application_cache/status');
		}
	};

	storage.applyTo(Session.prototype, 'local');
	storage.applyTo(Session.prototype, 'session');

	// TODO: The rest of this file are "extra" interfaces; decide where they go more permanently
	strategies.applyTo(Session.prototype);
	waitForDeleted.applyTo(Session.prototype);

	(function (prototype) {
		var timeouts = {
			script: 'ExecuteAsync',
			implicit: 'Implicit',
			'page load': 'PageLoad'
		};

		for (var type in timeouts) {
			prototype['get' + timeouts[type] + 'Timeout'] = lang.partial(function (type) {
				return this.getTimeout(type);
			}, type);

			prototype['set' + timeouts[type] + 'Timeout'] = lang.partial(function (type, ms) {
				return this.setTimeout(type, ms);
			}, type);
		}
	})(Session.prototype);


	Session.prototype.quit = function () {
		return this._server.deleteSession(this._sessionId).then(noop);
	};

	return Session;
});
