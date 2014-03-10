define([
	'./Element',
	'./storage',
	'./strategies'
], function (Element, storage, strategies) {
	function returnValue(response) {
		return response.value;
	}

	function proxyToServer(method) {
		return function (path, requestData, pathParts) {
			path = 'session/' + this._sessionId + path ? ('/' + path) : '';
			return this._server[method](path, requestData, pathParts).then(returnValue);
		};
	}

	function toString(fn) {
		if (typeof fn === 'function') {
			fn = 'return (' + fn.toString() + ').apply(this, arguments);';
		}

		return fn;
	}

	function Session(sessionId, server) {
		this._sessionId = sessionId;
		this._server = server;
	}

	Session.prototype = {
		constructor: Session,

		// TODO: Timeouts are held so that we can fiddle with the implicit wait timeout to add efficient `waitFor`
		// and `waitForDeleted` convenience methods. Technically only the implicit timeout is necessary.
		_timeouts: {
			script: Infinity,
			implicit: 0,
			'page load': Infinity
		},

		get sessionId() {
			return this._sessionId;
		},

		_get: proxyToServer('_get'),
		_post: proxyToServer('_post'),
		_delete: proxyToServer('_delete'),

		getCapabilities: function () {
			this._get('');
		},

		setTimeout: function (type, ms) {
			var self = this;
			return this._post('timeouts', {
				type: type,
				ms: ms
			}).then(function (returnValue) {
				self._timeouts[type] = ms;
				return returnValue;
			});
		},

		setAsyncScriptTimeout: function (ms) {
			return this.setTimeout('script', ms);
		},

		setImplicitWaitTimeout: function (ms) {
			return this.setTimeout('implicit', ms);
		},

		setPageLoadTimeout: function (ms) {
			return this.setTimeout('page load', ms);
		},

		getCurrentWindowHandle: function () {
			return this._get('window_handle');
		},

		getWindowHandles: function () {
			return this._get('window_handles');
		},

		getUrl: function () {
			return this._get('url');
		},

		setUrl: function (url) {
			return this._post('url', {
				url: url
			});
		},

		forward: function () {
			return this._post('forward');
		},

		back: function () {
			return this._post('back');
		},

		refresh: function () {
			return this._post('refresh');
		},

		execute: function (script, args) {
			return this._post('execute', {
				script: toString(script),
				args: args
			});
		},

		executeAsync: function (script, args) {
			return this._post('executeAsync', {
				script: toString(script),
				args: args
			});
		},

		takeScreenshot: function () {
			return this._get('screenshot');
		},

		getAvailableImeEngines: function () {
			return this._get('ime/available_engines');
		},

		getActiveImeEngine: function () {
			return this._get('ime/active_engine');
		},

		getIsImeActivated: function () {
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

		focusFrame: function (id) {
			return this._post('frame', {
				id: id
			});
		},

		focusWindow: function (name) {
			return this._post('window', {
				name: name
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
			return this._delete('cookie/$0', null, [ name ]);
		},

		getPageSource: function () {
			return this._get('source');
		},

		getPageTitle: function () {
			return this._get('title');
		},

		getElement: function (using, value) {
			var session = this;
			return this._get('element', {
				using: using,
				value: value
			}).then(function (element) {
				return new Element(element, session);
			});
		},

		getElements: function (using, value) {
			var session = this;
			return this._get('elements', {
				using: using,
				value: value
			}).then(function (elements) {
				return elements.map(function (element) {
					return new Element(element, session);
				});
			});
		},

		getActiveElement: function () {
			return this._get('element/active').then(function (element) {
				return new Element(this, element);
			});
		},

		sendKeys: function (keys) {
			if (!Array.isArray(keys)) {
				keys = [ keys ];
			}

			return this._post('keys', {
				keys: keys
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

		sendKeysToPrompt: function (text) {
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
			if (typeof yOffset === 'undefined') {
				yOffset = xOffset;
				xOffset = element;
				element = null;
			}

			return this._post('moveto', {
				element: element,
				xoffset: xOffset,
				yoffset: yOffset
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

		touchScroll: function (element, xOffset, yOffset) {
			if (typeof yOffset === 'undefined') {
				yOffset = xOffset;
				xOffset = element;
				element = undefined;
			}

			return this._post('touch/scroll', {
				element: element,
				xoffset: xOffset,
				yoffset: yOffset
			});
		},

		doubleTap: function () {
			return this._post('touch/doubleclick');
		},

		longTap: function (element) {
			return this._post('touch/longclick', {
				element: element
			});
		},

		flickFinger: function (element, xOffset, yOffset, speed) {
			if (typeof speed === 'undefined' && typeof yOffset === 'undefined') {
				return this._post('touch/flick', {
					xspeed: element,
					yspeed: xOffset
				});
			}

			// TODO: It is unclear whether or not this API actually supports this operation
			if (typeof speed === 'undefined') {
				speed = yOffset;
				yOffset = xOffset;
				xOffset = element;
				element = undefined;
			}

			return this._post('touch/flick', {
				element: element,
				xoffset: xOffset,
				yoffset: yOffset,
				speed: speed
			});
		},

		getGeolocation: function () {
			return this._get('location');
		},

		setGeolocation: function (latitude, longitude, altitude) {
			return this._post('location', {
				latitude: latitude,
				longitude: longitude,
				altitude: altitude
			});
		},

		getLogsFor: function (type) {
			return this._post('log', {
				type: type
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

	// TODO: These are "extras"; decide where they go more permanently
	strategies.applyTo(Session.prototype);
	Session.prototype.quit = function () {
		return this._server.deleteSession(this._sessionId).then(returnValue);
	};

	return Session;
});
