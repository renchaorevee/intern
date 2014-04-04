define([
	'dojo/lang',
	'dojo/Deferred',
	'./Element',
	'./statusCodes',
	'./storage',
	'./strategies'
], function (lang, Deferred, Element, statusCodes, storage, strategies) {
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

	function proxyToServer(method) {
		return function (path, requestData, pathParts) {
			path = 'session/' + this._sessionId + (path ? ('/' + path) : '');
			return this._server[method](path, requestData, pathParts).then(returnValue);
		};
	}

	function returnValue(response) {
		return response.value;
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
	}

	Session.prototype = {
		constructor: Session,

		_movedToElement: false,
		_lastAltitude: null,

		// TODO: Timeouts are held so that we can fiddle with the implicit wait timeout to add efficient `waitFor`
		// and `waitForDeleted` convenience methods. Technically only the implicit timeout is necessary.
		_timeouts: {
			script: createPromise(0),
			implicit: createPromise(0),
			'page load': createPromise(Infinity)
		},

		get sessionId() {
			return this._sessionId;
		},

		get capabilities() {
			return this._capabilities;
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
			});

			this._timeouts[type] = promise.then(function () {
				return ms;
			});

			return promise;
		},

		getCurrentWindowHandle: function () {
			return this._get('window_handle');
		},

		getAllWindowHandles: function () {
			return this._get('window_handles');
		},

		getCurrentUrl: function () {
			return this._get('url');
		},

		get: function (url) {
			this._movedToElement = false;
			return this._post('url', {
				url: url
			});
		},

		goForward: function () {
			return this._post('forward');
		},

		goBack: function () {
			return this._post('back');
		},

		refresh: function () {
			return this._post('refresh');
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
			});
		},

		switchToWindow: function (name) {
			return this._post('window', {
				name: name
			});
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
			});
		},

		closeCurrentWindow: function () {
			return this._delete('window');
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
			}, [ windowHandle ]);
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
			}, [ windowHandle ]);
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

			return this._post('window/$0/maximize', null, [ windowHandle ]);
		},

		getCookies: function () {
			return this._get('cookie');
		},

		setCookie: function (cookie) {
			return this._post('cookie', {
				cookie: cookie
			});
		},

		clearCookies: function () {
			return this._delete('cookie');
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
							encodeURIComponent(cookie.name) + '=',
							'expires=Thu, 01 Jan 1970 00:00:00 GMT'
						];

						Object.keys(cookie).forEach(function (key) {
							var value = cookie[key];

							if (key === 'name' || key === 'value' || (key === 'domain' && value === 'http')) {
								return;
							}

							if (typeof value === 'boolean') {
								value && expiredCookie.push(key);
							}
							else {
								expiredCookie.push(key + '=' + encodeURIComponent(cookie[key]));
							}
						});

						return self.execute(function (expiredCookie) {
							document.cookie = expiredCookie + ';domain=' + encodeURIComponent(document.domain);
						}, [ expiredCookie.join(';') ]);
					}
				});
			}

			return this._delete('cookie/$0', null, [ name ]);
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

			return this._post('keys', {
				value: keys
			});
		},

		getOrientation: function () {
			return this._get('orientation');
		},

		setOrientation: function (orientation) {
			return this._post('orientation', {
				orientation: orientation
			});
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
			});
		},

		acceptAlert: function () {
			return this._post('accept_alert');
		},

		dismissAlert: function () {
			return this._post('dismiss_alert');
		},

		moveMouseTo: function (element, xOffset, yOffset) {
			var self = this;

			if (typeof yOffset === 'undefined' && typeof xOffset !== 'undefined') {
				yOffset = xOffset;
				xOffset = element;
				element = null;
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
			}).then(function (returnValue) {
				self._movedToElement = true;
				return returnValue;
			});
		},

		click: function (button) {
			return this._post('click', {
				button: button
			});
		},

		pressMouseButton: function (button) {
			return this._post('buttondown', {
				button: button
			});
		},

		releaseMouseButton: function (button) {
			return this._post('buttonup', {
				button: button
			});
		},

		doubleClick: function () {
			return this._post('doubleclick');
		},

		tap: function (element) {
			if (element) {
				element = element.elementId;
			}

			return this._post('touch/click', {
				element: element
			});
		},

		pressFinger: function (x, y) {
			return this._post('touch/down', {
				x: x,
				y: y
			});
		},

		releaseFinger: function (x, y) {
			return this._post('touch/up', {
				x: x,
				y: y
			});
		},

		moveFinger: function (x, y) {
			return this._post('touch/move', {
				x: x,
				y: y
			});
		},

		touchScroll: function (element, xOffset, yOffset) {
			if (typeof yOffset === 'undefined' && typeof xOffset !== 'undefined') {
				yOffset = xOffset;
				xOffset = element;
				element = undefined;
			}

			if (element) {
				element = element.elementId;
			}

			return this._post('touch/scroll', {
				element: element,
				xoffset: xOffset,
				yoffset: yOffset
			});
		},

		doubleTap: function (element) {
			if (element) {
				element = element.elementId;
			}

			return this._post('touch/doubleclick', {
				element: element
			});
		},

		longTap: function (element) {
			if (element) {
				element = element.elementId;
			}

			return this._post('touch/longclick', {
				element: element
			});
		},

		flickFinger: function (element, xOffset, yOffset, speed) {
			if (typeof speed === 'undefined' && typeof yOffset === 'undefined' && typeof xOffset !== 'undefined') {
				return this._post('touch/flick', {
					xspeed: element,
					yspeed: xOffset
				});
			}

			if (element) {
				element = element.elementId;
			}

			return this._post('touch/flick', {
				element: element,
				xoffset: xOffset,
				yoffset: yOffset,
				speed: speed
			});
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
			});
		},

		getLogsFor: function (type) {
			return this._post('log', {
				type: type
			}).then(function (logs) {
				// At least Selendroid 0.9.0 returns logs as an array of strings instead of an array of log objects,
				// which is a spec violation; see https://github.com/selendroid/selendroid/issues/366
				if (logs && typeof logs[0] === 'string') {
					return logs.map(function (log) {
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

	Session.prototype.waitForDeletedElement = function (strategy, value) {
		var self = this;
		var originalTimeout;

		return self.getTimeout('implicit').then(function (value) {
			originalTimeout = value;
			return self.setTimeout('implicit', 0);
		}).then(function () {
			var dfd = new Deferred();
			var startTime = Date.now();

			(function poll() {
				if (Date.now() - startTime > originalTimeout) {
					self.setTimeout('implicit', originalTimeout).always(function () {
						var error = new Error();
						error.status = 21;
						error.name = statusCodes[error.status][0];
						error.message = statusCodes[error.status][1];
						dfd.reject(error);
					});
					return;
				}

				self.getElementBy(strategy, value).then(poll, function (error) {
					self.setTimeout('implicit', originalTimeout).always(function () {
						if (error.name === 'NoSuchElement') {
							dfd.resolve();
						}
						else {
							dfd.reject(error);
						}
					});
				});
			})();

			return dfd.promise;
		});
	};

	Session.prototype.quit = function () {
		return this._server.deleteSession(this._sessionId).then(returnValue);
	};

	return Session;
});
