define([ './strategies' ], function (strategies) {
	function proxyToSession(method) {
		return function (path, requestData, pathParts) {
			path = 'element/' + this._elementId + '/' + path;
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
			return this._get('element', {
				using: using,
				value: value
			}).then(function (element) {
				return new Element(element, session);
			});
		},

		getElements: function (using, value) {
			var session = this._session;
			return this._get('elements', {
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

		setValue: function (value) {
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
			return this._get('location');
		},

		getSize: function () {
			return this._get('size');
		},

		getComputedStyle: function (propertyName) {
			return this._get('css', null, [ propertyName ]);
		}
	};

	strategies.applyTo(Element.prototype);

	return Element;
});
