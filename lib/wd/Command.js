define([
	'dojo/Deferred',
	'dojo/promise/when',
	'./strategies',
	'./Session'
], function (Deferred, when, strategies, Session) {
	/**
	 * A hash map of names of methods that accept an element as the first argument.
	 */
	var elementArgumentMethods = {
		clickElement: true,
		submit: true,
		text: true,
		getTagName: true,
		clear: true,
		isSelected: true,
		getAttribute: true,
		getValue: true,
		isDisplayed: true,
		getLocation: true,
		getSize: true,
		getComputedCss: true,
		moveTo: true,
		flick: true,
		isVisible: true,
		isEnabled: true,
		// `type` must be used with element context or else this happens in Safari:
		// https://code.google.com/p/selenium/issues/detail?id=4996
		type: true
	};

	/**
	 * A hash map of names of methods that operate using an element as the context. Only methods that do not have an
	 * entry in `elementArgumentMethods` of the same name are listed here, since they are just proxies back to those
	 * master methods.
	 */
	var elementContextMethods = {
		click: true,
		textPresent: true,
		equals: true
	};

	strategies.suffixes.forEach(function (suffix) {
		[ 'getElement_', 'getElements_' ].forEach(function (name) {
			name = name.replace('_', suffix);
			elementContextMethods[name] = true;
		});
	});

	function Command(session) {
		this._session = session;
		this._context = [];
		this._lastPromise = null;
	}

	Object.keys(Session.prototype).forEach(function (key) {
		var wrappedFunction = Session.prototype[key];

		if (/* not a private interface */ key.charAt(0) !== '_') {
			Command.prototype[key] = function () {
				var self = this,
					args = Array.prototype.slice.call(arguments, 0);

				this._lastPromise = when(this._lastPromise).then(function () {
					var thisArg = self,
						// Use a local pointer to wrappedFunction so that the original wrapped function is not
						// overridden when switching to use a method from the context element object instead
						targetFunction = wrappedFunction;

					// Methods that interact on elements should be modified to use the current context element as
					// `thisArg`
					if (elementContextMethods[key] && self._context.length) {
						thisArg = self._context[self._context.length - 1];
						targetFunction = thisArg[key];
					}

					// Methods that might accept an element argument should be modified to use the current context
					// element as the argument
					else if (elementArgumentMethods[key] && self._context.length) {
						args.unshift(self._context[self._context.length - 1]);
					}

					return targetFunction.apply(thisArg, args);
				}).then(function (lastReturnValue) {
					// Methods that get elements need to provide the element as context for the next call to the fluid
					// interface, so users can type e.g. `remote.elementById('foo').clickElement()` and it works as
					// expected.
					if (lastReturnValue instanceof Element) {
						self._context.push(lastReturnValue);
					}
					// We should also check to see if a DOM element is returned from remote execution, e.g. `execute`
					// or `safeExecute`. If this is the case, we should use this element as the context for the next
					//  call to maintain the fluid interface described above.
					else if (lastReturnValue && lastReturnValue.ELEMENT) {
						lastReturnValue = new Element(lastReturnValue.ELEMENT, self._wd);
						self._context.push(lastReturnValue);
					}
					return lastReturnValue;
				});

				return this;
			};
		}
	});

	/**
	 * Ends a context chain.
	 * @param {=number} numContextsToPop The number of element contexts to pop. Defaults to 1.
	 */
	Command.prototype.end = function (numContextsToPop) {
		var self = this;

		this._lastPromise = when(this._lastPromise).then(function (value) {
			numContextsToPop = numContextsToPop || 1;
			while (numContextsToPop-- && self._context.length) {
				self._context.pop();
			}

			return value;
		});

		return this;
	};

	/**
	 * Waits milliseconds before performing the next command.
	 * @param {number} ms Milliseconds to wait.
	 */
	Command.prototype.sleep = function (ms) {
		this._lastPromise = when(this._lastPromise).then(function () {
			var dfd = new Deferred(function (reason) {
				clearTimeout(timer);
				return reason;
			});

			var timer = setTimeout(function () {
				dfd.resolve();
			}, ms);

			return dfd.promise;
		});
		return this;
	};

	Command.prototype.then = function (callback, errback) {
		var self = this,
			dfd = new Deferred();

		function fixCallback(callback) {
			// `null`
			if (typeof callback !== 'function') {
				return callback;
			}

			return function () {
				self._lastPromise = undefined;

				try {
					var returnValue = callback.apply(self, arguments);

					when(self._lastPromise || returnValue).then(function (fulfilledValue) {
						dfd.resolve(fulfilledValue);
					}, function (error) {
						dfd.reject(error);
					});
				}
				catch (error) {
					dfd.reject(error);
				}

				return dfd.promise;
			};
		}

		this._lastPromise = this._lastPromise.then(fixCallback(callback), fixCallback(errback));

		return this;
	};

	Command.prototype.otherwise = function (errback) {
		return this.then(null, errback);
	};

	Command.prototype.always = function (callback) {
		return this.then(callback, callback);
	};

	/**
	 * Cancels the execution of the remaining chain of commands for this driver.
	 */
	Command.prototype.cancel = function () {
		this._lastPromise && this._lastPromise.cancel.apply(this._lastPromise, arguments);
		return this;
	};

	/**
	 * Cancels the execution of the remaining chain of commands for this driver and dereferences the old promise chain.
	 */
	Command.prototype.reset = function () {
		this.cancel();
		this._lastPromise = undefined;
		this._context = [];
		return this;
	};

	return Command;
});
