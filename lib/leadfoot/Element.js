define([
	'./strategies',
	'./waitForDeleted',
	'./util'
], function (strategies, waitForDeleted, util) {
	function noop() {
		// At least ios-driver 0.6.6 returns an empty object for methods that are supposed to return no value at all,
		// which is not correct
	}

	function proxyToSession(method) {
		return function (path, requestData, pathParts) {
			path = 'element/' + encodeURIComponent(this._elementId) + '/' + path;
			return this._session[method](path, requestData, pathParts);
		};
	}

	function Element(elementId, session) {
		this._elementId = elementId.ELEMENT || elementId.elementId || elementId;
		this._session = session;
	}

	Element.prototype = {
		constructor: Element,

		get elementId() {
			return this._elementId;
		},

		get session() {
			return this._session;
		},

		_get: proxyToSession('_get'),
		_post: proxyToSession('_post'),

		toJSON: function () {
			return { ELEMENT: this._elementId };
		},

		getElement: function (using, value) {
			var session = this._session;
			return this._post('element', {
				using: using,
				value: value
			}).then(function (element) {
				return new Element(element, session);
			});
		},

		getElements: function (using, value) {
			var session = this._session;
			return this._post('elements', {
				using: using,
				value: value
			}).then(function (elements) {
				return elements.map(function (element) {
					return new Element(element, session);
				});
			});
		},

		click: function () {
			var self = this;
			return this._post('click').then(function () {
				// ios-driver 0.6.6-SNAPSHOT April 2014 does not wait until the default action for a click event occurs
				// before returning
				if (self.session.capabilities.touchEnabled) {
					return util.sleep(300);
				}
			});
		},

		submit: function () {
			return this._post('submit').then(noop);
		},

		getVisibleText: function () {
			return this._get('text');
		},

		type: function (value) {
			if (!Array.isArray(value)) {
				value = [ value ];
			}

			return this._post('value', {
				value: value
			}).then(noop);
		},

		getTagName: function () {
			var self = this;
			return this._get('name').then(function (name) {
				/*jshint maxlen:160 */
				if (self.session.capabilities.brokenHtmlTagName) {
					return self.session.execute(
						'return document.body && document.body.tagName === document.body.tagName.toUpperCase();'
					).then(function (isHtml) {
						return isHtml ? name.toLowerCase() : name;
					});
				}

				return name;
			});
		},

		clearValue: function () {
			return this._post('clear').then(noop);
		},

		isSelected: function () {
			return this._get('selected');
		},

		isEnabled: function () {
			return this._get('enabled');
		},

		getAttribute: function (name) {
			var self = this;
			return this._get('attribute/$0', null, [ name ]).then(function (value) {
				if (self.session.capabilities.brokenNullGetAttribute && (value === '' || value === undefined)) {
					return self.session.execute(function (element, name) {
						return element.hasAttribute(name);
					}, [ self, name ]).then(function (hasAttribute) {
						return hasAttribute ? value : null;
					});
				}

				return value;
			}).then(function (value) {
				// At least ios-driver 0.6.6-SNAPSHOT violates draft spec and returns boolean attributes as
				// booleans instead of the string "true" or null
				if (typeof value === 'boolean') {
					value = value ? 'true' : null;
				}

				return value;
			});
		},

		equals: function (other) {
			var elementId = other.elementId || other;
			var self = this;
			return this._get('equals/$0', null, [ elementId ]).otherwise(function (error) {
				// At least Selendroid 0.9.0 does not support this command;
				// At least ios-driver 0.6.6-SNAPSHOT April 2014 fails
				if (error.name === 'UnknownCommand' ||
					(error.name === 'UnknownError' && error.message.indexOf('bug.For input string:') > -1)
				) {
					return self.session.execute('return arguments[0] === arguments[1];', [ self, other ]);
				}

				throw error;
			});
		},

		isDisplayed: function () {
			if (this.session.capabilities.brokenElementDisplayedOpacity) {
				var self = this;
				return this._get('displayed').then(function (isDisplayed) {
					if (isDisplayed) {
						return self.session.execute(function (element) {
							do {
								if (window.getComputedStyle(element, null).opacity === '0') {
									return false;
								}
							}
							while ((element = element.parentNode) && element.nodeType === 1);
							return true;
						}, [ self ]);
					}

					return isDisplayed;
				});
			}

			return this._get('displayed');
		},

		getPosition: function () {
			if (this.session.capabilities.brokenElementPosition) {
				return this.session.execute(function (element) {
					var bbox = element.getBoundingClientRect();
					return { x: window.scrollX + bbox.left, y: window.scrollY + bbox.top };
				}, [ this ]);
			}

			return this._get('location').then(function (position) {
				// At least FirefoxDriver 2.41.0 incorrectly returns an object with additional `class` and `hCode`
				// properties
				return { x: position.x, y: position.y };
			});
		},

		getSize: function () {
			function getUsingExecute() {
				return self.session.execute(function (element) {
					var bbox = element.getBoundingClientRect();
					return { width: bbox.right - bbox.left, height: bbox.bottom - bbox.top };
				}, [ self ]);
			}

			var self = this;

			if (this.session.capabilities.brokenCssTransformedSize) {
				return getUsingExecute();
			}

			return this._get('size').otherwise(function (error) {
				// At least ios-driver 0.6.0-SNAPSHOT April 2014 does not support this command
				if (error.name === 'UnknownCommand') {
					return getUsingExecute();
				}

				throw error;
			}).then(function (dimensions) {
				// At least ChromeDriver 2.9 incorrectly returns an object with an additional `toString` property
				return { width: dimensions.width, height: dimensions.height };
			});
		},

		getComputedStyle: function (propertyName) {
			var self = this;
			return this._get('css/$0', null, [ propertyName ]).otherwise(function (error) {
				// At least Selendroid 0.9.0 does not support this command
				if (error.name === 'UnknownCommand') {
					return self.session.execute(function (element, propertyName) {
						return window.getComputedStyle(element, null)[propertyName];
					}, [ self, propertyName ]);
				}

				// At least ChromeDriver 2.9 incorrectly returns an error for property names it does not understand
				else if (error.name === 'UnknownError' && error.message.indexOf('failed to parse value') > -1) {
					return '';
				}

				throw error;
			}).then(function (value) {
				// At least ChromeDriver 2.9 and Selendroid 0.9.0 returns colour values as rgb instead of rgba
				if (value) {
					value = value.replace(/(.*\b)rgb\((\d+,\s*\d+,\s*\d+)\)(.*)/g, function (_, prefix, rgb, suffix) {
						return prefix + 'rgba(' + rgb + ', 1)' + suffix;
					});
				}

				// For consistency with Firefox, missing values are always returned as empty strings
				return value != null ? value : '';
			});
		}
	};

	strategies.applyTo(Element.prototype);
	waitForDeleted.applyTo(Element.prototype);

	return Element;
});
