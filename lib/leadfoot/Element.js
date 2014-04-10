define([
	'./strategies',
	'./waitForDeleted'
], function (strategies, waitForDeleted) {
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
			return this._post('click');
		},

		submit: function () {
			return this._post('submit');
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
			});
		},

		getTagName: function () {
			return this._get('name');
		},

		clearValue: function () {
			return this._post('clear');
		},

		isSelected: function () {
			return this._get('selected');
		},

		isEnabled: function () {
			return this._get('enabled');
		},

		getAttribute: function (name) {
			return this._get('attribute/$0', null, [ name ]);
		},

		equals: function (other) {
			if (other.ELEMENT) {
				other = other.ELEMENT;
			}
			else if (other.elementId) {
				other = other.elementId;
			}

			return this._get('equals/$0', null, [ other ]);
		},

		isDisplayed: function () {
			return this._get('displayed');
		},

		getPosition: function () {
			return this._get('location').then(function (position) {
				// At least FirefoxDriver 2.41.0 incorrectly returns an object with additional `class` and `hCode`
				// properties
				return { x: position.x, y: position.y };
			});
		},

		getSize: function () {
			return this._get('size').then(function (dimensions) {
				// At least ChromeDriver 2.9 incorrectly returns an object with an additional `toString` property
				return { width: dimensions.width, height: dimensions.height };
			});
		},

		getComputedStyle: function (propertyName) {
			return this._get('css/$0', null, [ propertyName ]).then(function (value) {
				// At least ChromeDriver 2.9 returns colour values as rgb instead of rgba
				value = value.replace(/(.*\b)rgb\((\d+, \d+, \d+)\)(.*)/g, function (_, prefix, rgb, suffix) {
					return prefix + 'rgba(' + rgb + ', 1)' + suffix;
				});

				return value;
			}, function (error) {
				// At least ChromeDriver 2.9 incorrectly returns an error for property names it does not understand
				if (error.name === 'UnknownError' && error.message.indexOf('failed to parse value') > -1) {
					return '';
				}

				throw error;
			});
		}
	};

	strategies.applyTo(Element.prototype);
	waitForDeleted.applyTo(Element.prototype);

	return Element;
});
