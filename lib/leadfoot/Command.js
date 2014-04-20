define([
	'dojo/Deferred',
	'dojo/promise/all',
	'./strategies',
	'./Session',
	'./Element',
	'./util'
], function (Deferred, whenAll, strategies, Session, Element, util) {
	function createDelegateMethod(handler) {
		return function () {
			var args = Array.prototype.slice.call(arguments, 0);

			this._lastPromise = this._lastPromise.then(handler.bind(this, args));

			return this;
		};
	}

	/**
	 * Creates a method that, when called, creates a new Command object, using the return value from the specified
	 * session method `command` as the context for the new Command object.
	 *
	 * @param {string} command
	 * @returns {Function}
	 */
	function createElementMethod(method) {
		return function () {
			var parent = this;
			var args = arguments;
			var context = this._context;
			var session = this._session;

			return new Command(session, this, function () {
				var newContext;
				// TODO: Actually, this might make no sense in the morning and we just need to flatten the returned
				// array from line 42
				if (context.length && parent._isSingleElementContext) {
					newContext = context[0][method].apply(context[0], args);
				}
				else if (context.length) {
					newContext = whenAll(context.map(function (element) {
						return element[method].apply(element, args);
					}));
				}
				else {
					newContext = session[method].apply(session, args);
				}

				return newContext;
			});
		};
	}

	/**
	 * Creates a method that, when called, creates a new Command object if the `asNewCommand` argument is `true`,
	 * otherwise invokes the original command on the current command.
	 *
	 * @param {string} command
	 * @returns {Function}
	 */
	function createExecuteMethod(method) {
		return function (code, args, asNewCommand) {
			var session = this._session;
			function execute() {
				return session[method](code, args);
			}

			if (asNewCommand) {
				return new Command(session, this, execute);
			}

			this._lastPromise = this._lastPromise.then(execute);

			return this;
		};
	}

	/**
	 * A Command is a chainable object that can be used to execute commands serially against a remote environment using
	 * a fluid interface.
	 *
	 * @param {module:leadfoot/Session} session
	 * @param {module:leadfoot/Command=} parent
	 * @param {function(): Promise.<(module:leadfoot/Element|Array.<module:leadfoot/Element>)>} initialiser
	 * A function that returns a Promise that resolves to one or more Elements to be used as the context for the
	 * command.
	 */
	function Command(session, parent, initialiser) {
		this._session = session;
		this._parent = parent;
		this._context = [];
		this._isSingleElementContext = true;

		if (initialiser) {
			var self = this;
			var context = this._context;
			var promise = parent ? parent.then(initialiser.bind(this)) : initialiser.call(this);
			this._lastPromise = promise.then(function (newContext) {
				if (Array.isArray(newContext)) {
					self._isSingleElementContext = false;
					context.push.apply(context, newContext);
				}
				else {
					context.push(newContext);
				}

				return newContext;
			});
		}
		else {
			this._lastPromise = util.createPromise(undefined);
		}
	}

	Command.prototype = {
		constructor: Command,

		/**
		 * The parent Command of the command, if one exists.
		 *
		 * @member {module:leadfoot/Command=} parent
		 * @memberOf module:leadfoot/Command#
		 * @readonly
		 */
		get parent() {
			return this._parent;
		},

		/**
		 * The parent Session of the command, if one exists.
		 *
		 * @member {module:leadfoot/Command=} parent
		 * @memberOf module:leadfoot/Command#
		 * @readonly
		 */
		get session() {
			return this._session;
		},

		/**
		 * The context Elements for the current command, if they exist.
		 *
		 * @member {module:leadfoot/Command=} parent
		 * @memberOf module:leadfoot/Command#
		 * @readonly
		 */
		get context() {
			return this._context;
		},

		getElement: createElementMethod('getElement'),
		getElements: createElementMethod('getElements'),
		getActiveElement: function () {
			var session = this._session;
			return new Command(session, this, function () {
				return session.getActiveElement();
			});
		},

		execute: createExecuteMethod('execute'),
		executeAsync: createExecuteMethod('executeAsync'),

		sleep: function (ms) {
			this._lastPromise = this._lastPromise.then(function () {
				return util.sleep(ms);
			});

			return this;
		},

		/**
		 * TODO
		 *
		 * @param {number=} numContextsToPop The number of element contexts to pop. Defaults to 1.
		 * @returns {module:leadfoot/Command}
		 */
		end: function (numCommandsToPop) {
			if (!numCommandsToPop) {
				numCommandsToPop = 1;
			}

			var command = this;
			while (numCommandsToPop--) {
				if (!command._parent) {
					break;
				}

				command = command._parent;
			}

			return command;
		},

		then: function (callback, errback) {
			var self = this;
			var dfd = new Deferred();

			function fixCallback(callback) {
				// `null`
				if (typeof callback !== 'function') {
					return callback;
				}

				return function () {
					self._lastPromise = util.createPromise(undefined);

					try {
						var returnValue = callback.apply(self, arguments);

						if (returnValue && returnValue.then) {
							returnValue.then(dfd.resolve.bind(dfd), dfd.reject.bind(dfd));
						}
						else {
							dfd.resolve(returnValue);
						}
					}
					catch (error) {
						dfd.reject(error);
					}

					return dfd.promise;
				};
			}

			this._lastPromise = this._lastPromise.then(fixCallback(callback), fixCallback(errback));

			return this;
		},

		otherwise: function (errback) {
			return this.then(null, errback);
		},

		always: function (callback) {
			return this.then(callback, callback);
		},

		cancel: function () {
			this._lastPromise && this._lastPromise.cancel.apply(this._lastPromise, arguments);
			return this;
		},

		reset: function () {
			this.cancel();
			this._lastPromise = util.createPromise(undefined);
			return this;
		}
	};

	strategies.applyTo(Command.prototype);

	Object.keys(Session.prototype).forEach(function (key) {
		if (key.charAt(0) !== '_' && !Command.prototype[key] && typeof Session.prototype[key] === 'function') {
			Command.prototype[key] = createDelegateMethod(function (args) {
				var session = this._session;
				var context = this._context;
				var fn = session[key];

				if (fn.usesElement && context.length) {
					if (this._isSingleElementContext) {
						return fn.apply(session, [ context[0] ].concat(args));
					}
					else {
						return whenAll(context.map(function (element) {
							return fn.apply(session, [ element ].concat(args));
						}));
					}
				}

				return fn.apply(session, args);
			});
		}
	});

	Object.keys(Element.prototype).forEach(function (key) {
		if (key.charAt(0) !== '_' && typeof Element.prototype[key] === 'function') {
			// some methods, like `click`, exist on both Session and Element; deduplicate these methods by appending the
			// element ones with 'Element'
			var targetKey = key + (Command.prototype[key] ? 'Element' : '');
			Command.prototype[targetKey] = createDelegateMethod(function (args) {
				var context = this._context;
				if (this._isSingleElementContext) {
					return context[0][key].apply(context[0], args);
				}
				else {
					return whenAll(context.map(function (element) {
						return element[key].apply(element, args);
					}));
				}
			});
		}
	});

	try {
		var chaiAsPromised = require.nodeRequire('chai-as-promised');
	}
	catch (error) {}

	if (chaiAsPromised) {
		chaiAsPromised.transferPromiseness = function (assertion, promise) {
			assertion.then = promise.then.bind(promise);
			Object.keys(Command.prototype).forEach(function (method) {
				if (typeof promise[method] === 'function') {
					assertion[method] = promise[method].bind(promise);
				}
			});
		};
	}

	return Command;
});
